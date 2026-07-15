using System.IO;
using System.Text.Json.Nodes;

namespace VSpeedLauncher.Core;

/// <summary>
/// World Pre-Baker — the "generate chunks efficiently" idea, delivered without
/// a native worldgen (which can't run a modpack's Java worldgen anyway). It
/// pregenerates chunks on the pack's OWN dedicated server (Chunky), then merges
/// the generated region files back into your singleplayer save. Result: when
/// you explore in-game, the chunks already exist — no chunk-gen stutter, on ANY
/// pack, because the pack's own server did the generating.
///
/// Flow: back up the save → copy it into the hosted server as its world →
/// install Chunky server-side → boot the server → `chunky radius`/`start`,
/// poll the console for progress → `stop` → merge NEW region files back into
/// the save (never overwriting existing chunks, so player edits are safe).
///
/// Reuses the v1.0.14 server engine (setup/start/console). Requires the server
/// to be set up once (Host server tab) — that path is already battle-tested.
/// </summary>
public sealed partial class CryoBridge
{
    private volatile bool _prebakeRunning;
    private CancellationTokenSource? _prebakeCts;

    // Region-bearing subfolders of a save/world (overworld + vanilla nether/end +
    // any modded dimensions under dimensions/).
    private static readonly string[] RegionRoots = { "region", "DIM-1/region", "DIM1/region" };

    private object GetPrebake(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        var m = LoadServerMeta(id);
        return new
        {
            ok = true,
            running   = _prebakeRunning,
            world     = NewestWorld(id) ?? "",
            serverReady = m["setupDone"]?.GetValue<bool>() ?? false,
        };
    }

    private object CancelPrebake() { _prebakeCts?.Cancel(); return new { ok = true }; }

