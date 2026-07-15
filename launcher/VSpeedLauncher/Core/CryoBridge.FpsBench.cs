using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Text.Json;

namespace VSpeedLauncher.Core;

/// <summary>
/// In-world FPS benchmark — the boot benchmark's honesty, applied inside the
/// game. Uses Intel's open-source PresentMon (pinned build, auto-provisioned
/// like the Turbo runtime) to capture REAL frame times of the game window via
/// ETW: no mod, works on any pack. Flow: Resume into the newest world → settle
/// → capture N seconds → report avg FPS, 1% lows and stutter share → record
/// per-instance history so tweaks (Session Boost, GC, runtimes) get compared
/// with numbers instead of vibes.
///
/// ETW capture needs elevation, so each run shows ONE UAC prompt (same UX as
/// the Defender exclusion). PresentMon writes a CSV; both v1 and v2 column
/// names are handled.
/// </summary>
public sealed partial class CryoBridge
{
    private const string PresentMonVersion = "2.5.1";
    private const string PresentMonUrl =
        "https://github.com/GameTechDev/PresentMon/releases/download/v2.5.1/PresentMon-2.5.1-x64.exe";

    private static string PresentMonDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "presentmon");
    private static string PresentMonExe => Path.Combine(PresentMonDir, "PresentMon.exe");

    private static string FpsDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "fps");
    private static string FpsHistoryFile(string id) =>
        Path.Combine(FpsDir, new string(id.Where(char.IsLetterOrDigit).ToArray()) + ".json");

    public sealed class FpsRecord
    {
        public long   T          { get; set; }   // unix ms
        public double AvgFps     { get; set; }
        public double Low1Fps    { get; set; }   // avg FPS of the worst 1% frames
        public double StutterPct { get; set; }   // frames slower than 2.5× median
        public int    Frames     { get; set; }
        public int    Seconds    { get; set; }
        public string Tags       { get; set; } = "";   // e.g. "turbo · boost" — what was active
    }

    private volatile bool _fpsRunning;
    private CancellationTokenSource? _fpsCts;

    private List<FpsRecord> LoadFpsHistory(string id)
    {
        try
        {
            if (File.Exists(FpsHistoryFile(id)))
                return JsonSerializer.Deserialize<List<FpsRecord>>(File.ReadAllText(FpsHistoryFile(id))) ?? new();
        }
        catch (Exception e) { Logger.Warn($"FPS history load ({id}): {e.Message}"); }
        return new();
    }

    private void SaveFpsHistory(string id, List<FpsRecord> list)
    {
        try
        {
            Directory.CreateDirectory(FpsDir);
            if (list.Count > 20) list = list.OrderByDescending(r => r.T).Take(20).OrderBy(r => r.T).ToList();
            File.WriteAllText(FpsHistoryFile(id), JsonSerializer.Serialize(list));
        }
        catch (Exception e) { Logger.Warn($"FPS history save ({id}): {e.Message}"); }
    }

    private object GetFpsBench(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        return new
        {
            ok = true,
            running = _fpsRunning,
            history = LoadFpsHistory(id).OrderByDescending(r => r.T).Take(10)
                .Select(r => new { t = r.T, avgFps = r.AvgFps, low1Fps = r.Low1Fps, stutterPct = r.StutterPct, frames = r.Frames, seconds = r.Seconds, tags = r.Tags }),
        };
    }

    private object CancelFpsBench() { _fpsCts?.Cancel(); return new { ok = true }; }

    private object StartFpsBench(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        if (_fpsRunning)        return new { ok = false, error = "An FPS benchmark is already running." };
        if (_benchRunning)      return new { ok = false, error = "Wait for the boot benchmark / Prepare to finish first." };
        var inst = _manager.FindById(id);
        if (inst == null) return new { ok = false, error = $"Instance not found: {id}" };
        if (inst.State is InstanceState.Loading or InstanceState.Ready)
            return new { ok = false, error = "Stop the game first — the benchmark launches it fresh." };
        if (GetStoredEngineVersion(id) == null)
            return new { ok = false, error = "Install the Kelvin engine for this instance first (Performance → Engine)." };
        if (!MicrosoftAccount.Instance.LoggedIn)
            return new { ok = false, error = "Sign in first — the benchmark plays the real game." };
        var meta = InstanceMetaReader.Read(id, InstanceDataDir(id));
        if (McMinor(meta.Mc) < 20)
            return new { ok = false, error = "The FPS benchmark resumes into your world via Quick Play — needs Minecraft 1.20+." };
        if (NewestWorld(id) == null)
            return new { ok = false, error = "No singleplayer world in this pack yet — play once first." };

        _fpsCts = new CancellationTokenSource();
        _fpsRunning = true;
        _ = Task.Run(() => RunFpsBenchAsync(inst, _fpsCts.Token));
        return new { ok = true };
    }

    private async Task RunFpsBenchAsync(RunningInstance inst, CancellationToken ct)
    {
        var id = inst.Entry.Id;
        void Ev(object p) => Push("fpsEvent", p);
        Process? game = null;
        try
        {
            // ── 1) Provision PresentMon (once, ~1 MB) ────────────────────────
            if (!File.Exists(PresentMonExe))
            {
                Ev(new { phase = "installing", message = $"Downloading PresentMon v{PresentMonVersion} (Intel, open source — one time)…" });
                Directory.CreateDirectory(PresentMonDir);
                using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) };
                var bytes = await http.GetByteArrayAsync(PresentMonUrl, ct);
                if (bytes.Length < 200_000) throw new Exception("PresentMon download looks truncated — try again.");
                await File.WriteAllBytesAsync(PresentMonExe, bytes, ct);
                Logger.Info($"FPS: PresentMon v{PresentMonVersion} installed");
            }

            // ── 2) Resume into the newest world ─────────────────────────────
            var world = NewestWorld(id) ?? "";
            Ev(new { phase = "launching", message = $"Launching into \"{world}\" (Quick Play — no menus)…" });
            var bootTcs = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
            game = await EngineLaunchAsync(id, "", "auto", bootTcs, resumeWorld: world)
                ?? throw new Exception("Launch failed — see the launcher log.");

            var engineLog = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "logs", "cryo-engine.log");
            var joinTask  = TurboRuntime.WatchJoinAsync(engineLog, game, ct);
            var winner    = await Task.WhenAny(joinTask, Task.Delay(TimeSpan.FromMinutes(20), ct));
            if (winner != joinTask || joinTask.Result <= 0)
                throw new Exception("The game never reached the world (crash or timeout) — check the Logs screen.");

            Ev(new { phase = "settling", message = "In the world — letting chunks and entities settle (15 s)…" });
            await Task.Delay(15_000, ct);
            if (game.HasExited) throw new Exception("The game exited before the capture could start.");

            // ── 3) Capture frame times (elevated — ONE UAC prompt) ──────────
            const int captureSecs = 60;
            var csv = Path.Combine(FpsDir, "capture.csv");
            Directory.CreateDirectory(FpsDir);
            try { File.Delete(csv); } catch { /* stale */ }
            Ev(new { phase = "capturing", seconds = captureSecs,
                     message = $"Capturing {captureSecs}s of real frame times — approve the Windows admin prompt (ETW capture needs it). Don't touch the game." });
            var psi = new ProcessStartInfo
            {
                FileName        = PresentMonExe,
                Arguments       = $"--process_id {game.Id} --output_file \"{csv}\" --timed {captureSecs} " +
                                  "--terminate_after_timed --stop_existing_session --no_console_stats",
                UseShellExecute = true,
                Verb            = "runas",
                WindowStyle     = ProcessWindowStyle.Hidden,
            };
            Process pm;
            try { pm = Process.Start(psi) ?? throw new Exception("Couldn't start PresentMon."); }
            catch (System.ComponentModel.Win32Exception)
            {
                throw new Exception("The admin prompt was declined — frame capture needs it. Run the benchmark again and click Yes.");
            }
            using var pmTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(captureSecs + 90));
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, pmTimeout.Token);
            try { await pm.WaitForExitAsync(linked.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            { try { pm.Kill(); } catch { } }

            // ── 4) Parse + stats ─────────────────────────────────────────────
            if (!File.Exists(csv)) throw new Exception("PresentMon produced no data — the capture may have been blocked. Try again.");
            var frames = ParseFrameTimes(csv);
            if (frames.Count < 100)
                throw new Exception($"Only {frames.Count} frames captured — not enough for a meaningful number. Is the game window visible (not minimized)?");

            frames.Sort();
            double avgMs   = frames.Average();
            double median  = frames[frames.Count / 2];
            int    worstN  = Math.Max(1, frames.Count / 100);
            double worstMs = frames.Skip(frames.Count - worstN).Average();   // sorted asc → tail = slowest
            double stutter = frames.Count(f => f > median * 2.5) * 100.0 / frames.Count;

            var st   = TurboRuntime.LoadState(id);
            var tags = (st.Enabled && st.Fingerprint.Length > 0 ? "turbo" : "standard")
                     + (_config.Data.SessionBoostEnabled ? " · boost" : "")
                     + (_config.Data.LargePagesEnabled ? " · lp" : "");

            var rec = new FpsRecord
            {
                T = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                AvgFps = Math.Round(1000.0 / avgMs, 1),
                Low1Fps = Math.Round(1000.0 / worstMs, 1),
                StutterPct = Math.Round(stutter, 2),
                Frames = frames.Count, Seconds = captureSecs, Tags = tags,
            };
            var hist = LoadFpsHistory(id); hist.Add(rec); SaveFpsHistory(id, hist);

            Logger.Info($"FPS({id}): avg {rec.AvgFps}, 1% low {rec.Low1Fps}, stutter {rec.StutterPct}% ({rec.Frames} frames, {tags})");
            Ev(new { phase = "done", avgFps = rec.AvgFps, low1Fps = rec.Low1Fps, stutterPct = rec.StutterPct,
                     frames = rec.Frames, tags,
                     message = $"{rec.AvgFps} FPS avg · {rec.Low1Fps} FPS 1% low · {rec.StutterPct}% stutter ({tags})" });
        }
        catch (OperationCanceledException) { Ev(new { phase = "cancelled", message = "FPS benchmark cancelled." }); }
        catch (Exception e)
        {
            Logger.Warn($"FpsBench({id}): {e.Message}");
            Ev(new { phase = "error", message = e.Message });
        }
        finally
        {
            // Close the game politely; it was only up for the measurement.
            try { if (game is { HasExited: false }) { game.CloseMainWindow(); if (!game.WaitForExit(30_000)) _manager.Kill(inst); } }
            catch { try { _manager.Kill(inst); } catch { /* gone */ } }
            _fpsRunning = false;
        }
    }

    /// <summary>Frame times (ms) from a PresentMon CSV — v2 ("FrameTime") or
    /// v1 ("MsBetweenPresents") column naming, case-insensitive.</summary>
    private static List<double> ParseFrameTimes(string csvPath)
    {
        var list = new List<double>();
        using var sr = new StreamReader(new FileStream(csvPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite));
        var header = sr.ReadLine();
        if (header == null) return list;
        var cols = header.Split(',');
        int idx = Array.FindIndex(cols, c => c.Trim().Equals("FrameTime", StringComparison.OrdinalIgnoreCase));
        if (idx < 0) idx = Array.FindIndex(cols, c => c.Trim().Equals("MsBetweenPresents", StringComparison.OrdinalIgnoreCase));
        if (idx < 0) return list;
        string? line;
        while ((line = sr.ReadLine()) != null)
        {
            var parts = line.Split(',');
            if (parts.Length > idx &&
                double.TryParse(parts[idx], NumberStyles.Float, CultureInfo.InvariantCulture, out var ms) &&
                ms > 0 && ms < 10_000)
                list.Add(ms);
        }
        return list;
    }
}
