using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace VSpeedLauncher.Core;

/// <summary>
/// User-editable preferences and the instance registry.  Loaded once at app
/// startup and saved on every change.  Stored at
/// <c>%LOCALAPPDATA%\VSpeedLauncher\config.json</c>.
///
/// <para>The instance registry maps a friendly name (e.g. "All the Mods 10")
/// to a PrismLauncher instance id (the folder name under
/// <c>PrismLauncher/instances/</c>).  The launcher invokes Prism via:</para>
/// <code>prismlauncher.exe --launch &lt;id&gt;</code>
/// </summary>
public sealed class ConfigStore
{
    private readonly string _path;

    public Config Data { get; private set; } = new();

    public ConfigStore(string path) => _path = path;

    public void Load()
    {
        if (!File.Exists(_path))
        {
            Data = Config.Default();
            Save();
            return;
        }
        try
        {
            var json = File.ReadAllText(_path);
            Data = JsonSerializer.Deserialize<Config>(json, _opts) ?? Config.Default();
            MigrateInstanceRoots();
            MigrateAiModel();
            Save();   // persist migrations so they stick + show in Settings
        }
        catch (Exception e)
        {
            Logger.Warn($"Config load failed: {e.Message} — using defaults");
            Data = Config.Default();
        }
    }

    public void Save()
    {
        try
        {
            File.WriteAllText(_path, JsonSerializer.Serialize(Data, _opts));
        }
        catch (Exception e)
        {
            Logger.Warn($"Config save failed: {e.Message}");
        }
    }

    /// <summary>Upgrade the AI model for users still on an old weak DEFAULT
    /// (8b / phi-4-mini) to the stronger 70b — a deliberate non-default choice is
    /// left untouched. Big quality win for testers who never changed it.</summary>
    private void MigrateAiModel()
    {
        var m = (Data.AiModel ?? "").Trim();
        if (m.Length == 0 || m == "meta/llama-3.1-8b-instruct" || m == "microsoft/phi-4-mini-instruct")
            Data.AiModel = "meta/llama-3.3-70b-instruct";
    }

    /// <summary>Back-compat for configs written before multi-root support: seed
    /// <see cref="Config.InstanceRoots"/> from the old PrismDataDir and tag any
    /// untagged instances with the primary root.</summary>
    private void MigrateInstanceRoots()
    {
        Data.InstanceRoots ??= new();
        if (Data.InstanceRoots.Count == 0 && !string.IsNullOrWhiteSpace(Data.PrismDataDir))
            Data.InstanceRoots.Add(Data.PrismDataDir);
        var primary = Data.InstanceRoots.Count > 0 ? Data.InstanceRoots[0] : Data.PrismDataDir;
        foreach (var e in Data.Instances)
            if (string.IsNullOrWhiteSpace(e.DataDir))
                e.DataDir = primary;
    }

