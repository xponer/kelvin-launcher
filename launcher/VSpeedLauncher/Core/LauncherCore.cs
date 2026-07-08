using System.Diagnostics;
using System.IO;
using System.Net.Http;
using CmlLib.Core;
using CmlLib.Core.Auth;
using CmlLib.Core.Installer.Forge;
using CmlLib.Core.Installer.NeoForge;
using CmlLib.Core.Installer.NeoForge.Installers;
using CmlLib.Core.Installer.NeoForge.Versions;
using CmlLib.Core.ModLoaders.FabricMC;
using CmlLib.Core.ModLoaders.QuiltMC;
using CmlLib.Core.ProcessBuilder;

namespace VSpeedLauncher.Core;

/// <summary>
/// Standalone Minecraft launch engine built on CmlLib.Core — installs the
/// version/libraries/assets, builds the launch command, and starts the game
/// WITHOUT PrismLauncher. This is the foundation for making Cryo self-contained.
///
/// <para><b>NeoForge:</b> use <see cref="InstallNeoForgeAsync"/> first to install
/// NeoForge into the shared CmlLib game root; the returned version name is then
/// passed to <see cref="InstallAndLaunchAsync"/>.</para>
/// </summary>
public sealed class LauncherCore
{
    private readonly string _root;
    private static readonly HttpClient _http = new();

    /// <summary>Shared CmlLib game root: libraries, versions, assets.</summary>
    public string Root => _root;

    public LauncherCore(string gameRoot) => _root = gameRoot;

    /// <summary>(name, progressedTasks, totalTasks)</summary>
    public event Action<string, int, int>? FileProgress;
    /// <summary>(progressedBytes, totalBytes)</summary>
    public event Action<long, long>? ByteProgress;

    // ── NeoForge ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Returns available NeoForge version strings for a given Minecraft version,
    /// newest first (e.g. ["21.1.172", "21.1.168", …]).
    /// </summary>
    public async Task<string[]> GetNeoForgeVersionsAsync(string mcVersion)
    {
        var path      = new MinecraftPath(_root);
        var launcher  = new MinecraftLauncher(path);
        var installer = new NeoForgeInstaller(launcher);
        var versions  = await installer.GetForgeVersions(mcVersion);
        // Sort numerically, newest first — CmlLib's order isn't guaranteed, and a
        // string sort puts "21.1.9" above "21.1.172". The UI preselects the first
        // entry, so a wrong order here installs an ancient loader.
        return versions
            .Select(v => v.VersionName ?? "")
            .Where(s => !string.IsNullOrEmpty(s))
            .OrderByDescending(VersionSortKey)
            .ToArray();
    }

    /// <summary>"21.1.228" → 21_00010_00228-style key; non-numeric tails ignored.</summary>
    private static long VersionSortKey(string v)
    {
        long key = 0;
        var parts = v.Split('.', '-', '+');
        for (int i = 0; i < 4; i++)
        {
            var digits = i < parts.Length ? new string(parts[i].TakeWhile(char.IsDigit).ToArray()) : "";
            key = key * 100000 + (long.TryParse(digits, out var n) ? Math.Min(n, 99999) : 0);
        }
        return key;
    }

    /// <summary>
    /// Downloads and installs NeoForge into the shared CmlLib game root.
    /// Returns the CmlLib internal version name (e.g. <c>"neoforge-21.1.172"</c>)
    /// that should be stored and later passed to <see cref="InstallAndLaunchAsync"/>.
    /// </summary>
    /// <param name="mcVersion">Minecraft version string, e.g. <c>"1.21.1"</c>.</param>
    /// <param name="neoForgeVersion">
    /// NeoForge version string, e.g. <c>"21.1.172"</c>.  Pass <c>null</c> to install
    /// the latest stable release for <paramref name="mcVersion"/>.
    /// </param>
    public async Task<string> InstallNeoForgeAsync(
        string mcVersion,
        string? neoForgeVersion    = null,
        IProgress<string>? output  = null,
        CancellationToken ct       = default)
    {
        var path      = new MinecraftPath(_root);
        var launcher  = new MinecraftLauncher(path);
        launcher.FileProgressChanged += (_, a) => FileProgress?.Invoke(a.Name ?? "", a.ProgressedTasks, a.TotalTasks);
        launcher.ByteProgressChanged += (_, a) => ByteProgress?.Invoke(a.ProgressedBytes, a.TotalBytes);

        var installer = new NeoForgeInstaller(launcher);
        var opts = new NeoForgeInstallOptions
        {
            InstallerOutput      = output,
            CancellationToken    = ct,
            SkipIfAlreadyInstalled = true,
        };

        return string.IsNullOrEmpty(neoForgeVersion)
            ? await installer.Install(mcVersion, opts)
            : await installer.Install(mcVersion, neoForgeVersion, opts);
    }

