using System.IO;
using System.Text.Json.Nodes;

namespace VSpeedLauncher.Core;

/// <summary>
/// "Prepare pack" — the whole speed toolkit as ONE unattended button: apply the
/// Pack Optimizer's safe fixes (perf mods → ModernFix dynamic resources → RAM →
/// Turbo enable + runtime download) and then run the Default-vs-Turbo benchmark,
/// which trains the AOT cache when needed and measures both paths. Install a
/// pack, click Prepare, come back to a tuned pack with a measured number.
///
/// The Defender exclusion is deliberately NOT part of this: it pops a UAC
/// prompt, and an unattended pipeline must never sit waiting on one.
/// Fix steps are individually non-fatal (a skipped perf mod shouldn't kill the
/// benchmark); only the benchmark phase decides success.
/// </summary>
public sealed partial class CryoBridge
{
    private volatile bool _prepRunning;
    private CancellationTokenSource? _prepCts;

    private object GetPrepare(string id) => new { ok = true, running = _prepRunning };

    private object CancelPrepare()
    {
        _prepCts?.Cancel();
        return new { ok = true };
    }

    private object StartPrepare(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_prepRunning)       return new { ok = false, error = "Prepare is already running." };
        if (_benchRunning)      return new { ok = false, error = "Wait for the benchmark to finish first." };
        if (_bisectRunning)     return new { ok = false, error = "Wait for the crash bisector to finish first." };
        if (_safeUpdateRunning) return new { ok = false, error = "Wait for the safe update to finish first." };
        var inst = _manager.FindById(id);
        if (inst == null) return new { ok = false, error = $"Instance not found: {id}" };
        if (inst.State is InstanceState.Loading or InstanceState.Ready)
            return new { ok = false, error = "Stop the game first." };
        if (GetStoredEngineVersion(id) == null)
            return new { ok = false, error = "Install the Cryo engine for this instance first (Performance → Cryo Engine)." };
        if (!MicrosoftAccount.Instance.LoggedIn)
            return new { ok = false, error = "Sign in first — Prepare launches the real game to train and measure." };
        var meta = InstanceMetaReader.Read(id, InstanceDataDir(id));
        if (JavaMajorForMc(meta.Mc) < 21)
            return new { ok = false, error = "Prepare needs Minecraft 1.20.5+ (VSpeed Turbo requires Java-21-era packs)." };

