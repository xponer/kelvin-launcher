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

    // Well-known CLIENT-ONLY mods that crash a dedicated server at mod-load
    // (they touch net.minecraft.client.* classes that don't exist on the server
    // dist). Seed removal is the fast path; the crash-heal loop below catches
    // any others generically, so this list only needs the common offenders.
    private static readonly string[] ClientOnlyPrefixes =
    {
        "drippyloadingscreen", "fancymenu", "konkrete", "embeddium", "oculus", "rubidium",
        "sodium", "iris", "reeses", "entityculling", "entity_culling", "immediatelyfast",
        "notenoughanimations", "notenoughcrashes", "dynamiclights", "dynamic_lights",
        "resourcefulconfig", "resourcefullib", "modelfix", "betterf3", "bettermodslist",
        "borderlessmining", "controlling", "cullleaves", "cullessleaves", "debugify",
        "eureka", "exordium", "fabricskyboxes", "fusion", "iceberg", "legendarytooltips",
        "lolmc", "mousetweaks", "nvidium", "prism", "screenshotviewer", "shulkerboxtooltip",
        "skinlayers3d", "3dskinlayers", "sound", "toastcontrol", "wavey", "yeetusexperimentus",
        "chat_heads", "chatheads", "continuity", "emojiful", "farsight", "ferritecore",
        "guineapig", "highlighter", "jade", "justzoom", "lambdynamiclights", "moreoverlays",
        "presencefootsteps", "raised", "readmeplease", "searchables", "supermartijn642sconfiglib",
        "tips", "watut", "whereisit", "xaerominimap", "xaeroworldmap", "zoomify",
    };

    private static bool IsClientOnlyName(string jarName)
    {
        var norm = jarName.ToLowerInvariant().Replace("-", "").Replace("_", "").Replace(" ", "");
        return ClientOnlyPrefixes.Any(p => norm.StartsWith(p.Replace("-", "").Replace("_", ""), StringComparison.Ordinal));
    }

    /// <summary>Disable obvious client-only jars on the server before the first
    /// boot (rename .jar → .jar.clientoff). Returns the count disabled.</summary>
    private static int SeedDisableClientMods(string serverMods)
    {
        int n = 0;
        if (!Directory.Exists(serverMods)) return 0;
        foreach (var jar in Directory.GetFiles(serverMods, "*.jar"))
        {
            if (!IsClientOnlyName(Path.GetFileName(jar))) continue;
            try { File.Move(jar, jar + ".clientoff"); n++; }
            catch (Exception e) { Logger.Warn($"Prebake seed-disable '{Path.GetFileName(jar)}': {e.Message}"); }
        }
        return n;
    }

    /// <summary>Reads the newest FML crash report, extracts the mod-ids named in
    /// "Mod loading issue for: X" / "invalid dist DEDICATED_SERVER" failures, maps
    /// them back to jars on the server, and disables those jars. Returns disabled
    /// count. This is the general fallback for client mods not on the seed list.</summary>
    private int HealClientModsFromCrash(string serverDir, string serverMods)
    {
        try
        {
            var crashDir = Path.Combine(serverDir, "crash-reports");
            if (!Directory.Exists(crashDir)) return 0;
            var report = Directory.EnumerateFiles(crashDir, "*.txt")
                .Select(f => new FileInfo(f)).OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
            if (report == null || DateTime.UtcNow - report.LastWriteTimeUtc > TimeSpan.FromMinutes(20)) return 0;

            var text = File.ReadAllText(report.FullName);
            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Text.RegularExpressions.Match m in
                     System.Text.RegularExpressions.Regex.Matches(text, @"Mod loading issue for:\s*([A-Za-z0-9_]+)"))
                ids.Add(m.Groups[1].Value);
            // Also catch the direct "Mod file: .../<name>.jar" lines near a dist error.
            var badFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Text.RegularExpressions.Match m in
                     System.Text.RegularExpressions.Regex.Matches(text, @"Mod file:.*/([^/\r\n]+\.jar)"))
                if (text.Contains("DEDICATED_SERVER") || text.Contains("client"))
                    badFiles.Add(m.Groups[1].Value);

            if (ids.Count == 0 && badFiles.Count == 0) return 0;
            int n = 0;
            foreach (var jar in Directory.GetFiles(serverMods, "*.jar"))
            {
                var name = Path.GetFileName(jar);
                bool hit = badFiles.Contains(name)
                        || (ids.Count > 0 && ReadModIds(jar).Any(mid => ids.Contains(mid)));
                if (!hit) continue;
                try { File.Move(jar, jar + ".clientoff"); n++; Logger.Info($"Prebake: disabled client-only server mod {name}"); }
                catch (Exception e) { Logger.Warn($"Prebake heal-disable '{name}': {e.Message}"); }
            }
            return n;
        }
        catch (Exception e) { Logger.Warn($"Prebake crash-heal: {e.Message}"); return 0; }
    }

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
            // A modpack's mod folder is the CLIENT set — client-only mods (loading
            // screens, renderers, minimaps…) crash a dedicated server at mod-load
            // ("invalid dist DEDICATED_SERVER"). Seed-disable the known ones, then
            // self-heal: if the server crashes, read the crash report, disable the
            // named client mods, and retry. Fully general (no per-pack list).
            var serverModsDir = Path.Combine(serverDir, "mods");
            int seeded = SeedDisableClientMods(serverModsDir);
            if (seeded > 0) Ev(new { phase = "starting", message = $"Excluded {seeded} client-only mod(s) the server can't run; starting the server…" });
            else Ev(new { phase = "starting", message = "Starting the pack's server (loads all its mods — a few minutes)…" });

            var lm = LoadServerMeta(id);
            lm["eulaAccepted"] = true; SaveServerMeta(id, lm);
            File.WriteAllText(Path.Combine(serverDir, "eula.txt"), "eula=true\n");

            var srv = GetSrv(id);
            bool up = false;
            for (int attempt = 1; attempt <= 5 && !up; attempt++)
            {
                ct.ThrowIfCancellationRequested();
                int mark = 0; lock (srv.Gate) mark = srv.Buffer.Count;
                var startRes = StartServer(id);
                if (startRes is not null && startRes.GetType().GetProperty("ok")?.GetValue(startRes) is false)
                    throw new Exception("Couldn't start the server — see the Host server console.");

                var outcome = await WaitForServerReady(srv, serverDir, TimeSpan.FromMinutes(20), ct);

                if (outcome == ServerStart.Ready) { up = true; break; }
                if (outcome == ServerStart.Timeout)
                    throw new Exception("The server didn't finish starting in 20 minutes — check the Host server console.");

                // Exited → almost always a client-only mod. Heal from the crash
                // report and retry; if nothing new to disable, give up honestly.
                int healed = HealClientModsFromCrash(serverDir, serverModsDir);
                if (healed == 0)
                    throw new Exception("The server crashed at startup and it isn't a client-only-mod issue — open the Host server console to see the crash.");
                Ev(new { phase = "starting", message = $"Disabled {healed} client-only mod(s) from the crash and retrying (attempt {attempt + 1})…" });
                await Task.Delay(2000, ct);
            }
            if (!up) throw new Exception("Couldn't get the server past its client-only mods after several tries — check the Host server console.");

            // ── 5) Drive Chunky ─────────────────────────────────────────────
            // The world is generated around spawn; make sure spawn is the world
            // centre for a deterministic shape, then radius + start.
            Ev(new { phase = "generating", radius, percent = 0.0,
                     message = $"Generating a {radius}-block radius around spawn — this runs on the server, watch the % below." });
            await Task.Delay(3000, ct);   // let the just-"Done" server settle before commands
            SendServerCommand(id, "chunky world minecraft:overworld");
            await Task.Delay(800, ct);
            SendServerCommand(id, "chunky center 0 0");
            await Task.Delay(800, ct);
            SendServerCommand(id, "chunky radius " + radius);
            await Task.Delay(1200, ct);
            SendServerCommand(id, "chunky start");

            // Tail the server log (NOT the ring buffer): Chunky prints periodic
            // "… 12.3% … ETA …" and a "Task finished" line at completion.
            var log = ServerLatestLog(serverDir);
            long pos = 0; string carry = "";
            ReadNewLogLines(log, ref pos, ref carry);   // jump to current end (ignore boot spam)
            var reProg = new System.Text.RegularExpressions.Regex(@"(\d{1,3}(?:\.\d+)?)%", System.Text.RegularExpressions.RegexOptions.Compiled);
            var deadline = DateTime.UtcNow.AddHours(6);
            bool finished = false; bool sawChunky = false; double lastPct = -1;
            var noProgressSince = DateTime.UtcNow;
            while (!finished && DateTime.UtcNow < deadline)
            {
                ct.ThrowIfCancellationRequested();
                if (srv.Proc is not { HasExited: false }) throw new Exception("The server exited during generation — check the console.");
                foreach (var line in ReadNewLogLines(log, ref pos, ref carry))
                {
                    if (!line.Contains("Chunky", StringComparison.OrdinalIgnoreCase)
                     && !line.Contains("chunky", StringComparison.Ordinal)
                     && !reProg.IsMatch(line)) continue;
                    if (line.Contains("Chunky", StringComparison.OrdinalIgnoreCase)) sawChunky = true;
                    if (line.Contains("finished", StringComparison.OrdinalIgnoreCase) &&
                        line.Contains("Chunky", StringComparison.OrdinalIgnoreCase)) { finished = true; break; }
                    var m = reProg.Match(line);
                    if (m.Success && double.TryParse(m.Groups[1].Value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var pct))
                    {
                        if (pct >= 99.99) { finished = true; }
                        if (Math.Abs(pct - lastPct) > 0.01) { lastPct = pct; noProgressSince = DateTime.UtcNow; }
                        Ev(new { phase = "generating", radius, percent = Math.Round(pct, 1),
                                 message = $"Generating around spawn… {pct:0.0}%" });
                    }
                }
                // If Chunky never acknowledged the start command, re-issue once.
                if (!sawChunky && (DateTime.UtcNow - noProgressSince).TotalSeconds > 25)
                {
                    Logger.Info("Prebake: no Chunky output yet — re-issuing start");
                    SendServerCommand(id, "chunky start");
                    noProgressSince = DateTime.UtcNow;
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
        finally
        {
            // Leave the server's mod set whole for the Host Server feature.
            try { RestoreClientMods(Path.Combine(serverDir, "mods")); } catch { }
            _prebakeRunning = false;
        }
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

    private enum ServerStart { Ready, Exited, Timeout }

    private static string ServerLatestLog(string serverDir) => Path.Combine(serverDir, "logs", "latest.log");

    /// <summary>
    /// Reads complete new lines appended to a log file since <paramref name="pos"/>.
    /// Handles the file being truncated/recreated (Minecraft rewrites latest.log
    /// on each start) by resetting the position. FileShare so the running server
    /// can keep writing.
    /// </summary>
    private static List<string> ReadNewLogLines(string path, ref long pos, ref string carry)
    {
        var outp = new List<string>();
        try
        {
            if (!File.Exists(path)) return outp;
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (fs.Length < pos) { pos = 0; carry = ""; }   // truncated / rotated
            if (fs.Length <= pos) return outp;
            fs.Seek(pos, SeekOrigin.Begin);
            var buf = new byte[fs.Length - pos];
            int n = fs.Read(buf, 0, buf.Length);
            pos += n;
            carry += System.Text.Encoding.UTF8.GetString(buf, 0, n);
            int nl;
            while ((nl = carry.IndexOf('\n')) >= 0)
            {
                outp.Add(carry[..nl].TrimEnd('\r'));
                carry = carry[(nl + 1)..];
            }
        }
        catch (IOException) { /* rotating — retry next tick */ }
        return outp;
    }

    /// <summary>
    /// Waits for the server's "Done" line (Ready), the process to exit (Exited =
    /// a startup crash), or the timeout — by TAILING the server's latest.log,
    /// which is complete and truncated fresh each start. (The in-memory console
    /// buffer is a 2500-line ring buffer; a 480-mod server prints far more than
    /// that during boot, so index-based scanning of it silently missed "Done".)
    /// </summary>
    private static async Task<ServerStart> WaitForServerReady(HostedServer srv, string serverDir, TimeSpan timeout, CancellationToken ct)
    {
        var log = ServerLatestLog(serverDir);
        long pos = 0; string carry = "";
        var deadline = DateTime.UtcNow.Add(timeout);
        await Task.Delay(2000, ct);   // let the process spawn + truncate latest.log
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            foreach (var line in ReadNewLogLines(log, ref pos, ref carry))
            {
                if (line.Contains("Done (", StringComparison.Ordinal) || line.Contains("For help, type", StringComparison.Ordinal))
                    return ServerStart.Ready;
            }
            if (srv.Proc is { HasExited: true })
            {
                await Task.Delay(1500, CancellationToken.None);   // drain final crash lines
                foreach (var line in ReadNewLogLines(log, ref pos, ref carry))
                    if (line.Contains("Done (", StringComparison.Ordinal)) return ServerStart.Ready;
                return ServerStart.Exited;
            }
            await Task.Delay(1500, ct);
        }
        return ServerStart.Timeout;
    }

    /// <summary>Re-enable every server mod the pre-baker disabled (.jar.clientoff
    /// → .jar) so the Host Server feature still has the full set afterwards.</summary>
    private static void RestoreClientMods(string serverMods)
    {
        if (!Directory.Exists(serverMods)) return;
        foreach (var off in Directory.GetFiles(serverMods, "*.jar.clientoff"))
        {
            var jar = off[..^".clientoff".Length];
            try { if (!File.Exists(jar)) File.Move(off, jar); else File.Delete(off); }
            catch (Exception e) { Logger.Warn($"Prebake restore '{Path.GetFileName(off)}': {e.Message}"); }
        }
    }
}