    // ── Forge / Fabric / Quilt ───────────────────────────────────────────────

    private MinecraftLauncher NewLauncher()
    {
        var launcher = new MinecraftLauncher(new MinecraftPath(_root));
        launcher.FileProgressChanged += (_, a) => FileProgress?.Invoke(a.Name ?? "", a.ProgressedTasks, a.TotalTasks);
        launcher.ByteProgressChanged += (_, a) => ByteProgress?.Invoke(a.ProgressedBytes, a.TotalBytes);
        return launcher;
    }

    public async Task<string> InstallForgeAsync(string mcVersion, string? forgeVersion = null)
    {
        var installer = new ForgeInstaller(NewLauncher());
        return string.IsNullOrEmpty(forgeVersion)
            ? await installer.Install(mcVersion)
            : await installer.Install(mcVersion, forgeVersion);
    }

    public async Task<string> InstallFabricAsync(string mcVersion, string? loaderVersion = null)
    {
        var path = new MinecraftPath(_root);
        var installer = new FabricInstaller(_http);
        return string.IsNullOrEmpty(loaderVersion)
            ? await installer.Install(mcVersion, path)
            : await installer.Install(mcVersion, loaderVersion, path);
    }

    public async Task<string> InstallQuiltAsync(string mcVersion, string? loaderVersion = null)
    {
        var path = new MinecraftPath(_root);
        var installer = new QuiltInstaller(_http);
        return string.IsNullOrEmpty(loaderVersion)
            ? await installer.Install(mcVersion, path)
            : await installer.Install(mcVersion, loaderVersion, path);
    }

    /// <summary>
    /// Installs the given loader and returns the CmlLib version name to launch.
    /// Vanilla returns the MC version unchanged (installed lazily at first launch).
    /// </summary>
    public async Task<string> InstallLoaderAsync(string mcVersion, string loader, string? loaderVersion = null,
                                                 IProgress<string>? output = null)
    {
        switch ((loader ?? "").ToLowerInvariant())
        {
            case "neoforge": return await InstallNeoForgeAsync(mcVersion, loaderVersion, output);
            case "forge":    return await InstallForgeAsync(mcVersion, loaderVersion);
            case "fabric":   return await InstallFabricAsync(mcVersion, loaderVersion);
            case "quilt":    return await InstallQuiltAsync(mcVersion, loaderVersion);
            default:         return mcVersion;   // vanilla
        }
    }

