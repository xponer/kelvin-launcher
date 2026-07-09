using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace VSpeedLauncher.Core;

/// <summary>
/// VSpeed Turbo — modpack startup acceleration via the JDK 25 AOT cache
/// (Project Leyden, JEP 483/514/515).
///
/// <para>
/// Where AppCDS only maps class <i>metadata</i>, the AOT cache stores classes
/// already loaded and linked plus JIT method profiles, so a launch skips class
/// loading, linking, verification and most of the JIT warm-up. Flags:
/// a <b>training</b> run uses <c>-XX:AOTCacheOutput=file.aot</c> (the cache is
/// assembled by a forked JVM at normal shutdown), every later run uses
/// <c>-XX:AOTCache=file.aot</c>. Requires the game to run on a Java 25 VM, so
/// this class also provisions a Temurin 25 runtime from the Adoptium API.
/// </para>
///
/// <para>
/// The cache is only valid for the exact class environment it was trained on,
/// so it is keyed to a fingerprint of the mods folder + loader version; any
/// change invalidates it and the next launch silently re-trains.
/// </para>
/// </summary>
public static class TurboRuntime
{
    // ── Paths ────────────────────────────────────────────────────────────────

    private static string LauncherData =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher");

    /// <summary>Where the Temurin 25 runtime is installed (next to the Mojang JREs).</summary>
    public static string RuntimeDir => Path.Combine(LauncherData, "game", "runtime", "turbo-25");

    /// <summary>Per-instance AOT caches + state files.</summary>
    public static string AotDir => Path.Combine(LauncherData, "aot");

    private static string SafeId(string instanceId)
    {
        var s = new string((instanceId ?? "").Where(char.IsLetterOrDigit).ToArray());
        return s.Length > 0 ? s : "inst";
    }

    public static string CacheFile(string instanceId) => Path.Combine(AotDir, SafeId(instanceId) + ".aot");
    public static string StateFile(string instanceId) => Path.Combine(AotDir, SafeId(instanceId) + ".json");
    /// <summary>Intermediate training record written at game exit; consumed by the assembly JVM.
    /// Can be hundreds of MB on a big modpack — cleaned up once assembly ends.</summary>
    public static string CacheConfigFile(string instanceId) => CacheFile(instanceId) + ".config";

    // ── Per-instance state ───────────────────────────────────────────────────

    public sealed class TurboState
    {
        public bool   Enabled     { get; set; }
        /// <summary>Mods fingerprint the current .aot cache was trained on ("" = untrained).</summary>
        public string Fingerprint { get; set; } = "";
        /// <summary>Unix ms of the last successful training, 0 = never.</summary>
        public long   TrainedAt   { get; set; }
        public string LastError   { get; set; } = "";
        /// <summary>User opted in to retrain a STALE cache on the next launch.
        /// (A stale cache — mods changed since training — otherwise launches
        /// standard instead of springing a slow training run on the user.)</summary>
        public bool   RetrainRequested { get; set; }
        /// <summary>Rolling window of measured boot-to-menu times.</summary>
        public List<BootRecord> Boots { get; set; } = new();
    }

    public sealed class BootRecord
    {
        public long   T    { get; set; }        // unix ms
        public long   Secs { get; set; }        // boot-to-menu seconds
        public string Mode { get; set; } = "";  // standard | training | turbo | default
    }

    private static readonly object _stateLock = new();

    public static TurboState LoadState(string instanceId)
    {
        lock (_stateLock)
        {
            try
            {
                var f = StateFile(instanceId);
                if (File.Exists(f))
                    return JsonSerializer.Deserialize<TurboState>(File.ReadAllText(f)) ?? new TurboState();
            }
            catch (Exception e) { Logger.Warn($"Turbo state load failed ({instanceId}): {e.Message}"); }
            return new TurboState();
        }
    }

    public static void SaveState(string instanceId, TurboState state)
    {
        lock (_stateLock)
        {
            try
            {
                Directory.CreateDirectory(AotDir);
                // Keep the boots list a rolling window.
                if (state.Boots.Count > 15)
                    state.Boots = state.Boots.OrderByDescending(b => b.T).Take(15).OrderBy(b => b.T).ToList();
                File.WriteAllText(StateFile(instanceId), JsonSerializer.Serialize(state));
            }
            catch (Exception e) { Logger.Warn($"Turbo state save failed ({instanceId}): {e.Message}"); }
        }
    }