    private static readonly JsonSerializerOptions _opts = new()
    {
        WriteIndented          = true,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

/// <summary>Schema for <c>config.json</c>.  Default constructed = first-launch defaults.</summary>
public sealed class Config
{
    public string PrismExe          { get; set; } = "";
    public string PrismDataDir      { get; set; } = "";
    /// <summary>Folders that contain instances (Prism-style data dirs, each with an
    /// <c>instances/</c> subfolder). All are scanned and shown together; when a
    /// modpack is installed and more than one exists, the user picks the target.</summary>
    public List<string> InstanceRoots { get; set; } = new();
    public bool   ShowOnLaunch      { get; set; } = true;
    public bool   AutoHibernate     { get; set; } = true;
    public bool   StartWithWindows  { get; set; } = false;
    /// <summary>Hide the launcher window when a game starts launching.</summary>
    public bool   AutoHideOnLaunch  { get; set; } = false;
    /// <summary>Snapshot the instance's worlds before each launch (opt-in safety net).</summary>
    public bool   AutoBackupBeforeLaunch { get; set; } = false;
    public bool   AutoCleanCache    { get; set; } = true;

    // Notifications (tray balloons)
    public bool   NotifyLaunchDone  { get; set; } = true;
    public bool   NotifyCacheBuilt  { get; set; } = true;
    public bool   NotifyCrash       { get; set; } = true;

    // Defaults applied to new instances
    public int    DefaultRamMax     { get; set; } = 8192;
    public string DefaultJvmPreset  { get; set; } = "Balanced (G1GC)";

    // ── Game Session Boost (applied to every engine launch while enabled) ──
    /// <summary>High CPU priority + P-core affinity (hybrid CPUs) + discrete-GPU
    /// preference + high-performance power plan while the game runs.</summary>
    public bool   SessionBoostEnabled { get; set; } = false;
    /// <summary>Adds -XX:+UseLargePages (needs the one-time privilege grant +
    /// re-login; the JVM falls back gracefully with a warning if unavailable).</summary>
    public bool   LargePagesEnabled   { get; set; } = false;

    // ── AI assistant (NVIDIA NIM / build.nvidia.com) ──
    /// <summary>NVIDIA API key (NGC). Pasted by the user in Settings → Assistant. Never logged.</summary>
    public string AiApiKey   { get; set; } = "";
    /// <summary>OpenAI-compatible base. Hosted cloud by default; set to http://localhost:8000 for a local NIM.</summary>
    public string AiBaseUrl  { get; set; } = "https://integrate.api.nvidia.com";
    // Default to a STRONG model on NVIDIA's free hosted endpoint — small models
    // (8b / phi-4-mini) give poor, generic modpack diagnoses. 70b is far better at
    // reading crash reports without false alarms. Switch in Settings → Assistant.
    public string AiModel    { get; set; } = "meta/llama-3.3-70b-instruct";
    /// <summary>If true, apply safe proposed fixes without asking. Off = 1-click confirm (default).</summary>
    public bool   AiAutoApply { get; set; } = false;

    /// <summary>CurseForge API key (from console.curseforge.com). Optional — enables the
    /// CurseForge source in the mod browser. Never logged or echoed to the UI.</summary>
    public string CurseForgeApiKey { get; set; } = "";

    // ── Discord Rich Presence ──
    /// <summary>Discord Application (client) ID from discord.com/developers. Optional.</summary>
    public string DiscordClientId { get; set; } = "";
    /// <summary>Show "Playing …" status in Discord while a game runs.</summary>
    public bool   DiscordEnabled  { get; set; } = false;

    public List<InstanceEntry> Instances { get; set; } = new();

    /// <summary>Reusable launch presets (RAM + JVM args + VSpeed toggle).</summary>
    public List<ProfileData> Profiles { get; set; } = new();

    public static Config Default()
    {
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var prismData = Path.Combine(roaming, "PrismLauncher");
        var prismExe  = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "PrismLauncher", "prismlauncher.exe");

        var roots = new List<string>();
        if (Directory.Exists(prismData)) roots.Add(prismData);

        return new Config
        {
            PrismExe      = File.Exists(prismExe) ? prismExe : "",
            PrismDataDir  = Directory.Exists(prismData) ? prismData : "",
            InstanceRoots = roots,
            Instances     = DiscoverInstances(roots),
        };
    }

    /// <summary>Scan every instance root (a Prism-style data dir with an
    /// <c>instances/</c> folder) and build the list, tagging each entry with the
    /// root it lives under. First root wins if the same id appears in two roots.</summary>
    public static List<InstanceEntry> DiscoverInstances(IEnumerable<string> roots)
    {
        var list = new List<InstanceEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots)
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            var instances = Path.Combine(root, "instances");
            if (!Directory.Exists(instances)) continue;
            foreach (var dir in Directory.EnumerateDirectories(instances))
            {
                var cfg = Path.Combine(dir, "instance.cfg");
                if (!File.Exists(cfg)) continue;
                var id = Path.GetFileName(dir);
                if (!seen.Add(id)) continue;
                var name = id;
                foreach (var line in File.ReadAllLines(cfg))
                    if (line.StartsWith("name=", StringComparison.Ordinal))
                        { name = line[5..]; break; }
                list.Add(new InstanceEntry { Id = id, DisplayName = name, DataDir = root });
            }
        }
        return list;
    }
}

/// <summary>A reusable launch preset that can be applied to any instance.</summary>
public sealed class ProfileData
{
    public string Id            { get; set; } = "";
    public string Name          { get; set; } = "";
    public string Icon          { get; set; } = "zap";    // UI icon name
    public int    RamMax        { get; set; } = 8192;     // MB
    public string JvmArgs       { get; set; } = "";
    public bool   VspeedEnabled { get; set; } = true;
    public bool   BuiltIn       { get; set; } = false;    // built-ins can't be deleted

    /// <summary>The four presets seeded on first launch.</summary>
    public static List<ProfileData> Defaults() => new()
    {
        new ProfileData {
            Id = "performance", Name = "Performance", Icon = "zap", RamMax = 8192, VspeedEnabled = true, BuiltIn = true,
            JvmArgs = "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions "
                    + "-XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 "
                    + "-XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 "
                    + "-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 "
                    + "-XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1",
        },
        new ProfileData { Id = "balanced",    Name = "Balanced",         Icon = "gauge",   RamMax = 6144, VspeedEnabled = true,  BuiltIn = true, JvmArgs = "-XX:+UseG1GC" },
        new ProfileData { Id = "lightweight", Name = "Lightweight",      Icon = "feather", RamMax = 3072, VspeedEnabled = false, BuiltIn = true, JvmArgs = "" },
        new ProfileData { Id = "lowlatency",  Name = "Low-latency (ZGC)",Icon = "activity",RamMax = 8192, VspeedEnabled = true,  BuiltIn = true, JvmArgs = "-XX:+UseZGC -XX:+AlwaysPreTouch -XX:+DisableExplicitGC" },
    };
}

/// <summary>One row in the launcher's instance list.</summary>
public sealed class InstanceEntry
{
    public string Id          { get; set; } = "";       // instance folder name (Prism id or Cryo id)
    public string DisplayName { get; set; } = "";       // human label for the UI
    public bool   Hibernate   { get; set; } = true;     // hibernate after load?
    /// <summary>"prism" = launched via PrismLauncher (default);
    /// "cryo" = launched directly via CmlLib engine.</summary>
    public string Source      { get; set; } = "prism";
    /// <summary>The instance-root (Prism-style data dir) this instance lives under;
    /// its folder is <c>&lt;DataDir&gt;/instances/&lt;Id&gt;</c>. Empty = primary/legacy root.</summary>
    public string DataDir     { get; set; } = "";
}
