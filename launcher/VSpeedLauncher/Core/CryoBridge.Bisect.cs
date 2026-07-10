using System.IO;
using System.Text.Json;

namespace VSpeedLauncher.Core;

/// <summary>
/// Crash bisector — "find the broken mod". When a pack crashes at startup,
/// binary-search the mods folder: disable a dependency-closed half (rename
/// <c>.jar</c> → <c>.jar.bisect-off</c>, a suffix the loaders ignore and that
/// can't collide with user-disabled <c>.jar.disabled</c> files), boot the pack
/// via the engine, watch boot-vs-crash with the existing log-marker detection,
/// and keep the half that still crashes. ~9 automated boots isolate one culprit
/// out of ~500 mods. All renames are journaled to <c>cryo-bisect.json</c> in
/// the instance folder so a launcher crash mid-run is recoverable.
/// </summary>
public sealed partial class CryoBridge
{
    private const string BisectSuffix = ".bisect-off";        // appended to ".jar"
    private volatile bool _bisectRunning;
    private CancellationTokenSource? _bisectCts;

    private string BisectJournalPath(string id) =>
        Path.Combine(InstanceDataDir(id), "instances", id, "cryo-bisect.json");

    private string BisectModsDir(string id) =>
        Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");

    /// <summary>Re-enables every jar the bisector disabled (idempotent).</summary>
    private int BisectRestoreAll(string id)
    {
        int restored = 0;
        var modsDir = BisectModsDir(id);
        if (!Directory.Exists(modsDir)) return 0;
        foreach (var f in Directory.EnumerateFiles(modsDir, "*.jar" + BisectSuffix).ToList())
        {
            var target = f[..^BisectSuffix.Length];
            try
            {
                if (File.Exists(target)) File.Delete(f);   // duplicate landed meanwhile — drop ours
                else File.Move(f, target);
                restored++;
            }
            catch (Exception e) { Logger.Warn($"Bisect restore '{Path.GetFileName(f)}': {e.Message}"); }
        }
        try { File.Delete(BisectJournalPath(id)); } catch { /* absent is fine */ }
        return restored;
    }

    private object GetBisect(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        bool leftovers = false;
        try
        {
            var modsDir = BisectModsDir(id);
            leftovers = !_bisectRunning && Directory.Exists(modsDir)
                     && Directory.EnumerateFiles(modsDir, "*.jar" + BisectSuffix).Any();
        }
        catch { /* status only */ }
        return new { ok = true, running = _bisectRunning, leftovers };
    }