        _prepCts = new CancellationTokenSource();
        _prepRunning = true;
        // Claim the benchmark lock for the whole pipeline so benchmark/bisect/
        // safe-update can't start mid-run (they all check _benchRunning).
        _benchRunning = true;
        _ = Task.Run(() => RunPrepareAsync(inst, _prepCts.Token));
        return new { ok = true };
    }

    private async Task RunPrepareAsync(RunningInstance inst, CancellationToken ct)
    {
        var id = inst.Entry.Id;
        void Ev(object payload) => Push("prepEvent", payload);
        try
        {
            // ── 1) Curated performance mods (skips are fine) ────────────────
            Ev(new { phase = "mods", step = 1, total = 4, message = "Installing performance mods for this loader…" });
            var addedMods = new List<string>();
            try
            {
                var (installed, skipped, added) = await InstallPerfPackCoreAsync(id);
                addedMods = added;
                Logger.Info($"Prepare({id}): perf pack installed={installed}, skipped={skipped}, added=[{string.Join(", ", added)}]");
            }
            catch (Exception e) { Logger.Warn($"Prepare({id}): perf pack skipped: {e.Message}"); }
            ct.ThrowIfCancellationRequested();

            // ── 2) ModernFix dynamic resources (only when the mod is there) ─
            Ev(new { phase = "dynres", step = 2, total = 4, message = "Enabling ModernFix dynamic resources…" });
            try
            {
                var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
                bool modernfix = Directory.Exists(modsDir) && Directory.EnumerateFiles(modsDir, "*.jar")
                    .Any(f => Path.GetFileName(f).StartsWith("modernfix", StringComparison.OrdinalIgnoreCase));
                if (modernfix) SetDynamicResources(id, true);
            }
            catch (Exception e) { Logger.Warn($"Prepare({id}): dynRes skipped: {e.Message}"); }

            // ── 3) RAM to recommendation + Turbo on (runtime download) ──────
            Ev(new { phase = "tune", step = 3, total = 4, message = "Tuning memory and enabling VSpeed Turbo…" });
            try
            {
                var meta  = InstanceMetaReader.Read(id, InstanceDataDir(id));
                var cfgKv = ReadInstanceCfgGeneral(id);
                int rec   = RecommendRamMb(meta.ModCount, SystemRamMb());
                // Explicit-but-too-low gets raised; unset stays unset (the engine
                // auto-sizes at launch anyway).
                if (cfgKv.ContainsKey("MaxMemAlloc") && meta.RamMax < rec)
                    SaveInstanceCfg(id, new JsonObject { ["ramMax"] = rec, ["ramMin"] = rec });
            }
            catch (Exception e) { Logger.Warn($"Prepare({id}): RAM tune skipped: {e.Message}"); }

            var st = TurboRuntime.LoadState(id);
            if (!st.Enabled) { st.Enabled = true; st.LastError = ""; TurboRuntime.SaveState(id, st); }
            if (TurboRuntime.FindJavaw() == null)
            {
                Ev(new { phase = "runtime", step = 3, total = 4, message = "Downloading the Java 25 Turbo runtime (one time)…" });
                await TurboRuntime.ProvisionAsync((msg, done, total) =>
                    Push("turboProgress", new { id, message = msg, bytesDone = done, bytesTotal = total }));
                Push("turboDone", new { id, javaVersion = TurboRuntime.InstalledVersion() });
            }
            ct.ThrowIfCancellationRequested();

            // ── 4) Benchmark: trains the AOT cache if needed + measures both ─
            Ev(new { phase = "benchmark", step = 4, total = 4,
                     message = "Running the Default-vs-Turbo benchmark — 2-3 full launches, fully unattended…" });
            var (defBoot, turboBoot) = await RunBenchmarkAsync(inst, ct);

            if (defBoot > 0 && turboBoot > 0)
            {
                double pct = Math.Round((1.0 - (double)turboBoot / defBoot) * 100.0, 1);
                Logger.Info($"Prepare({id}): done — default {defBoot}s vs turbo {turboBoot}s ({pct}%)");
                Ev(new { phase = "done", bootDefault = defBoot, bootTurbo = turboBoot, deltaPercent = pct,
                         message = $"Pack ready: {defBoot}s default → {turboBoot}s Turbo (−{pct}%). Optimized, trained and measured." });
            }
            else
            {
                // The pack may be failing BECAUSE of what step 1 added — undo it,
                // same philosophy as the safe-update rollback.
                int removed = 0;
                var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
                foreach (var f in addedMods)
                    try { var p = Path.Combine(modsDir, f); if (File.Exists(p)) { File.Delete(p); removed++; } }
                    catch (Exception rx) { Logger.Warn($"Prepare({id}): undo '{f}': {rx.Message}"); }
                if (removed > 0) Logger.Info($"Prepare({id}): benchmark failed — removed the {removed} mod(s) step 1 added");
                Ev(new { phase = "error",
                         message = "The benchmark couldn't measure both launches — see the benchmark card for what happened."
                                   + (removed > 0 ? $" The {removed} mod(s) Prepare added were removed again, in case one of them caused it." : "") });
            }
        }
        catch (OperationCanceledException)
        {
            try { _manager.Kill(inst); } catch { /* already gone */ }
            Ev(new { phase = "cancelled", message = "Prepare cancelled." });
        }
        catch (Exception e)
        {
            Logger.Warn($"Prepare({id}): {e.Message}");
            Ev(new { phase = "error", message = e.Message });
        }
        finally { _prepRunning = false; _benchRunning = false; }
    }
}
