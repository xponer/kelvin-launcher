using System.IO;
using System.Text.Json;

namespace VSpeedLauncher.Core;

/// <summary>
/// Worry-free "Update all": snapshot the current jars, apply every available
/// Modrinth update, BOOT-VERIFY the pack (the engine's existing boot/crash
/// detection), and roll everything back automatically if the updated pack
/// crashes at startup. The snapshot from the last run is kept for a manual
/// "Roll back" until the next safe update replaces it.
///
/// Snapshot layout: <c>&lt;instance&gt;/mods.rollback/</c> holds the pre-update
/// jars plus <c>manifest.json</c> ([{Old,New}] filenames). Restore = delete the
/// new jar, move the old one back.
/// </summary>
public sealed partial class CryoBridge
{
    private volatile bool _safeUpdateRunning;
    private CancellationTokenSource? _safeUpdateCts;

    private string RollbackDir(string id) =>
        Path.Combine(InstanceDataDir(id), "instances", id, "mods.rollback");
    private string RollbackManifest(string id) => Path.Combine(RollbackDir(id), "manifest.json");

    private sealed class RollbackEntry { public string Old { get; set; } = ""; public string New { get; set; } = ""; }

    private object GetSafeUpdate(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        bool hasSnapshot = File.Exists(RollbackManifest(id));
        long snapshotAt = 0;
        try { if (hasSnapshot) snapshotAt = new DateTimeOffset(File.GetLastWriteTimeUtc(RollbackManifest(id))).ToUnixTimeMilliseconds(); }
        catch { /* status only */ }
        return new { ok = true, running = _safeUpdateRunning, hasSnapshot, snapshotAt };
    }

    private object CancelSafeUpdate() { _safeUpdateCts?.Cancel(); return new { ok = true }; }