    private object StartPrebake(string id, int radius)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_prebakeRunning)    return new { ok = false, error = "A pre-bake is already running." };
        radius = Math.Clamp(radius, 250, 5000);

        var world = NewestWorld(id);
        if (world == null) return new { ok = false, error = "No singleplayer world to pre-bake — create one first." };
        var m = LoadServerMeta(id);
        if (!(m["setupDone"]?.GetValue<bool>() ?? false))
            return new { ok = false, error = "Set up the server for this pack first (Host server tab → Set up server) — the pre-baker uses it to generate chunks." };
        if (!IsLoaderServerSupported(InstanceMetaReader.Read(id, InstanceDataDir(id)).Loader))
            return new { ok = false, error = "Pre-bake supports NeoForge, Fabric and Vanilla packs." };
        var srv = _servers.GetValueOrDefault(id);
        if (srv?.Proc is { HasExited: false })
            return new { ok = false, error = "Stop the hosted server first — the pre-baker needs exclusive use of it." };

        _prebakeCts = new CancellationTokenSource();
        _prebakeRunning = true;
        _ = Task.Run(() => RunPrebakeAsync(id, world, radius, _prebakeCts.Token));
        return new { ok = true };
    }

    private async Task RunPrebakeAsync(string id, string world, int radius, CancellationToken ct)
    {
        void Ev(object p) => Push("prebakeEvent", p);
        var saveDir   = Path.Combine(InstanceMcDir(id), "saves", world);
        var serverDir = ServerDir(id);
        var serverWorld = Path.Combine(serverDir, "world");
        try
        {
            // ── 1) Back up the save (zip, keep last few) ────────────────────
            Ev(new { phase = "backup", message = "Backing up your world before touching it…" });
            AutoBackupWorlds(id);   // existing world backup helper

            // ── 2) Install Chunky into the server's mods (once) ─────────────
            Ev(new { phase = "chunky", message = "Installing Chunky (server-side pre-generator)…" });
            var meta = InstanceMetaReader.Read(id, InstanceDataDir(id));
            var serverMods = Path.Combine(serverDir, "mods");
            Directory.CreateDirectory(serverMods);
            bool haveChunky = Directory.EnumerateFiles(serverMods, "*.jar")
                .Any(f => Path.GetFileName(f).StartsWith("chunky", StringComparison.OrdinalIgnoreCase)
                       || Path.GetFileName(f).Contains("Chunky", StringComparison.OrdinalIgnoreCase));
            if (!haveChunky)
            {
                var ver = (await _modrinth.GetVersionsAsync("chunky", meta.Mc, meta.Loader) as JsonArray)?.FirstOrDefault();
                var files = ver?["files"]?.AsArray();
                var pf = files?.FirstOrDefault(f => f?["primary"]?.GetValue<bool>() == true) ?? (files != null && files.Count > 0 ? files[0] : null);
                var url = pf?["url"]?.GetValue<string>();
                var fn  = pf?["filename"]?.GetValue<string>();
                if (url == null || fn == null)
                    throw new Exception($"Chunky isn't available for {meta.Loader} {meta.Mc} on Modrinth — can't pre-bake this pack.");
                await _modrinth.DownloadFileAsync(url, fn, pf?["hashes"]?["sha512"]?.GetValue<string>(), serverMods);
            }

            // ── 3) Seed the server world from the save ──────────────────────
            // Copy the whole save in (so the server generates AROUND your existing
            // chunks with the same seed), overwriting the server's previous world.
            Ev(new { phase = "seed", message = "Copying your world into the server so it generates from the same seed…" });
            try { if (Directory.Exists(serverWorld)) Directory.Delete(serverWorld, recursive: true); } catch { }
            ct.ThrowIfCancellationRequested();
            CopyTree(saveDir, serverWorld, overwrite: true);
            SetServerProp(serverDir, "level-name", "world");
            SetServerProp(serverDir, "level-type", "minecraft:normal");

            // ── 4) Boot the server headlessly, wait for "Done" ──────────────
            Ev(new { phase = "starting", message = "Starting the pack's server (loads all its mods — a few minutes)…" });
            var lm = LoadServerMeta(id);
            lm["eulaAccepted"] = true; SaveServerMeta(id, lm);
            File.WriteAllText(Path.Combine(serverDir, "eula.txt"), "eula=true\n");

            var srv = GetSrv(id);
            int mark = 0; lock (srv.Gate) mark = srv.Buffer.Count;
            var startRes = StartServer(id);
            if (startRes is not null && startRes.GetType().GetProperty("ok")?.GetValue(startRes) is false)
                throw new Exception("Couldn't start the server — see the Host server console.");

            if (!await WaitForServerLine(srv, mark, l =>
                    l.Contains("Done (", StringComparison.Ordinal) || l.Contains("For help, type", StringComparison.Ordinal),
                    TimeSpan.FromMinutes(15), ct))
                throw new Exception("The server didn't finish starting in 15 minutes — check the Host server console.");

            // ── 5) Drive Chunky ─────────────────────────────────────────────
            Ev(new { phase = "generating", radius, percent = 0.0,
                     message = $"Generating a {radius}-block radius around spawn — this runs on the server, watch the % below." });
            SendServerCommand(id, "chunky radius " + radius);
            await Task.Delay(1500, ct);
            SendServerCommand(id, "chunky start");

            // Poll the console: Chunky prints "... 12.3% ... ETA ..." and a
            // "Task finished" line when the shape completes.
            var reProg = new System.Text.RegularExpressions.Regex(@"(\d{1,3}(?:\.\d+)?)%", System.Text.RegularExpressions.RegexOptions.Compiled);
            int cursor = 0; lock (srv.Gate) cursor = srv.Buffer.Count;
            var deadline = DateTime.UtcNow.AddHours(6);
            bool finished = false;
            while (!finished && DateTime.UtcNow < deadline)
            {
                ct.ThrowIfCancellationRequested();
                if (srv.Proc is not { HasExited: false }) throw new Exception("The server exited during generation — check the console.");
                List<string> fresh;
                lock (srv.Gate) { fresh = srv.Buffer.Skip(cursor).ToList(); cursor = srv.Buffer.Count; }
                foreach (var line in fresh)
                {
                    if (line.Contains("Task finished", StringComparison.OrdinalIgnoreCase)
                     || line.Contains("Chunky task", StringComparison.OrdinalIgnoreCase) && line.Contains("finished", StringComparison.OrdinalIgnoreCase))
                        finished = true;
                    else
                    {
                        var m = reProg.Match(line);
                        if (m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pct))
                            Ev(new { phase = "generating", radius, percent = Math.Round(pct, 1),
                                     message = $"Generating around spawn… {pct:0.0}%" });
                    }
                }
                await Task.Delay(2500, ct);
            }
            if (!finished) throw new Exception("Generation didn't finish within the time cap — the world may be partially baked; run again to continue.");

            // ── 6) Stop the server cleanly (flush region files) ─────────────
            Ev(new { phase = "saving", message = "Generation done — saving and stopping the server…" });
            SendServerCommand(id, "save-all flush");
            await Task.Delay(4000, ct);
            StopServer(id);
            var stopWait = DateTime.UtcNow.AddMinutes(3);
            while (srv.Proc is { HasExited: false } && DateTime.UtcNow < stopWait) await Task.Delay(1000, ct);

            // ── 7) Merge NEW region files back into the save ────────────────
            Ev(new { phase = "merging", message = "Merging freshly-baked chunks into your world (existing chunks untouched)…" });
            int copied = 0, skipped = 0;
            foreach (var sub in EnumerateRegionDirs(serverWorld))
            {
                var rel = Path.GetRelativePath(serverWorld, sub);
                var dstDir = Path.Combine(saveDir, rel);
                Directory.CreateDirectory(dstDir);
                foreach (var mca in Directory.EnumerateFiles(sub, "*.mca"))
                {
                    var dst = Path.Combine(dstDir, Path.GetFileName(mca));
                    // Only copy region files the save doesn't already have — never
                    // overwrite a region that holds your existing builds.
                    if (File.Exists(dst)) { skipped++; continue; }
                    try { File.Copy(mca, dst); copied++; }
                    catch (Exception ce) { Logger.Warn($"Prebake merge '{rel}': {ce.Message}"); }
                }
            }

            Logger.Info($"Prebake({id}): {copied} new region files merged, {skipped} kept (radius {radius})");
            Ev(new { phase = "done", copied, skipped, radius,
                     message = copied > 0
                        ? $"Done — {copied} new region file(s) baked into \"{world}\". Explore lag-free; your existing chunks are untouched."
                        : "Done — no new regions to add (that area was already generated in your save)." });
        }
        catch (OperationCanceledException)
        {
            try { StopServer(id); } catch { }
            Ev(new { phase = "cancelled", message = "Pre-bake cancelled. Your save is safe (a backup was taken before any changes)." });
        }
        catch (Exception e)
        {
            try { StopServer(id); } catch { }
            Logger.Warn($"Prebake({id}): {e.Message}");
            Ev(new { phase = "error", message = e.Message + " — your world backup is in the Worlds tab if you need it." });
        }
        finally { _prebakeRunning = false; }
    }

    private static IEnumerable<string> EnumerateRegionDirs(string worldRoot)
    {
        // Vanilla overworld/nether/end
        foreach (var r in RegionRoots)
        {
            var p = Path.Combine(worldRoot, r.Replace('/', Path.DirectorySeparatorChar));
            if (Directory.Exists(p)) yield return p;
        }
        // Modded dimensions: world/dimensions/<namespace>/<dim>/region
        var dims = Path.Combine(worldRoot, "dimensions");
        if (Directory.Exists(dims))
            foreach (var region in Directory.EnumerateDirectories(dims, "region", SearchOption.AllDirectories))
                yield return region;
    }

    /// <summary>Waits until a server console line (after <paramref name="fromIndex"/>)
    /// matches, the process dies, or the timeout elapses.</summary>
    private static async Task<bool> WaitForServerLine(HostedServer srv, int fromIndex, Func<string, bool> match, TimeSpan timeout, CancellationToken ct)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        int cursor = fromIndex;
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (srv.Proc is { HasExited: true }) return false;
            List<string> fresh;
            lock (srv.Gate) { fresh = srv.Buffer.Skip(cursor).ToList(); cursor = srv.Buffer.Count; }
            if (fresh.Any(match)) return true;
            await Task.Delay(1500, ct);
        }
        return false;
    }
}