    // ── Launch ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Installs (if missing) and launches a Minecraft version, returning the started process.
    /// </summary>
    /// <param name="versionId">CmlLib version name — vanilla e.g. <c>"1.21.1"</c>,
    /// NeoForge e.g. <c>"neoforge-21.1.172"</c> (returned by
    /// <see cref="InstallNeoForgeAsync"/>).</param>
    /// <param name="gameDir">
    /// Per-instance <c>.minecraft</c> directory (mods, config, saves).
    /// When <c>null</c>, uses the shared CmlLib root (only suitable for plain vanilla).
    /// </param>
    public async Task<Process> InstallAndLaunchAsync(
        string versionId,
        MSession session,
        int ramMb,
        string? gameDir  = null,
        string? javaPath = null,
        IEnumerable<MArgument>? extraJvmArgs = null,
        string? stdoutLog = null,
        IEnumerable<MArgument>? extraGameArgs = null,
        CancellationToken ct = default)
    {
        // Libraries/versions live in _root; game dir (mods/config/saves) is separate.
        var mcPath   = new MinecraftPath(_root);
        var launcher = new MinecraftLauncher(mcPath);
        launcher.FileProgressChanged += (_, a) => FileProgress?.Invoke(a.Name ?? "", a.ProgressedTasks, a.TotalTasks);
        launcher.ByteProgressChanged += (_, a) => ByteProgress?.Invoke(a.ProgressedBytes, a.TotalBytes);

        var opt = new MLaunchOption
        {
            Session      = session,
            MaximumRamMb = ramMb > 0 ? ramMb : 4096,
        };
        if (!string.IsNullOrWhiteSpace(javaPath)) opt.JavaPath = javaPath;
        // Game dir: the version json ALREADY contains "--gameDir ${game_directory}",
        // so override the variable instead of appending a second --gameDir — Mod-
        // Launcher's option parser hard-crashes on a duplicate option
        // (joptsimple MultipleArgumentsForOptionException). Verified on the real
        // neoforge-21.1.1: this yields exactly ONE properly-quoted --gameDir while
        // assets/libraries stay in the shared root.
        if (!string.IsNullOrWhiteSpace(gameDir))
            opt.ArgumentDictionary = new Dictionary<string, string> { ["game_directory"] = gameDir };
        var gameArgs = new List<MArgument>();
        if (extraGameArgs != null) gameArgs.AddRange(extraGameArgs);
        if (gameArgs.Count > 0) opt.ExtraGameArguments = gameArgs;
        if (extraJvmArgs != null) opt.ExtraJvmArguments = extraJvmArgs;

        var proc = await launcher.InstallAndBuildProcessAsync(versionId, opt, ct);

        // CWD must be the instance dir, like Prism does: many mods (FancyMenu,
        // Jupiter, Ice&Fire…) resolve "./config/…" against the process working
        // directory, not --gameDir. CmlLib defaults it to the shared root, which
        // crashed FancyMenu (IOException reading its config → NPE in LoadingOverlay).
        if (!string.IsNullOrWhiteSpace(gameDir))
            proc.StartInfo.WorkingDirectory = gameDir;

        // Capture the JVM's stdout/stderr so early crashes (which never reach
        // Minecraft's own logs/latest.log) are still recoverable for diagnosis.
        if (!string.IsNullOrWhiteSpace(stdoutLog))
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(stdoutLog)!);

                // Create the writer BEFORE mutating StartInfo so that if the
                // StreamWriter constructor throws (e.g. permissions), StartInfo
                // is still clean and the fallback proc.Start() below works correctly.
                var writer = new StreamWriter(stdoutLog, append: false, System.Text.Encoding.UTF8)
                {
                    AutoFlush = true,
                };

                proc.StartInfo.UseShellExecute        = false;
                proc.StartInfo.RedirectStandardOutput = true;
                proc.StartInfo.RedirectStandardError  = true;
                proc.StartInfo.StandardOutputEncoding = System.Text.Encoding.UTF8;
                proc.StartInfo.StandardErrorEncoding  = System.Text.Encoding.UTF8;
                var gate = new object();
                proc.OutputDataReceived += (_, e) =>
                {
                    if (e.Data == null) return;
                    lock (gate) writer.WriteLine(e.Data);
                };
                proc.ErrorDataReceived += (_, e) =>
                {
                    if (e.Data == null) return;
                    lock (gate) writer.WriteLine(e.Data);
                };
                proc.Exited += (_, _) =>
                {
                    try { lock (gate) { writer.Flush(); writer.Dispose(); } } catch { }
                };
                proc.EnableRaisingEvents = true;

                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                return proc;
            }
            catch
            {
                // If redirection setup fails, fall through to a plain launch.
            }
        }

        proc.Start();
        return proc;
    }
}