    private object RollbackUpdate(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_safeUpdateRunning) return new { ok = false, error = "A safe update is still running." };
        var running = _manager.FindById(id);
        if (running != null && running.State is InstanceState.Loading or InstanceState.Ready)
            return new { ok = false, error = "Stop the game first." };
        var n = RestoreRollback(id);
        return n >= 0 ? new { ok = true, restored = n }
                      : new { ok = false, error = "No update snapshot to roll back to." };
    }

    /// <summary>Puts mods/ back to the snapshot. Returns restored count, or -1 when no manifest exists.</summary>
    private int RestoreRollback(string id)
    {
        var manifest = RollbackManifest(id);
        if (!File.Exists(manifest)) return -1;
        var modsDir = BisectModsDir(id);
        List<RollbackEntry> entries;
        try { entries = JsonSerializer.Deserialize<List<RollbackEntry>>(File.ReadAllText(manifest)) ?? new(); }
        catch { entries = new(); }

        int restored = 0;
        foreach (var e in entries)
        {
            try
            {
                // Drop the updated jar (unless the update reused the same filename —
                // then the move below overwrites it).
                var newPath = Path.Combine(modsDir, e.New);
                if (e.New.Length > 0 && File.Exists(newPath)
                    && !string.Equals(e.New, e.Old, StringComparison.OrdinalIgnoreCase))
                    File.Delete(newPath);

                var snap = Path.Combine(RollbackDir(id), e.Old);
                if (File.Exists(snap))
                {
                    var back = Path.Combine(modsDir, e.Old);
                    if (File.Exists(back)) File.Delete(back);
                    File.Move(snap, back);
                }
                restored++;
            }
            catch (Exception ex) { Logger.Warn($"Rollback '{e.Old}': {ex.Message}"); }
        }
        try { Directory.Delete(RollbackDir(id), recursive: true); } catch { /* leftovers are harmless */ }
        Logger.Info($"SafeUpdate({id}): rolled back {restored} mod(s)");
        return restored;
    }

    private object StartSafeUpdate(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_safeUpdateRunning) return new { ok = false, error = "A safe update is already running." };
        if (_bisectRunning)     return new { ok = false, error = "Wait for the crash bisector to finish first." };
        if (_benchRunning)      return new { ok = false, error = "Wait for the benchmark to finish first." };
        var inst = _manager.FindById(id);
        if (inst == null) return new { ok = false, error = $"Instance not found: {id}" };
        if (inst.State is InstanceState.Loading or InstanceState.Ready)
            return new { ok = false, error = "Stop the game first." };
        if (GetStoredEngineVersion(id) == null)
            return new { ok = false, error = "Safe update boot-verifies the pack through the Cryo engine — install it in Performance → Cryo Engine first." };
        if (!MicrosoftAccount.Instance.LoggedIn)
            return new { ok = false, error = "Sign in first — the verify step launches the real game." };

        _safeUpdateCts = new CancellationTokenSource();
        _safeUpdateRunning = true;
        _ = Task.Run(() => RunSafeUpdateAsync(inst, _safeUpdateCts.Token));
        return new { ok = true };
    }

    private async Task RunSafeUpdateAsync(RunningInstance inst, CancellationToken ct)
    {
        var id = inst.Entry.Id;
        void Ev(object payload) => Push("safeUpdateEvent", payload);
        bool snapshotTaken = false;
        try
        {
            var modsDir = BisectModsDir(id);
            var meta    = InstanceMetaReader.Read(id, InstanceDataDir(id));

            // ── 1) Find updates (hash → Modrinth, same as CheckModUpdates) ──
            Ev(new { phase = "checking", message = "Hashing mods and checking Modrinth…" });
            var files      = Directory.Exists(modsDir) ? Directory.GetFiles(modsDir, "*.jar") : Array.Empty<string>();
            var hashToFile = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var f in files)
            {
                ct.ThrowIfCancellationRequested();
                var h = Convert.ToHexString(System.Security.Cryptography.SHA512.HashData(
                    await File.ReadAllBytesAsync(f, ct))).ToLowerInvariant();
                hashToFile[h] = f;
            }
            var result  = await _modrinth.CheckUpdatesAsync(hashToFile.Keys.ToList(), meta.Mc, meta.Loader);
            var updates = new List<(string oldFile, string newFilename, string url, string sha512, string version)>();
            if (result is System.Text.Json.Nodes.JsonObject map)
                foreach (var kv in map)
                {
                    if (!hashToFile.TryGetValue(kv.Key, out var localPath)) continue;
                    var vFiles = kv.Value?["files"]?.AsArray();
                    if (vFiles == null || vFiles.Count == 0) continue;
                    if (vFiles.Any(x => string.Equals(x?["hashes"]?["sha512"]?.GetValue<string>(), kv.Key, StringComparison.OrdinalIgnoreCase)))
                        continue;   // already the latest
                    var nf = vFiles.FirstOrDefault(x => x?["primary"]?.GetValue<bool>() == true) ?? vFiles[0];
                    var url = nf?["url"]?.GetValue<string>() ?? "";
                    var fn  = nf?["filename"]?.GetValue<string>() ?? "";
                    if (url.Length == 0 || fn.Length == 0) continue;
                    updates.Add((Path.GetFileName(localPath)!, Path.GetFileName(fn),
                                 url, nf?["hashes"]?["sha512"]?.GetValue<string>() ?? "",
                                 kv.Value?["version_number"]?.GetValue<string>() ?? ""));
                }
            if (updates.Count == 0)
            {
                Ev(new { phase = "upToDate", message = $"All {files.Length} mods are already on their latest versions." });
                return;
            }

            // ── 2) Snapshot: move the old jars out of mods/ ──────────────────
            Ev(new { phase = "snapshot", count = updates.Count,
                     message = $"Snapshotting {updates.Count} mod(s) before updating…" });
            try { if (Directory.Exists(RollbackDir(id))) Directory.Delete(RollbackDir(id), recursive: true); } catch { }
            Directory.CreateDirectory(RollbackDir(id));
            var manifest = new List<RollbackEntry>();
            foreach (var u in updates)
            {
                var src = Path.Combine(modsDir, u.oldFile);
                if (!File.Exists(src)) continue;
                File.Move(src, Path.Combine(RollbackDir(id), u.oldFile));
                manifest.Add(new RollbackEntry { Old = u.oldFile, New = u.newFilename });
            }
            File.WriteAllText(RollbackManifest(id), JsonSerializer.Serialize(manifest));
            snapshotTaken = true;

            // ── 3) Download the new jars ─────────────────────────────────────
            int done = 0, failed = 0;
            foreach (var u in updates)
            {
                ct.ThrowIfCancellationRequested();
                done++;
                Ev(new { phase = "downloading", done, total = updates.Count,
                         message = $"Updating {u.oldFile} → {u.newFilename} ({done}/{updates.Count})…" });
                try { await _modrinth.DownloadFileAsync(u.url, u.newFilename, u.sha512, modsDir); }
                catch (Exception ex)
                {
                    // Failed download: put THIS mod's old jar straight back and keep going.
                    failed++;
                    Logger.Warn($"SafeUpdate({id}): download {u.newFilename} failed: {ex.Message}");
                    try
                    {
                        var snap = Path.Combine(RollbackDir(id), u.oldFile);
                        if (File.Exists(snap)) File.Move(snap, Path.Combine(modsDir, u.oldFile), overwrite: true);
                        manifest.RemoveAll(m => m.Old.Equals(u.oldFile, StringComparison.OrdinalIgnoreCase));
                        File.WriteAllText(RollbackManifest(id), JsonSerializer.Serialize(manifest));
                    }
                    catch (Exception rx) { Logger.Warn($"SafeUpdate({id}): inline restore '{u.oldFile}': {rx.Message}"); }
                }
            }
            int applied = updates.Count - failed;
            if (applied == 0)
            {
                try { Directory.Delete(RollbackDir(id), recursive: true); } catch { }
                Ev(new { phase = "error", message = "Every download failed — nothing was changed. Check your connection and try again." });
                return;
            }

            // ── 4) Boot-verify with the engine's boot/crash detection ───────
            Ev(new { phase = "verifying", applied, failed,
                     message = $"Updated {applied} mod(s) — boot-verifying the pack now (this launches the game once)…" });
            bool? crashed = null;
            var bootTcs = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
            var proc = await EngineLaunchAsync(id, "", "auto", bootTcs);
            if (proc != null)
            {
                var exit   = proc.WaitForExitAsync(ct);
                var winner = await Task.WhenAny(bootTcs.Task, exit, Task.Delay(TimeSpan.FromMinutes(15), ct));
                // "Verified" means a MEASURED boot (>0). -2 = fatal/error screen,
                // -1 = process died first; any exit before the menu is a failure.
                if (winner == bootTcs.Task) crashed = bootTcs.Task.Result <= 0;
                else if (winner == exit)    crashed = true;
                await Task.Delay(1500, CancellationToken.None);
                try { _manager.Kill(inst); } catch { /* already gone */ }
                try { await proc.WaitForExitAsync(new CancellationTokenSource(30_000).Token); } catch { /* keep going */ }
            }

            // ── 5) Verdict ───────────────────────────────────────────────────
            if (crashed == true)
            {
                var restored = RestoreRollback(id);
                Ev(new { phase = "rolledBack", restored,
                         message = $"The updated pack CRASHED at startup — all {restored} mod(s) were rolled back automatically. You're on the previous, working versions." });
            }
            else if (crashed == false)
            {
                Logger.Info($"SafeUpdate({id}): {applied} update(s) applied and boot-verified");
                Ev(new { phase = "done", applied, failed,
                         message = $"Updated {applied} mod(s) and verified the pack boots to the menu."
                                   + (failed > 0 ? $" ({failed} download(s) failed and kept their old version.)" : "") });
            }
            else
            {
                Ev(new { phase = "inconclusive", applied,
                         message = "The verify launch neither crashed nor reached the menu in 15 minutes. The updates are KEPT and the snapshot is saved — use \"Roll back\" if the pack misbehaves." });
            }
        }
        catch (OperationCanceledException)
        {
            if (snapshotTaken) RestoreRollback(id);
            try { _manager.Kill(inst); } catch { /* already gone */ }
            Ev(new { phase = "cancelled", message = "Safe update cancelled — all mods restored to their previous versions." });
        }
        catch (Exception e)
        {
            if (snapshotTaken) RestoreRollback(id);
            Logger.Warn($"SafeUpdate({id}): {e.Message}");
            Ev(new { phase = "error", message = e.Message + (snapshotTaken ? " — all mods were restored." : "") });
        }
        finally { _safeUpdateRunning = false; }
    }
}