    private object RestoreBisect(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_bisectRunning) return new { ok = false, error = "A bisect run is still active." };
        var n = BisectRestoreAll(id);
        Logger.Info($"Bisect: restored {n} jar(s) for {id}");
        return new { ok = true, restored = n };
    }

    private object CancelBisect()
    {
        _bisectCts?.Cancel();
        return new { ok = true };
    }

    private object StartBisect(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_bisectRunning)     return new { ok = false, error = "A bisect run is already active." };
        if (_benchRunning)      return new { ok = false, error = "Wait for the benchmark to finish first." };

        var inst = _manager.FindById(id);
        if (inst == null) return new { ok = false, error = $"Instance not found: {id}" };
        if (inst.State is InstanceState.Loading or InstanceState.Ready)
            return new { ok = false, error = "Stop the game first." };
        if (GetStoredEngineVersion(id) == null)
            return new { ok = false, error = "Install the Cryo engine for this instance first (Performance → Cryo engine)." };

        _bisectCts = new CancellationTokenSource();
        _bisectRunning = true;
        _ = Task.Run(() => RunBisectAsync(inst, _bisectCts.Token));
        return new { ok = true };
    }

    private async Task RunBisectAsync(RunningInstance inst, CancellationToken ct)
    {
        var id = inst.Entry.Id;
        void Ev(object payload) => Push("bisectEvent", payload);

        try
        {
            var modsDir = BisectModsDir(id);
            BisectRestoreAll(id);   // clean slate if a previous run died

            // ── Build the dependency picture ────────────────────────────────
            // provides[jar] = ids this jar satisfies (own + JarJar-nested);
            // requires[jar] = required ids (platform ids excluded).
            Ev(new { phase = "scan", message = "Reading mod metadata…" });
            var jars = Directory.EnumerateFiles(modsDir, "*.jar")
                                .Select(f => Path.GetFileName(f)!)
                                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                                .ToList();
            if (jars.Count < 2) { Ev(new { phase = "error", message = "Fewer than two enabled mods — nothing to bisect." }); return; }

            var provides = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            var requires = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var jar in jars)
            {
                ct.ThrowIfCancellationRequested();
                var path = Path.Combine(modsDir, jar);
                var info = ReadModGraphInfo(path);
                var prov = new HashSet<string>(info.OwnIds, StringComparer.OrdinalIgnoreCase);
                foreach (var nid in CollectNestedModIds(path)) prov.Add(nid);
                provides[jar] = prov;
                requires[jar] = info.Deps.Where(d => d.Required && !_ignoreModIds.Contains(d.Target))
                                         .Select(d => d.Target)
                                         .ToHashSet(StringComparer.OrdinalIgnoreCase);
            }

            // Dependency closure: given a set to disable, also disable every enabled
            // jar whose required ids are no longer satisfied by any enabled jar.
            HashSet<string> Closure(IEnumerable<string> seed)
            {
                var off = new HashSet<string>(seed, StringComparer.OrdinalIgnoreCase);
                bool grew = true;
                while (grew)
                {
                    grew = false;
                    var satisfied = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var j in jars) if (!off.Contains(j)) satisfied.UnionWith(provides[j]);
                    foreach (var j in jars)
                    {
                        if (off.Contains(j)) continue;
                        if (requires[j].Any(r => !satisfied.Contains(r) && provides.Values.Any(p => p.Contains(r))))
                        { off.Add(j); grew = true; }
                    }
                }
                return off;
            }

            async Task<bool?> BootOnce(string label, int step, int total, IReadOnlyCollection<string> off)
            {
                // Journal BEFORE renaming so a dead launcher can always restore.
                try { File.WriteAllText(BisectJournalPath(id), JsonSerializer.Serialize(off)); } catch { /* best effort */ }
                foreach (var j in off)
                {
                    var src = Path.Combine(modsDir, j);
                    try { if (File.Exists(src)) File.Move(src, src + BisectSuffix); }
                    catch (Exception e) { Logger.Warn($"Bisect disable '{j}': {e.Message}"); }
                }
                Ev(new { phase = "boot", step, total, disabled = off.Count, message = label });

                bool? crashed = null;   // null = timeout / inconclusive
                try
                {
                    var bootTcs = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
                    var proc = await EngineLaunchAsync(id, "", "default", bootTcs);
                    if (proc == null) { crashed = null; }
                    else
                    {
                        var exit = proc.WaitForExitAsync(ct);
                        var winner = await Task.WhenAny(bootTcs.Task, exit, Task.Delay(TimeSpan.FromMinutes(15), ct));
                        // A measured boot (>0) is the only "runs fine". -2 = the boot
                        // watcher saw a fatal / mod-loading-error screen; -1 or an
                        // exit before the menu = the game died — both count as crashed.
                        if (winner == bootTcs.Task)      crashed = bootTcs.Task.Result <= 0;
                        else if (winner == exit)         crashed = true;
                        // else: 15-min timeout without menu or exit → inconclusive
                        await Task.Delay(1500, ct);
                        try { _manager.Kill(inst); } catch { /* already gone */ }
                        try { await proc.WaitForExitAsync(new CancellationTokenSource(30_000).Token); } catch { /* keep going */ }
                    }
                }
                finally
                {
                    BisectRestoreAll(id);
                    await Task.Delay(3000, CancellationToken.None);   // let the tree die before the next boot
                }
                return crashed;
            }

            // ── Round 0: reproduce the crash with everything enabled ───────
            int totalSteps = (int)Math.Ceiling(Math.Log2(jars.Count)) + 1;
            var baseline = await BootOnce("Reproducing the crash (all mods enabled)…", 1, totalSteps, Array.Empty<string>());
            ct.ThrowIfCancellationRequested();
            if (baseline == false)
            {
                Ev(new { phase = "noCrash", message = "The pack booted to the menu with all mods enabled — no startup crash to bisect." });
                return;
            }
            if (baseline == null)
            {
                Ev(new { phase = "error", message = "The baseline launch neither crashed nor reached the menu within 15 minutes — can't bisect reliably." });
                return;
            }

            // ── Binary search ───────────────────────────────────────────────
            var candidates = new List<string>(jars);
            int stepNo = 1;
            while (candidates.Count > 1 && stepNo < 16)
            {
                ct.ThrowIfCancellationRequested();
                stepNo++;
                var half = candidates.Take(candidates.Count / 2).ToList();
                var off  = Closure(half);
                var crashed = await BootOnce(
                    $"Testing with {off.Count} mod(s) disabled ({candidates.Count} suspects left)…",
                    stepNo, totalSteps, off.ToList());
                ct.ThrowIfCancellationRequested();

                List<string> next;
                if (crashed == true)       next = candidates.Where(c => !off.Contains(c)).ToList();  // culprit still enabled
                else if (crashed == false) next = candidates.Where(c => off.Contains(c)).ToList();   // culprit was disabled
                else { Ev(new { phase = "error", message = "A test launch was inconclusive (no crash, no menu) — stopped. Try again." }); return; }

                if (next.Count == 0 || next.Count == candidates.Count)
                {
                    Ev(new { phase = "error", message = "The crash didn't follow either half — it's likely caused by a mod INTERACTION or is not mod-related (RAM, drivers, corrupted config). See the crash report." });
                    return;
                }
                candidates = next;
                Ev(new { phase = "narrowed", step = stepNo, total = totalSteps, remaining = candidates.Count,
                         suspects = candidates.Take(6).ToArray() });
            }

            var culprit = candidates[0];
            // Leave the pack playable: disable the culprit with the STANDARD
            // ".disabled" convention so the Mods tab can re-enable it.
            try
            {
                var src = Path.Combine(modsDir, culprit);
                if (File.Exists(src)) File.Move(src, src + ".disabled");
            }
            catch (Exception e) { Logger.Warn($"Bisect: couldn't disable culprit '{culprit}': {e.Message}"); }

            Logger.Info($"Bisect({id}): culprit = {culprit} after {stepNo} boots");
            Ev(new { phase = "done", culprit, steps = stepNo,
                     message = $"Culprit found: {culprit} — it has been disabled (re-enable it any time in the Mods tab)." });
        }
        catch (OperationCanceledException)
        {
            BisectRestoreAll(id);
            try { _manager.Kill(inst); } catch { /* already gone */ }
            Ev(new { phase = "cancelled", message = "Bisect cancelled — all mods restored." });
        }
        catch (Exception e)
        {
            BisectRestoreAll(id);
            Logger.Warn($"Bisect({id}): {e.Message}");
            Ev(new { phase = "error", message = e.Message });
        }
        finally { _bisectRunning = false; }
    }
}