    public static void RecordBoot(string instanceId, long secs, string mode)
    {
        var st = LoadState(instanceId);
        st.Boots.Add(new BootRecord { T = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Secs = secs, Mode = mode });
        SaveState(instanceId, st);
    }

    // ── Mods fingerprint (cache validity key) ────────────────────────────────

    /// <summary>
    /// Cheap, stable fingerprint of the class environment: enabled mod jars
    /// (name + size + mtime) + the loader version name. No content hashing —
    /// 400 jars must stay a few-ms operation on every launch.
    /// </summary>
    /// <summary>
    /// Bump when the set of JVM flags on turbo/training launches changes in a way
    /// that affects the AOT cache (e.g. object layout). A bump changes every
    /// fingerprint → all instances silently retrain on their next Turbo launch
    /// instead of the JVM rejecting the stale cache at startup.
    /// v2: +UseCompactObjectHeaders (JEP 519).
    /// </summary>
    public const string FlagsVersion = "v2";

    public static string ComputeFingerprint(string gameDir, string versionName, string jvmArgsKey = "")
    {
        var sb = new StringBuilder("flags:" + FlagsVersion + "|args:" + jvmArgsKey + "|").Append(versionName ?? "");
        try
        {
            var mods = Path.Combine(gameDir, "mods");
            if (Directory.Exists(mods))
            {
                foreach (var f in Directory.EnumerateFiles(mods, "*.jar").OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
                {
                    var fi = new FileInfo(f);
                    sb.Append('|').Append(fi.Name).Append(':').Append(fi.Length).Append(':').Append(fi.LastWriteTimeUtc.Ticks);
                }
            }
        }
        catch (Exception e) { Logger.Warn($"Turbo fingerprint failed: {e.Message}"); }
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sb.ToString()));
        return Convert.ToHexString(hash)[..16];
    }

    // ── Temurin 25 runtime provisioning ──────────────────────────────────────

    /// <summary>Returns the turbo runtime's javaw.exe, or null if not installed yet.</summary>
    public static string? FindJavaw()
    {
        try
        {
            if (!Directory.Exists(RuntimeDir)) return null;
            foreach (var exe in new[] { "javaw.exe", "java.exe" })
            {
                var hit = Directory.EnumerateFiles(RuntimeDir, exe, SearchOption.AllDirectories).FirstOrDefault();
                if (hit != null) return hit;
            }
        }
        catch { /* unreadable dir → treat as not installed */ }
        return null;
    }

    /// <summary>Reads JAVA_VERSION from the runtime's release file, e.g. "25.0.1".</summary>
    public static string InstalledVersion()
    {
        try
        {
            var javaw = FindJavaw();
            if (javaw == null) return "";
            var release = Path.Combine(Path.GetDirectoryName(Path.GetDirectoryName(javaw))!, "release");
            if (!File.Exists(release)) return "";
            foreach (var line in File.ReadAllLines(release))
                if (line.StartsWith("JAVA_VERSION=", StringComparison.OrdinalIgnoreCase))
                    return line["JAVA_VERSION=".Length..].Trim().Trim('"');
        }
        catch { /* cosmetic only */ }
        return "";
    }

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(15) };
    private static int _provisioning;   // Interlocked guard: only one download at a time

    /// <summary>
    /// Downloads + installs the latest Temurin 25 JRE (falls back to the JDK if
    /// no JRE image exists) from the Adoptium API. Safe to call when already
    /// installed (no-op). <paramref name="progress"/>: (message, bytesDone, bytesTotal).
    /// </summary>
    public static async Task ProvisionAsync(Action<string, long, long> progress, CancellationToken ct = default)
    {
        if (FindJavaw() != null) { progress("Java 25 runtime already installed.", 0, 0); return; }
        if (Interlocked.Exchange(ref _provisioning, 1) == 1)
            throw new InvalidOperationException("Runtime download already in progress.");
        try
        {
            string? zip = null;
            foreach (var imageType in new[] { "jre", "jdk" })
            {
                var url = $"https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/{imageType}/hotspot/normal/eclipse";
                try
                {
                    progress($"Downloading Temurin 25 ({imageType})…", 0, 0);
                    zip = await DownloadAsync(url, progress, ct);
                    break;
                }
                catch (Exception e) when (imageType == "jre")
                {
                    Logger.Warn($"Turbo: JRE 25 download failed ({e.Message}) — trying full JDK");
                }
            }
            if (zip == null) throw new Exception("Download failed.");

            progress("Extracting runtime…", 0, 0);
            var tmpDir = RuntimeDir + ".tmp";
            try { if (Directory.Exists(tmpDir)) Directory.Delete(tmpDir, true); } catch { }
            ZipFile.ExtractToDirectory(zip, tmpDir);
            try { File.Delete(zip); } catch { }

            // Atomic-ish swap into place.
            try { if (Directory.Exists(RuntimeDir)) Directory.Delete(RuntimeDir, true); } catch { }
            Directory.Move(tmpDir, RuntimeDir);

            var javaw = FindJavaw() ?? throw new Exception("Extracted runtime has no javaw.exe.");
            Logger.Info($"Turbo: Temurin 25 installed → {javaw}");
            progress("Java 25 runtime ready.", 0, 0);
        }
        finally { Interlocked.Exchange(ref _provisioning, 0); }
    }

    private static async Task<string> DownloadAsync(string url, Action<string, long, long> progress, CancellationToken ct)
    {
        using var resp = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        resp.EnsureSuccessStatusCode();
        long total = resp.Content.Headers.ContentLength ?? 0;

        Directory.CreateDirectory(RuntimeDir + "-dl");
        var zipPath = Path.Combine(RuntimeDir + "-dl", "temurin25.zip");
        await using (var src = await resp.Content.ReadAsStreamAsync(ct))
        await using (var dst = File.Create(zipPath))
        {
            var buf = new byte[1 << 16];
            long done = 0; int n; var lastPush = DateTime.UtcNow;
            while ((n = await src.ReadAsync(buf, ct)) > 0)
            {
                await dst.WriteAsync(buf.AsMemory(0, n), ct);
                done += n;
                if ((DateTime.UtcNow - lastPush).TotalMilliseconds > 250)
                {
                    progress("Downloading Java 25 runtime…", done, total);
                    lastPush = DateTime.UtcNow;
                }
            }
            progress("Download complete.", done, total);
        }
        return zipPath;
    }

    // ── Boot-to-menu detection (no pipe mod needed) ──────────────────────────

    private static readonly Regex _reModernFix =
        new(@"Game took ([0-9]+(?:[.,][0-9]+)?) seconds to start", RegexOptions.Compiled);

    /// <summary>
    /// Tails the engine's stdout log and returns the boot-to-menu time in
    /// seconds, or -1 if it couldn't be measured (process died / no markers).
    ///
    /// Markers, best first:
    ///  1. ModernFix's "Game took X.XX seconds to start" — exact title-screen time.
    ///  2. Vanilla's "Realms Notification" check — fires right after the title screen shows.
    ///  3. Fallback: "Sound engine started" was seen (end of first resource reload)
    ///     and the log then went quiet for 12s → boot ≈ time of the last log line.
    /// </summary>
    public static async Task<long> WatchBootAsync(string logPath, Process proc, CancellationToken ct = default)
    {
        DateTime start;
        try { start = proc.StartTime.ToUniversalTime(); }
        catch { start = DateTime.UtcNow; }

        long pos = 0; string carry = "";
        bool soundSeen = false;
        var lastLineAt = DateTime.UtcNow;
        var deadline = DateTime.UtcNow.AddMinutes(12);

        while (!ct.IsCancellationRequested && DateTime.UtcNow < deadline)
        {
            bool exited = false;
            try { exited = proc.HasExited; } catch { exited = true; }
            if (exited) return -1;

            try
            {
                if (File.Exists(logPath))
                {
                    using var fs = new FileStream(logPath, FileMode.Open, FileAccess.Read,
                                                  FileShare.ReadWrite | FileShare.Delete);
                    if (fs.Length < pos) { pos = 0; carry = ""; }   // truncated / recreated
                    if (fs.Length > pos)
                    {
                        fs.Seek(pos, SeekOrigin.Begin);
                        var buf = new byte[fs.Length - pos];
                        int n = await fs.ReadAsync(buf, ct);
                        pos += n;
                        carry += Encoding.UTF8.GetString(buf, 0, n);

                        int nl;
                        while ((nl = carry.IndexOf('\n')) >= 0)
                        {
                            var line = carry[..nl].TrimEnd('\r');
                            carry = carry[(nl + 1)..];
                            if (line.Length == 0) continue;
                            lastLineAt = DateTime.UtcNow;

                            var m = _reModernFix.Match(line);
                            if (m.Success && double.TryParse(m.Groups[1].Value.Replace(',', '.'),
                                    NumberStyles.Float, CultureInfo.InvariantCulture, out var s) && s > 0)
                                return (long)Math.Round(s);

                            if (line.Contains("Realms Notification", StringComparison.Ordinal))
                                return (long)Math.Max(1, (DateTime.UtcNow - start).TotalSeconds);

                            if (line.Contains("Sound engine started", StringComparison.Ordinal))
                                soundSeen = true;
                        }
                    }
                }
            }
            catch (IOException) { /* log rotating — retry next tick */ }

            // Quiet fallback: reload finished (sound engine up) and nothing logged
            // for 12s → the game is idling at the main menu.
            if (soundSeen && (DateTime.UtcNow - lastLineAt).TotalSeconds > 12)
                return (long)Math.Max(1, (lastLineAt - start).TotalSeconds);

            try { await Task.Delay(500, ct); } catch (TaskCanceledException) { return -1; }
        }
        return -1;
    }

    /// <summary>Finds the AOT assembly JVM: a java/javaw process running from the
    /// Turbo runtime dir that isn't the (dead) game process. Only meaningful to
    /// call after the game has exited.</summary>
    public static Process? FindAssemblyProcess(int excludePid = -1)
    {
        foreach (var name in new[] { "java", "javaw" })
        {
            foreach (var p in Process.GetProcessesByName(name))
            {
                try
                {
                    if (p.Id == excludePid || p.HasExited) continue;
                    var path = p.MainModule?.FileName ?? "";
                    if (path.StartsWith(RuntimeDir, StringComparison.OrdinalIgnoreCase)) return p;
                }
                catch { /* access denied / raced exit — skip */ }
            }
        }
        return null;
    }

    private static long TryGetFreshCache(string cacheFile, DateTime launchedAtUtc)
    {
        try
        {
            var fi = new FileInfo(cacheFile);
            if (fi.Exists && fi.LastWriteTimeUtc >= launchedAtUtc.AddSeconds(-5) && fi.Length > 0)
            {
                // Locked = assembly JVM still writing.
                try
                {
                    using var _ = fi.Open(FileMode.Open, FileAccess.Read, FileShare.None);
                    return fi.Length;
                }
                catch (IOException) { /* still writing */ }
            }
        }
        catch { /* transient */ }
        return -1;
    }

    /// <summary>
    /// Waits for a freshly-assembled AOT cache. On a 400-mod pack the training
    /// record is ~700 MB and the forked assembly JVM grinds for MINUTES after the
    /// game closes — so this waits as long as that assembler is actually alive
    /// (cap 20 min), not a fixed short timeout. <paramref name="onAssembling"/>
    /// fires once when the assembler is detected (surface progress in the UI).
    /// Returns cache size in bytes, or -1.
    /// </summary>
    public static async Task<long> AwaitTrainedCacheAsync(string cacheFile, DateTime launchedAtUtc,
                                                          int gamePid = -1, Action? onAssembling = null)
    {
        var deadline     = DateTime.UtcNow.AddMinutes(20);
        var grace        = DateTime.UtcNow.AddSeconds(90);   // fork can take a moment to appear
        bool sawAssembler = false;
        while (DateTime.UtcNow < deadline)
        {
            var size = TryGetFreshCache(cacheFile, launchedAtUtc);
            if (size > 0) return size;

            var asm = FindAssemblyProcess(gamePid);
            if (asm != null)
            {
                if (!sawAssembler) { sawAssembler = true; onAssembling?.Invoke(); }
            }
            else if (sawAssembler || DateTime.UtcNow > grace)
            {
                // The assembler finished (or never appeared) — give the file one
                // final settle, then report whatever is there.
                await Task.Delay(3000);
                return TryGetFreshCache(cacheFile, launchedAtUtc);
            }
            await Task.Delay(2000);
        }
        return TryGetFreshCache(cacheFile, launchedAtUtc);
    }
}
