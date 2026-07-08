using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using CmlLib.Core.Auth;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using WpfApp = System.Windows.Application;

namespace VSpeedLauncher.Core;

/// <summary>
/// Bidirectional JS ↔ C# bridge for the Cryo React UI running inside WebView2.
///
/// <h3>Protocol</h3>
/// JS → C# (request):
/// <code>window.chrome.webview.postMessage(JSON.stringify({id, method, args}))</code>
/// C# → JS (response):
/// <code>{"id": "r1", "result": ...}  |  {"id": "r1", "error": "..."}</code>
/// C# → JS (push event, no id):
/// <code>{"type": "instanceStateChanged", "data": {...}}</code>
///
/// All bridge calls are handled on a background thread; responses are posted
/// back to the WebView2 via <c>Dispatcher.Invoke</c>.
/// </summary>
public sealed partial class CryoBridge
{
    private readonly InstanceManager _manager;
    private readonly ConfigStore     _config;
    private readonly HistoryStore    _history;
    private readonly WebView2        _webView;
    private readonly string          _prismDataDir;

    private static readonly JsonSerializerOptions _jOpts = new()
    {
        PropertyNamingPolicy        = JsonNamingPolicy.CamelCase,
        WriteIndented               = false,
        DefaultIgnoreCondition      = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public CryoBridge(InstanceManager manager, ConfigStore config,
                      HistoryStore history, WebView2 webView)
    {
        _manager      = manager;
        _config       = config;
        _history      = history;
        _webView      = webView;
        _prismDataDir = config.Data.PrismDataDir;

        // Subscribe to runtime state changes and push them to the UI
        foreach (var inst in manager.Instances)
            inst.Changed += OnInstanceChanged;

        manager.Instances.CollectionChanged += (_, _) =>
        {
            foreach (var inst in manager.Instances)
            {
                inst.Changed -= OnInstanceChanged;
                inst.Changed += OnInstanceChanged;
            }
        };

        // Set initial Discord presence if configured (no-op otherwise).
        UpdateDiscordPresence();
    }

    // ── Push: C# → JS ────────────────────────────────────────────────────────

    private void OnInstanceChanged(RunningInstance inst)
    {
        Push("instanceStateChanged", BuildRuntimeState(inst));
        ManageLauncherWindow(inst);
        UpdateDiscordPresence();
    }

    // ── Discord Rich Presence ────────────────────────────────────────────────
    private static readonly DiscordRpc _discord = new();

    /// <summary>Connects/refreshes Discord presence based on config + running games.
    /// No-op when disabled or no client ID is set. Runs off-thread (pipe I/O).</summary>
    public void UpdateDiscordPresence()
    {
        var enabled  = _config.Data.DiscordEnabled;
        var clientId = DiscordRpc.EmbeddedClientId;   // embedded public app ID (no user setup)
        _ = Task.Run(() =>
        {
            try
            {
                if (!enabled || string.IsNullOrEmpty(clientId)) { _discord.Clear(); return; }
                if (!_discord.Connect(clientId)) return;

                var active = _manager.Instances.FirstOrDefault(i =>
                    i.State is InstanceState.Ready or InstanceState.Loading or InstanceState.Hibernated);
                if (active != null)
                {
                    var name = active.Entry.DisplayName;
                    var meta = ReadMetaSafe(active.Entry.Id);
                    _discord.SetPresence($"Playing {name}", meta != null ? $"{meta.Loader} {meta.Mc}".Trim() : "Modded Minecraft");
                }
                else
                {
                    _discord.SetPresence("In the launcher", "Browsing modpacks");
                }
            }
            catch (Exception e) { Logger.Info($"Discord presence: {e.Message}"); }
        });
    }

    private InstanceMeta? ReadMetaSafe(string id)
    {
        try { return InstanceMetaReader.Read(id, InstanceDataDir(id)); } catch { return null; }
    }

    // ── Auto-update (Velopack + GitHub Releases) ─────────────────────────────
    private static readonly UpdateService _updater = new();

    private object GetAppVersion() => new
    {
        version   = _updater.CurrentVersion,
        installed = _updater.IsInstalled,
    };

    private async Task<object?> CheckForUpdateAsync()
    {
        try
        {
            if (!_updater.IsInstalled)
                return new { ok = true, available = false, installed = false, current = _updater.CurrentVersion };
            var v = await _updater.CheckAsync();
            return new { ok = true, available = v != null, version = v, current = _updater.CurrentVersion, installed = true };
        }
        catch (Exception e)
        {
            Logger.Warn($"CheckForUpdate: {e.Message}");
            return new { ok = false, error = e.Message };
        }
    }

    /// <summary>Downloads the pending update (progress via updateProgress) then
    /// applies it and restarts. Push events: updateProgress / updateError.</summary>
    private object ApplyUpdate()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                Push("updateProgress", new { phase = "download", percent = 0 });
                await _updater.DownloadAsync(p => Push("updateProgress", new { phase = "download", percent = p }));
                Push("updateProgress", new { phase = "ready", percent = 100 });
                await Task.Delay(700);   // let the UI show "restarting…"
                _updater.ApplyAndRestart();   // exits the process
            }
            catch (Exception e)
            {
                Logger.Warn($"ApplyUpdate: {e.Message}");
                Push("updateError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    /// <summary>
    /// Hide the launcher when a game is loading (avoids GPU conflict with
    /// Minecraft's GL context + gives the user a clean game launch).
    /// Show it again when the game exits or crashes.
    /// </summary>
    private void ManageLauncherWindow(RunningInstance inst)
    {
        WpfApp.Current?.Dispatcher.Invoke(() =>
        {
            switch (inst.State)
            {
                case InstanceState.Crashed:
                    // Always show the launcher on crash so the user can see the error.
                    App.Current.OpenMainWindow();
                    break;

                case InstanceState.Stopped:
                    // If we hid the window when the game started, bring it back now.
                    if (_config.Data.AutoHideOnLaunch)
                        App.Current.OpenMainWindow();
                    break;
            }
        });
    }

    private void Push(string type, object data)
    {
        var json = JsonSerializer.Serialize(new { type, data }, _jOpts);
        try
        {
            WpfApp.Current?.Dispatcher.Invoke(() =>
                _webView.CoreWebView2?.PostWebMessageAsString(json));
        }
        catch (Exception e)
        {
            Logger.Warn($"Bridge push failed: {e.Message}");
        }
    }

    // ── Receive: JS → C# ─────────────────────────────────────────────────────

    public void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var raw = e.WebMessageAsJson;
        _ = Task.Run(async () =>
        {
            string? reqId = null;
            try
            {
                var req  = JsonNode.Parse(raw)!;
                reqId    = req["id"]?.GetValue<string>();
                var meth = req["method"]?.GetValue<string>() ?? "";
                var argsNode = req["args"];
                var args = (argsNode is JsonObject) ? argsNode : new JsonObject();

                Logger.Info($"Bridge → {meth}");
                var result = await DispatchAsync(meth, args);
                Reply(reqId, result, null);
            }
            catch (Exception ex)
            {
                Logger.Error($"Bridge({reqId}): {ex.Message}");
                Reply(reqId, null, ex.Message);
            }
        });
    }

    private void Reply(string? id, object? result, string? error)
    {
        object payload = error != null
            ? new { id, error }
            : (object)new { id, result };
        var json = JsonSerializer.Serialize(payload, _jOpts);
        try
        {
            WpfApp.Current?.Dispatcher.Invoke(() =>
                _webView.CoreWebView2?.PostWebMessageAsString(json));
        }
        catch (Exception e)
        {
            Logger.Warn($"Bridge reply failed: {e.Message}");
        }
    }

    // ── Method dispatcher ─────────────────────────────────────────────────────

    private async Task<object?> DispatchAsync(string method, JsonNode args)
    {
        // Async handlers that perform real I/O run before the sync switch.
        if (method == "aiChat")              return await AiChatAsync(args);
        if (method == "accountStatus")       return await AccountStatusAsync();
        if (method == "getNeoForgeVersions") return await GetNeoForgeVersionsAsync(args.Str("mcVersion"));
        if (method == "searchModrinth")      return await SearchModrinthAsync(args.Str("query"), args.Str("id"), args.Int("offset", 0), args.Str("kind"), args.Str("sort"), args.Str("category"));
        if (method == "getModrinthVersions") return await GetModrinthVersionsAsync(args.Str("projectId"), args.Str("id"));
        if (method == "getInstalledModIds")  return await GetInstalledModIdsAsync(args.Str("id"));
        if (method == "pingServer")          return await PingServerAsync(args.Str("ip"));
        if (method == "searchCurseForge")    return await SearchCurseForgeAsync(args.Str("query"), args.Str("id"), args.Int("offset", 0), args.Str("kind"), args.Str("sort"));
        if (method == "getCurseForgeFiles")  return await GetCurseForgeFilesAsync(args.Str("projectId"), args.Str("id"));
        if (method == "checkForUpdate")      return await CheckForUpdateAsync();
        if (method == "getModpackInfo")      return await GetModpackInfoAsync(args.Str("id"));
#pragma warning disable CS8619
        object? result = method switch
        {
            "getInstances"    => GetInstances(),
            "getInstance"     => GetInstance(args.Str("id")),
            "setInstanceTags"      => SetInstanceTags(args.Str("id"), args["tags"]),
            "setInstanceNote"      => SetInstanceNote(args.Str("id"), args.Str("note")),
            "getInstanceTagColors" => GetInstanceTagColors(),
            "setInstanceTagColor"  => SetInstanceTagColor(args.Str("tag"), args.Str("color")),
            "getKpis"         => GetKpis(args.Str("id")),
            "getCache"        => GetCache(args.Str("id")),
            "getMods"         => GetMods(args.Str("id")),
            "getHealth"       => GetHealth(args.Str("id")),
            "setModEnabled"   => SetModEnabled(args.Str("id"), args.Str("file"), args.Bool("enabled", true)),
            "setModTags"      => SetModTags(args.Str("id"), args.Str("file"), args["tags"]),
            "setModNote"      => SetModNote(args.Str("id"), args.Str("file"), args.Str("note")),
            "getTagColors"    => GetTagColors(args.Str("id")),
            "setTagColor"     => SetTagColor(args.Str("id"), args.Str("tag"), args.Str("color")),
            "openUrl"         => OpenUrl(args.Str("url")),
            "openPrism"       => OpenPrism(),
            "setProfileNextLaunch" => SetProfileNextLaunch(args.Str("id"), args.Bool("on", false)),
            "getHistory"      => GetHistory(),
            "getLogs"         => GetLogs(args.Str("id"), args.Int("n", 3000)),
            "getBootTimeline" => GetBootTimeline(args.Str("id")),
            "rebuildCache"    => RebuildCache(args.Str("id")),
            "launchInstance"  => LaunchInstance(args.Str("id"), args.Bool("vanilla", false), args.Str("joinServer")),
            "startBenchmark"  => StartBenchmark(args.Str("id")),
            "cancelBenchmark" => CancelBenchmark(),
            "getTurbo"        => GetTurbo(args.Str("id")),
            "setTurbo"        => SetTurbo(args.Str("id"), args.Bool("on", false)),
            "resetTurbo"      => ResetTurbo(args.Str("id")),
            "openConsole"     => OpenConsole(args.Str("id")),
            "selfCheck"       => SelfCheck(),
            "getAppVersion"   => GetAppVersion(),
            "applyUpdate"     => ApplyUpdate(),
            "openLauncherLog" => OpenLauncherLog(),
            "scanMods"        => ScanMods(args.Str("id")),
            "analyzeModGraph" => AnalyzeModGraph(args.Str("id")),
            "coreTest"        => CoreTest(args.Str("version"), args.Int("ram", 0)),
            "accountLogin"    => AccountLogin(),
            "accountLogout"   => AccountLogout(),
            "aiChatStream"    => StartAiStream(args),
            "getStats"        => GetStats(args.Str("id")),
            "stopInstance"    => StopInstance(args.Str("id")),
            "windowMinimize"  => WindowMinimize(),
            "windowMaximize"  => WindowMaximize(),
            "windowClose"     => WindowClose(),
            "uiReady"         => new { ok = true },   // React signals first paint → host fades splash
            "windowDragStart" => WindowDragStart(),
            "getConfig"         => GetConfig(),
            "saveConfig"        => SaveConfig(args),
            // ── Instance config (instance.cfg) ─────────────────────────────────
            "getInstanceCfg"    => GetInstanceCfg(args.Str("id")),
            "saveInstanceCfg"   => SaveInstanceCfg(args.Str("id"), args),
            "detectJavas"       => DetectJavas(args.Str("id")),
            "getSystemRam"      => GetSystemRam(),
            // ── Shell / file actions ───────────────────────────────────────────
            "openFolder"        => OpenFolder(args.Str("id")),
            "openCrashReport"   => OpenCrashReport(args.Str("id")),
            "exportLogs"        => ExportLogs(args.Str("id"), args.Str("content")),
            "removeFromLauncher"  => RemoveFromLauncher(args.Str("id")),
            // ── Profiles ───────────────────────────────────────────────────────────
            "getProfiles"         => GetProfiles(),
            "saveProfile"         => SaveProfile(args),
            "deleteProfile"       => DeleteProfile(args.Str("profileId")),
            "applyProfile"        => ApplyProfile(args.Str("id"), args.Str("profileId")),
            // ── AI Memory ─────────────────────────────────────────────────────────
            "saveAiMemory"        => SaveAiMemory(args.Str("id"), args.Str("problem"), args.Str("solution"), args["actions"]),
            "getAiMemory"         => GetAiMemory(args.Str("id")),
            "clearAiMemory"       => ClearAiMemory(args.Str("id")),
            // ── Instance creation / modpack install (no Prism) ─────────────────────
            "createInstance"      => CreateInstance(args),
            "getInstanceRoots"    => GetInstanceRoots(),
            "addInstanceRoot"     => AddInstanceRoot(args.Str("path")),
            "removeInstanceRoot"  => RemoveInstanceRoot(args.Str("path")),
            "pickFolder"          => PickFolder(),
            "setPrimaryRoot"      => SetPrimaryRoot(args.Str("path")),
            "openPath"            => OpenPath(args.Str("path")),
            "moveInstance"        => MoveInstance(args.Str("id"), args.Str("targetRoot")),
            "duplicateInstance"   => DuplicateInstance(args.Str("id")),
            "installModrinthModpack"   => InstallModrinthModpack(args.Str("projectId"), args.Str("versionId"), args.Str("name"), args.Str("targetRoot")),
            "installCurseForgeModpack" => InstallCurseForgeModpack(args.Str("projectId"), args.Str("fileId"), args.Str("name"), args.Str("targetRoot")),
            "updateModpack"            => UpdateModpack(args.Str("id")),
            // ── Modpack Export / Import ────────────────────────────────────────────
            "exportModpack"       => ExportModpack(args.Str("id")),
            "importModpack"       => ImportModpack(),
            // ── Modrinth ───────────────────────────────────────────────────────────
            "downloadMod"         => DownloadMod(args.Str("id"), args.Str("url"), args.Str("filename"), args.Str("sha512"), args.Str("projectTitle")),
            "downloadModrinthMod" => DownloadModrinthMod(args.Str("id"), args.Str("projectId"), args.Str("versionId"), args.Str("projectTitle")),
            "installPerformancePack" => InstallPerformancePack(args.Str("id")),
            "addLocalMods"        => AddLocalMods(args.Str("id")),
            "addLocalModData"     => AddLocalModData(args.Str("id"), args.Str("filename"), args.Str("base64")),
            "checkModUpdates"     => CheckModUpdates(args.Str("id")),
            "updateMod"           => UpdateMod(args.Str("id"), args.Str("oldFile"), args.Str("url"), args.Str("newFilename"), args.Str("sha512")),
            // ── Server list ────────────────────────────────────────────────────────
            "getServers"          => GetServers(args.Str("id")),
            "addServer"           => AddServer(args.Str("id"), args.Str("name"), args.Str("ip")),
            "removeServer"        => RemoveServer(args.Str("id"), args.Str("ip")),
            // ── World Backups ──────────────────────────────────────────────────────
            "getWorlds"           => GetWorlds(args.Str("id")),
            "getScreenshots"      => GetScreenshots(args.Str("id")),
            "deleteScreenshot"    => DeleteScreenshot(args.Str("id"), args.Str("file")),
            "openScreenshot"      => OpenScreenshot(args.Str("id"), args.Str("file")),
            "backupWorld"         => BackupWorld(args.Str("id"), args.Str("worldName")),
            "getBackups"          => GetBackups(args.Str("id")),
            "restoreBackup"       => RestoreBackup(args.Str("id"), args.Str("file")),
            "deleteBackup"        => DeleteBackup(args.Str("id"), args.Str("file")),
            "openWorldsFolder"    => OpenWorldsFolder(args.Str("id")),
            // ── Cryo Engine (CmlLib.Core) ──────────────────────────────────────────
            "installNeoForge"     => InstallNeoForge(args.Str("id"), args.Str("neoForgeVersion")),
            "launchWithEngine"    => LaunchWithEngine(args.Str("id"), args.Str("joinServer")),
            "getEngineStatus"     => GetEngineStatus(args.Str("id")),
            "setEngineSource"     => SetEngineSource(args.Str("id"), args.Str("source")),
            // ── Server hosting (run a dedicated server for a pack) ──────────────────
            "getHostedServer"     => GetHostedServer(args.Str("id")),
            "createServer"        => CreateServer(args.Str("id")),
            "startServer"         => StartServer(args.Str("id")),
            "stopServer"          => StopServer(args.Str("id")),
            "sendServerCommand"   => SendServerCommand(args.Str("id"), args.Str("cmd")),
            "getServerConsole"    => GetServerConsole(args.Str("id"), args.Int("n", 800)),
            "saveServerSettings"  => SaveServerSettings(args.Str("id"), args.Int("ramMb", 0), args.Int("port", 0)),
            "getServerProperties" => GetServerProperties(args.Str("id")),
            "saveServerProperties"=> SaveServerProperties(args.Str("id"), args["props"]),
            "acceptServerEula"    => AcceptServerEula(args.Str("id")),
            "deleteServer"        => DeleteServer(args.Str("id")),
            "openServerFolder"    => OpenServerFolder(args.Str("id")),
            _ => throw new InvalidOperationException($"Unknown method: {method}"),
        };
#pragma warning restore CS8619
        return result;
    }

    // ── Instance list ─────────────────────────────────────────────────────────

    private object GetInstances()
    {
        var result = new List<object>();
        foreach (var inst in _manager.Instances)
        {
            try
            {
                var meta = ReadMeta(inst.Entry.Id);
                Merge(meta, inst);
                result.Add(EnrichWithPhases(meta, inst.Entry.Id));
            }
            catch (Exception ex)
            {
                Logger.Warn($"GetInstances: skipping '{inst.Entry.Id}': {ex.Message}");
                // Return a minimal safe object so the UI still shows the instance
                result.Add(new
                {
                    id = inst.Entry.Id, name = inst.Entry.DisplayName,
                    loader = "", mc = "", loaderVer = "", java = "",
                    mods = 0, ramMin = 2048, ramMax = 8192,
                    lastPlayed = 0L, accent = "#38BDF8",
                    cacheState = "off", wallClock = 90,
                    phases = DefaultPhases(90),
                    state = inst.State.ToString().ToLowerInvariant(),
                    jvmPid = inst.JvmPid, loadSeconds = inst.LoadSeconds,
                    residentMB = inst.ResidentMB, lastError = ex.Message,
                    tags = new List<string>(), note = "",
                });
            }
        }
        return result;
    }

    private object GetInstance(string id)
    {
        var inst = _manager.FindById(id);
        var meta = ReadMeta(id);
        if (inst != null) Merge(meta, inst);
        return EnrichWithPhases(meta, id);
    }

    /// <summary>
    /// Adds wallClock and phases — required by the React Overview tab.
    /// wallClock is the last known boot time from history (or a safe estimate).
    /// phases are computed from proportional timings (bootstrap 12%, construction 71%, setup 17%).
    /// </summary>
    private object EnrichWithPhases(InstanceMeta meta, string id)
    {
        var kpi    = _history.GetKpis(id);
        double wall = kpi.Avg > 0 ? kpi.Avg : EstimateWall(meta.ModCount);
        var im     = LoadInstanceMeta(id);   // user tags + note for the whole pack
        return new
        {
            id           = meta.Id,
            name         = meta.Name,
            loader       = meta.Loader,
            mc           = meta.Mc,
            loaderVer    = meta.LoaderVer,
            java         = meta.Java,
            mods         = meta.ModCount,
            ramMin       = meta.RamMin,
            ramMax       = meta.RamMax,
            lastPlayed   = meta.LastPlayed,
            accent       = meta.Accent,
            cacheState   = meta.CacheState,
            wallClock    = (int)Math.Round(wall),
            phases       = DefaultPhases(wall),
            state        = meta.State,
            jvmPid       = meta.JvmPid,
            loadSeconds  = meta.LoadSeconds,
            residentMB   = meta.ResidentMB,
            lastError    = meta.LastError,
            tags         = im.Tags,
            note         = im.Note,
        };
    }

    private static double EstimateWall(int modCount) =>
        modCount switch { < 50 => 15, < 150 => 35, < 300 => 60, _ => 90 };

    private static object[] DefaultPhases(double wall)
    {
        var boot  = Math.Round(wall * 0.12, 1);
        var cons  = Math.Round(wall * 0.71, 1);
        var setup = Math.Round(wall * 0.17, 1);
        return new object[]
        {
            new { key = "bootstrap",    start = 0.0,        dur = boot,  cacheable = false },
            new { key = "construction", start = boot,       dur = cons,  cacheable = false },
            new { key = "setup",        start = boot+cons-Math.Round(wall*0.06,1), dur = setup, cacheable = false },
        };
    }

    private InstanceMeta ReadMeta(string id)
        => InstanceMetaReader.Read(id, InstanceDataDir(id));

    private static void Merge(InstanceMeta meta, RunningInstance inst)
    {
        meta.State       = inst.State.ToString().ToLowerInvariant();
        meta.JvmPid      = inst.JvmPid;
        meta.LoadSeconds = inst.LoadSeconds;
        meta.ResidentMB  = inst.ResidentMB;
        meta.LastError   = inst.LastError ?? "";
    }

    // ── Per-instance user metadata: tags + note ──────────────────────────────
    // Lets users label/group whole packs ("favorite", "smp", "testing") and jot
    // a note. Stored next to the instance so it travels with a move/duplicate.
    public sealed class InstanceUserMeta
    {
        public List<string> Tags { get; set; } = new();
        public string       Note { get; set; } = "";
    }

    private string InstanceMetaPath(string id)
        => Path.Combine(InstanceDataDir(id), "instances", id, "cryo-instance.json");

    private InstanceUserMeta LoadInstanceMeta(string id)
    {
        try
        {
            var p = InstanceMetaPath(id);
            if (!File.Exists(p)) return new();
            return JsonSerializer.Deserialize<InstanceUserMeta>(File.ReadAllText(p), _jOpts) ?? new();
        }
        catch (Exception e) { Logger.Warn($"LoadInstanceMeta({id}): {e.Message}"); return new(); }
    }

    private bool SaveInstanceMeta(string id, InstanceUserMeta data)
    {
        try { File.WriteAllText(InstanceMetaPath(id), JsonSerializer.Serialize(data, _jOpts)); return true; }
        catch (Exception e) { Logger.Warn($"SaveInstanceMeta({id}): {e.Message}"); return false; }
    }

    private object SetInstanceTags(string id, JsonNode? tagsNode)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        var tags = new List<string>();
        if (tagsNode is JsonArray arr)
        {
            foreach (var t in arr)
            {
                var s = (t?.GetValue<string>() ?? "").Trim();
                if (s.Length == 0) continue;
                if (s.Length > 24) s = s[..24];
                if (!tags.Any(x => x.Equals(s, StringComparison.OrdinalIgnoreCase))) tags.Add(s);
                if (tags.Count >= 12) break;
            }
        }
        var data = LoadInstanceMeta(id);
        data.Tags = tags;
        return new { ok = SaveInstanceMeta(id, data), tags };
    }

    private object SetInstanceNote(string id, string note)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        note = (note ?? "").Trim();
        if (note.Length > 500) note = note[..500];
        var data = LoadInstanceMeta(id);
        data.Note = note;
        return new { ok = SaveInstanceMeta(id, data), note };
    }

    // Instance tag colours are library-wide (a tag name is shared across packs),
    // so they live once in the app-data dir, not per-instance.
    private static string InstanceTagColorsPath()
        => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "VSpeedLauncher", "instance-tagcolors.json");

    private Dictionary<string, string> LoadInstanceTagColors()
    {
        try
        {
            var p = InstanceTagColorsPath();
            if (!File.Exists(p)) return new(StringComparer.OrdinalIgnoreCase);
            var d = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(p), _jOpts);
            return d == null ? new(StringComparer.OrdinalIgnoreCase) : new(d, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception e) { Logger.Warn($"LoadInstanceTagColors: {e.Message}"); return new(StringComparer.OrdinalIgnoreCase); }
    }

    private object GetInstanceTagColors() => LoadInstanceTagColors();

    private object SetInstanceTagColor(string tag, string color)
    {
        tag = (tag ?? "").Trim();
        if (tag.Length == 0) return new { ok = false, error = "Empty tag." };
        if (tag.Length > 24) tag = tag[..24];
        color = (color ?? "").Trim();
        var data = LoadInstanceTagColors();
        if (color.Length == 0) data.Remove(tag);
        else if (_hexColor.IsMatch(color)) data[tag] = color;
        else return new { ok = false, error = "Invalid colour." };
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(InstanceTagColorsPath())!);
            File.WriteAllText(InstanceTagColorsPath(), JsonSerializer.Serialize(data, _jOpts));
            return new { ok = true, tag, color };
        }
        catch (Exception e) { Logger.Warn($"SetInstanceTagColor: {e.Message}"); return new { ok = false, error = e.Message }; }
    }

    private static object BuildRuntimeState(RunningInstance inst) => new
    {
        id          = inst.Entry.Id,
        state       = inst.State.ToString().ToLowerInvariant(),
        jvmPid      = inst.JvmPid,
        loadSeconds = inst.LoadSeconds,
        residentMB  = inst.ResidentMB,
        lastError   = inst.LastError ?? "",
    };

    // ── KPIs ──────────────────────────────────────────────────────────────────

    private object GetKpis(string id)
        => _history.GetKpis(id);

    // ── Cache ─────────────────────────────────────────────────────────────────

    private object GetCache(string id)
    {
        var dir  = Path.Combine(InstanceDataDir(id), "instances", id);
        var info = InstanceMetaReader.ReadCacheInfo(dir);
        var state = info.TotalSizeBytes > 0 ? "ready" : "off";

        // Real entry counts come from the mod's vspeed-stats.json (written on world load).
        int recipes = 0, advancements = 0;
        try
        {
            var sp = Path.Combine(dir, "minecraft", "vspeed-stats.json");
            if (File.Exists(sp))
            {
                var types = JsonNode.Parse(File.ReadAllText(sp))?["types"]?.AsObject();
                recipes      = types?["recipe"]?["entries"]?.GetValue<int>() ?? 0;
                advancements = types?["advancement"]?["entries"]?.GetValue<int>() ?? 0;
            }
        }
        catch { /* ignore */ }

        return new
        {
            enabled          = true,
            state,
            modsetHash       = info.Hash != null ? "sha256:" + info.Hash + "…" : "",
            recipes,
            advancements,
            sizeBytes        = info.TotalSizeBytes,
            builtAt          = info.BuiltAt.HasValue
                                 ? new DateTimeOffset(info.BuiltAt.Value).ToUnixTimeMilliseconds()
                                 : (long?)null,
            path             = ".vspeed-cache/json/<type>/<hash>.bin",
            worldEntryCold   = 8.5,
            worldEntryWarm   = 1.8,
        };
    }

    // ── Mods ──────────────────────────────────────────────────────────────────

    // ── Instance health check (VSpeed diagnostics) ──────────────────────────────
    private long SystemRamMb()
    {
        try { var st = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() }; if (GlobalMemoryStatusEx(ref st)) return (long)(st.ullTotalPhys / (1024UL * 1024UL)); }
        catch { }
        return 0;
    }

    private static int ReadRamMaxMb(string instanceDir)
    {
        try
        {
            var cfg = Path.Combine(instanceDir, "instance.cfg");
            if (File.Exists(cfg))
                foreach (var line in File.ReadAllLines(cfg))
                    if (line.StartsWith("MaxMemAlloc=", StringComparison.Ordinal) && int.TryParse(line[12..].Trim(), out var v))
                        return v;
        }
        catch { }
        return 0;
    }

    /// <summary>Diagnoses an instance and returns a 0–100 score + per-check status/tips.</summary>
    private object GetHealth(string id)
    {
        var checks = new List<object>();
        int score = 100;
        void Add(string title, string status, string detail)
        {
            checks.Add(new { title, status, detail });
            if (status == "warn") score -= 12; else if (status == "fail") score -= 28;
        }

        var dir    = Path.Combine(InstanceDataDir(id), "instances", id);
        var mcDir  = Path.Combine(dir, "minecraft");
        var meta   = ReadMetaSafe(id);
        var mc     = meta?.Mc ?? "";
        var loader = meta?.Loader ?? "";

        if (!string.IsNullOrWhiteSpace(mc))
            Add("Minecraft", "ok", (string.IsNullOrWhiteSpace(loader) ? "Vanilla" : loader) + " " + mc);
        else
            Add("Minecraft", "fail", "Version not detected (mmc-pack.json missing?)");

        int reqMajor = JavaMajorForMc(mc);
        var javaPath = ReadInstanceJavaPath(id);
        if (!string.IsNullOrWhiteSpace(javaPath) && !File.Exists(javaPath))
            Add("Java", "warn", "Custom Java path set but the file is missing — pack needs Java " + reqMajor);
        else if (!string.IsNullOrWhiteSpace(javaPath))
            Add("Java", "ok", "Custom Java • this pack needs Java " + reqMajor);
        else
            Add("Java", "ok", "Java " + reqMajor + " (auto-selected)");

        int mods = 0, disabled = 0;
        var modsDir = Path.Combine(mcDir, "mods");
        if (Directory.Exists(modsDir))
        {
            mods     = Directory.GetFiles(modsDir, "*.jar").Length;
            disabled = Directory.GetFiles(modsDir, "*.jar.disabled").Length;
        }
        Add("Mods", "ok", mods + " enabled" + (disabled > 0 ? ", " + disabled + " disabled" : ""));

        int  ramMax    = ReadRamMaxMb(dir);
        long sysMb     = SystemRamMb();
        int  recommend = Math.Min(16384, 4096 + mods * 8);
        if (sysMb > 0) recommend = (int)Math.Min(recommend, Math.Max(2048, sysMb - 2048));
        if (ramMax <= 0)
            Add("Memory", "warn", "Not set — the default will be used");
        else if (ramMax < recommend - 1024)
            Add("Memory", "warn", (ramMax / 1024.0).ToString("0.0") + " GB — low for " + mods + " mods (~" + (recommend / 1024.0).ToString("0.0") + " GB suggested)");
        else if (sysMb > 0 && ramMax > sysMb - 1024)
            Add("Memory", "warn", (ramMax / 1024.0).ToString("0.0") + " GB — leaves little for the OS");
        else
            Add("Memory", "ok", (ramMax / 1024.0).ToString("0.0") + " GB allocated");

        if (reqMajor >= 19) Add("VSpeed (AppCDS)", "ok", "Faster startup active on Java " + reqMajor);
        else                Add("VSpeed (AppCDS)", "warn", "Java " + reqMajor + " — AppCDS needs Java 19+ (older MC)");

        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(dir));
            if (!string.IsNullOrEmpty(root))
            {
                var freeGb = new DriveInfo(root).AvailableFreeSpace / 1024.0 / 1024 / 1024;
                Add("Disk space", freeGb < 2 ? "fail" : freeGb < 5 ? "warn" : "ok", freeGb.ToString("0.0") + " GB free");
            }
        }
        catch { }

        return new { ok = true, score = Math.Max(0, score), mods, disabled, checks };
    }

    private object GetMods(string id)
    {
        var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
        if (!Directory.Exists(modsDir)) return Array.Empty<object>();

        var knownOptim = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "modernfix", "ferritecore", "sodium", "embeddium", "rubidium",
            "immediatelyfast", "entityculling", "moreculling", "noisium",
            "canary", "radium", "lithium", "starlight", "smoothboot",
        };

        // Include both enabled (*.jar) and disabled (*.jar.disabled) mods.
        var files = Directory.GetFiles(modsDir, "*.jar")
            .Concat(Directory.GetFiles(modsDir, "*.jar.disabled"));

        var modMeta = LoadModMeta(id);   // user tags + notes (keyed by base filename)

        return files.Select(path =>
            {
                var file    = Path.GetFileName(path);                 // real filename, incl. .disabled
                var enabled = !file.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase);
                var baseN   = enabled ? file : file[..^".disabled".Length];   // strip .disabled
                var fn      = baseN.EndsWith(".jar", StringComparison.OrdinalIgnoreCase) ? baseN[..^4] : baseN;
                var sizeMb  = new FileInfo(path).Length / 1024.0 / 1024.0;
                var dash    = fn.LastIndexOf('-');
                var name    = dash > 0 ? fn[..dash] : fn;
                var ver     = dash > 0 ? fn[(dash + 1)..] : "";
                var isOptim = knownOptim.Any(k => name.Contains(k, StringComparison.OrdinalIgnoreCase));
                var mm      = modMeta.GetValueOrDefault(baseN);
                return new
                {
                    id           = id + "::" + file,   // id carries the real filename for toggling
                    file,
                    name         = name.Replace('_', ' ').Replace('-', ' '),
                    version      = ver,
                    enabled,
                    optimization = isOptim,
                    sizeMb       = Math.Round(sizeMb, 1),
                    update       = false,
                    tags         = mm?.Tags ?? new List<string>(),
                    note         = mm?.Note ?? "",
                };
            })
            .OrderBy(m => m.name)
            .ToList<object>();
    }

    /// <summary>Enable/disable a mod by renaming its jar ↔ jar.disabled.</summary>
    private object SetModEnabled(string id, string file, bool enabled)
    {
        if (!IsSafeSegment(id) || !IsSafeSegment(file))
            return new { ok = false, error = "Invalid mod or instance name." };
        var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
        var current = Path.Combine(modsDir, file);
        if (!IsContained(modsDir, current))
            return new { ok = false, error = "Invalid mod path." };
        if (!File.Exists(current))
            return new { ok = false, error = "Mod file not found: " + file };

        var isDisabled = file.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase);
        string target;
        if (enabled && isDisabled)        target = Path.Combine(modsDir, file[..^".disabled".Length]);
        else if (!enabled && !isDisabled) target = Path.Combine(modsDir, file + ".disabled");
        else return new { ok = true, file };   // already in desired state

        try
        {
            File.Move(current, target, overwrite: false);
            Logger.Info($"SetModEnabled({id}): {file} -> {Path.GetFileName(target)}");
            return new { ok = true, file = Path.GetFileName(target), enabled };
        }
        catch (Exception e)
        {
            return new { ok = false, error = e.Message };
        }
    }

    // ── Per-mod metadata: user tags + notes ──────────────────────────────────
    // Stored alongside the instance (cryo-modmeta.json) keyed by the *base*
    // filename (".disabled" stripped) so tags & notes survive enable/disable,
    // which renames the jar. Lets users group/label mods (optimization, visuals,
    // …) and filter by their own tags — entirely manual, never auto-applied.
    public sealed class ModMetaEntry
    {
        public List<string> Tags { get; set; } = new();
        public string       Note { get; set; } = "";
    }

    private string ModMetaPath(string id)
        => Path.Combine(InstanceDataDir(id), "instances", id, "cryo-modmeta.json");

    /// <summary>Strip a trailing ".disabled" so a mod keeps its tags when toggled.</summary>
    private static string ModKey(string file)
        => file.EndsWith(".disabled", StringComparison.OrdinalIgnoreCase)
            ? file[..^".disabled".Length] : file;

    private Dictionary<string, ModMetaEntry> LoadModMeta(string id)
    {
        try
        {
            var p = ModMetaPath(id);
            if (!File.Exists(p)) return new(StringComparer.OrdinalIgnoreCase);
            var d = JsonSerializer.Deserialize<Dictionary<string, ModMetaEntry>>(File.ReadAllText(p), _jOpts);
            return d == null ? new(StringComparer.OrdinalIgnoreCase)
                             : new(d, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception e)
        {
            Logger.Warn($"LoadModMeta({id}): {e.Message}");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    private bool SaveModMeta(string id, Dictionary<string, ModMetaEntry> data)
    {
        try
        {
            // Drop empty entries so the file stays tidy.
            var clean = data
                .Where(kv => (kv.Value.Tags?.Count ?? 0) > 0 || !string.IsNullOrWhiteSpace(kv.Value.Note))
                .ToDictionary(kv => kv.Key, kv => kv.Value);
            File.WriteAllText(ModMetaPath(id), JsonSerializer.Serialize(clean, _jOpts));
            return true;
        }
        catch (Exception e)
        {
            Logger.Warn($"SaveModMeta({id}): {e.Message}");
            return false;
        }
    }

    /// <summary>Replace the full tag list for one mod. Tags are trimmed, de-duped
    /// (case-insensitive), length-capped, and limited in count to keep the UI sane.</summary>
    private object SetModTags(string id, string file, JsonNode? tagsNode)
    {
        if (!IsSafeSegment(id) || !IsSafeSegment(file))
            return new { ok = false, error = "Invalid mod or instance name." };
        var tags = new List<string>();
        if (tagsNode is JsonArray arr)
        {
            foreach (var t in arr)
            {
                var s = (t?.GetValue<string>() ?? "").Trim();
                if (s.Length == 0) continue;
                if (s.Length > 24) s = s[..24];
                if (!tags.Any(x => x.Equals(s, StringComparison.OrdinalIgnoreCase))) tags.Add(s);
                if (tags.Count >= 12) break;
            }
        }
        var key   = ModKey(file);
        var data  = LoadModMeta(id);
        var mm    = data.GetValueOrDefault(key) ?? new ModMetaEntry();
        mm.Tags   = tags;
        data[key] = mm;
        return new { ok = SaveModMeta(id, data), tags };
    }

    /// <summary>Set a free-text note for one mod (length-capped).</summary>
    private object SetModNote(string id, string file, string note)
    {
        if (!IsSafeSegment(id) || !IsSafeSegment(file))
            return new { ok = false, error = "Invalid mod or instance name." };
        note = (note ?? "").Trim();
        if (note.Length > 500) note = note[..500];
        var key   = ModKey(file);
        var data  = LoadModMeta(id);
        var mm    = data.GetValueOrDefault(key) ?? new ModMetaEntry();
        mm.Note   = note;
        data[key] = mm;
        return new { ok = SaveModMeta(id, data), note };
    }

    // ── Tag colours ──────────────────────────────────────────────────────────
    // Colour is chosen per tag *name* (so "optimization" looks the same on every
    // mod) and kept in its own small file, name → hex. Unset tags fall back to a
    // stable auto-hue in the UI.
    private string TagColorsPath(string id)
        => Path.Combine(InstanceDataDir(id), "instances", id, "cryo-tagcolors.json");

    private Dictionary<string, string> LoadTagColors(string id)
    {
        try
        {
            var p = TagColorsPath(id);
            if (!File.Exists(p)) return new(StringComparer.OrdinalIgnoreCase);
            var d = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(p), _jOpts);
            return d == null ? new(StringComparer.OrdinalIgnoreCase)
                             : new(d, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception e)
        {
            Logger.Warn($"LoadTagColors({id}): {e.Message}");
            return new(StringComparer.OrdinalIgnoreCase);
        }
    }

    private bool SaveTagColors(string id, Dictionary<string, string> data)
    {
        try { File.WriteAllText(TagColorsPath(id), JsonSerializer.Serialize(data, _jOpts)); return true; }
        catch (Exception e) { Logger.Warn($"SaveTagColors({id}): {e.Message}"); return false; }
    }

    private object GetTagColors(string id)
    {
        if (!IsSafeSegment(id)) return new Dictionary<string, string>();
        return LoadTagColors(id);
    }

    private static readonly Regex _hexColor = new(@"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", RegexOptions.Compiled);

    /// <summary>Set (or, with an empty colour, reset to auto) the colour of a tag.</summary>
    private object SetTagColor(string id, string tag, string color)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        tag = (tag ?? "").Trim();
        if (tag.Length == 0) return new { ok = false, error = "Empty tag." };
        if (tag.Length > 24) tag = tag[..24];
        color = (color ?? "").Trim();
        var data = LoadTagColors(id);
        if (color.Length == 0) data.Remove(tag);                 // reset → auto-hue
        else if (_hexColor.IsMatch(color)) data[tag] = color;     // store the hex
        else return new { ok = false, error = "Invalid colour." };
        return new { ok = SaveTagColors(id, data), tag, color };
    }

    /// <summary>Opens a native file picker for .jar files and copies them into the
    /// instance's mods/ folder. Returns the number added (or cancelled=true).</summary>
    private object AddLocalMods(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        string[]? files = null;
        void Show()
        {
            using var dlg = new System.Windows.Forms.OpenFileDialog
            {
                Title = "Add mod .jar files",
                Filter = "Minecraft mods (*.jar)|*.jar",
                Multiselect = true,
                CheckFileExists = true,
            };
            if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK) files = dlg.FileNames;
        }
        var disp = WpfApp.Current?.Dispatcher;
        if (disp != null && !disp.CheckAccess()) disp.Invoke(Show); else Show();
        if (files == null || files.Length == 0) return new { ok = true, added = 0, cancelled = true };

        var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
        Directory.CreateDirectory(modsDir);
        int added = 0; var names = new List<string>();
        foreach (var src in files)
        {
            try
            {
                if (!src.EndsWith(".jar", StringComparison.OrdinalIgnoreCase)) continue;
                File.Copy(src, Path.Combine(modsDir, Path.GetFileName(src)), overwrite: true);
                names.Add(Path.GetFileName(src)); added++;
            }
            catch (Exception e) { Logger.Warn($"AddLocalMods copy '{Path.GetFileName(src)}': {e.Message}"); }
        }
        Logger.Info($"AddLocalMods({id}): added {added}");
        return new { ok = true, added, names };
    }

    /// <summary>Writes a base64-encoded .jar (from a drag-and-drop) into mods/.</summary>
    private object AddLocalModData(string id, string filename, string base64)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        try
        {
            var leaf = Path.GetFileName(filename ?? "");
            if (!IsSafeSegment(leaf) || !leaf.EndsWith(".jar", StringComparison.OrdinalIgnoreCase))
                return new { ok = false, error = "Only .jar files are allowed." };
            var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
            Directory.CreateDirectory(modsDir);
            var dest = Path.Combine(modsDir, leaf);
            if (!IsContained(modsDir, dest)) return new { ok = false, error = "Invalid path." };
            File.WriteAllBytes(dest, Convert.FromBase64String(base64 ?? ""));
            Logger.Info($"AddLocalModData({id}): {leaf} ({new FileInfo(dest).Length / 1024} KB)");
            return new { ok = true, file = leaf };
        }
        catch (Exception e) { Logger.Warn($"AddLocalModData({id}): {e.Message}"); return new { ok = false, error = e.Message }; }
    }

    /// <summary>Open a URL or PrismLauncher (for New/Duplicate which Prism owns).</summary>
    private object OpenUrl(string url)
    {
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true });
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    private object OpenPrism()
    {
        var exe = _config.Data.PrismExe;
        if (string.IsNullOrEmpty(exe) || !File.Exists(exe))
            return new { ok = false, error = "PrismLauncher path not configured" };
        try { System.Diagnostics.Process.Start(exe); return new { ok = true }; }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    /// <summary>
    /// Toggle JFR boot profiling for the next launch by adding/removing a single
    /// (comma-free, Prism-safe) flag in the instance's JvmArgs.
    /// </summary>
    private object SetProfileNextLaunch(string id, bool on)
    {
        var cfgPath = Path.Combine(InstanceDataDir(id), "instances", id, "instance.cfg");
        if (!File.Exists(cfgPath)) return new { ok = false, error = "instance.cfg not found" };
        const string FLAG = "-XX:StartFlightRecording=filename=vspeed-boot.jfr";

        var lines = File.ReadAllLines(cfgPath).ToList();
        bool inGeneral = true; int jvmIdx = -1; string jvm = "";
        for (int i = 0; i < lines.Count; i++)
        {
            var l = lines[i].Trim();
            if (l.StartsWith("[")) { inGeneral = l.Equals("[General]", StringComparison.OrdinalIgnoreCase); continue; }
            if (inGeneral && l.StartsWith("JvmArgs=")) { jvmIdx = i; jvm = l[8..]; }
        }
        jvm = jvm.Replace(FLAG, "").Trim();
        if (on) jvm = (FLAG + " " + jvm).Trim();

        if (jvmIdx >= 0) lines[jvmIdx] = "JvmArgs=" + jvm;
        else
        {
            var ui = lines.FindIndex(l => l.Trim().Equals("[UI]", StringComparison.OrdinalIgnoreCase));
            var ins = "JvmArgs=" + jvm;
            if (ui >= 0) lines.Insert(ui, ins); else lines.Add(ins);
        }
        // ensure OverrideJavaArgs=true
        var ovrIdx = lines.FindIndex(l => l.Trim().StartsWith("OverrideJavaArgs="));
        if (ovrIdx >= 0) lines[ovrIdx] = "OverrideJavaArgs=true";

        File.WriteAllLines(cfgPath, lines);
        Logger.Info($"SetProfileNextLaunch({id}): {(on ? "ON" : "OFF")}");
        return new { ok = true, on };
    }

    // ── History ───────────────────────────────────────────────────────────────

    private object GetHistory()
        => _history.GetAll();

    // ── Logs ──────────────────────────────────────────────────────────────────

    private object GetLogs(string id, int n)
        => LogReader.Read(id, InstanceDataDir(id), n);

    // ── Boot timeline (waterfall derived from real log timestamps) ──────────────

    private object GetBootTimeline(string id)
    {
        var entries = LogReader.Read(id, InstanceDataDir(id), 30000);
        if (entries.Count == 0) return new { ok = false, error = "No log found for this instance yet." };

        long start = entries[0].T;

        // Ordered milestones; each is the FIRST line (at/after the previous one)
        // whose message contains any of the given needles (case-insensitive).
        var milestones = new (string name, string[] needles)[]
        {
            ("Bootstrap",       new[]{ "ModLauncher running", "ModLauncher", "Java is", "JVM" }),
            ("Mod discovery",   new[]{ "Found mod", "mods to load", "ModDiscoverer", "Scanning" }),
            ("Loading mods",    new[]{ "Constructing", "Loading ", "LOAD_REGISTRIES", "Processing mod" }),
            ("Mixins",          new[]{ "Mixin", "mixing" }),
            ("Registries",      new[]{ "Applying holder", "Registry", "registered" }),
            ("Resource reload", new[]{ "Reloading ResourceManager" }),
            ("Texture atlas",   new[]{ "Created: ", "atlas", "Stitching" }),
            ("Audio / render",  new[]{ "OpenAL", "Sound engine started", "Backend library", "Narrator" }),
        };

        var phases = new List<object>();
        long cursorTime = start;
        int cursorIdx = 0;
        string? prevName = null; long prevTime = start;

        foreach (var (name, needles) in milestones)
        {
            int found = -1;
            for (int i = cursorIdx; i < entries.Count; i++)
            {
                var msg = entries[i].Msg;
                if (needles.Any(n => msg.Contains(n, StringComparison.OrdinalIgnoreCase)))
                { found = i; break; }
            }
            if (found < 0) continue;

            var ts = entries[found].T;
            if (ts < prevTime) ts = prevTime;     // keep monotonic
            if (prevName != null)
                phases.Add(new { name = prevName, atMs = prevTime - start, durationMs = ts - prevTime });
            prevName = name; prevTime = ts;
            cursorIdx = found + 1;
            cursorTime = ts;
        }

        // Final phase up to the last log line (≈ main menu reached)
        long endTime = entries[^1].T;
        if (prevName != null && endTime > prevTime)
            phases.Add(new { name = prevName, atMs = prevTime - start, durationMs = endTime - prevTime });

        long totalMs = endTime - start;
        return new { ok = true, totalMs, phases, lineCount = entries.Count };
    }

    // ── Cache rebuild ─────────────────────────────────────────────────────────

    private object RebuildCache(string id)
    {
        var cacheDir = Path.Combine(InstanceDataDir(id), "instances", id,
                                    "minecraft", ".vspeed-cache", "json");
        if (Directory.Exists(cacheDir))
        {
            Directory.Delete(cacheDir, recursive: true);
            Logger.Info($"RebuildCache({id}): deleted {cacheDir}");
        }
        return new { ok = true };
    }

    // ── Launch / Stop / Hibernate / Wake ──────────────────────────────────────

    /// <summary>The instance-root (Prism-style data dir) the given instance lives under:
    /// resolved from its registry entry, then any configured root that actually contains
    /// it, then the primary root / legacy PrismDataDir. Its folder is
    /// <c>&lt;root&gt;/instances/&lt;id&gt;</c>.</summary>
    private string InstanceDataDir(string id)
    {
        var tagged = _config.Data.Instances.FirstOrDefault(e => e.Id == id)?.DataDir;
        if (!string.IsNullOrWhiteSpace(tagged)) return tagged!;
        var roots = _config.Data.InstanceRoots;
        if (roots != null)
        {
            foreach (var r in roots)
                if (!string.IsNullOrWhiteSpace(r) && Directory.Exists(Path.Combine(r, "instances", id)))
                    return r;
            if (roots.Count > 0 && !string.IsNullOrWhiteSpace(roots[0])) return roots[0];
        }
        return _prismDataDir;
    }

    private string PrimaryRoot()
    {
        foreach (var r in _config.Data.InstanceRoots)
            if (!string.IsNullOrWhiteSpace(r)) return r;
        return _prismDataDir ?? "";
    }

    // ── Security: bridge-input guards ────────────────────────────────────────────
    // The WebView renderer is trusted today, but treating its messages as untrusted
    // input is cheap defence-in-depth: even a single XSS must not be able to rename,
    // delete, open, or move files outside the locations the launcher manages.

    /// <summary>True when <paramref name="name"/> is a single safe path segment —
    /// no directory separators, no "..", no characters illegal in a file name.
    /// Real instance ids and mod file names always satisfy this.</summary>
    private static bool IsSafeSegment(string? name)
        => !string.IsNullOrWhiteSpace(name)
           && name!.IndexOfAny(Path.GetInvalidFileNameChars()) < 0
           && name != "." && name != ".."
           && !name.Contains("..", StringComparison.Ordinal);

    /// <summary>True when <paramref name="candidate"/> resolves to a path inside
    /// <paramref name="baseDir"/> (blocks path-traversal escapes).</summary>
    private static bool IsContained(string baseDir, string candidate)
    {
        try
        {
            var root = Path.GetFullPath(baseDir).TrimEnd('\\', '/') + Path.DirectorySeparatorChar;
            return Path.GetFullPath(candidate).StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    /// <summary>True when <paramref name="path"/> equals or sits under a launcher-managed
    /// base (a configured instance root or Cryo's own app-data dir). Gates <see cref="OpenPath"/>
    /// so a compromised renderer can't open arbitrary folders (or UNC shares) via Explorer.</summary>
    private bool IsAllowedOpenBase(string path)
    {
        string full;
        try { full = Path.GetFullPath(path).TrimEnd('\\', '/'); } catch { return false; }

        var bases = new List<string>(_config.Data.InstanceRoots.Where(r => !string.IsNullOrWhiteSpace(r))!);
        if (!string.IsNullOrWhiteSpace(_prismDataDir)) bases.Add(_prismDataDir);
        bases.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher"));

        foreach (var b in bases)
        {
            string bf;
            try { bf = Path.GetFullPath(b).TrimEnd('\\', '/'); } catch { continue; }
            if (full.Equals(bf, StringComparison.OrdinalIgnoreCase)) return true;                                   // the root itself
            if (full.StartsWith(bf + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return true; // inside it
        }
        return false;
    }

    /// <summary>Validates a requested target root against the configured locations;
    /// falls back to the primary root when empty/unknown.</summary>
    private string ResolveTargetRoot(string requested)
    {
        var req = (requested ?? "").Trim();
        if (req.Length > 0 && _config.Data.InstanceRoots.Any(r => string.Equals((r ?? "").Trim(), req, StringComparison.OrdinalIgnoreCase)))
            return req;
        return PrimaryRoot();
    }

    // ── Instance locations (roots) ───────────────────────────────────────────────
    private object GetInstanceRoots()
    {
        var primary = PrimaryRoot();
        var roots = _config.Data.InstanceRoots
            .Where(r => !string.IsNullOrWhiteSpace(r))
            .Select(r => new
            {
                path    = r,
                primary = string.Equals(r, primary, StringComparison.OrdinalIgnoreCase),
                exists  = Directory.Exists(Path.Combine(r, "instances")),
                count   = _config.Data.Instances.Count(e => string.Equals(e.DataDir, r, StringComparison.OrdinalIgnoreCase)),
            })
            .ToList();
        return new { ok = true, roots };
    }

    private object AddInstanceRoot(string path)
    {
        var p = (path ?? "").Trim().TrimEnd('\\', '/');
        if (p.Length == 0)          return new { ok = false, error = "No folder selected." };
        if (!Directory.Exists(p))   return new { ok = false, error = "Folder does not exist." };
        if (_config.Data.InstanceRoots.Any(r => string.Equals((r ?? "").TrimEnd('\\', '/'), p, StringComparison.OrdinalIgnoreCase)))
            return new { ok = false, error = "That location is already added." };

        _config.Data.InstanceRoots.Add(p);

        int added = 0;
        var instances = Path.Combine(p, "instances");
        if (Directory.Exists(instances))
            foreach (var dir in Directory.EnumerateDirectories(instances))
            {
                var cfg = Path.Combine(dir, "instance.cfg");
                if (!File.Exists(cfg)) continue;
                var id = Path.GetFileName(dir);
                if (_config.Data.Instances.Any(e => e.Id == id)) continue;
                var nm = id;
                try { foreach (var line in File.ReadAllLines(cfg)) if (line.StartsWith("name=", StringComparison.Ordinal)) { nm = line[5..]; break; } } catch { }
                var entry = new InstanceEntry { Id = id, DisplayName = nm, DataDir = p };
                _config.Data.Instances.Add(entry);
                _manager.AddEntry(entry);
                added++;
            }
        _config.Save();
        return new { ok = true, added };
    }

    private object RemoveInstanceRoot(string path)
    {
        var p = (path ?? "").Trim().TrimEnd('\\', '/');
        _config.Data.InstanceRoots.RemoveAll(r => string.Equals((r ?? "").TrimEnd('\\', '/'), p, StringComparison.OrdinalIgnoreCase));
        var gone = _config.Data.Instances
            .Where(e => string.Equals((e.DataDir ?? "").TrimEnd('\\', '/'), p, StringComparison.OrdinalIgnoreCase))
            .Select(e => e.Id).ToList();
        _config.Data.Instances.RemoveAll(e => gone.Contains(e.Id));
        var disp = WpfApp.Current?.Dispatcher;
        foreach (var id in gone)
        {
            var running = _manager.Instances.FirstOrDefault(i => i.Entry.Id == id);
            if (running == null) continue;
            if (disp != null && !disp.CheckAccess()) disp.Invoke(() => _manager.Instances.Remove(running));
            else _manager.Instances.Remove(running);
        }
        _config.Save();
        return new { ok = true, removed = gone.Count };
    }

    /// <summary>Opens a native folder picker (on the UI thread) and returns the chosen path.</summary>
    private object PickFolder()
    {
        string? picked = null;
        void Show()
        {
            using var dlg = new System.Windows.Forms.FolderBrowserDialog
            {
                Description = "Select an instances location (a folder that contains an 'instances' subfolder)",
                UseDescriptionForTitle = true,
            };
            if (dlg.ShowDialog() == System.Windows.Forms.DialogResult.OK) picked = dlg.SelectedPath;
        }
        var disp = WpfApp.Current?.Dispatcher;
        if (disp != null && !disp.CheckAccess()) disp.Invoke(Show); else Show();
        return picked == null ? (object)new { ok = false, cancelled = true } : new { ok = true, path = picked };
    }

    private object SetPrimaryRoot(string path)
    {
        var p = (path ?? "").Trim().TrimEnd('\\', '/');
        var idx = _config.Data.InstanceRoots.FindIndex(r => string.Equals((r ?? "").TrimEnd('\\', '/'), p, StringComparison.OrdinalIgnoreCase));
        if (idx < 0) return new { ok = false, error = "Unknown location." };
        if (idx > 0)
        {
            var r = _config.Data.InstanceRoots[idx];
            _config.Data.InstanceRoots.RemoveAt(idx);
            _config.Data.InstanceRoots.Insert(0, r);
            _config.Save();
        }
        return new { ok = true };
    }

    private object OpenPath(string path)
    {
        try
        {
            var p = (path ?? "").Trim();
            if (p.Length == 0) return new { ok = false, error = "No path." };
            // Reject UNC paths (\\host\share, //host) — opening one can leak the user's
            // NTLM credentials to a remote SMB host chosen by an attacker.
            if (p.StartsWith(@"\\") || p.StartsWith("//")) return new { ok = false, error = "Network paths are not allowed." };
            if (!Directory.Exists(p)) return new { ok = false, error = "Folder not found." };
            if (!IsAllowedOpenBase(p)) return new { ok = false, error = "That folder is outside Cryo's managed locations." };
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = p, UseShellExecute = true });
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    /// <summary>Moves an instance's folder to another location. Same-volume is a fast
    /// rename; cross-volume falls back to copy+delete. Push: moveProgress / moveDone.</summary>
    private object MoveInstance(string id, string targetRoot)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        var target = ResolveTargetRoot(targetRoot);
        _ = Task.Run(() =>
        {
            try
            {
                var src = Path.Combine(InstanceDataDir(id), "instances", id);
                var dst = Path.Combine(target, "instances", id);
                if (string.Equals(Path.GetFullPath(src).TrimEnd('\\'), Path.GetFullPath(dst).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                    { Push("moveDone", new { ok = false, error = "Instance is already in that location." }); return; }
                if (!Directory.Exists(src)) { Push("moveDone", new { ok = false, error = "Instance folder not found." }); return; }
                if (Directory.Exists(dst)) { Push("moveDone", new { ok = false, error = "A folder with that id already exists there." }); return; }
                var running = _manager.Instances.FirstOrDefault(i => i.Entry.Id == id);
                if (running != null && running.State != InstanceState.Stopped)
                    { Push("moveDone", new { ok = false, error = "Stop the instance before moving it." }); return; }

                Directory.CreateDirectory(Path.Combine(target, "instances"));
                Push("moveProgress", new { id, message = "Moving files…" });
                try { Directory.Move(src, dst); }
                catch (IOException) { CopyDirectory(src, dst); Directory.Delete(src, recursive: true); }   // cross-volume

                var entry = _config.Data.Instances.FirstOrDefault(e => e.Id == id);
                if (entry != null) entry.DataDir = target;
                _config.Save();
                Logger.Info($"MoveInstance: '{id}' -> {target}");
                Push("moveDone", new { ok = true, id });
            }
            catch (Exception e) { Logger.Warn($"MoveInstance({id}): {e.Message}"); Push("moveDone", new { ok = false, error = e.Message }); }
        });
        return new { ok = true };
    }

    private object LaunchInstance(string id, bool vanilla, string joinServer = "")
    {
        var inst = _manager.FindById(id)
            ?? throw new InvalidOperationException($"Instance not found: {id}");

        if (_config.Data.AutoBackupBeforeLaunch) AutoBackupWorlds(id);

        // Cryo-native instances skip Prism and go straight to CmlLib.
        if (inst.Entry.Source == "cryo" && MicrosoftAccount.Instance.LoggedIn
            && GetStoredEngineVersion(id) != null)
        {
            Logger.Info($"LaunchInstance({id}): routing to Cryo engine (source=cryo)"
                        + (string.IsNullOrWhiteSpace(joinServer) ? "" : $", joining {joinServer}"));
            return LaunchWithEngine(id, joinServer);
        }

        if (_config.Data.AutoHideOnLaunch)
            WpfApp.Current?.Dispatcher.Invoke(() => WpfApp.Current?.MainWindow?.Hide());

        _ = _manager.LaunchAsync(inst, vanilla);
        return new { ok = true, vanilla };
    }

    // ── Automated benchmark (boot-to-menu A/B: Vanilla vs Optimized) ───────────
    private CancellationTokenSource? _benchCts;
    private volatile bool _benchRunning;

    private object StartBenchmark(string id)
    {
        if (_benchRunning) return new { ok = false, error = "Benchmark already running" };
        var inst = _manager.FindById(id)
            ?? throw new InvalidOperationException($"Instance not found: {id}");

        _benchCts = new CancellationTokenSource();
        _benchRunning = true;
        _ = Task.Run(() => RunBenchmarkAsync(inst, _benchCts.Token));
        return new { ok = true };
    }

    private object CancelBenchmark()
    {
        _benchCts?.Cancel();
        return new { ok = true };
    }

    // ── VSpeed Turbo (JDK 25 AOT cache) — status / toggle / reset ──────────────

    private object GetTurbo(string id)
    {
        var meta      = InstanceMetaReader.Read(id, InstanceDataDir(id));
        int javaMajor = JavaMajorForMc(meta.Mc);
        var st        = TurboRuntime.LoadState(id);
        var javaw     = TurboRuntime.FindJavaw();
        var version   = GetStoredEngineVersion(id);
        var gameDir   = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft");

        long cacheSize = 0; bool trained = false;
        try
        {
            var fi = new FileInfo(TurboRuntime.CacheFile(id));
            if (fi.Exists)
            {
                cacheSize = fi.Length;
                // "trained" = the cache matches the CURRENT mods — a mod change silently retrains.
                trained = st.Fingerprint.Length > 0
                       && st.Fingerprint == TurboRuntime.ComputeFingerprint(gameDir, version ?? "");
            }
        }
        catch { /* status only */ }

        return new
        {
            ok = true,
            supported       = javaMajor >= 21,
            engineInstalled = version != null,
            javaReady       = javaw != null,
            javaVersion     = javaw != null ? TurboRuntime.InstalledVersion() : "",
            enabled         = st.Enabled,
            trained,
            cacheSizeMb     = cacheSize / (1024 * 1024),
            trainedAt       = st.TrainedAt,
            lastError       = st.LastError,
            boots           = st.Boots.OrderByDescending(b => b.T).Take(8)
                                .Select(b => new { t = b.T, secs = b.Secs, mode = b.Mode }).ToArray(),
        };
    }

    /// <summary>Enables/disables Turbo; enabling also kicks off the Temurin 25
    /// download when it's not installed yet (Push: turboProgress/turboDone/turboError).</summary>
    private object SetTurbo(string id, bool on)
    {
        var st = TurboRuntime.LoadState(id);
        st.Enabled = on;
        if (on) st.LastError = "";
        TurboRuntime.SaveState(id, st);
        Logger.Info($"Turbo {(on ? "enabled" : "disabled")} for {id}");

        if (on && TurboRuntime.FindJavaw() == null)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await TurboRuntime.ProvisionAsync((msg, done, total) =>
                        Push("turboProgress", new { id, message = msg, bytesDone = done, bytesTotal = total }));
                    Push("turboDone", new { id, javaVersion = TurboRuntime.InstalledVersion() });
                }
                catch (Exception e)
                {
                    Logger.Warn($"Turbo runtime install failed: {e.Message}");
                    Push("turboError", new { id, error = e.Message });
                }
            });
            return new { ok = true, enabled = on, installing = true };
        }
        return new { ok = true, enabled = on, installing = false };
    }

    /// <summary>Opens the pop-out live console window for an instance (UI.ConsoleWindow).</summary>
    private object OpenConsole(string id)
    {
        var meta   = InstanceMetaReader.Read(id, InstanceDataDir(id));
        var logDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "logs");
        WpfApp.Current?.Dispatcher.Invoke(() =>
            UI.ConsoleWindow.Open(id, string.IsNullOrWhiteSpace(meta.Name) ? id : meta.Name, logDir));
        return new { ok = true };
    }

    private object ResetTurbo(string id)
    {
        try { File.Delete(TurboRuntime.CacheFile(id)); } catch { /* absent is fine */ }
        try { File.Delete(TurboRuntime.CacheConfigFile(id)); } catch { /* absent is fine */ }
        var st = TurboRuntime.LoadState(id);
        st.Fingerprint = ""; st.TrainedAt = 0; st.LastError = "";
        TurboRuntime.SaveState(id, st);
        Logger.Info($"Turbo cache reset for {id}");
        return new { ok = true };
    }

    /// <summary>
    /// Launches the game unattended via the Cryo engine and measures boot-to-menu
    /// with log markers (ModernFix / Realms / quiet-log — no pipe mod needed):
    /// (1) Default launch (bundled Java + AppCDS, exactly what the Launch button
    /// does with Turbo off), (2) Turbo training IF the AOT cache isn't built yet
    /// (time discarded; the game is closed GRACEFULLY so the cache can assemble
    /// at shutdown), (3) Turbo measured run from the cache.
    /// Requires: Cryo engine installed, signed in, Turbo enabled + runtime ready.
    /// </summary>
    private async Task RunBenchmarkAsync(RunningInstance inst, CancellationToken ct)
    {
        var id = inst.Entry.Id;
        long defBoot = -1, turboBoot = -1;
        try
        {
            // Pre-flight — fail with a message that tells the user the exact fix.
            var versionName = GetStoredEngineVersion(id)
                ?? throw new Exception("Install the Cryo engine for this instance first (Performance → Cryo engine card).");
            if (!MicrosoftAccount.Instance.LoggedIn)
                throw new Exception("Sign in first — the benchmark launches the real game.");
            var meta = InstanceMetaReader.Read(id, InstanceDataDir(id));
            if (JavaMajorForMc(meta.Mc) < 21)
                throw new Exception("VSpeed Turbo needs Minecraft 1.20.5+ (Java 21-era packs).");
            if (!TurboRuntime.LoadState(id).Enabled)
                throw new Exception("Enable VSpeed Turbo first (the Turbo card above), then run the benchmark.");
            if (TurboRuntime.FindJavaw() == null)
                throw new Exception("The Java 25 Turbo runtime isn't installed yet — wait for the download in the Turbo card to finish.");

            // Make sure nothing is already running for this instance.
            if (inst.State != InstanceState.Stopped) { _manager.Kill(inst); await Task.Delay(3000, ct); }

            var  gameDir      = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft");
            var  fp           = TurboRuntime.ComputeFingerprint(gameDir, versionName);
            bool needTraining = !(File.Exists(TurboRuntime.CacheFile(id)) && TurboRuntime.LoadState(id).Fingerprint == fp);
            int  total        = needTraining ? 3 : 2;

            Push("benchmarkProgress", new {
                phase = "start", step = 0, totalSteps = total,
                message = $"Benchmark started — the game launches {total}× (~{total * 3}–{total * 4} min). Leave the PC alone until done.",
            });

            // 1) Default: the standard engine path (bundled Java 21 + AppCDS), Turbo ignored.
            int step = 1;
            defBoot = await BenchRunAsync(inst, "default", "Default launch (bundled Java + AppCDS)", step, total, graceful: false, ct);
            Push("benchmarkProgress", new {
                phase = "vanilla", step, totalSteps = total, bootVanilla = defBoot,
                message = defBoot > 0 ? $"Default boot-to-menu: {defBoot}s"
                                      : "Default run: couldn't detect the main menu (timed out)",
            });

            // 2) Turbo training (only when the cache is missing/stale; time discarded).
            if (needTraining)
            {
                step++;
                var errBefore = TurboRuntime.LoadState(id).LastError ?? "";
                await BenchRunAsync(inst, "auto", "Turbo training (recording the AOT cache)", step, total, graceful: true, ct);
                // The engine's exit watcher persists the trained state once the
                // assembly JVM (forked after the game closes) finishes — which on a
                // big pack takes MINUTES. Wait on that outcome, not a fixed timeout.
                Push("benchmarkProgress", new {
                    phase = "assembling", step, totalSteps = total, bootVanilla = defBoot,
                    message = "Game closed — assembling the AOT cache in the background (several minutes on a big pack)…",
                });
                var deadline = DateTime.UtcNow.AddMinutes(22);
                while (DateTime.UtcNow < deadline && TurboRuntime.LoadState(id).Fingerprint != fp)
                {
                    var errNow = TurboRuntime.LoadState(id).LastError ?? "";
                    if (errNow.Length > 0 && errNow != errBefore)
                        throw new Exception(errNow);   // the exit watcher declared the assembly failed
                    await Task.Delay(3000, ct);
                }
                if (TurboRuntime.LoadState(id).Fingerprint != fp)
                    throw new Exception("The AOT cache assembly didn't finish in time — check logs/cryo-engine.log, then run the benchmark again.");
                Push("benchmarkProgress", new {
                    phase = "warmup", step, totalSteps = total, bootVanilla = defBoot,
                    message = "AOT cache built — measuring the Turbo boot…",
                });
            }

            // 3) Turbo measured: launches from the AOT cache.
            step++;
            turboBoot = await BenchRunAsync(inst, "auto", "Turbo (measured, from the AOT cache)", step, total, graceful: false, ct);

            double delta = (defBoot > 0 && turboBoot > 0) ? defBoot - turboBoot : 0;
            double pct   = (defBoot > 0)                  ? delta / defBoot * 100.0 : 0;
            Push("benchmarkProgress", new {
                phase = "done", step, totalSteps = total, done = true,
                bootVanilla = defBoot, bootOptimized = turboBoot,
                deltaSeconds = Math.Round(delta, 1), deltaPercent = Math.Round(pct, 1),
                message = "Benchmark complete.",
            });
        }
        catch (OperationCanceledException)
        {
            Push("benchmarkProgress", new { phase = "cancelled", cancelled = true, message = "Benchmark cancelled." });
        }
        catch (Exception e)
        {
            Logger.Warn($"Benchmark failed: {e.Message}");
            Push("benchmarkProgress", new { phase = "error", error = true, message = $"Benchmark failed: {e.Message}" });
        }
        finally
        {
            try { if (inst.State != InstanceState.Stopped) _manager.Kill(inst); } catch { /* ignore */ }
            _benchRunning = false;
        }
    }

    /// <summary>One benchmark launch: engine-launch in <paramref name="mode"/>
    /// ("default" | "auto"), wait for boot-to-menu (log markers), then stop the
    /// game — gracefully (WM_CLOSE, so an AOT training run can assemble its cache
    /// at shutdown) or by kill for the measured runs.</summary>
    private async Task<long> BenchRunAsync(RunningInstance inst, string mode, string label, int step, int totalSteps, bool graceful, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        Push("benchmarkProgress", new {
            phase = "launching", step, totalSteps,
            mode = mode == "default" ? "vanilla" : "optimized",
            message = $"Launching: {label}…",
        });

        var bootTcs = new TaskCompletionSource<long>(TaskCreationOptions.RunContinuationsAsynchronously);
        var proc = await EngineLaunchAsync(inst.Entry.Id, "", mode, bootTcs)
            ?? throw new Exception($"Launch failed on step {step} — see the launcher log.");

        var winner = await Task.WhenAny(bootTcs.Task, Task.Delay(TimeSpan.FromMinutes(12), ct));
        ct.ThrowIfCancellationRequested();
        long secs = winner == bootTcs.Task ? bootTcs.Task.Result : -1;

        await Task.Delay(2000, ct);                 // let the main menu settle
        if (graceful)
        {
            // WM_CLOSE → clean JVM shutdown. In one-command AOT mode the JVM then
            // writes the ~700 MB training record AND runs the cache assembly (a
            // forked child it waits on) BEFORE exiting — several minutes on a big
            // pack. Killing on a short timeout destroys the cache (verified live
            // on ATM10: the 90 s kill took out the assembler), so wait generously.
            try { proc.CloseMainWindow(); } catch { /* fall through to kill below */ }
            Push("benchmarkProgress", new {
                phase = "assembling", step, totalSteps,
                message = "Game closed — recording + assembling the AOT cache (several minutes on a big pack)…",
            });
            var exit = proc.WaitForExitAsync(ct);
            if (await Task.WhenAny(exit, Task.Delay(TimeSpan.FromMinutes(20), ct)) != exit)
                try { _manager.Kill(inst); } catch { /* ignore */ }
        }
        else
        {
            try { _manager.Kill(inst); } catch { /* ignore */ }
        }
        await Task.Delay(4000, ct);                 // let the process tree die before the next launch
        return secs;
    }

    // ── AI assistant (NVIDIA hosted / local NIM, OpenAI-compatible) ────────────
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(120) };

    private const string AiSystemPrompt =
@"You are Cryo Assistant, a senior Minecraft modpack engineer built into the Cryo launcher. You know NeoForge, Forge, Fabric and Quilt deeply. Be concise, concrete and evidence-based — short paragraphs and bullets.

# How modded Minecraft REALLY behaves (read this before judging anything)
- A normal, healthy modded pack prints HUNDREDS of scary-looking but HARMLESS lines on every boot: mixin ""could not find""/""already applied"" notices, ""Mod X is missing a pack.mcmeta"", missing-OPTIONAL-dependency notices, datapack/recipe/tag warnings, deprecation warnings, registry remap/""Unknown registry"" messages, ""failed to load … falling back"", and full Java stack traces the game catches and continues past. This is NOISE, not failure.
- If the pack REACHED THE MAIN MENU or is currently RUNNING, it is WORKING. Warnings — and even caught exceptions — in a running pack are almost never worth acting on.
- Conclude the pack is broken ONLY with hard evidence of a real failure: an actual crash report (crash-reports/*.txt), `Exception in thread ""main""`, a JVM fatal error (hs_err / ""A fatal error has been detected""), a mixin that FAILED to apply (""mixin apply failed"" / ""…FAILED injection""), ""Failed to start the minecraft server"", or the launcher telling you the process exited abnormally during startup. The CONTEXT below states the current state (running / stopped / crashed) and gives a VERDICT — trust it.

# Hard rules (this is exactly what users hate when you get it wrong)
- NEVER tell the user to disable or remove a mod just because you see a WARN or a stack trace. Recommend disabling a mod ONLY when a crash report clearly names it (the failing mixin's owning mod, the deepest in-mod stack frame, or the crash-report ""Mod File""/""Failure message""/""Failure ID"" fields).
- If the VERDICT says the game is running/working, SAY SO plainly, do NOT propose mod changes, and just answer the user's actual question.
- Diagnose a crash from the CAUSE, not the first scary line: read the ""Description"", the last ""Caused by"", the deepest in-mod frame, and the crash-report header fields. Quote the exact line(s) you based your conclusion on.
- Never invent mod names, file names, versions, links or facts. Use only what's in the context. If evidence is insufficient, say what's missing (e.g. ""attach the crash report"") and ask for it — don't guess.
- The launcher's own ""Dependency check"" and ""Conflict scan"" are heuristics and are OFTEN WRONG: most dependencies are bundled INSIDE other jars (JarJar / nested jars), so a ""missing"" dependency is usually actually present; duplicate mod-ids are usually harmless library/API splits. Treat their output as a hint to verify in the logs, never as proof.
- You cannot edit the launcher's source. If you suspect a launcher bug, say so and describe it.

# One-click actions the launcher can run
Propose an action on its OWN line: @@ACTION {compact json}, with a one-line plain explanation BEFORE it. Only propose actions you can justify.
- webSearch {query}    — open a web search. USE THIS for any unfamiliar error: build a precise query with the exact error text + loader + MC version. When you're not certain of the cause, prefer this over guessing a fix.
- findMod {query}      — search Modrinth inside the launcher (to install a genuinely missing mod/dependency)
- openUrl {url}        — open a specific trusted page (CurseForge/Modrinth/the wiki/GitHub). Only well-known modding domains.
- openCrashReport {}   — open the latest crash report
- openModsFolder {}    — open the mods folder
- rebuildCache {}      — rebuild the VSpeed data cache
- setRam {gb}          — set max RAM (integer GB) — ONLY with OutOfMemory / ""Out of memory"" / GC-overhead evidence
- disableMod {file}    — disable a mod (EXACT file name from the mod list) — ONLY when a crash clearly blames it
- enableMod {file}     — re-enable a disabled mod

Example for an unknown error:
@@ACTION {""type"":""webSearch"",""label"":""Search this error"",""args"":{""query"":""NeoForge 1.21.1 java.lang.NoSuchMethodError ExampleMod""}}";

    /// <summary>
    /// Calls the configured OpenAI-compatible chat endpoint (NVIDIA hosted by default).
    /// args: { messages:[{role,content}], instanceId?, attach?:["logs","mods","crash"] }
    /// </summary>
    private async Task<object?> AiChatAsync(JsonNode args)
    {
        var key     = (_config.Data.AiApiKey  ?? "").Trim();
        var baseUrl = (_config.Data.AiBaseUrl ?? "").Trim().TrimEnd('/');
        var model   = string.IsNullOrWhiteSpace(_config.Data.AiModel) ? "meta/llama-3.3-70b-instruct" : _config.Data.AiModel.Trim();
        bool isLocal = baseUrl.Contains("localhost") || baseUrl.Contains("127.0.0.1") || baseUrl.Contains("0.0.0.0");

        if (string.IsNullOrWhiteSpace(baseUrl)) return new { ok = false, error = "No API base URL configured (Settings → Assistant)." };
        if (string.IsNullOrWhiteSpace(key) && !isLocal)
            return new { ok = false, error = "No NVIDIA API key set. Paste your key in Settings → Assistant." };

        var msgs = new JsonArray();
        if (model.Contains("nemotron", StringComparison.OrdinalIgnoreCase))
            msgs.Add(new JsonObject { ["role"] = "system", ["content"] = "detailed thinking off" });
        msgs.Add(new JsonObject { ["role"] = "system", ["content"] = AiSystemPrompt });
        var ctx = BuildAiContext(args);
        if (!string.IsNullOrEmpty(ctx)) msgs.Add(new JsonObject { ["role"] = "system", ["content"] = ctx });
        if (args["messages"] is JsonArray hist)
            foreach (var m in hist)
            {
                var role    = m?["role"]?.GetValue<string>() ?? "user";
                var content = m?["content"]?.GetValue<string>() ?? "";
                if (content.Length == 0) continue;
                msgs.Add(new JsonObject { ["role"] = role, ["content"] = content });
            }

        var body = new JsonObject
        {
            ["model"]       = model,
            ["messages"]    = msgs,
            ["max_tokens"]  = 2048,
            ["temperature"] = 0.2,   // NVIDIA-recommended for phi-4-mini; low = reliable diagnostics
            ["top_p"]       = 0.7,
            ["stream"]      = false,
        };

        // Build the chat-completions URL tolerantly: the configured base may be the
        // host ("…nvidia.com"), include "/v1", or already be the full endpoint.
        string chatUrl =
            baseUrl.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase) ? baseUrl :
            baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)               ? baseUrl + "/chat/completions" :
                                                                                        baseUrl + "/v1/chat/completions";

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, chatUrl);
            if (!string.IsNullOrWhiteSpace(key)) req.Headers.Add("Authorization", "Bearer " + key);
            req.Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req);
            var text = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                string detail = text;
                try
                {
                    var n = JsonNode.Parse(text);
                    detail = n?["detail"]?.ToString()
                          ?? n?["error"]?["message"]?.ToString()
                          ?? n?["message"]?.ToString() ?? text;
                }
                catch { /* keep raw */ }
                Logger.Warn($"AI chat HTTP {(int)resp.StatusCode}");
                return new { ok = false, error = $"AI error {(int)resp.StatusCode}: {Trunc(detail, 400)}" };
            }

            var node    = JsonNode.Parse(text);
            var msg     = node?["choices"]?[0]?["message"];
            var reply   = msg?["content"]?.GetValue<string>() ?? "";
            if (string.IsNullOrWhiteSpace(reply))   // reasoning models may answer only here
                reply = msg?["reasoning_content"]?.GetValue<string>() ?? "";
            return new { ok = true, content = reply };
        }
        catch (TaskCanceledException)
        {
            return new { ok = false, error = "Request timed out. Check your internet (hosted) or the local NIM at " + baseUrl + "." };
        }
        catch (HttpRequestException e)
        {
            return new { ok = false, error = "Network error: " + e.Message };
        }
        catch (Exception e)
        {
            Logger.Warn($"AI chat failed: {e.Message}");
            return new { ok = false, error = e.Message };
        }
    }

    /// <summary>Kicks off a streaming chat completion; chunks arrive as push events
    /// (aiChunk / aiDone / aiError) keyed by streamId. Returns immediately.</summary>
    private object StartAiStream(JsonNode args)
    {
        var key      = (_config.Data.AiApiKey  ?? "").Trim();
        var baseUrl  = (_config.Data.AiBaseUrl ?? "").Trim().TrimEnd('/');
        var streamId = args["streamId"]?.GetValue<string>() ?? "";
        bool isLocal = baseUrl.Contains("localhost") || baseUrl.Contains("127.0.0.1") || baseUrl.Contains("0.0.0.0");

        if (string.IsNullOrWhiteSpace(baseUrl)) return new { ok = false, error = "No API base URL configured (Settings → Assistant)." };
        if (string.IsNullOrWhiteSpace(key) && !isLocal)
            return new { ok = false, error = "No NVIDIA API key set. Paste your key in Settings → Assistant." };

        _ = Task.Run(() => StreamAsync(args, key, baseUrl, streamId));
        return new { ok = true, streamId };
    }

    private async Task StreamAsync(JsonNode args, string key, string baseUrl, string streamId)
    {
        try
        {
            var model = string.IsNullOrWhiteSpace(_config.Data.AiModel) ? "meta/llama-3.3-70b-instruct" : _config.Data.AiModel.Trim();
            var msgs  = new JsonArray();
            // Nemotron reasoning models default to verbose chain-of-thought (streamed in a
            // SEPARATE reasoning channel) and can spend the whole token budget thinking,
            // leaving the visible reply empty. This directive makes them answer directly.
            if (model.Contains("nemotron", StringComparison.OrdinalIgnoreCase))
                msgs.Add(new JsonObject { ["role"] = "system", ["content"] = "detailed thinking off" });
            msgs.Add(new JsonObject { ["role"] = "system", ["content"] = AiSystemPrompt });
            var ctx   = BuildAiContext(args);
            if (!string.IsNullOrEmpty(ctx)) msgs.Add(new JsonObject { ["role"] = "system", ["content"] = ctx });
            if (args["messages"] is JsonArray hist)
                foreach (var m in hist)
                {
                    var role = m?["role"]?.GetValue<string>() ?? "user";
                    var content = m?["content"]?.GetValue<string>() ?? "";
                    if (content.Length == 0) continue;
                    msgs.Add(new JsonObject { ["role"] = role, ["content"] = content });
                }

            var body = new JsonObject
            {
                ["model"] = model, ["messages"] = msgs, ["max_tokens"] = 2048,
                ["temperature"] = 0.2, ["top_p"] = 0.7, ["stream"] = true,
            };
            string chatUrl =
                baseUrl.EndsWith("/chat/completions", StringComparison.OrdinalIgnoreCase) ? baseUrl :
                baseUrl.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)               ? baseUrl + "/chat/completions" :
                                                                                            baseUrl + "/v1/chat/completions";

            using var req = new HttpRequestMessage(HttpMethod.Post, chatUrl);
            if (!string.IsNullOrWhiteSpace(key)) req.Headers.Add("Authorization", "Bearer " + key);
            req.Content = new StringContent(body.ToJsonString(), System.Text.Encoding.UTF8, "application/json");

            using var resp = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            if (!resp.IsSuccessStatusCode)
            {
                var txt = await resp.Content.ReadAsStringAsync();
                string detail = txt;
                try { var n = JsonNode.Parse(txt); detail = n?["detail"]?.ToString() ?? n?["error"]?["message"]?.ToString() ?? n?["message"]?.ToString() ?? txt; } catch { }
                Push("aiError", new { streamId, error = $"AI error {(int)resp.StatusCode}: {Trunc(detail, 400)}" });
                return;
            }

            using var stream = await resp.Content.ReadAsStreamAsync();
            using var reader = new StreamReader(stream);
            string? line;
            while ((line = await reader.ReadLineAsync()) != null)
            {
                if (line.Length == 0 || !line.StartsWith("data:")) continue;
                var data = line[5..].Trim();
                if (data == "[DONE]") break;
                try
                {
                    var d     = JsonNode.Parse(data)?["choices"]?[0]?["delta"];
                    var delta = d?["content"]?.GetValue<string>();
                    if (!string.IsNullOrEmpty(delta)) Push("aiChunk", new { streamId, delta });
                    else
                    {
                        // Reasoning models stream chain-of-thought here. Push it LIVE (flagged)
                        // so the UI can show the model is actively thinking — not frozen. The UI
                        // promotes it to the answer if no real content ever arrives.
                        var rc = d?["reasoning_content"]?.GetValue<string>();
                        if (!string.IsNullOrEmpty(rc)) Push("aiChunk", new { streamId, delta = rc, reasoning = true });
                    }
                }
                catch { /* keepalive / non-JSON line */ }
            }
            Push("aiDone", new { streamId });
        }
        catch (Exception e)
        {
            Logger.Warn($"AI stream failed: {e.Message}");
            Push("aiError", new { streamId, error = e.Message });
        }
    }

    /// <summary>Builds a compact context block (mods / logs tail / crash / launcher log) for the model.</summary>
    // ── Profiles (reusable launch presets) ───────────────────────────────────────

    private object GetProfiles()
    {
        // Seed built-in presets on first access.
        if (_config.Data.Profiles.Count == 0)
        {
            _config.Data.Profiles.AddRange(ProfileData.Defaults());
            _config.Save();
        }
        return new
        {
            profiles = _config.Data.Profiles.Select(p => new
            {
                id = p.Id, name = p.Name, icon = p.Icon, ramMax = p.RamMax,
                jvmArgs = p.JvmArgs, vspeedEnabled = p.VspeedEnabled, builtIn = p.BuiltIn,
            }).ToArray(),
        };
    }

    private object SaveProfile(JsonNode args)
    {
        var id   = args.Str("profileId");
        var name = args.Str("name");
        if (string.IsNullOrWhiteSpace(name)) return new { ok = false, error = "Name required" };

        // New profile gets a generated id; existing one is updated in place.
        if (string.IsNullOrWhiteSpace(id))
            id = "p" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var existing = _config.Data.Profiles.FirstOrDefault(p => p.Id == id);
        if (existing == null)
        {
            existing = new ProfileData { Id = id };
            _config.Data.Profiles.Add(existing);
        }
        if (existing.BuiltIn) { /* allow editing values but keep BuiltIn flag */ }

        existing.Name          = name;
        existing.Icon          = string.IsNullOrWhiteSpace(args.Str("icon")) ? existing.Icon : args.Str("icon");
        existing.RamMax        = args.Int("ramMax", existing.RamMax);
        existing.JvmArgs       = args["jvmArgs"] is JsonNode ja ? (ja.GetValue<string>() ?? "") : existing.JvmArgs;
        existing.VspeedEnabled = args.Bool("vspeedEnabled", existing.VspeedEnabled);
        _config.Save();
        Logger.Info($"SaveProfile: {name} ({id})");
        return new { ok = true, id };
    }

    private object DeleteProfile(string profileId)
    {
        var p = _config.Data.Profiles.FirstOrDefault(x => x.Id == profileId);
        if (p == null) return new { ok = false, error = "Profile not found" };
        if (p.BuiltIn) return new { ok = false, error = "Built-in profiles can't be deleted" };
        _config.Data.Profiles.Remove(p);
        _config.Save();
        return new { ok = true };
    }

    /// <summary>Writes a profile's RAM + JVM args into the instance's instance.cfg,
    /// and sets the VSpeed cache flag.</summary>
    private object ApplyProfile(string instanceId, string profileId)
    {
        var p = _config.Data.Profiles.FirstOrDefault(x => x.Id == profileId);
        if (p == null) return new { ok = false, error = "Profile not found" };

        var argsNode = new JsonObject
        {
            ["jvmArgs"] = p.JvmArgs,
            ["ramMax"]  = p.RamMax,
        };
        var res = SaveInstanceCfg(instanceId, argsNode);
        Logger.Info($"ApplyProfile({instanceId}): {p.Name}");
        return new { ok = true, applied = p.Name, ramMax = p.RamMax, vspeedEnabled = p.VspeedEnabled };
    }

    // ── Modrinth mod browser ────────────────────────────────────────────────────

    private static readonly ModrinthClient _modrinth = new();

    /// <summary>Searches Modrinth. kind="mod" scopes to the instance's MC+loader;
    /// kind="modpack" searches modpacks (no loader filter).</summary>
    private async Task<object?> SearchModrinthAsync(string query, string instanceId, int offset, string kind, string sort, string category)
    {
        var projectType = kind == "modpack" ? "modpack" : "mod";
        try
        {
            var meta = string.IsNullOrEmpty(instanceId) ? null : InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
            var mcFilter = projectType == "modpack" ? "" : (meta?.Mc ?? "");
            var node = await _modrinth.SearchAsync(query, mcFilter, meta?.Loader ?? "", offset, 20, projectType, sort, category);
            var hits = node?["hits"]?.AsArray();
            var list = new List<object>();
            if (hits != null)
                foreach (var h in hits)
                {
                    list.Add(new
                    {
                        projectId   = h?["project_id"]?.GetValue<string>() ?? "",
                        slug        = h?["slug"]?.GetValue<string>() ?? "",
                        title       = h?["title"]?.GetValue<string>() ?? "",
                        description = h?["description"]?.GetValue<string>() ?? "",
                        downloads   = h?["downloads"]?.GetValue<long>() ?? 0,
                        follows     = h?["follows"]?.GetValue<long>() ?? 0,
                        iconUrl     = h?["icon_url"]?.GetValue<string>() ?? "",
                        author      = h?["author"]?.GetValue<string>() ?? "",
                    });
                }
            return new { ok = true, hits = list, total = node?["total_hits"]?.GetValue<long>() ?? 0 };
        }
        catch (Exception e)
        {
            Logger.Warn($"SearchModrinth('{query}'): {e.Message}");
            return new { ok = false, error = e.Message, hits = Array.Empty<object>() };
        }
    }

    /// <summary>Lists installable versions of a Modrinth project for this instance.</summary>
    private async Task<object?> GetModrinthVersionsAsync(string projectId, string instanceId)
    {
        try
        {
            var meta = string.IsNullOrEmpty(instanceId) ? null : InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
            var arr  = await _modrinth.GetVersionsAsync(projectId, meta?.Mc ?? "", meta?.Loader ?? "");
            var list = new List<object>();
            if (arr is JsonArray versions)
                foreach (var v in versions)
                {
                    var files   = v?["files"]?.AsArray();
                    // Prefer the file flagged "primary", else the first.
                    JsonNode? file = null;
                    if (files != null && files.Count > 0)
                        file = files.FirstOrDefault(f => f?["primary"]?.GetValue<bool>() == true) ?? files[0];
                    if (file == null) continue;
                    list.Add(new
                    {
                        versionId     = v?["id"]?.GetValue<string>() ?? "",
                        name          = v?["name"]?.GetValue<string>() ?? "",
                        versionNumber = v?["version_number"]?.GetValue<string>() ?? "",
                        datePublished = v?["date_published"]?.GetValue<string>() ?? "",
                        versionType   = v?["version_type"]?.GetValue<string>() ?? "release",
                        downloads     = v?["downloads"]?.GetValue<long>() ?? 0,
                        filename      = file?["filename"]?.GetValue<string>() ?? "",
                        url           = file?["url"]?.GetValue<string>() ?? "",
                        sha512        = file?["hashes"]?["sha512"]?.GetValue<string>() ?? "",
                    });
                }
            return new { ok = true, versions = list };
        }
        catch (Exception e)
        {
            Logger.Warn($"GetModrinthVersions('{projectId}'): {e.Message}");
            return new { ok = false, error = e.Message, versions = Array.Empty<object>() };
        }
    }

    // ── VSpeed Performance Pack ──────────────────────────────────────────────────
    // One-click curated optimization mods, per loader (all on Modrinth). Slugs that
    // don't resolve to a version compatible with the instance's MC are skipped, so
    // the feature degrades gracefully across versions. Required deps (e.g. Fabric API)
    // are pulled one level deep.
    private static readonly Dictionary<string, string[]> PerfModSlugs = new(StringComparer.OrdinalIgnoreCase)
    {
        ["fabric"]   = new[] { "sodium", "lithium", "ferrite-core", "modernfix", "entityculling", "dynamic-fps", "immediatelyfast", "krypton" },
        ["quilt"]    = new[] { "sodium", "lithium", "ferrite-core", "modernfix", "entityculling", "dynamic-fps", "immediatelyfast", "krypton" },
        ["forge"]    = new[] { "embeddium", "ferrite-core", "modernfix", "saturn", "canary" },
        ["neoforge"] = new[] { "embeddium", "ferrite-core", "modernfix", "saturn" },
    };

    /// <summary>Installs the curated VSpeed performance mods for the instance's loader
    /// into mods/ (latest compatible version each, plus required deps one level deep).
    /// Push events: perfPackProgress / perfPackDone.</summary>
    private object InstallPerformancePack(string instanceId)
    {
        if (!IsSafeSegment(instanceId)) return new { ok = false, error = "Invalid instance." };
        _ = Task.Run(async () =>
        {
            try
            {
                var meta   = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var mc     = meta.Mc ?? "";
                var loader = meta.Loader ?? "";
                if (!PerfModSlugs.TryGetValue(loader.ToLowerInvariant(), out var slugs))
                {
                    Push("perfPackDone", new { ok = false, error = $"No performance pack for '{(loader.Length == 0 ? "Vanilla" : loader)}'. Use Fabric, Quilt, Forge or NeoForge." });
                    return;
                }
                var modsDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "mods");
                Directory.CreateDirectory(modsDir);

                var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                int installed = 0, skipped = 0, i = 0;

                // Downloads a version node's primary file (skips if already present); returns true if a file landed.
                async Task<bool> Grab(JsonNode? ver)
                {
                    var pid = ver?["project_id"]?.GetValue<string>() ?? "";
                    if (!string.IsNullOrEmpty(pid) && !visited.Add(pid)) return false;
                    var files = ver?["files"]?.AsArray();
                    var pf = files?.FirstOrDefault(f => f?["primary"]?.GetValue<bool>() == true) ?? (files != null && files.Count > 0 ? files[0] : null);
                    var url = pf?["url"]?.GetValue<string>() ?? "";
                    var fn  = pf?["filename"]?.GetValue<string>() ?? "";
                    if (url.Length == 0 || fn.Length == 0) return false;
                    if (!File.Exists(Path.Combine(modsDir, Path.GetFileName(fn))))
                        await _modrinth.DownloadFileAsync(url, fn, pf?["hashes"]?["sha512"]?.GetValue<string>(), modsDir);
                    return true;
                }

                foreach (var slug in slugs)
                {
                    i++;
                    Push("perfPackProgress", new { message = $"Installing {slug}…", done = i, total = slugs.Length });
                    try
                    {
                        var ver = (await _modrinth.GetVersionsAsync(slug, mc, loader) as JsonArray)?.FirstOrDefault();
                        if (ver == null) { skipped++; continue; }
                        if (await Grab(ver)) installed++; else { skipped++; continue; }

                        // Required dependencies (e.g. Fabric API), one level deep.
                        var deps = ver["dependencies"]?.AsArray();
                        if (deps == null) continue;
                        foreach (var dep in deps)
                        {
                            if ((dep?["dependency_type"]?.GetValue<string>() ?? "") != "required") continue;
                            var dvid = dep?["version_id"]?.GetValue<string>();
                            var dpid = dep?["project_id"]?.GetValue<string>();
                            if (!string.IsNullOrEmpty(dpid) && visited.Contains(dpid)) continue;
                            try
                            {
                                JsonNode? dver = !string.IsNullOrWhiteSpace(dvid)
                                    ? await _modrinth.GetVersionAsync(dvid!)
                                    : (!string.IsNullOrWhiteSpace(dpid) ? (await _modrinth.GetVersionsAsync(dpid!, mc, loader) as JsonArray)?.FirstOrDefault() : null);
                                if (dver != null && await Grab(dver)) installed++;
                            }
                            catch (Exception de) { Logger.Warn($"PerfPack dep {dpid}/{dvid}: {de.Message}"); }
                        }
                    }
                    catch (Exception e) { skipped++; Logger.Warn($"PerfPack {slug}: {e.Message}"); }
                }

                Logger.Info($"PerformancePack({instanceId}): installed={installed}, skipped={skipped}");
                Push("perfPackDone", new { ok = true, installed, skipped });
            }
            catch (Exception e)
            {
                Logger.Warn($"InstallPerformancePack({instanceId}): {e.Message}");
                Push("perfPackDone", new { ok = false, error = e.Message });
            }
        });
        return new { ok = true };
    }

    // ── CurseForge (optional second source for the mod browser) ──────────────────

    private static readonly CurseForgeClient _curse = new();

    /// <summary>The CurseForge key to use: the user's own (Settings) if set,
    /// otherwise the app-wide key embedded at build time. Empty only when neither
    /// exists — then CurseForge is unavailable until one is provided.</summary>
    private string EffectiveCurseKey()
    {
        var user = (_config.Data.CurseForgeApiKey ?? "").Trim();
        return user.Length > 0 ? user : CurseForgeClient.DefaultApiKey;
    }

    private const string CurseSetupHint =
        "CurseForge isn't set up. Add a free API key from console.curseforge.com in Settings → Assistant (or embed one app-wide — see CLAUDE.md).";

    private async Task<object?> SearchCurseForgeAsync(string query, string instanceId, int offset, string kind, string sort)
    {
        var key = EffectiveCurseKey();
        if (string.IsNullOrEmpty(key)) return new { ok = false, error = CurseSetupHint, hits = Array.Empty<object>() };
        var classId = kind == "modpack" ? CurseForgeClient.ClassModpacks : 6;
        var sortField = sort switch { "downloads" => 6, "updated" => 3, _ => 2 };   // 2 = Popularity
        try
        {
            var meta = string.IsNullOrEmpty(instanceId) ? null : InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
            var mcFilter = kind == "modpack" ? "" : (meta?.Mc ?? "");
            var node = await _curse.SearchAsync(key, query, mcFilter, meta?.Loader ?? "", offset, 20, classId, sortField);
            var data = node?["data"]?.AsArray();
            var list = new List<object>();
            if (data != null)
                foreach (var h in data)
                {
                    var authors = h?["authors"]?.AsArray();
                    list.Add(new
                    {
                        projectId   = (h?["id"]?.GetValue<int>() ?? 0).ToString(),
                        slug        = h?["slug"]?.GetValue<string>() ?? "",
                        title       = h?["name"]?.GetValue<string>() ?? "",
                        description = h?["summary"]?.GetValue<string>() ?? "",
                        downloads   = (long)(h?["downloadCount"]?.GetValue<double>() ?? 0),
                        follows     = (long)(h?["thumbsUpCount"]?.GetValue<double>() ?? 0),
                        iconUrl     = h?["logo"]?["thumbnailUrl"]?.GetValue<string>() ?? h?["logo"]?["url"]?.GetValue<string>() ?? "",
                        author      = (authors != null && authors.Count > 0) ? authors[0]?["name"]?.GetValue<string>() ?? "" : "",
                    });
                }
            return new { ok = true, hits = list, total = node?["pagination"]?["totalCount"]?.GetValue<int>() ?? list.Count };
        }
        catch (Exception e)
        {
            Logger.Warn($"SearchCurseForge('{query}'): {e.Message}");
            return new { ok = false, error = e.Message, hits = Array.Empty<object>() };
        }
    }

    private async Task<object?> GetCurseForgeFilesAsync(string projectId, string instanceId)
    {
        var key = EffectiveCurseKey();
        if (string.IsNullOrEmpty(key)) return new { ok = false, error = CurseSetupHint, versions = Array.Empty<object>() };
        try
        {
            var meta = string.IsNullOrEmpty(instanceId) ? null : InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
            var node = await _curse.GetFilesAsync(key, projectId, meta?.Mc ?? "", meta?.Loader ?? "");
            var data = node?["data"]?.AsArray();
            var list = new List<object>();
            if (data != null)
                foreach (var f in data)
                {
                    var rel = f?["releaseType"]?.GetValue<int>() ?? 1;  // 1 release, 2 beta, 3 alpha
                    var url = f?["downloadUrl"]?.GetValue<string>();
                    list.Add(new
                    {
                        versionId     = (f?["id"]?.GetValue<int>() ?? 0).ToString(),
                        name          = f?["displayName"]?.GetValue<string>() ?? "",
                        versionNumber = f?["fileName"]?.GetValue<string>() ?? "",
                        datePublished = f?["fileDate"]?.GetValue<string>() ?? "",
                        versionType   = rel == 1 ? "release" : rel == 2 ? "beta" : "alpha",
                        downloads     = (long)(f?["downloadCount"]?.GetValue<double>() ?? 0),
                        filename      = f?["fileName"]?.GetValue<string>() ?? "",
                        url           = url ?? "",
                        sha512        = "",   // CF uses fingerprint/sha1; skip hash verification
                        disabled      = string.IsNullOrEmpty(url),   // author opted out of API distribution
                    });
                }
            return new { ok = true, versions = list };
        }
        catch (Exception e)
        {
            Logger.Warn($"GetCurseForgeFiles('{projectId}'): {e.Message}");
            return new { ok = false, error = e.Message, versions = Array.Empty<object>() };
        }
    }

    /// <summary>Downloads a mod file into the instance's mods folder (SHA-512 verified).
    /// Push events: modDownloadDone / modDownloadError.</summary>
    private object DownloadMod(string instanceId, string url, string filename, string sha512, string projectTitle)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                if (string.IsNullOrWhiteSpace(url)) throw new Exception("No download URL");
                var modsDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "mods");
                var dest    = await _modrinth.DownloadFileAsync(url, filename, sha512, modsDir);
                Logger.Info($"DownloadMod({instanceId}): {Path.GetFileName(dest)} ← {projectTitle}");
                Push("modDownloadDone", new { ok = true, filename = Path.GetFileName(dest), projectTitle });
            }
            catch (Exception e)
            {
                Logger.Warn($"DownloadMod({instanceId}): {e.Message}");
                Push("modDownloadError", new { error = e.Message, projectTitle });
            }
        });
        return new { ok = true };
    }

    /// <summary>Installs a Modrinth mod version AND its required dependencies
    /// (resolved to versions compatible with the instance's MC + loader, recursively,
    /// de-duplicated). Push events: modDownloadProgress / modDownloadDone / modDownloadError.</summary>
    private object DownloadModrinthMod(string instanceId, string projectId, string versionId, string projectTitle)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                if (string.IsNullOrWhiteSpace(versionId)) throw new Exception("No version selected.");
                var meta    = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var modsDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "mods");
                Directory.CreateDirectory(modsDir);

                var visited  = new HashSet<string>(StringComparer.OrdinalIgnoreCase);  // project ids handled
                var depNames = new List<string>();
                string mainFile = "";

                // Downloads a version node's primary file (skips if already present).
                async Task<bool> Grab(JsonNode? ver, bool isDep)
                {
                    if (ver == null) return false;
                    var pid = ver["project_id"]?.GetValue<string>() ?? "";
                    if (!string.IsNullOrEmpty(pid) && !visited.Add(pid)) return false;  // already handled
                    var files = ver["files"]?.AsArray();
                    var pf = files?.FirstOrDefault(f => f?["primary"]?.GetValue<bool>() == true)
                             ?? (files != null && files.Count > 0 ? files[0] : null);
                    if (pf == null) return false;
                    var url = pf["url"]?.GetValue<string>() ?? "";
                    var fn  = pf["filename"]?.GetValue<string>() ?? "";
                    if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(fn)) return false;
                    var leaf = Path.GetFileName(fn);
                    if (!File.Exists(Path.Combine(modsDir, leaf)))   // skip files already there
                    {
                        var sha = pf["hashes"]?["sha512"]?.GetValue<string>();
                        await _modrinth.DownloadFileAsync(url, fn, sha, modsDir);
                    }
                    if (isDep) depNames.Add(Path.GetFileNameWithoutExtension(leaf)); else mainFile = leaf;
                    return true;
                }

                // Walks required dependencies breadth-first (capped depth + total).
                async Task Resolve(JsonNode? ver, int depth)
                {
                    if (ver == null || depth > 5 || depNames.Count >= 60) return;
                    var deps = ver["dependencies"]?.AsArray();
                    if (deps == null) return;
                    foreach (var dep in deps)
                    {
                        if ((dep?["dependency_type"]?.GetValue<string>() ?? "") != "required") continue;
                        var dvid = dep?["version_id"]?.GetValue<string>();
                        var dpid = dep?["project_id"]?.GetValue<string>();
                        if (!string.IsNullOrEmpty(dpid) && visited.Contains(dpid)) continue;
                        JsonNode? dver = null;
                        try
                        {
                            if (!string.IsNullOrWhiteSpace(dvid))
                                dver = await _modrinth.GetVersionAsync(dvid!);
                            else if (!string.IsNullOrWhiteSpace(dpid))
                                dver = (await _modrinth.GetVersionsAsync(dpid!, meta.Mc, meta.Loader) as JsonArray)?.FirstOrDefault();
                        }
                        catch (Exception de) { Logger.Warn($"dep {dpid}/{dvid}: {de.Message}"); continue; }
                        if (dver == null) continue;
                        Push("modDownloadProgress", new { message = $"Adding dependency: {dver["name"]?.GetValue<string>() ?? dpid}" });
                        if (await Grab(dver, true)) await Resolve(dver, depth + 1);
                    }
                }

                Push("modDownloadProgress", new { message = $"Installing {projectTitle}…" });
                var main = await _modrinth.GetVersionAsync(versionId) ?? throw new Exception("Could not fetch version.");
                await Grab(main, false);
                await Resolve(main, 0);

                Logger.Info($"DownloadModrinthMod({instanceId}): {projectTitle} + {depNames.Count} dep(s)");
                Push("modDownloadDone", new { ok = true, projectTitle, filename = mainFile, deps = depNames, depCount = depNames.Count });
            }
            catch (Exception e)
            {
                Logger.Warn($"DownloadModrinthMod({instanceId}): {e.Message}");
                Push("modDownloadError", new { error = e.Message, projectTitle });
            }
        });
        return new { ok = true };
    }

    /// <summary>Hashes every installed jar and asks Modrinth which have newer versions.
    /// Push events: modUpdatesProgress / modUpdatesDone / modUpdatesError.</summary>
    private object CheckModUpdates(string instanceId)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var meta    = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var modsDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "mods");
                if (!Directory.Exists(modsDir)) { Push("modUpdatesDone", new { ok = true, updates = Array.Empty<object>(), scanned = 0 }); return; }

                var files     = Directory.GetFiles(modsDir, "*.jar");
                var hashToFile = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                var hashes    = new List<string>();

                Push("modUpdatesProgress", new { message = $"Hashing {files.Length} mods…" });
                foreach (var f in files)
                {
                    var bytes = await File.ReadAllBytesAsync(f);
                    var h = Convert.ToHexString(System.Security.Cryptography.SHA512.HashData(bytes)).ToLowerInvariant();
                    hashToFile[h] = f;
                    hashes.Add(h);
                }

                Push("modUpdatesProgress", new { message = "Checking Modrinth for updates…" });
                var result = await _modrinth.CheckUpdatesAsync(hashes, meta.Mc, meta.Loader);

                var updates = new List<object>();
                if (result is JsonObject map)
                    foreach (var kv in map)
                    {
                        var localHash = kv.Key;
                        var version   = kv.Value;
                        if (!hashToFile.TryGetValue(localHash, out var localPath)) continue;

                        var vFiles = version?["files"]?.AsArray();
                        if (vFiles == null || vFiles.Count == 0) continue;

                        // Already on the latest version if our hash matches any file in it.
                        bool latest = vFiles.Any(x =>
                            string.Equals(x?["hashes"]?["sha512"]?.GetValue<string>(), localHash, StringComparison.OrdinalIgnoreCase));
                        if (latest) continue;

                        var newFile = vFiles.FirstOrDefault(x => x?["primary"]?.GetValue<bool>() == true) ?? vFiles[0];
                        updates.Add(new
                        {
                            currentFile = Path.GetFileName(localPath),
                            newFilename = newFile?["filename"]?.GetValue<string>() ?? "",
                            newVersion  = version?["version_number"]?.GetValue<string>() ?? "",
                            url         = newFile?["url"]?.GetValue<string>() ?? "",
                            sha512      = newFile?["hashes"]?["sha512"]?.GetValue<string>() ?? "",
                            projectId   = version?["project_id"]?.GetValue<string>() ?? "",
                        });
                    }

                Logger.Info($"CheckModUpdates({instanceId}): {updates.Count} update(s) for {files.Length} mods");
                Push("modUpdatesDone", new { ok = true, updates, scanned = files.Length });
            }
            catch (Exception e)
            {
                Logger.Warn($"CheckModUpdates({instanceId}): {e.Message}");
                Push("modUpdatesError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    /// <summary>Returns the Modrinth project ids of the instance's installed jars,
    /// matched by SHA-512 hash, so the mod browser can flag mods already present.
    /// (CurseForge-only mods simply won't match — best-effort, no false positives.)</summary>
    private async Task<object> GetInstalledModIdsAsync(string instanceId)
    {
        if (!IsSafeSegment(instanceId)) return new { ok = false, ids = Array.Empty<string>() };
        try
        {
            var meta    = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
            var modsDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "mods");
            if (!Directory.Exists(modsDir)) return new { ok = true, ids = Array.Empty<string>() };

            var hashes = new List<string>();
            foreach (var f in Directory.GetFiles(modsDir, "*.jar"))
                hashes.Add(Convert.ToHexString(System.Security.Cryptography.SHA512.HashData(await File.ReadAllBytesAsync(f))).ToLowerInvariant());

            var ids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (hashes.Count > 0)
            {
                var result = await _modrinth.CheckUpdatesAsync(hashes, meta.Mc, meta.Loader);
                if (result is JsonObject map)
                    foreach (var kv in map)
                    {
                        var pid = kv.Value?["project_id"]?.GetValue<string>();
                        if (!string.IsNullOrEmpty(pid)) ids.Add(pid!);
                    }
            }
            return new { ok = true, ids = ids.ToList() };
        }
        catch (Exception e) { Logger.Warn($"GetInstalledModIds({instanceId}): {e.Message}"); return new { ok = false, ids = Array.Empty<string>() }; }
    }

    /// <summary>Downloads a newer mod jar and removes the old one.
    /// Push events: modUpdateDone / modUpdateError.</summary>
    private object UpdateMod(string instanceId, string oldFile, string url, string newFilename, string sha512)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var modsDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "mods");
                var dest    = await _modrinth.DownloadFileAsync(url, newFilename, sha512, modsDir);

                // Remove the previous jar only if it's a different file (some mods reuse the name).
                var oldPath = Path.Combine(modsDir, Path.GetFileName(oldFile));
                if (File.Exists(oldPath) &&
                    !string.Equals(Path.GetFileName(oldPath), Path.GetFileName(dest), StringComparison.OrdinalIgnoreCase))
                    File.Delete(oldPath);

                Logger.Info($"UpdateMod({instanceId}): {oldFile} → {Path.GetFileName(dest)}");
                Push("modUpdateDone", new { ok = true, oldFile, newFile = Path.GetFileName(dest) });
            }
            catch (Exception e)
            {
                Logger.Warn($"UpdateMod({instanceId}/{oldFile}): {e.Message}");
                Push("modUpdateError", new { error = e.Message, oldFile });
            }
        });
        return new { ok = true };
    }

    // ── Modpack Export ────────────────────────────────────────────────────────

    private object ExportModpack(string instanceId)
    {
        _ = Task.Run(() =>
        {
            string? savePath = null;
            WpfApp.Current?.Dispatcher.Invoke(() =>
            {
                var meta = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var dlg  = new Microsoft.Win32.SaveFileDialog
                {
                    Title    = "Export Modpack — " + meta.Name,
                    Filter   = "Modpack ZIP|*.zip",
                    FileName = meta.Name.Length > 0 ? meta.Name : instanceId,
                };
                if (dlg.ShowDialog() == true) savePath = dlg.FileName;
            });

            if (savePath == null) { Push("exportDone", new { ok = false, cancelled = true }); return; }

            try
            {
                var meta       = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var mcDir      = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft");
                Push("exportProgress", new { phase = "start", message = "Building modpack ZIP…" });

                using var zip = System.IO.Compression.ZipFile.Open(savePath, System.IO.Compression.ZipArchiveMode.Create);

                // mods/
                var modsDir = Path.Combine(mcDir, "mods");
                if (Directory.Exists(modsDir))
                    foreach (var f in Directory.GetFiles(modsDir, "*.jar"))
                        zip.CreateEntryFromFile(f, "mods/" + Path.GetFileName(f));

                // config/ (recursive)
                var cfgDir = Path.Combine(mcDir, "config");
                if (Directory.Exists(cfgDir))
                    foreach (var f in Directory.EnumerateFiles(cfgDir, "*", SearchOption.AllDirectories))
                    {
                        var rel = Path.GetRelativePath(mcDir, f).Replace('\\', '/');
                        zip.CreateEntryFromFile(f, rel);
                    }

                // options.txt + servers.dat (safe to share)
                foreach (var fname in new[] { "options.txt", "servers.dat" })
                {
                    var fp = Path.Combine(mcDir, fname);
                    if (File.Exists(fp)) zip.CreateEntryFromFile(fp, fname);
                }

                // cryo-modpack.json — manifest
                var manifest = new JsonObject
                {
                    ["name"]       = meta.Name,
                    ["mc"]         = meta.Mc,
                    ["loader"]     = meta.Loader,
                    ["loaderVer"]  = meta.LoaderVer,
                    ["exportedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    ["exportedBy"] = "Cryo Launcher",
                };
                var entry = zip.CreateEntry("cryo-modpack.json");
                using var sw = new StreamWriter(entry.Open());
                sw.Write(manifest.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));

                Logger.Info($"ExportModpack({instanceId}): {savePath}");
                Push("exportDone", new { ok = true, path = savePath });
            }
            catch (Exception e)
            {
                Logger.Warn($"ExportModpack({instanceId}): {e.Message}");
                Push("exportDone", new { ok = false, error = e.Message });
            }
        });
        return new { ok = true };
    }

    // ── Modpack Import ─────────────────────────────────────────────────────────

    // ── Shared instance-creation helpers (used by create + modpack installs) ─────

    /// <summary>Generates a unique, filesystem-safe instance id from a display name.</summary>
    private string MakeInstanceId(string name)
    {
        var slug = new string((name ?? "").ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray());
        while (slug.Contains("--")) slug = slug.Replace("--", "-");
        slug = slug.Trim('-');
        if (slug.Length > 40) slug = slug[..40];
        if (slug.Length < 2) slug = "cryo-instance";
        var id = slug;
        int n = 2;
        while (Directory.Exists(Path.Combine(InstanceDataDir(id), "instances", id))
            || _config.Data.Instances.Any(e => e.Id == id))
            id = slug + "-" + n++;
        return id;
    }

    /// <summary>Writes instance.cfg + mmc-pack.json and creates the minecraft folder tree.</summary>
    private string CreateInstanceFolder(string id, string name, string mc, string loader, string loaderVer, int ramMax, string targetRoot)
    {
        var instanceDir = Path.Combine(targetRoot, "instances", id);
        var mcDir       = Path.Combine(instanceDir, "minecraft");
        Directory.CreateDirectory(Path.Combine(mcDir, "mods"));
        Directory.CreateDirectory(Path.Combine(mcDir, "config"));
        Directory.CreateDirectory(Path.Combine(mcDir, "saves"));

        File.WriteAllText(Path.Combine(instanceDir, "instance.cfg"),
            $"[General]\nConfigVersion=1.2\nname={name}\nMaxMemAlloc={ramMax}\nMinMemAlloc=2048\n");

        var components = new JsonArray { new JsonObject { ["uid"] = "net.minecraft", ["version"] = mc } };
        switch ((loader ?? "").ToLowerInvariant())
        {
            case "neoforge": components.Add(new JsonObject { ["uid"] = "net.neoforged",            ["version"] = loaderVer }); break;
            case "forge":    components.Add(new JsonObject { ["uid"] = "net.minecraftforge",        ["version"] = loaderVer }); break;
            case "fabric":   components.Add(new JsonObject { ["uid"] = "net.fabricmc.fabric-loader",["version"] = loaderVer }); break;
            case "quilt":    components.Add(new JsonObject { ["uid"] = "org.quiltmc.quilt-loader",  ["version"] = loaderVer }); break;
        }
        File.WriteAllText(Path.Combine(instanceDir, "mmc-pack.json"),
            new JsonObject { ["components"] = components, ["formatVersion"] = 1 }.ToJsonString());
        return instanceDir;
    }

    // ── Modpack source tracking + update ─────────────────────────────────────────

    private string PackJsonPath(string id) => Path.Combine(InstanceDataDir(id), "instances", id, "cryo-pack.json");

    /// <summary>Remembers which Modrinth/CurseForge pack (and version) an instance came
    /// from, so it can be updated later.</summary>
    private void StorePackSource(string id, string source, string projectId, string versionId, string name)
    {
        try
        {
            File.WriteAllText(PackJsonPath(id), new JsonObject
            {
                ["source"] = source, ["projectId"] = projectId, ["versionId"] = versionId, ["name"] = name,
            }.ToJsonString());
        }
        catch (Exception e) { Logger.Warn($"StorePackSource({id}): {e.Message}"); }
    }

    private JsonNode? ReadPackSource(string id)
    {
        try { var p = PackJsonPath(id); return File.Exists(p) ? JsonNode.Parse(File.ReadAllText(p)) : null; }
        catch { return null; }
    }

    private void WriteMmcPack(string instanceDir, string mc, string loader, string loaderVer)
    {
        var components = new JsonArray { new JsonObject { ["uid"] = "net.minecraft", ["version"] = mc } };
        switch ((loader ?? "").ToLowerInvariant())
        {
            case "neoforge": components.Add(new JsonObject { ["uid"] = "net.neoforged",             ["version"] = loaderVer }); break;
            case "forge":    components.Add(new JsonObject { ["uid"] = "net.minecraftforge",         ["version"] = loaderVer }); break;
            case "fabric":   components.Add(new JsonObject { ["uid"] = "net.fabricmc.fabric-loader", ["version"] = loaderVer }); break;
            case "quilt":    components.Add(new JsonObject { ["uid"] = "org.quiltmc.quilt-loader",   ["version"] = loaderVer }); break;
        }
        File.WriteAllText(Path.Combine(instanceDir, "mmc-pack.json"),
            new JsonObject { ["components"] = components, ["formatVersion"] = 1 }.ToJsonString());
    }

    /// <summary>Reports the instance's modpack source and whether a newer version exists.</summary>
    private async Task<object?> GetModpackInfoAsync(string id)
    {
        var src = ReadPackSource(id);
        if (src == null) return new { hasSource = false };
        var source    = src["source"]?.GetValue<string>() ?? "";
        var projectId = src["projectId"]?.GetValue<string>() ?? "";
        var curVer    = src["versionId"]?.GetValue<string>() ?? "";
        var name      = src["name"]?.GetValue<string>() ?? "";
        var meta      = InstanceMetaReader.Read(id, InstanceDataDir(id));
        try
        {
            string latestId = "", latestName = "";
            if (source == "modrinth")
            {
                var v = (await _modrinth.GetVersionsAsync(projectId, meta.Mc, meta.Loader) as JsonArray)?.FirstOrDefault();
                latestId   = v?["id"]?.GetValue<string>() ?? "";
                latestName = v?["version_number"]?.GetValue<string>() ?? v?["name"]?.GetValue<string>() ?? "";
            }
            else if (source == "curseforge")
            {
                var key = EffectiveCurseKey();
                if (!string.IsNullOrEmpty(key))
                {
                    var d = (await _curse.GetFilesAsync(key, projectId, meta.Mc, meta.Loader))?["data"]?.AsArray();
                    var v = d?.OrderByDescending(x => x?["fileDate"]?.GetValue<string>() ?? "").FirstOrDefault();
                    latestId   = (v?["id"]?.GetValue<long>() ?? 0).ToString();
                    latestName = v?["displayName"]?.GetValue<string>() ?? "";
                }
            }
            return new
            {
                hasSource = true, source, name, projectId,
                currentVersionId = curVer, latestVersionId = latestId, latestName,
                updateAvailable = !string.IsNullOrEmpty(latestId) && latestId != curVer && !string.IsNullOrEmpty(curVer),
            };
        }
        catch (Exception e) { Logger.Warn($"GetModpackInfo({id}): {e.Message}"); return new { hasSource = true, source, name, error = e.Message }; }
    }

    /// <summary>Updates an installed modpack to its latest version in place. Old mods are
    /// MOVED to a timestamped backup (never deleted) and worlds (saves/) are left untouched.
    /// Push events: modpackProgress / modpackDone.</summary>
    private object UpdateModpack(string id)
    {
        _ = Task.Run(async () =>
        {
            string? temp = null;
            try
            {
                var src = ReadPackSource(id) ?? throw new Exception("This instance has no known modpack source to update.");
                var source    = src["source"]?.GetValue<string>() ?? "";
                var projectId  = src["projectId"]?.GetValue<string>() ?? "";
                var name      = src["name"]?.GetValue<string>() ?? "Modpack";
                var meta      = InstanceMetaReader.Read(id, InstanceDataDir(id));
                var instanceDir = Path.Combine(InstanceDataDir(id), "instances", id);
                var mcDir   = Path.Combine(instanceDir, "minecraft");
                var modsDir = Path.Combine(mcDir, "mods");

                Push("modpackProgress", new { phase = "start", message = "Finding the latest version…" });

                string mc = meta.Mc, loader = meta.Loader, loaderVer = "", newVer = "";
                int total = 0, failed = 0, done = 0;

                // Back up the current mods (MOVE, fully reversible) — worlds stay put.
                if (Directory.Exists(modsDir) && Directory.EnumerateFileSystemEntries(modsDir).Any())
                {
                    var bak = Path.Combine(mcDir, "mods.bak-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                    Directory.Move(modsDir, bak);
                    Logger.Info($"UpdateModpack({id}): backed up mods → {Path.GetFileName(bak)}");
                }
                Directory.CreateDirectory(modsDir);

                if (source == "modrinth")
                {
                    var v = (await _modrinth.GetVersionsAsync(projectId, meta.Mc, meta.Loader) as JsonArray)?.FirstOrDefault()
                            ?? throw new Exception("No matching versions found on Modrinth.");
                    newVer = v["id"]?.GetValue<string>() ?? "";
                    var files = v["files"]?.AsArray();
                    var primary = files?.FirstOrDefault(f => f?["primary"]?.GetValue<bool>() == true) ?? (files != null && files.Count > 0 ? files[0] : null);
                    var mrUrl = primary?["url"]?.GetValue<string>() ?? throw new Exception("No .mrpack file in the latest version.");
                    temp = Path.Combine(Path.GetTempPath(), "cryo-upd-" + Guid.NewGuid().ToString("N") + ".mrpack");
                    Push("modpackProgress", new { phase = "download", message = "Downloading update…" });
                    await DownloadToFileAsync(mrUrl, temp);

                    JsonArray? indexFiles = null;
                    using (var z = System.IO.Compression.ZipFile.OpenRead(temp))
                    {
                        var idx = z.GetEntry("modrinth.index.json") ?? throw new Exception("Invalid .mrpack.");
                        using var sr = new StreamReader(idx.Open());
                        var node = JsonNode.Parse(sr.ReadToEnd());
                        var deps = node?["dependencies"]?.AsObject();
                        if (deps != null)
                        {
                            mc = deps["minecraft"]?.GetValue<string>() ?? mc;
                            if (deps["neoforge"] != null)           { loader = "NeoForge"; loaderVer = deps["neoforge"]!.GetValue<string>(); }
                            else if (deps["forge"] != null)         { loader = "Forge";    loaderVer = deps["forge"]!.GetValue<string>(); }
                            else if (deps["fabric-loader"] != null) { loader = "Fabric";   loaderVer = deps["fabric-loader"]!.GetValue<string>(); }
                            else if (deps["quilt-loader"] != null)  { loader = "Quilt";    loaderVer = deps["quilt-loader"]!.GetValue<string>(); }
                        }
                        indexFiles = node?["files"]?.AsArray();
                    }
                    total = indexFiles?.Count ?? 0;
                    if (indexFiles != null)
                        foreach (var f in indexFiles)
                        {
                            var path = f?["path"]?.GetValue<string>() ?? "";
                            var dls  = f?["downloads"]?.AsArray();
                            if (string.IsNullOrEmpty(path) || dls == null || dls.Count == 0) { done++; continue; }
                            var dest = Path.GetFullPath(Path.Combine(mcDir, path));
                            if (!dest.StartsWith(mcDir, StringComparison.OrdinalIgnoreCase)) { done++; continue; }
                            try { await DownloadToFileAsync(dls[0]!.GetValue<string>(), dest); }
                            catch (Exception fe) { failed++; Logger.Warn($"upd file '{path}': {fe.Message}"); }
                            done++;
                            Push("modpackProgress", new { phase = "files", message = $"Downloading mods… {done}/{total}", done, total });
                        }
                    using (var z = System.IO.Compression.ZipFile.OpenRead(temp)) ExtractOverrides(z, mcDir);
                }
                else if (source == "curseforge")
                {
                    var key = EffectiveCurseKey();
                    if (string.IsNullOrEmpty(key)) throw new Exception(CurseSetupHint);
                    var d = (await _curse.GetFilesAsync(key, projectId, meta.Mc, meta.Loader))?["data"]?.AsArray();
                    var latest = d?.OrderByDescending(x => x?["fileDate"]?.GetValue<string>() ?? "").FirstOrDefault()
                                 ?? throw new Exception("No files found on CurseForge.");
                    var packFileId = latest["id"]?.GetValue<long>() ?? 0;
                    newVer = packFileId.ToString();
                    var packMap = await _curse.GetFilesByIdsAsync(key, new[] { packFileId });
                    if (!packMap.TryGetValue(packFileId, out var pf) || string.IsNullOrEmpty(pf.url))
                        throw new Exception("Modpack download not available from CurseForge.");
                    temp = Path.Combine(Path.GetTempPath(), "cryo-upd-" + Guid.NewGuid().ToString("N") + ".zip");
                    Push("modpackProgress", new { phase = "download", message = "Downloading update…" });
                    await DownloadToFileAsync(pf.url!, temp);

                    var projectFileIds = new List<(long projectId, long fileId)>();
                    using (var z = System.IO.Compression.ZipFile.OpenRead(temp))
                    {
                        var man = z.GetEntry("manifest.json") ?? throw new Exception("Invalid CurseForge pack (no manifest.json).");
                        using var sr = new StreamReader(man.Open());
                        var node = JsonNode.Parse(sr.ReadToEnd());
                        mc = node?["minecraft"]?["version"]?.GetValue<string>() ?? mc;
                        var ml = node?["minecraft"]?["modLoaders"]?.AsArray();
                        var prim = ml?.FirstOrDefault(x => x?["primary"]?.GetValue<bool>() == true) ?? (ml != null && ml.Count > 0 ? ml[0] : null);
                        var lid = prim?["id"]?.GetValue<string>() ?? ""; var dash = lid.IndexOf('-');
                        if (dash > 0) { var pfx = lid[..dash].ToLowerInvariant(); loaderVer = lid[(dash + 1)..]; loader = pfx switch { "neoforge" => "NeoForge", "forge" => "Forge", "fabric" => "Fabric", "quilt" => "Quilt", _ => loader }; }
                        var fl = node?["files"]?.AsArray();
                        if (fl != null) foreach (var f in fl) { var pid = f?["projectID"]?.GetValue<long>() ?? 0; var fid = f?["fileID"]?.GetValue<long>() ?? 0; if (pid > 0 && fid > 0) projectFileIds.Add((pid, fid)); }
                    }
                    total = projectFileIds.Count;
                    var urlMap = await _curse.GetFilesByIdsAsync(key, projectFileIds.Select(p => p.fileId));
                    foreach (var (_, fid) in projectFileIds)
                    {
                        urlMap.TryGetValue(fid, out var info);
                        var fname = info.fileName; var url = info.url;
                        if (string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(fname)) url = CurseForgeClient.FallbackUrl(fid, fname);
                        if (!string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(fname))
                        {
                            try { await DownloadToFileAsync(url, Path.Combine(modsDir, Path.GetFileName(fname))); }
                            catch (Exception fe) { failed++; Logger.Warn($"upd cf {fid}: {fe.Message}"); }
                        }
                        else failed++;
                        done++;
                        Push("modpackProgress", new { phase = "files", message = $"Downloading mods… {done}/{total}", done, total });
                    }
                    using (var z = System.IO.Compression.ZipFile.OpenRead(temp)) ExtractOverrides(z, mcDir);
                }
                else throw new Exception("Unknown modpack source.");

                // Persist the new MC/loader + remembered version, then reinstall the loader.
                WriteMmcPack(instanceDir, mc, loader, loaderVer);
                StorePackSource(id, source, projectId, newVer, name);
                Push("modpackProgress", new { phase = "loader", message = $"Installing {loader} {loaderVer}…" });
                if (loader.Equals("Vanilla", StringComparison.OrdinalIgnoreCase)) StoreEngineVersion(id, mc);
                else InstallLoaderForInstance(id, mc, loader, loaderVer);

                Logger.Info($"UpdateModpack({id}): → {newVer} ({total} files, {failed} failed)");
                Push("modpackDone", new { ok = true, id, name, updated = true, files = total, failed });
            }
            catch (Exception e)
            {
                Logger.Warn($"UpdateModpack({id}): {e.Message}");
                Push("modpackDone", new { ok = false, error = e.Message });
            }
            finally { try { if (temp != null) File.Delete(temp); } catch { } }
        });
        return new { ok = true };
    }

    /// <summary>Registers a Cryo-native instance in config + the live manager.</summary>
    private void RegisterInstance(string id, string name, string targetRoot)
    {
        if (_config.Data.Instances.All(e => e.Id != id))
        {
            var entry = new InstanceEntry { Id = id, DisplayName = name, Source = "cryo", DataDir = string.IsNullOrWhiteSpace(targetRoot) ? PrimaryRoot() : targetRoot };
            _config.Data.Instances.Add(entry);
            _config.Save();
            _manager.AddEntry(entry);
        }
    }

    /// <summary>
    /// Creates a brand-new instance without PrismLauncher.
    /// args: { name, mcVersion, loader, loaderVersion, ramMax }.
    /// For NeoForge/Vanilla the engine version is prepared so it launches standalone.
    /// </summary>
    private object CreateInstance(JsonNode args)
    {
        var name      = args.Str("name").Trim();
        var mc        = args.Str("mcVersion").Trim();
        var loader    = args.Str("loader").Trim();
        var loaderVer = args.Str("loaderVersion").Trim();
        var ramMax    = args.Int("ramMax", 6144);
        if (string.IsNullOrWhiteSpace(name)) return new { ok = false, error = "Name is required." };
        if (string.IsNullOrWhiteSpace(mc))   mc = "1.21.1";
        if (string.IsNullOrWhiteSpace(loader)) loader = "NeoForge";

        try
        {
            var id = MakeInstanceId(name);
            var target = ResolveTargetRoot(args.Str("targetRoot"));
            CreateInstanceFolder(id, name, mc, loader, loaderVer, ramMax, target);
            RegisterInstance(id, name, target);

            // Install the loader via the engine so the instance launches without Prism
            // (NeoForge/Forge/Fabric/Quilt download; Vanilla just records the version).
            if (loader.Equals("Vanilla", StringComparison.OrdinalIgnoreCase))
                StoreEngineVersion(id, mc);
            else
                InstallLoaderForInstance(id, mc, loader, loaderVer);

            Logger.Info($"CreateInstance: '{id}' ({name}) {loader} {mc}");
            Push("instanceCreated", new { ok = true, id, name, loader });
            return new { ok = true, id, loader };
        }
        catch (Exception e)
        {
            Logger.Warn($"CreateInstance: {e.Message}");
            return new { ok = false, error = e.Message };
        }
    }

    // ── Modpack install: download files from Modrinth / CurseForge ───────────────

    private static readonly HttpClient _dl = new() { Timeout = TimeSpan.FromMinutes(5) };

    private static async Task DownloadToFileAsync(string url, string dest)
    {
        using var resp = await _dl.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        resp.EnsureSuccessStatusCode();
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        await using var fs = File.Create(dest);
        await resp.Content.CopyToAsync(fs);
    }

    /// <summary>Copies a .mrpack/.zip's overrides + client-overrides into minecraft/.</summary>
    private static void ExtractOverrides(System.IO.Compression.ZipArchive z, string mcDir)
    {
        foreach (var entry in z.Entries)
        {
            var fn = entry.FullName;
            string? rel =
                fn.StartsWith("overrides/", StringComparison.Ordinal)        ? fn["overrides/".Length..] :
                fn.StartsWith("client-overrides/", StringComparison.Ordinal) ? fn["client-overrides/".Length..] : null;
            if (string.IsNullOrEmpty(rel) || fn.EndsWith('/')) continue;
            var dest = Path.GetFullPath(Path.Combine(mcDir, rel));
            if (!dest.StartsWith(mcDir, StringComparison.OrdinalIgnoreCase)) continue;  // traversal guard
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            entry.ExtractToFile(dest, overwrite: true);
        }
    }

    private void FinishModpack(string id, string name, string mc, string loader, string loaderVer, int fileCount, int failed, string targetRoot)
    {
        RegisterInstance(id, name, targetRoot);
        // Install whatever loader the pack declares so it launches without Prism.
        if (loader.Equals("Vanilla", StringComparison.OrdinalIgnoreCase))
            StoreEngineVersion(id, mc);
        else
        {
            Push("modpackProgress", new { phase = "loader", message = $"Installing {loader}…" });
            InstallLoaderForInstance(id, mc, loader, loaderVer);
        }
        Logger.Info($"Modpack installed: '{id}' ({name}) {loader} {mc}, {fileCount} files, {failed} failed");
        Push("modpackDone", new { ok = true, id, name, loader, files = fileCount, failed });
    }

    /// <summary>Downloads + installs a Modrinth modpack (.mrpack) as a new instance.
    /// Push events: modpackProgress / modpackDone.</summary>
    private object InstallModrinthModpack(string projectId, string versionId, string name, string targetRoot)
    {
        var target = ResolveTargetRoot(targetRoot);
        _ = Task.Run(async () =>
        {
            string? temp = null;
            try
            {
                Push("modpackProgress", new { phase = "start", message = "Fetching modpack info…" });
                var ver = await _modrinth.GetVersionAsync(versionId);
                var files = ver?["files"]?.AsArray();
                var primary = files?.FirstOrDefault(f => f?["primary"]?.GetValue<bool>() == true) ?? (files != null && files.Count > 0 ? files[0] : null);
                var mrUrl = primary?["url"]?.GetValue<string>() ?? throw new Exception("No .mrpack file in this version.");

                temp = Path.Combine(Path.GetTempPath(), "cryo-" + Guid.NewGuid().ToString("N") + ".mrpack");
                Push("modpackProgress", new { phase = "download", message = "Downloading modpack…" });
                await DownloadToFileAsync(mrUrl, temp);

                // Parse modrinth.index.json
                string mc = "1.21.1", loader = "NeoForge", loaderVer = "";
                JsonArray? indexFiles = null;
                using (var z = System.IO.Compression.ZipFile.OpenRead(temp))
                {
                    var idx = z.GetEntry("modrinth.index.json") ?? throw new Exception("Invalid .mrpack (no modrinth.index.json).");
                    using var sr = new StreamReader(idx.Open());
                    var node = JsonNode.Parse(sr.ReadToEnd());
                    if (string.IsNullOrWhiteSpace(name)) name = node?["name"]?.GetValue<string>() ?? "Modpack";
                    var deps = node?["dependencies"]?.AsObject();
                    if (deps != null)
                    {
                        mc = deps["minecraft"]?.GetValue<string>() ?? mc;
                        if (deps["neoforge"] != null)          { loader = "NeoForge"; loaderVer = deps["neoforge"]!.GetValue<string>(); }
                        else if (deps["forge"] != null)        { loader = "Forge";    loaderVer = deps["forge"]!.GetValue<string>(); }
                        else if (deps["fabric-loader"] != null){ loader = "Fabric";   loaderVer = deps["fabric-loader"]!.GetValue<string>(); }
                        else if (deps["quilt-loader"] != null) { loader = "Quilt";    loaderVer = deps["quilt-loader"]!.GetValue<string>(); }
                    }
                    indexFiles = node?["files"]?.AsArray();
                }

                var id = MakeInstanceId(name);
                var instanceDir = CreateInstanceFolder(id, name, mc, loader, loaderVer, 6144, target);
                var mcDir = Path.Combine(instanceDir, "minecraft");
                StorePackSource(id, "modrinth", projectId, versionId, name);

                int total = indexFiles?.Count ?? 0, done = 0, failed = 0;
                if (indexFiles != null)
                    foreach (var f in indexFiles)
                    {
                        var path = f?["path"]?.GetValue<string>() ?? "";
                        var dls  = f?["downloads"]?.AsArray();
                        if (string.IsNullOrEmpty(path) || dls == null || dls.Count == 0) { done++; continue; }
                        var dest = Path.GetFullPath(Path.Combine(mcDir, path));
                        if (!dest.StartsWith(mcDir, StringComparison.OrdinalIgnoreCase)) { done++; continue; }
                        try { await DownloadToFileAsync(dls[0]!.GetValue<string>(), dest); }
                        catch (Exception fe) { failed++; Logger.Warn($"mrpack file '{path}': {fe.Message}"); }
                        done++;
                        Push("modpackProgress", new { phase = "files", message = $"Downloading mods… {done}/{total}", done, total });
                    }

                Push("modpackProgress", new { phase = "overrides", message = "Applying overrides…" });
                using (var z = System.IO.Compression.ZipFile.OpenRead(temp)) ExtractOverrides(z, mcDir);

                FinishModpack(id, name, mc, loader, loaderVer, total, failed, target);
            }
            catch (Exception e)
            {
                Logger.Warn($"InstallModrinthModpack: {e.Message}");
                Push("modpackDone", new { ok = false, error = e.Message });
            }
            finally { try { if (temp != null) File.Delete(temp); } catch { } }
        });
        return new { ok = true };
    }

    /// <summary>Downloads + installs a CurseForge modpack as a new instance.
    /// Push events: modpackProgress / modpackDone.</summary>
    private object InstallCurseForgeModpack(string projectId, string fileId, string name, string targetRoot)
    {
        var target = ResolveTargetRoot(targetRoot);
        _ = Task.Run(async () =>
        {
            string? temp = null;
            try
            {
                var key = EffectiveCurseKey();
                if (string.IsNullOrEmpty(key)) throw new Exception(CurseSetupHint);
                if (!long.TryParse(fileId, out var packFileId)) throw new Exception("Invalid file id.");

                Push("modpackProgress", new { phase = "start", message = "Fetching modpack info…" });
                var packMap = await _curse.GetFilesByIdsAsync(key, new[] { packFileId });
                if (!packMap.TryGetValue(packFileId, out var packFile) || string.IsNullOrEmpty(packFile.url))
                    throw new Exception("Modpack download not available from CurseForge.");

                temp = Path.Combine(Path.GetTempPath(), "cryo-" + Guid.NewGuid().ToString("N") + ".zip");
                Push("modpackProgress", new { phase = "download", message = "Downloading modpack…" });
                await DownloadToFileAsync(packFile.url!, temp);

                // Parse manifest.json
                string mc = "1.21.1", loader = "NeoForge", loaderVer = "";
                var projectFileIds = new List<(long projectId, long fileId)>();
                using (var z = System.IO.Compression.ZipFile.OpenRead(temp))
                {
                    var man = z.GetEntry("manifest.json") ?? throw new Exception("Invalid CurseForge pack (no manifest.json).");
                    using var sr = new StreamReader(man.Open());
                    var node = JsonNode.Parse(sr.ReadToEnd());
                    if (string.IsNullOrWhiteSpace(name)) name = node?["name"]?.GetValue<string>() ?? "Modpack";
                    mc = node?["minecraft"]?["version"]?.GetValue<string>() ?? mc;
                    var ml = node?["minecraft"]?["modLoaders"]?.AsArray();
                    var primary = ml?.FirstOrDefault(x => x?["primary"]?.GetValue<bool>() == true) ?? (ml != null && ml.Count > 0 ? ml[0] : null);
                    var lid = primary?["id"]?.GetValue<string>() ?? "";   // e.g. "neoforge-21.1.172"
                    var dash = lid.IndexOf('-');
                    if (dash > 0)
                    {
                        var pfx = lid[..dash].ToLowerInvariant();
                        loaderVer = lid[(dash + 1)..];
                        loader = pfx switch { "neoforge" => "NeoForge", "forge" => "Forge", "fabric" => "Fabric", "quilt" => "Quilt", _ => "NeoForge" };
                    }
                    var fl = node?["files"]?.AsArray();
                    if (fl != null)
                        foreach (var f in fl)
                        {
                            var pid = f?["projectID"]?.GetValue<long>() ?? 0;
                            var fid = f?["fileID"]?.GetValue<long>() ?? 0;
                            if (pid > 0 && fid > 0) projectFileIds.Add((pid, fid));
                        }
                }

                var id = MakeInstanceId(name);
                var instanceDir = CreateInstanceFolder(id, name, mc, loader, loaderVer, 6144, target);
                var mcDir = Path.Combine(instanceDir, "minecraft");
                var modsDir = Path.Combine(mcDir, "mods");
                StorePackSource(id, "curseforge", projectId, fileId, name);

                // Resolve all file download URLs in one bulk call.
                Push("modpackProgress", new { phase = "resolve", message = $"Resolving {projectFileIds.Count} mods…" });
                var urlMap = await _curse.GetFilesByIdsAsync(key, projectFileIds.Select(p => p.fileId));

                int total = projectFileIds.Count, done = 0, failed = 0;
                foreach (var (_, fid) in projectFileIds)
                {
                    urlMap.TryGetValue(fid, out var info);
                    var fname = info.fileName;
                    var url   = info.url;
                    if (string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(fname))
                        url = CurseForgeClient.FallbackUrl(fid, fname);
                    if (!string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(fname))
                    {
                        try { await DownloadToFileAsync(url, Path.Combine(modsDir, Path.GetFileName(fname))); }
                        catch (Exception fe) { failed++; Logger.Warn($"CF file {fid}: {fe.Message}"); }
                    }
                    else failed++;
                    done++;
                    Push("modpackProgress", new { phase = "files", message = $"Downloading mods… {done}/{total}", done, total });
                }

                Push("modpackProgress", new { phase = "overrides", message = "Applying overrides…" });
                using (var z = System.IO.Compression.ZipFile.OpenRead(temp)) ExtractOverrides(z, mcDir);

                FinishModpack(id, name, mc, loader, loaderVer, total, failed, target);
            }
            catch (Exception e)
            {
                Logger.Warn($"InstallCurseForgeModpack: {e.Message}");
                Push("modpackDone", new { ok = false, error = e.Message });
            }
            finally { try { if (temp != null) File.Delete(temp); } catch { } }
        });
        return new { ok = true };
    }

    // Folders that are regenerable / noisy — skipped when duplicating an instance.
    private static readonly HashSet<string> _dupSkipDirs = new(StringComparer.OrdinalIgnoreCase)
        { ".vspeed-cache", "logs", "crash-reports" };

    private static void CopyDirectory(string src, string dst, HashSet<string>? skipTopDirs = null)
    {
        Directory.CreateDirectory(dst);
        foreach (var dir in Directory.GetDirectories(src))
        {
            var name = Path.GetFileName(dir);
            if (skipTopDirs != null && skipTopDirs.Contains(name)) continue;
            CopyDirectory(dir, Path.Combine(dst, name));   // nested dirs copied fully
        }
        foreach (var file in Directory.GetFiles(src))
            File.Copy(file, Path.Combine(dst, Path.GetFileName(file)), overwrite: true);
    }

    /// <summary>Duplicates an instance natively (no Prism): copies the folder, renames,
    /// and registers the copy. Push events: duplicateProgress / duplicateDone.</summary>
    private object DuplicateInstance(string id)
    {
        _ = Task.Run(() =>
        {
            try
            {
                var src = Path.Combine(InstanceDataDir(id), "instances", id);
                if (!Directory.Exists(src)) { Push("duplicateDone", new { ok = false, error = "Instance not found." }); return; }

                var meta    = InstanceMetaReader.Read(id, InstanceDataDir(id));
                var newName = (string.IsNullOrEmpty(meta.Name) ? id : meta.Name) + " (copy)";
                var newId   = MakeInstanceId(newName);
                var dst     = Path.Combine(InstanceDataDir(id), "instances", newId);

                Push("duplicateProgress", new { message = "Copying files…" });
                // Skip regenerable noise at the instance root AND under minecraft/.
                CopyDirectory(src, dst, _dupSkipDirs);
                var dstMc = Path.Combine(dst, "minecraft");
                foreach (var skip in _dupSkipDirs)
                {
                    var p = Path.Combine(dstMc, skip);
                    try { if (Directory.Exists(p)) Directory.Delete(p, recursive: true); } catch { }
                }

                // Rename inside instance.cfg
                var cfg = Path.Combine(dst, "instance.cfg");
                if (File.Exists(cfg))
                    File.WriteAllLines(cfg, File.ReadAllLines(cfg)
                        .Select(l => l.StartsWith("name=", StringComparison.Ordinal) ? "name=" + newName : l));

                RegisterInstance(newId, newName, InstanceDataDir(id));
                Logger.Info($"DuplicateInstance: '{id}' → '{newId}'");
                Push("duplicateDone", new { ok = true, id = newId, name = newName });
            }
            catch (Exception e)
            {
                Logger.Warn($"DuplicateInstance({id}): {e.Message}");
                Push("duplicateDone", new { ok = false, error = e.Message });
            }
        });
        return new { ok = true };
    }

    private object ImportModpack()
    {
        _ = Task.Run(() =>
        {
            string? zipPath = null;
            WpfApp.Current?.Dispatcher.Invoke(() =>
            {
                var dlg = new Microsoft.Win32.OpenFileDialog
                {
                    Title  = "Import Modpack",
                    Filter = "Modpack ZIP|*.zip;*.mrpack|All files|*.*",
                };
                if (dlg.ShowDialog() == true) zipPath = dlg.FileName;
            });

            if (zipPath == null) { Push("importDone", new { ok = false, cancelled = true }); return; }

            try
            {
                Push("importProgress", new { phase = "start", message = "Reading modpack…" });

                // Read manifest from ZIP
                string name = Path.GetFileNameWithoutExtension(zipPath);
                string mc = "1.21.1", loader = "NeoForge", loaderVer = "";
                using (var archive = System.IO.Compression.ZipFile.OpenRead(zipPath))
                {
                    var manifestEntry = archive.GetEntry("cryo-modpack.json")
                                     ?? archive.GetEntry("modrinth.index.json");  // mrpack support
                    if (manifestEntry != null)
                    {
                        using var sr = new StreamReader(manifestEntry.Open());
                        var node = JsonNode.Parse(sr.ReadToEnd());
                        name      = node?["name"]?.GetValue<string>()      ?? name;
                        mc        = node?["mc"]?.GetValue<string>()         ?? mc;
                        loader    = node?["loader"]?.GetValue<string>()     ?? loader;
                        loaderVer = node?["loaderVer"]?.GetValue<string>()  ?? loaderVer;
                    }
                }

                // Generate a unique instance id
                var id  = "cryo-" + Path.GetFileNameWithoutExtension(zipPath)
                              .ToLowerInvariant()
                              .Replace(" ", "-")
                              .Where(c => char.IsLetterOrDigit(c) || c == '-')
                              .Aggregate("", (a, c) => a + c);
                id = id.Length > 32 ? id[..32] : id;
                if (id.Length < 4) id = "cryo-import-" + DateTimeOffset.UtcNow.ToUnixTimeSeconds();

                var instanceDir = Path.Combine(InstanceDataDir(id), "instances", id);
                var mcDir       = Path.Combine(instanceDir, "minecraft");
                if (Directory.Exists(instanceDir))
                    id += "-" + DateTimeOffset.UtcNow.ToString("yyyyMMdd");
                Directory.CreateDirectory(mcDir);

                // Minimal instance.cfg
                File.WriteAllText(Path.Combine(instanceDir, "instance.cfg"),
                    $"[General]\nConfigVersion=1.2\nname={name}\nMaxMemAlloc=8192\nMinMemAlloc=2048\n");

                // Minimal mmc-pack.json
                var components = new JsonArray();
                components.Add(new JsonObject { ["uid"] = "net.minecraft", ["version"] = mc });
                if (loader == "NeoForge")
                    components.Add(new JsonObject { ["uid"] = "net.neoforged",    ["version"] = loaderVer });
                else if (loader == "Forge")
                    components.Add(new JsonObject { ["uid"] = "net.minecraftforge",["version"] = loaderVer });
                else if (loader == "Fabric")
                    components.Add(new JsonObject { ["uid"] = "net.fabricmc.fabric-loader", ["version"] = loaderVer });
                File.WriteAllText(Path.Combine(instanceDir, "mmc-pack.json"),
                    new JsonObject { ["components"] = components, ["formatVersion"] = 1 }.ToJsonString());

                // Extract ZIP contents into minecraft/
                Push("importProgress", new { phase = "extract", message = "Extracting files…" });
                using (var archive = System.IO.Compression.ZipFile.OpenRead(zipPath))
                {
                    foreach (var entry in archive.Entries)
                    {
                        if (entry.FullName == "cryo-modpack.json" || entry.FullName == "modrinth.index.json") continue;
                        if (entry.FullName.EndsWith('/')) continue;  // directory entry
                        var dest = Path.GetFullPath(Path.Combine(mcDir, entry.FullName));
                        if (!dest.StartsWith(mcDir)) continue;  // path traversal guard
                        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                        entry.ExtractToFile(dest, overwrite: true);
                    }
                }

                // Register in Cryo's instance list + the live manager (so it shows without restart)
                if (_config.Data.Instances.All(e => e.Id != id))
                {
                    var entry = new InstanceEntry { Id = id, DisplayName = name };
                    _config.Data.Instances.Add(entry);
                    _config.Save();
                    _manager.AddEntry(entry);
                }

                Logger.Info($"ImportModpack: created '{id}' ({name}) from {zipPath}");
                Push("importDone", new { ok = true, id, name });
            }
            catch (Exception e)
            {
                Logger.Warn($"ImportModpack: {e.Message}");
                Push("importDone", new { ok = false, error = e.Message });
            }
        });
        return new { ok = true };
    }

    // ── Server list ──────────────────────────────────────────────────────────

    private string ServersDatPath(string instanceId)
        => Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "servers.dat");

    private object GetServers(string instanceId)
    {
        var servers = ServerListClient.ReadServersDat(ServersDatPath(instanceId));
        return new { servers = servers.Select(s => new { name = s.Name, ip = s.Ip }).ToArray() };
    }

    private async Task<object?> PingServerAsync(string ip)
    {
        var st = await ServerListClient.PingAsync(ip);
        return new
        {
            online     = st.Online,
            motd       = st.Motd,
            players    = st.Players,
            maxPlayers = st.MaxPlayers,
            version    = st.Version,
            latencyMs  = st.LatencyMs,
            error      = st.Error,
        };
    }

    private object AddServer(string instanceId, string name, string ip)
    {
        try
        {
            var path    = ServersDatPath(instanceId);
            var servers = ServerListClient.ReadServersDat(path);
            if (servers.Any(s => string.Equals(s.Ip, ip, StringComparison.OrdinalIgnoreCase)))
                return new { ok = false, error = "Server already in the list" };
            servers.Add(new ServerEntry { Name = string.IsNullOrWhiteSpace(name) ? ip : name, Ip = ip });
            ServerListClient.WriteServersDat(path, servers);
            Logger.Info($"AddServer({instanceId}): {name} = {ip}");
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    private object RemoveServer(string instanceId, string ip)
    {
        try
        {
            var path    = ServersDatPath(instanceId);
            var servers = ServerListClient.ReadServersDat(path);
            servers.RemoveAll(s => string.Equals(s.Ip, ip, StringComparison.OrdinalIgnoreCase));
            ServerListClient.WriteServersDat(path, servers);
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    // ── World Backups ──────────────────────────────────────────────────────────

    private static string BackupDir(string instanceId) =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                     "VSpeedLauncher", "backups", instanceId);

    /// <summary>Snapshots the whole saves/ folder before launch (opt-in), keeping the
    /// 5 most recent auto-backups. Runs inline so the snapshot exists before the game starts.</summary>
    private void AutoBackupWorlds(string id)
    {
        try
        {
            var saves = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "saves");
            if (!Directory.Exists(saves) || !Directory.EnumerateDirectories(saves).Any()) return;
            var backupDir = BackupDir(id);
            Directory.CreateDirectory(backupDir);
            var zip = Path.Combine(backupDir, "auto-" + DateTimeOffset.Now.ToString("yyyy-MM-dd_HH-mm-ss") + ".zip");
            System.IO.Compression.ZipFile.CreateFromDirectory(saves, zip);
            Logger.Info($"AutoBackup({id}): {zip}");
            foreach (var f in Directory.GetFiles(backupDir, "auto-*.zip").OrderByDescending(f => f).Skip(5))
                try { File.Delete(f); } catch { }
        }
        catch (Exception e) { Logger.Warn($"AutoBackup({id}): {e.Message}"); }
    }

    // ── Screenshots ──────────────────────────────────────────────────────────────
    private object GetScreenshots(string id)
    {
        var dir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "screenshots");
        if (!Directory.Exists(dir)) return new { ok = true, shots = Array.Empty<object>() };
        var shots = new List<object>();
        foreach (var f in Directory.GetFiles(dir, "*.png")
                     .Select(p => new FileInfo(p))
                     .OrderByDescending(p => p.LastWriteTimeUtc)
                     .Take(120))
        {
            string thumb = "";
            try { thumb = MakeThumbDataUri(f.FullName, 420); }
            catch (Exception e) { Logger.Warn($"Screenshot thumb {f.Name}: {e.Message}"); }
            shots.Add(new
            {
                file   = f.Name,
                thumb,
                sizeKb = (int)(f.Length / 1024),
                when   = f.LastWriteTime.ToString("yyyy-MM-dd HH:mm"),
            });
        }
        return new { ok = true, shots };
    }

    /// <summary>Decodes a PNG, downscales it, and returns a JPEG <c>data:</c> URI thumbnail.
    /// Reliable in WebView2 (no virtual-host / cross-origin pitfalls that hid the images).</summary>
    private static string MakeThumbDataUri(string path, int maxW)
    {
        using var src = System.Drawing.Image.FromFile(path);
        double scale = src.Width > maxW ? (double)maxW / src.Width : 1.0;
        int tw = Math.Max(1, (int)(src.Width * scale)), th = Math.Max(1, (int)(src.Height * scale));
        using var bmp = new System.Drawing.Bitmap(tw, th);
        using (var g = System.Drawing.Graphics.FromImage(bmp))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.DrawImage(src, 0, 0, tw, th);
        }
        using var ms = new MemoryStream();
        var enc = System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders()
            .First(c => c.FormatID == System.Drawing.Imaging.ImageFormat.Jpeg.Guid);
        using var ep = new System.Drawing.Imaging.EncoderParameters(1);
        ep.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
        bmp.Save(ms, enc, ep);
        return "data:image/jpeg;base64," + Convert.ToBase64String(ms.ToArray());
    }

    private object DeleteScreenshot(string id, string file)
    {
        try
        {
            if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
            var dir  = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "screenshots");
            var path = Path.Combine(dir, Path.GetFileName(file ?? ""));
            if (!IsContained(dir, path)) return new { ok = false, error = "Invalid path." };
            if (File.Exists(path)) File.Delete(path);
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    private object OpenScreenshot(string id, string file)
    {
        try
        {
            if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
            var dir  = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "screenshots");
            var path = Path.Combine(dir, Path.GetFileName(file ?? ""));
            if (!IsContained(dir, path)) return new { ok = false, error = "Invalid path." };
            if (File.Exists(path)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo { FileName = path, UseShellExecute = true });
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    private object GetWorlds(string instanceId)
    {
        var savesDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "saves");
        if (!Directory.Exists(savesDir)) return new { worlds = Array.Empty<object>() };
        var worlds = Directory.EnumerateDirectories(savesDir)
            .Select(d => new DirectoryInfo(d))
            .OrderByDescending(di => di.LastWriteTime)
            .Select(di =>
            {
                long sizeBytes = 0;
                try { sizeBytes = di.EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length); } catch { }
                return (object)new
                {
                    name     = di.Name,
                    sizeBytes,
                    modified = new DateTimeOffset(di.LastWriteTime).ToUnixTimeMilliseconds(),
                };
            })
            .ToArray();
        return new { worlds };
    }

    private object BackupWorld(string instanceId, string worldName)
    {
        _ = Task.Run(() =>
        {
            try
            {
                var worldDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "saves", worldName);
                if (!Directory.Exists(worldDir)) throw new DirectoryNotFoundException($"World '{worldName}' not found");

                var backupDir = BackupDir(instanceId);
                Directory.CreateDirectory(backupDir);
                var ts      = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd_HH-mm-ss");
                var zipPath = Path.Combine(backupDir, worldName + "_" + ts + ".zip");

                Push("backupProgress", new { phase = "start", worldName, message = $"Backing up '{worldName}'…" });
                System.IO.Compression.ZipFile.CreateFromDirectory(worldDir, zipPath);
                var size = new FileInfo(zipPath).Length;
                Logger.Info($"BackupWorld({instanceId}/{worldName}): {zipPath} ({size} bytes)");
                Push("backupDone", new { ok = true, worldName, file = Path.GetFileName(zipPath), sizeBytes = size });
            }
            catch (Exception e)
            {
                Logger.Warn($"BackupWorld({instanceId}/{worldName}): {e.Message}");
                Push("backupError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    private object GetBackups(string instanceId)
    {
        var dir = BackupDir(instanceId);
        if (!Directory.Exists(dir)) return new { backups = Array.Empty<object>() };
        var backups = Directory.GetFiles(dir, "*.zip")
            .Select(f => new FileInfo(f))
            .OrderByDescending(fi => fi.LastWriteTime)
            .Select(fi => (object)new
            {
                file      = fi.Name,
                sizeBytes = fi.Length,
                modified  = new DateTimeOffset(fi.LastWriteTime).ToUnixTimeMilliseconds(),
            })
            .ToArray();
        return new { backups };
    }

    private object RestoreBackup(string instanceId, string file)
    {
        _ = Task.Run(() =>
        {
            try
            {
                var zipPath = Path.Combine(BackupDir(instanceId), Path.GetFileName(file));
                if (!File.Exists(zipPath)) throw new FileNotFoundException("Backup not found: " + file);

                // Derive world name from filename: "MyWorld_2024-01-01_12-00-00.zip" → "MyWorld"
                var worldName  = Path.GetFileNameWithoutExtension(file);
                var dateIdx    = System.Text.RegularExpressions.Regex.Match(worldName, @"_\d{4}-\d{2}-\d{2}_");
                if (dateIdx.Success) worldName = worldName[..dateIdx.Index];

                var destDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "saves", worldName + "_restore");
                if (Directory.Exists(destDir)) Directory.Delete(destDir, recursive: true);

                Push("backupProgress", new { phase = "start", worldName, message = $"Restoring '{worldName}'…" });
                System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, destDir);
                Logger.Info($"RestoreBackup({instanceId}): {file} → {destDir}");
                Push("backupDone", new { ok = true, worldName, restoredAs = worldName + "_restore" });
            }
            catch (Exception e)
            {
                Logger.Warn($"RestoreBackup({instanceId}/{file}): {e.Message}");
                Push("backupError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    private object DeleteBackup(string instanceId, string file)
    {
        var path = Path.Combine(BackupDir(instanceId), Path.GetFileName(file));
        try { if (File.Exists(path)) File.Delete(path); }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
        return new { ok = true };
    }

    private object OpenWorldsFolder(string instanceId)
    {
        var dir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft", "saves");
        if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
        System.Diagnostics.Process.Start("explorer.exe", dir);
        return new { ok = true };
    }

    // ── AI Memory ─────────────────────────────────────────────────────────────

    private static string AiMemoryPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                     "VSpeedLauncher", "ai-memory.json");

    private static List<JsonObject> LoadMemory()
    {
        try
        {
            if (File.Exists(AiMemoryPath))
            {
                var arr = JsonNode.Parse(File.ReadAllText(AiMemoryPath)) as JsonArray;
                return arr?.Select(n => n as JsonObject).Where(n => n != null).Cast<JsonObject>().ToList()
                       ?? new List<JsonObject>();
            }
        }
        catch { /* ignore */ }
        return new List<JsonObject>();
    }

    private static void WriteMemory(List<JsonObject> list)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(AiMemoryPath)!);
            var arr = new JsonArray();
            foreach (var e in list) arr.Add(JsonNode.Parse(e.ToJsonString()));
            File.WriteAllText(AiMemoryPath, arr.ToJsonString());
        }
        catch (Exception ex) { Logger.Warn($"AI memory write: {ex.Message}"); }
    }

    private object SaveAiMemory(string instanceId, string problem, string solution, JsonNode? actionsNode)
    {
        if (string.IsNullOrWhiteSpace(problem)) return new { ok = false };
        var list = LoadMemory();
        // Remove duplicates for the same problem on this instance (keep freshest)
        list.RemoveAll(e => e["instanceId"]?.GetValue<string>() == instanceId
                         && e["problem"]?.GetValue<string>() == problem);
        var entry = new JsonObject
        {
            ["instanceId"] = instanceId,
            ["problem"]    = Trunc(problem, 400),
            ["solution"]   = Trunc(solution, 800),
            ["timestamp"]  = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
        if (actionsNode != null) entry["actions"] = JsonNode.Parse(actionsNode.ToJsonString());
        list.Insert(0, entry);
        if (list.Count > 60) list.RemoveRange(60, list.Count - 60);
        WriteMemory(list);
        return new { ok = true };
    }

    private object GetAiMemory(string instanceId)
    {
        var list = LoadMemory();
        var filtered = string.IsNullOrEmpty(instanceId)
            ? list
            : list.Where(e => e["instanceId"]?.GetValue<string>() == instanceId).ToList();
        // Return last 20 for UI
        return new { entries = filtered.Take(20).Select(e => new {
            instanceId = e["instanceId"]?.GetValue<string>() ?? "",
            problem    = e["problem"]?.GetValue<string>() ?? "",
            solution   = e["solution"]?.GetValue<string>() ?? "",
            timestamp  = e["timestamp"]?.GetValue<long>() ?? 0L,
        }).ToArray() };
    }

    private object ClearAiMemory(string instanceId)
    {
        if (string.IsNullOrEmpty(instanceId))
        {
            try { if (File.Exists(AiMemoryPath)) File.Delete(AiMemoryPath); } catch { }
        }
        else
        {
            var list = LoadMemory();
            list.RemoveAll(e => e["instanceId"]?.GetValue<string>() == instanceId);
            WriteMemory(list);
        }
        return new { ok = true };
    }

    private string BuildAiContext(JsonNode args)
    {
        var attach = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (args["attach"] is JsonArray a)
            foreach (var x in a) { var s = x?.GetValue<string>(); if (s != null) attach.Add(s); }
        if (attach.Count == 0) return "";

        var sb = new System.Text.StringBuilder();

        // Launcher's own log — not instance-specific, useful for diagnosing the launcher itself.
        if (attach.Contains("launcher"))
            try
            {
                var lp = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "launcher.log");
                if (File.Exists(lp))
                {
                    var ll = File.ReadLines(lp).ToList();
                    sb.AppendLine("## Cryo launcher log (last lines) — for diagnosing the LAUNCHER itself");
                    sb.AppendLine(string.Join("\n", ll.Skip(Math.Max(0, ll.Count - 110))));
                }
            }
            catch { /* ignore */ }

        var id = args["instanceId"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(id))
        {
            var only = sb.ToString();
            return only.Length > 12000 ? only[..12000] + "\n…(truncated)" : only;
        }

        var dir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft");
        sb.AppendLine($"\n# Context for instance \"{id}\" (only use facts from here; do not invent file names)");

        // Runtime state + an explicit verdict — the single most important signal so the
        // assistant stops calling a perfectly-working pack ""broken"" off a stray warning.
        try
        {
            var meta0 = InstanceMetaReader.Read(id, InstanceDataDir(id));
            var st    = _manager.FindById(id)?.State.ToString().ToLowerInvariant() ?? "stopped";
            sb.AppendLine($"Loader: {(string.IsNullOrEmpty(meta0.Loader) ? "Vanilla" : meta0.Loader)} {meta0.LoaderVer}; Minecraft {meta0.Mc}; launcher state: {st}.");
            if (st is "loading" or "ready" or "waking" or "hibernated")
                sb.AppendLine("VERDICT: the game is currently RUNNING / launching — it is WORKING. Do NOT suggest disabling or removing mods. Treat warnings and stack traces below as normal modded noise and just answer the user's actual question.");
            else if (st == "crashed")
                sb.AppendLine("VERDICT: the launcher reports this instance CRASHED during startup. Find the real cause in the crash report / log tail and name the exact evidence before proposing any fix.");
            else
                sb.AppendLine("VERDICT: the game is not currently running. Diagnose a failure ONLY if there is a RECENT crash report or a clear fatal error below; otherwise the warnings are normal — answer the question, don't recommend removing mods.");
        }
        catch { /* ignore */ }

        // AI Memory — inject past solutions so the AI doesn't repeat itself
        try
        {
            var mem = LoadMemory()
                .Where(e => e["instanceId"]?.GetValue<string>() == id)
                .Take(6)
                .ToList();
            if (mem.Count > 0)
            {
                sb.AppendLine("\n## Past fixes for this instance (AI memory — avoid repeating)");
                foreach (var e in mem)
                {
                    var ts  = DateTimeOffset.FromUnixTimeMilliseconds(e["timestamp"]?.GetValue<long>() ?? 0).ToString("yyyy-MM-dd");
                    var prb = e["problem"]?.GetValue<string>() ?? "";
                    var sol = e["solution"]?.GetValue<string>() ?? "";
                    sb.AppendLine($"- [{ts}] Problem: \"{prb}\" → Fix: \"{sol}\"");
                }
            }
        }
        catch { /* ignore */ }

        if (attach.Contains("mods"))
            try
            {
                var modsDir = Path.Combine(dir, "mods");
                if (Directory.Exists(modsDir))
                {
                    var enabled  = Directory.EnumerateFiles(modsDir, "*.jar").Select(Path.GetFileName).Where(n => n != null).ToList();
                    var disabled = Directory.EnumerateFiles(modsDir, "*.jar.disabled").Select(Path.GetFileName).Where(n => n != null).ToList();
                    sb.AppendLine($"\n## Mods — {enabled.Count} enabled, {disabled.Count} disabled");
                    sb.AppendLine("Enabled: " + string.Join(", ", enabled.Take(140)) + (enabled.Count > 140 ? $" …(+{enabled.Count - 140} more)" : ""));
                    if (disabled.Count > 0) sb.AppendLine("Disabled: " + string.Join(", ", disabled.Take(60)));
                }
            }
            catch { /* ignore */ }

        if (attach.Contains("logs"))
            try
            {
                var log = Path.Combine(dir, "logs", "latest.log");
                if (File.Exists(log))
                {
                    var lines = File.ReadLines(log).ToList();
                    var tail  = lines.Skip(Math.Max(0, lines.Count - 140));
                    sb.AppendLine("\n## latest.log (last lines)");
                    sb.AppendLine(string.Join("\n", tail));
                }
            }
            catch { /* ignore */ }

        if (attach.Contains("crash"))
            try
            {
                var crashDir = Path.Combine(dir, "crash-reports");
                if (Directory.Exists(crashDir))
                {
                    var latest = new DirectoryInfo(crashDir).GetFiles("*.txt")
                                    .OrderByDescending(f => f.LastWriteTime).FirstOrDefault();
                    if (latest != null)
                    {
                        var ageMin  = (DateTime.Now - latest.LastWriteTime).TotalMinutes;
                        var ageNote = ageMin > 120
                            ? $" — ⚠ ~{Math.Round(ageMin / 60)}h old; likely from a PREVIOUS session and probably UNRELATED to the current state — do not assume it explains a running game"
                            : $" — {Math.Round(ageMin)} min old";
                        sb.AppendLine($"\n## Latest crash report — {latest.Name}{ageNote}");
                        sb.AppendLine(string.Join("\n", File.ReadLines(latest.FullName).Take(120)));
                    }
                }
            }
            catch { /* ignore */ }

        var full = sb.ToString();
        return full.Length > 12000 ? full[..12000] + "\n…(truncated)" : full;
    }

    private static string Trunc(string s, int n) => string.IsNullOrEmpty(s) ? "" : (s.Length <= n ? s : s[..n] + "…");

    // ── Launcher self-diagnostics ──────────────────────────────────────────────
    [DllImport("kernel32.dll")]
    private static extern bool GetPhysicallyInstalledSystemMemory(out long totalMemoryInKilobytes);

    private int ReadRamMax(string instDir)
    {
        try
        {
            var cfg = Path.Combine(instDir, "instance.cfg");
            if (!File.Exists(cfg)) return 0;
            foreach (var l in File.ReadLines(cfg))
                if (l.StartsWith("MaxMemAlloc=", StringComparison.OrdinalIgnoreCase) && int.TryParse(l[12..].Trim(), out var v)) return v;
        }
        catch { /* ignore */ }
        return 0;
    }

    /// <summary>Inspects the launcher's own health and returns checks with optional 1-click fixes.</summary>
    private object SelfCheck()
    {
        var checks = new List<object>();
        int nok = 0, nwarn = 0, nfail = 0;
        void Add(string id, string title, string status, string detail, object? fix = null)
        {
            checks.Add(new { id, title, status, detail, fix });
            if (status == "ok") nok++; else if (status == "warn") nwarn++; else nfail++;
        }

        var data = _config.Data.InstanceRoots.Count > 0 ? _config.Data.InstanceRoots[0] : _prismDataDir;

        // PrismLauncher executable + data dir
        var prism = _config.Data.PrismExe;
        Add("prism", "PrismLauncher executable", !string.IsNullOrWhiteSpace(prism) && File.Exists(prism) ? "ok" : "fail",
            !string.IsNullOrWhiteSpace(prism) && File.Exists(prism) ? prism : (string.IsNullOrWhiteSpace(prism) ? "Not configured." : "Not found: " + prism));
        Add("datadir", "Instances folder", Directory.Exists(data) ? "ok" : "fail", Directory.Exists(data) ? data : "Missing: " + data);

        // WebView2 runtime
        try { Add("webview2", "WebView2 runtime", "ok", "v" + CoreWebView2Environment.GetAvailableBrowserVersionString()); }
        catch { Add("webview2", "WebView2 runtime", "warn", "Could not determine version."); }

        // AI assistant
        bool hasKey = !string.IsNullOrWhiteSpace(_config.Data.AiApiKey);
        bool local  = (_config.Data.AiBaseUrl ?? "").Contains("localhost");
        Add("ai", "AI assistant", hasKey || local ? "ok" : "warn",
            (hasKey || local ? "Configured · " : "No API key · ") + _config.Data.AiModel,
            hasKey || local ? null : new { type = "openSettings", label = "Add key" });

        // System RAM + disk
        long ramKb = 0; try { GetPhysicallyInstalledSystemMemory(out ramKb); } catch { }
        int sysMb = (int)(ramKb / 1024);
        try
        {
            var root = Path.GetPathRoot(data);
            if (!string.IsNullOrEmpty(root) && Directory.Exists(root))
            {
                double freeGb = new DriveInfo(root).AvailableFreeSpace / 1073741824.0;
                Add("disk", "Free disk space", freeGb < 5 ? "warn" : "ok", $"{freeGb:0.0} GB free on {root}");
            }
        }
        catch { /* ignore */ }

        // Per-instance: folder, VSpeed mod, RAM sanity
        foreach (var inst in _config.Data.Instances)
        {
            var dir = Path.Combine(data, "instances", inst.Id);
            if (!Directory.Exists(dir)) { Add("inst:" + inst.Id, inst.DisplayName, "warn", "Folder missing"); continue; }

            var modsDir = Path.Combine(dir, "minecraft", "mods");
            bool hasMod = Directory.Exists(modsDir) && Directory.EnumerateFiles(modsDir, "vspeed*").Any();
            int ramMax  = ReadRamMax(dir);

            var notes = new List<string>();
            string status = "ok";
            object? fix = null;
            if (!hasMod) { notes.Add("VSpeed mod not installed (optimizer inactive)"); status = "warn"; fix = new { type = "openModsFolder", label = "Open mods folder", args = new { id = inst.Id } }; }
            if (sysMb > 0 && ramMax > 0 && ramMax > sysMb * 0.8)
            {
                int safe = Math.Max(2, (int)(sysMb * 0.6 / 1024)) * 1024;
                notes.Add($"RAM {ramMax / 1024.0:0.0}G exceeds 80% of {sysMb / 1024.0:0.0}G system");
                status = "warn";
                fix = new { type = "setRam", label = $"Set to {safe / 1024}G", args = new { id = inst.Id, ramMax = safe } };
            }
            Add("inst:" + inst.Id, inst.DisplayName, status,
                notes.Count > 0 ? string.Join(" · ", notes) : ("Healthy" + (ramMax > 0 ? $" · RAM {ramMax / 1024.0:0.0}G" : "")), fix);
        }

        // Launcher's own log errors
        try
        {
            var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "launcher.log");
            if (File.Exists(logPath))
            {
                var errs = File.ReadLines(logPath).Where(l => l.Contains(" ERROR ")).ToList();
                if (errs.Count == 0) Add("log", "Launcher log", "ok", "No errors logged.");
                else Add("log", "Launcher log", "warn", $"{errs.Count} error(s). Last: " + Trunc(errs[^1], 120), new { type = "openLauncherLog", label = "Open log" });
            }
        }
        catch { /* ignore */ }

        return new { checks, summary = new { ok = nok, warn = nwarn, fail = nfail } };
    }

    private object OpenLauncherLog()
    {
        try
        {
            var p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "launcher.log");
            if (File.Exists(p)) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(p) { UseShellExecute = true });
            return new { ok = true };
        }
        catch (Exception e) { return new { ok = false, error = e.Message }; }
    }

    // ── Mod conflict scanner ───────────────────────────────────────────────────
    private static readonly Regex _modIdRe    = new("^\\s*modId\\s*=\\s*\"([^\"]+)\"", RegexOptions.Compiled);
    private static readonly Regex _fabricIdRe = new("\"id\"\\s*:\\s*\"([^\"]+)\"", RegexOptions.Compiled);

    /// <summary>
    /// Reads a jar's OWN mod id(s) — the modId under [[mods]] only. Dependency
    /// sections ([[dependencies.x]] → modId="minecraft"/"neoforge"/parent mod) are
    /// ignored, otherwise every mod looks like a duplicate of its platform deps.
    /// </summary>
    private static List<string> ReadModIds(string jarPath)
    {
        try { using var z = ZipFile.OpenRead(jarPath); return ReadModIdsFromZip(z); }
        catch { return new List<string>(); }
    }

    /// <summary>Reads the own modId(s) declared in an open jar archive
    /// (neoforge/forge mods.toml [[mods]] or fabric.mod.json).</summary>
    private static List<string> ReadModIdsFromZip(ZipArchive z)
    {
        var ids = new List<string>();
        var toml = z.GetEntry("META-INF/neoforge.mods.toml") ?? z.GetEntry("META-INF/mods.toml");
        if (toml != null)
        {
            using var r = new StreamReader(toml.Open());
            bool inMods = false;
            string? line;
            while ((line = r.ReadLine()) != null)
            {
                var t = line.TrimStart();
                if (t.StartsWith("[["))      { inMods = t.StartsWith("[[mods]]", StringComparison.OrdinalIgnoreCase); continue; }
                if (t.StartsWith("["))       { inMods = false; continue; }
                if (!inMods) continue;
                var m = _modIdRe.Match(line);
                if (m.Success) ids.Add(m.Groups[1].Value);
            }
        }
        else
        {
            var fab = z.GetEntry("fabric.mod.json");
            if (fab != null)
            {
                using var r = new StreamReader(fab.Open());
                var m = _fabricIdRe.Match(r.ReadToEnd());
                if (m.Success) ids.Add(m.Groups[1].Value);
            }
        }
        return ids;
    }

    /// <summary>Collects modIds provided by jars BUNDLED inside a mod jar — Forge/
    /// NeoForge JarJar (META-INF/jarjar/*.jar) and Fabric nested jars
    /// (META-INF/jars/*.jar). These satisfy dependencies even though they're not
    /// separate files in mods/, so the dependency check must count them (otherwise
    /// it falsely reports bundled libraries as "missing").</summary>
    private static HashSet<string> CollectNestedModIds(string jarPath)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var z = ZipFile.OpenRead(jarPath);
            foreach (var e in z.Entries)
            {
                var n = e.FullName.Replace('\\', '/');
                if (!n.EndsWith(".jar", StringComparison.OrdinalIgnoreCase)) continue;
                if (!(n.StartsWith("META-INF/jarjar/", StringComparison.OrdinalIgnoreCase) ||
                      n.StartsWith("META-INF/jars/", StringComparison.OrdinalIgnoreCase))) continue;
                try
                {
                    using var ms = new MemoryStream();
                    using (var es = e.Open()) es.CopyTo(ms);
                    ms.Position = 0;
                    using var nz = new ZipArchive(ms, ZipArchiveMode.Read);
                    foreach (var id in ReadModIdsFromZip(nz)) set.Add(id);
                }
                catch { /* skip an unreadable nested jar */ }
            }
        }
        catch { /* ignore */ }
        return set;
    }

    // Platform / loader ids that are never user-managed jars (safety net for odd metadata).
    private static readonly HashSet<string> _ignoreModIds = new(StringComparer.OrdinalIgnoreCase)
        { "minecraft", "forge", "neoforge", "fml", "fabricloader", "fabric", "java", "mixinextras", "mixin" };

    private static readonly Regex _depModRe   = new("^\\s*modId\\s*=\\s*\"([^\"]+)\"", RegexOptions.Compiled);
    private static readonly Regex _depTypeRe  = new("^\\s*type\\s*=\\s*\"([^\"]+)\"", RegexOptions.Compiled);
    private static readonly Regex _depMandRe  = new("^\\s*mandatory\\s*=\\s*(true|false)", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex _depRangeRe = new("^\\s*versionRange\\s*=\\s*\"([^\"]+)\"", RegexOptions.Compiled);

    private sealed class ModDep { public string Target = ""; public bool Required = true; public string Range = ""; }
    private sealed class ModGraphInfo { public List<string> OwnIds = new(); public List<ModDep> Deps = new(); }

    /// <summary>Reads a jar's own modId(s) plus its declared dependencies
    /// (from [[dependencies.*]] in neoforge/forge mods.toml).</summary>
    private static ModGraphInfo ReadModGraphInfo(string jarPath)
    {
        var info = new ModGraphInfo();
        try
        {
            using var z = ZipFile.OpenRead(jarPath);
            var toml = z.GetEntry("META-INF/neoforge.mods.toml") ?? z.GetEntry("META-INF/mods.toml");
            if (toml == null)
            {
                // Fabric: read own id only (dependency graph for Fabric isn't parsed here).
                var fab = z.GetEntry("fabric.mod.json");
                if (fab != null)
                {
                    using var fr = new StreamReader(fab.Open());
                    var m = _fabricIdRe.Match(fr.ReadToEnd());
                    if (m.Success) info.OwnIds.Add(m.Groups[1].Value);
                }
                return info;
            }

            using var r = new StreamReader(toml.Open());
            string section = "";        // "mods" | "dep" | other
            ModDep? cur = null;
            string? line;
            while ((line = r.ReadLine()) != null)
            {
                var t = line.TrimStart();
                if (t.StartsWith("[["))
                {
                    if (cur != null && !string.IsNullOrEmpty(cur.Target)) { info.Deps.Add(cur); cur = null; }
                    if (t.StartsWith("[[mods]]", StringComparison.OrdinalIgnoreCase)) section = "mods";
                    else if (t.StartsWith("[[dependencies.", StringComparison.OrdinalIgnoreCase)) { section = "dep"; cur = new ModDep(); }
                    else section = "other";
                    continue;
                }
                if (t.StartsWith("["))
                {
                    if (cur != null && !string.IsNullOrEmpty(cur.Target)) { info.Deps.Add(cur); cur = null; }
                    section = "other";
                    continue;
                }

                if (section == "mods")
                {
                    var m = _modIdRe.Match(line);
                    if (m.Success) info.OwnIds.Add(m.Groups[1].Value);
                }
                else if (section == "dep" && cur != null)
                {
                    var mm = _depModRe.Match(line);   if (mm.Success) { cur.Target = mm.Groups[1].Value; continue; }
                    var tt = _depTypeRe.Match(line);  if (tt.Success) { cur.Required = tt.Groups[1].Value.Equals("required", StringComparison.OrdinalIgnoreCase); continue; }
                    var md = _depMandRe.Match(line);  if (md.Success) { cur.Required = md.Groups[1].Value.Equals("true", StringComparison.OrdinalIgnoreCase); continue; }
                    var rg = _depRangeRe.Match(line); if (rg.Success) { cur.Range = rg.Groups[1].Value; continue; }
                }
            }
            if (cur != null && !string.IsNullOrEmpty(cur.Target)) info.Deps.Add(cur);
        }
        catch { /* ignore unreadable jars */ }
        return info;
    }

    /// <summary>Groups enabled jars by declared modId and flags duplicates (same mod, multiple jars).</summary>
    private object ScanMods(string id)
    {
        var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
        if (!Directory.Exists(modsDir)) return new { ok = false, error = "No mods folder for this instance." };

        var byId = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        int total = 0, unknown = 0;
        foreach (var jar in Directory.EnumerateFiles(modsDir, "*.jar"))
        {
            total++;
            var ids = ReadModIds(jar);
            if (ids.Count == 0) { unknown++; continue; }
            foreach (var mid in ids)
            {
                if (!byId.TryGetValue(mid, out var l)) byId[mid] = l = new List<string>();
                l.Add(Path.GetFileName(jar)!);
            }
        }

        var duplicates = byId.Where(kv => kv.Value.Count > 1 && !_ignoreModIds.Contains(kv.Key))
            .Select(kv => new { modId = kv.Key, files = kv.Value })
            .OrderBy(d => d.modId).ToList();

        return new { ok = true, total, unknown, duplicates };
    }

    /// <summary>
    /// Builds a dependency graph from every jar's mods.toml and flags problems
    /// BEFORE launch: required dependencies that are missing or only present as a
    /// disabled jar. Returns nodes + edges for a focused visualization of the issues.
    /// </summary>
    private object AnalyzeModGraph(string id)
    {
        var modsDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "mods");
        if (!Directory.Exists(modsDir)) return new { ok = false, error = "No mods folder for this instance." };

        // Map enabled + disabled modIds → primary name; collect deps per owner.
        var enabledIds  = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);  // modId → file
        var disabledIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var owners      = new List<(string ownerId, string file, ModGraphInfo info)>();
        // Every modId actually AVAILABLE to satisfy a dependency: each enabled jar's
        // own id(s) PLUS ids bundled inside it (JarJar / nested jars). Using this set
        // (not just top-level jar ids) is what stops the bogus "missing dependency"
        // reports for libraries that ship embedded in another mod.
        var available   = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var jar in Directory.EnumerateFiles(modsDir, "*.jar"))
        {
            foreach (var nid in CollectNestedModIds(jar)) available.Add(nid);   // bundled libs count
            var info = ReadModGraphInfo(jar);
            if (info.OwnIds.Count == 0) continue;
            var primary = info.OwnIds[0];
            enabledIds[primary] = Path.GetFileName(jar)!;
            owners.Add((primary, Path.GetFileName(jar)!, info));
            foreach (var oid in info.OwnIds) available.Add(oid);
        }
        foreach (var jar in Directory.EnumerateFiles(modsDir, "*.jar.disabled"))
        {
            var info = ReadModGraphInfo(jar);
            foreach (var oid in info.OwnIds) disabledIds[oid] = Path.GetFileName(jar)!;
        }

        var issues = new List<object>();
        var edges  = new List<object>();
        var involved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (ownerId, file, info) in owners)
            foreach (var dep in info.Deps)
            {
                if (_ignoreModIds.Contains(dep.Target)) continue;     // platform deps are always present
                bool present  = available.Contains(dep.Target);       // top-level OR JarJar-bundled
                bool disabled = !present && disabledIds.ContainsKey(dep.Target);

                if (present)
                {
                    edges.Add(new { from = ownerId, to = dep.Target, required = dep.Required, ok = true });
                }
                else if (dep.Required)
                {
                    involved.Add(ownerId); involved.Add(dep.Target);
                    edges.Add(new { from = ownerId, to = dep.Target, required = true, ok = false });
                    issues.Add(new
                    {
                        type     = disabled ? "disabled" : "missing",
                        severity = "error",
                        mod      = ownerId,
                        modFile  = file,
                        dep      = dep.Target,
                        versionRange = dep.Range,
                        message  = disabled
                            ? $"{ownerId} requires {dep.Target}, but it's installed as a DISABLED jar."
                            : $"{ownerId} requires {dep.Target}{(string.IsNullOrEmpty(dep.Range) ? "" : " " + dep.Range)}, which is not installed.",
                    });
                }
            }

        var nodes = enabledIds.Keys
            .Select(k => new { id = k, file = enabledIds[k], installed = true, involved = involved.Contains(k) })
            .Concat(involved.Where(k => !enabledIds.ContainsKey(k))
                .Select(k => new { id = k, file = "", installed = false, involved = true }))
            .ToList<object>();

        return new
        {
            ok = true,
            nodeCount = enabledIds.Count,
            edgeCount = edges.Count,
            issueCount = issues.Count,
            issues,
            nodes,
            edges,
        };
    }

    // ── Cryo Engine — NeoForge install + launch without Prism ────────────────

    private static string EngineRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                     "VSpeedLauncher", "game");

    /// <summary>Maps a Minecraft version to the Java major version it requires
    /// (matches Mojang's bundled runtimes). Used to gate Java-version-specific flags.</summary>
    private static int JavaMajorForMc(string mc)
    {
        // Parse "1.MINOR(.PATCH)"
        var parts = (mc ?? "").Split('.');
        if (parts.Length < 2 || !int.TryParse(parts[1], out var minor)) return 21;  // assume modern
        int patch = parts.Length >= 3 && int.TryParse(parts[2], out var p) ? p : 0;
        if (minor >= 21) return 21;
        if (minor == 20) return patch >= 5 ? 21 : 17;   // 1.20.5+ → Java 21
        if (minor >= 18) return 17;                       // 1.18–1.20.4 → Java 17
        if (minor == 17) return 16;                       // 1.17 → Java 16
        return 8;                                         // ≤ 1.16 → Java 8
    }

    /// <summary>Game args that make Minecraft connect to a server on launch.
    /// 1.20+ uses --quickPlayMultiplayer; older versions use --server/--port.</summary>
    private static List<CmlLib.Core.ProcessBuilder.MArgument> BuildJoinGameArgs(string mc, string ip)
    {
        var list = new List<CmlLib.Core.ProcessBuilder.MArgument>();
        ip = (ip ?? "").Trim();
        if (ip.Length == 0) return list;
        int minor = 0;
        var parts = (mc ?? "").Split('.');
        if (parts.Length >= 2) int.TryParse(parts[1], out minor);
        if (minor >= 20)   // 1.20+ — Quick Play (single address argument)
        {
            list.Add(CmlLib.Core.ProcessBuilder.MArgument.FromCommandLine("--quickPlayMultiplayer"));
            list.Add(CmlLib.Core.ProcessBuilder.MArgument.FromCommandLine(ip));
        }
        else               // legacy --server <host> --port <port>
        {
            string host = ip, port = "25565";
            var c = ip.LastIndexOf(':');
            if (c > 0 && c < ip.Length - 1) { host = ip[..c]; port = ip[(c + 1)..]; }
            list.Add(CmlLib.Core.ProcessBuilder.MArgument.FromCommandLine("--server"));
            list.Add(CmlLib.Core.ProcessBuilder.MArgument.FromCommandLine(host));
            list.Add(CmlLib.Core.ProcessBuilder.MArgument.FromCommandLine("--port"));
            list.Add(CmlLib.Core.ProcessBuilder.MArgument.FromCommandLine(port));
        }
        return list;
    }

    /// <summary>
    /// Finds an already-installed Mojang JRE (<c>javaw.exe</c>) matching a Java
    /// major version under the engine's runtime dir, or <c>null</c> if none is
    /// present yet (so the caller can let CmlLib download the right one).
    /// </summary>
    private static string? ResolveBundledJava(int major)
    {
        // Mojang runtime components → Java major. For 17 several components exist;
        // prefer the newest. (jre-legacy=8, alpha=16, beta/gamma=17, delta=21.)
        string[] components = major switch
        {
            >= 21 => new[] { "java-runtime-delta" },
            17    => new[] { "java-runtime-gamma", "java-runtime-gamma-snapshot", "java-runtime-beta" },
            16    => new[] { "java-runtime-alpha" },
            <= 8  => new[] { "jre-legacy" },
            _     => new[] { "java-runtime-delta", "java-runtime-gamma", "java-runtime-beta", "jre-legacy" },
        };
        var baseDir = Path.Combine(EngineRoot, "runtime", "windows-x64");
        foreach (var c in components)
            foreach (var exe in new[] { "javaw.exe", "java.exe" })  // prefer no-console javaw
            {
                var p = Path.Combine(baseDir, c, "bin", exe);
                if (File.Exists(p)) return p;
            }
        return null;
    }

    /// <summary>Reads the user-configured Java path (javaw.exe) from an instance's
    /// instance.cfg <c>[General]</c> section, or <c>""</c> if unset.</summary>
    private string ReadInstanceJavaPath(string instanceId)
    {
        var cfgPath = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "instance.cfg");
        if (!File.Exists(cfgPath)) return "";
        try
        {
            bool inGeneral = true;
            foreach (var raw in File.ReadAllLines(cfgPath))
            {
                var l = raw.Trim();
                if (l.StartsWith("[")) { inGeneral = l.Equals("[General]", StringComparison.OrdinalIgnoreCase); continue; }
                if (!inGeneral) continue;
                if (l.StartsWith("JavaPath=", StringComparison.OrdinalIgnoreCase))
                    return l["JavaPath=".Length..].Trim().Trim('"');
            }
        }
        catch { /* unreadable cfg → treat as unset */ }
        return "";
    }

    private sealed class JavaInfo
    {
        public string Path = ""; public string Version = ""; public int Major; public string Vendor = ""; public string Source = "";
    }

    /// <summary>Parses a Java version string ("1.8.0_412", "17.0.15", "21.0.1") into its major.</summary>
    private static int MajorFromVersion(string ver)
    {
        if (string.IsNullOrWhiteSpace(ver)) return 0;
        var parts = ver.Split('.', '_', '-', '+');
        if (parts.Length == 0) return 0;
        if (!int.TryParse(new string(parts[0].TakeWhile(char.IsDigit).ToArray()), out var first)) return 0;
        if (first == 1 && parts.Length >= 2 && int.TryParse(new string(parts[1].TakeWhile(char.IsDigit).ToArray()), out var second))
            return second;   // 1.8.0 → 8
        return first;        // 17.0.15 → 17
    }

    /// <summary>Reads version/vendor from a JRE's <c>release</c> file (sibling of bin/).</summary>
    private static (string version, int major, string vendor) ReadJavaRelease(string javawPath)
    {
        try
        {
            var home = Path.GetDirectoryName(Path.GetDirectoryName(javawPath)); // <home>/bin/javaw.exe → <home>
            var rel  = home == null ? null : Path.Combine(home, "release");
            if (rel != null && File.Exists(rel))
            {
                string ver = "", vendor = "";
                foreach (var line in File.ReadAllLines(rel))
                {
                    if (line.StartsWith("JAVA_VERSION="))    ver    = line["JAVA_VERSION=".Length..].Trim().Trim('"');
                    else if (line.StartsWith("IMPLEMENTOR=")) vendor = line["IMPLEMENTOR=".Length..].Trim().Trim('"');
                }
                return (ver, MajorFromVersion(ver), vendor);
            }
        }
        catch { }
        return ("", 0, "");
    }

    /// <summary>
    /// Discovers Java installations on this machine — Cryo's bundled Mojang
    /// runtimes, Prism's runtimes, common vendor install dirs, JAVA_HOME and PATH —
    /// and computes the Java major the given instance's Minecraft version needs.
    /// Powers the Settings → Java "Auto-detect" button and the picker list.
    /// </summary>
    private object DetectJavas(string instanceId)
    {
        var found = new Dictionary<string, JavaInfo>(StringComparer.OrdinalIgnoreCase);

        void Consider(string? javawPath, string source)
        {
            if (string.IsNullOrWhiteSpace(javawPath)) return;
            try
            {
                var full = Path.GetFullPath(javawPath);
                if (!File.Exists(full) || found.ContainsKey(full)) return;
                var (ver, major, vendor) = ReadJavaRelease(full);
                found[full] = new JavaInfo { Path = full, Version = ver, Major = major, Vendor = vendor, Source = source };
            }
            catch { }
        }
        void ScanContainer(string? dir, string source)   // scans <dir>/*/bin/javaw.exe
        {
            try
            {
                if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir)) return;
                foreach (var sub in Directory.GetDirectories(dir))
                    Consider(Path.Combine(sub, "bin", "javaw.exe"), source);
            }
            catch { }
        }

        // 1) Cryo's own bundled Mojang runtimes (self-contained, preferred).
        ScanContainer(Path.Combine(EngineRoot, "runtime", "windows-x64"), "Cryo bundled");
        // 2) PrismLauncher's runtimes (the user very likely already has these).
        var appdata = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        ScanContainer(Path.Combine(appdata, "PrismLauncher", "java"), "Prism");
        // 3) Common vendor install directories.
        var pf  = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var pfx = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        foreach (var root in new[] { pf, pfx })
        {
            if (string.IsNullOrEmpty(root)) continue;
            ScanContainer(Path.Combine(root, "Java"),             "Oracle/OpenJDK");
            ScanContainer(Path.Combine(root, "Eclipse Adoptium"), "Adoptium");
            ScanContainer(Path.Combine(root, "Microsoft"),        "Microsoft");
            ScanContainer(Path.Combine(root, "Zulu"),             "Azul Zulu");
            ScanContainer(Path.Combine(root, "Amazon Corretto"),  "Corretto");
            ScanContainer(Path.Combine(root, "BellSoft"),         "Liberica");
            ScanContainer(Path.Combine(root, "Semeru"),           "Semeru");
            Consider(Path.Combine(root, "Common Files", "Oracle", "Java", "javapath", "javaw.exe"), "Oracle");
        }
        // 4) JAVA_HOME, then 5) anything on PATH.
        var jh = Environment.GetEnvironmentVariable("JAVA_HOME");
        if (!string.IsNullOrWhiteSpace(jh)) Consider(Path.Combine(jh, "bin", "javaw.exe"), "JAVA_HOME");
        foreach (var p in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            Consider(Path.Combine(p.Trim(), "javaw.exe"), "PATH");

        // Required major for this instance's MC version.
        int requiredMajor = 0; string mc = "";
        try { var meta = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId)); mc = meta.Mc ?? ""; requiredMajor = JavaMajorForMc(mc); }
        catch { }

        // Recommended: Cryo's bundled JRE for the required major if present, else any
        // detected Java whose major matches (leave "" → engine downloads on launch).
        string recommended = ResolveBundledJava(requiredMajor) ?? "";
        if (string.IsNullOrEmpty(recommended) && requiredMajor > 0)
            recommended = found.Values.Where(j => j.Major == requiredMajor)
                                      .OrderByDescending(j => j.Version, StringComparer.Ordinal)
                                      .Select(j => j.Path).FirstOrDefault() ?? "";

        var list = found.Values
            .OrderByDescending(j => j.Major)
            .ThenBy(j => j.Source, StringComparer.Ordinal)
            .Select(j => new
            {
                path        = j.Path,
                version     = j.Version,
                major       = j.Major,
                vendor      = j.Vendor,
                source      = j.Source,
                recommended = requiredMajor > 0 && j.Major == requiredMajor,
            })
            .ToList();

        return new { mc, requiredMajor, recommendedPath = recommended, javas = list };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint  dwLength;
        public uint  dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    /// <summary>Total usable physical RAM in MB — bounds the memory-allocation
    /// sliders to what the machine actually has instead of a fixed 64 GB cap.</summary>
    private object GetSystemRam()
    {
        long totalMb = 0;
        try
        {
            var st = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
            if (GlobalMemoryStatusEx(ref st)) totalMb = (long)(st.ullTotalPhys / (1024UL * 1024UL));
        }
        catch { }
        // Fallback if the P/Invoke fails for any reason.
        if (totalMb <= 0)
            try { totalMb = (long)(GC.GetGCMemoryInfo().TotalAvailableMemoryBytes / (1024 * 1024)); } catch { }
        return new { totalMb };
    }

    /// <summary>Reads the CmlLib version name previously stored for an instance.</summary>
    private string? GetStoredEngineVersion(string instanceId)
    {
        var path = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "cryo-engine.json");
        if (!File.Exists(path)) return null;
        try { return JsonNode.Parse(File.ReadAllText(path))?["versionName"]?.GetValue<string>(); }
        catch { return null; }
    }

    private void StoreEngineVersion(string instanceId, string versionName)
    {
        var path = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "cryo-engine.json");
        File.WriteAllText(path, new JsonObject { ["versionName"] = versionName }.ToJsonString());
    }

    /// <summary>Installs ANY loader (NeoForge/Forge/Fabric/Quilt/Vanilla) via the engine
    /// and stores the version name so the instance launches without Prism.
    /// Push events: loaderProgress / loaderDone / loaderError.</summary>
    private void InstallLoaderForInstance(string instanceId, string mc, string loader, string loaderVer)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                Push("loaderProgress", new { id = instanceId, message = $"Installing {loader} for Minecraft {mc}…" });
                var core = new LauncherCore(EngineRoot);
                core.FileProgress += (name, done, total) =>
                    Push("loaderProgress", new { id = instanceId, name, done, total });
                var statusProg = new Progress<string>(msg => Push("loaderProgress", new { id = instanceId, message = msg }));
                var versionName = await core.InstallLoaderAsync(mc, loader, string.IsNullOrWhiteSpace(loaderVer) ? null : loaderVer, statusProg);
                StoreEngineVersion(instanceId, versionName);
                Logger.Info($"Loader installed for '{instanceId}': {versionName}");
                Push("loaderDone", new { ok = true, id = instanceId, versionName, loader });
            }
            catch (Exception e)
            {
                Logger.Warn($"InstallLoader({instanceId}/{loader}): {e.Message}");
                Push("loaderError", new { id = instanceId, error = e.Message });
            }
        });
    }

    private object GetEngineStatus(string instanceId)
    {
        var versionName = GetStoredEngineVersion(instanceId);
        var meta  = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
        var entry = _manager.FindById(instanceId)?.Entry;
        return new
        {
            installed    = !string.IsNullOrEmpty(versionName),
            versionName  = versionName ?? "",
            mcVersion    = meta.Mc,
            loader       = meta.Loader,
            loaderVer    = meta.LoaderVer,
            loggedIn     = MicrosoftAccount.Instance.LoggedIn,
            source       = entry?.Source ?? "prism",
        };
    }

    /// <summary>Marks an instance as "cryo" (engine) or "prism" source.
    /// After marking as "cryo", the standard Launch button uses CmlLib directly.</summary>
    private object SetEngineSource(string instanceId, string source)
    {
        var entry = _manager.FindById(instanceId)?.Entry;
        if (entry == null) return new { ok = false, error = "Instance not found" };
        source = source == "cryo" ? "cryo" : "prism";
        entry.Source = source;
        _config.Save();
        Logger.Info($"SetEngineSource({instanceId}): source={source}");
        return new { ok = true, source };
    }

    private async Task<object?> GetNeoForgeVersionsAsync(string mcVersion)
    {
        if (string.IsNullOrWhiteSpace(mcVersion)) mcVersion = "1.21.1";
        try
        {
            var core = new LauncherCore(EngineRoot);
            var versions = await core.GetNeoForgeVersionsAsync(mcVersion);
            return new { ok = true, versions };
        }
        catch (Exception e)
        {
            Logger.Warn($"GetNeoForgeVersions({mcVersion}): {e.Message}");
            return new { ok = false, error = e.Message, versions = Array.Empty<string>() };
        }
    }

    /// <summary>
    /// Downloads NeoForge into the shared CmlLib game root and stores the resulting
    /// version name so <see cref="LaunchWithEngine"/> can use it later.
    /// Push events: neoforgeProgress / neoforgeDone / neoforgeError.
    /// </summary>
    private object InstallNeoForge(string instanceId, string neoForgeVersion)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var meta = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var mc   = meta.Mc;
                if (string.IsNullOrEmpty(mc)) mc = "1.21.1";
                // Default to the PACK's pinned loader version (mmc-pack.json), not
                // "latest": mods hard-require their pack's NeoForge build.
                var nfv  = !string.IsNullOrWhiteSpace(neoForgeVersion) ? neoForgeVersion
                         : meta.Loader.Equals("NeoForge", StringComparison.OrdinalIgnoreCase)
                           && !string.IsNullOrWhiteSpace(meta.LoaderVer) ? meta.LoaderVer
                         : null;

                Push("neoforgeProgress", new { phase = "start", message = $"Preparing NeoForge for Minecraft {mc}…" });

                var core = new LauncherCore(EngineRoot);
                core.FileProgress += (name, done, total) =>
                    Push("neoforgeProgress", new { phase = "file", name, done, total });
                core.ByteProgress += (b, t) =>
                    Push("neoforgeProgress", new { phase = "bytes", bytesDone = b, bytesTotal = t });

                var statusProg = new Progress<string>(msg =>
                    Push("neoforgeProgress", new { phase = "status", message = msg }));

                var versionName = await core.InstallNeoForgeAsync(mc, nfv, statusProg);
                StoreEngineVersion(instanceId, versionName);

                Logger.Info($"NeoForge installed: {versionName} for instance {instanceId}");
                Push("neoforgeDone", new { ok = true, versionName, instanceId });
            }
            catch (Exception e)
            {
                Logger.Warn($"NeoForge install failed ({instanceId}): {e.Message}");
                Push("neoforgeError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    /// <summary>
    /// Launches the instance using the Cryo engine (CmlLib.Core) instead of Prism.
    /// Requires: (1) NeoForge installed via InstallNeoForge, (2) Microsoft session.
    /// The instance's own .minecraft folder (mods, config, saves) is passed as gameDir.
    /// Push events: engineProgress / engineError.
    /// </summary>
    private object LaunchWithEngine(string instanceId, string joinServer = "")
    {
        _ = Task.Run(() => EngineLaunchAsync(instanceId, joinServer, mode: "auto", bootTcs: null));
        return new { ok = true };
    }

    /// <summary>
    /// Core engine launch. <paramref name="mode"/>: "auto" = respect the instance's
    /// VSpeed Turbo state (train / use the AOT cache); "default" = force the standard
    /// path (bundled Java + AppCDS, Turbo ignored) — used as the benchmark baseline.
    /// <paramref name="bootTcs"/>: benchmark hook, resolved with the measured
    /// boot-to-menu seconds (-1 if unmeasurable); interactive launches pass null.
    /// Returns the game process, or null if the launch failed.
    /// </summary>
    private async Task<Process?> EngineLaunchAsync(string instanceId, string joinServer, string mode, TaskCompletionSource<long>? bootTcs)
    {
            try
            {
                var inst = _manager.FindById(instanceId)
                    ?? throw new Exception($"Instance not found: {instanceId}");

                if (!MicrosoftAccount.Instance.LoggedIn)
                    throw new Exception("Not signed in. Please sign in from the titlebar first.");

                var versionName = GetStoredEngineVersion(instanceId)
                    ?? throw new Exception("NeoForge not installed via engine yet. Click 'Install Engine' first.");

                var session = MicrosoftAccount.Instance.Session!;
                var meta    = InstanceMetaReader.Read(instanceId, InstanceDataDir(instanceId));
                var gameDir = Path.Combine(InstanceDataDir(instanceId), "instances", instanceId, "minecraft");

                if (inst.State is InstanceState.Loading or InstanceState.Ready)
                {
                    Push("engineError", new { error = "Instance already running." });
                    bootTcs?.TrySetResult(-1);
                    return null;
                }

                inst.State     = InstanceState.Loading;
                inst.LastError = null;
                inst.Notify();

                // Benchmark runs keep the launcher window visible (progress lives there).
                if (bootTcs == null && _config.Data.AutoHideOnLaunch)
                    WpfApp.Current?.Dispatcher.Invoke(() => WpfApp.Current?.MainWindow?.Hide());

                Push("engineProgress", new { phase = "start", message = $"Launching {meta.Name} via Cryo engine…" });

                var core = new LauncherCore(EngineRoot);
                core.FileProgress += (name, done, total) =>
                    Push("engineProgress", new { phase = "file", name, done, total });
                core.ByteProgress += (b, t) =>
                    Push("engineProgress", new { phase = "bytes", bytesDone = b, bytesTotal = t });

                // Launch the loader version the PACK pins (mmc-pack.json), not whatever
                // got stored at install time. ATM10 pins NeoForge 21.1.228 but the old
                // install default stored 21.1.1 → every mod failed with
                // fml.modloadingissue.missingdependency. Self-heals on every launch;
                // SkipIfAlreadyInstalled makes this a no-op once correct.
                if (meta.Loader.Equals("NeoForge", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrWhiteSpace(meta.LoaderVer)
                    && !versionName.Equals("neoforge-" + meta.LoaderVer, StringComparison.OrdinalIgnoreCase))
                {
                    Logger.Info($"Engine: stored '{versionName}' ≠ pack's NeoForge {meta.LoaderVer} — installing the pack's version");
                    Push("engineProgress", new { phase = "loader", message = $"Installing NeoForge {meta.LoaderVer} (the version this pack requires)…" });
                    var loaderProg = new Progress<string>(msg => Push("engineProgress", new { phase = "loader", message = msg }));
                    versionName = await core.InstallNeoForgeAsync(meta.Mc, meta.LoaderVer, loaderProg);
                    StoreEngineVersion(instanceId, versionName);
                    Logger.Info($"Engine: now using {versionName} for '{instanceId}'");
                }

                // Build extra JVM args: VSpeed pipe signal + AppCDS.
                // ⚠️ NEVER use MArgument.FromCommandLine for values that can contain
                // spaces — it PARSES a command line and splits on them. An instance id
                // like "All the Mods 10 - ATM10" became 6 tokens and the JVM aborted
                // with `Could not find or load main class the`. The single-string ctor
                // keeps the value as ONE argument and CmlLib quotes it when building.
                var extraJvm = new List<CmlLib.Core.ProcessBuilder.MArgument>
                {
                    new CmlLib.Core.ProcessBuilder.MArgument("-Dvspeed.daemon=true"),
                    new CmlLib.Core.ProcessBuilder.MArgument($"-Dvspeed.instance={instanceId}"),
                };
                int javaMajor = JavaMajorForMc(meta.Mc);

                // ── VSpeed Turbo (JDK 25 AOT cache, Project Leyden) ──────────
                // "training": -XX:AOTCacheOutput records this run; the cache is
                // assembled by a forked JVM at normal shutdown (a force-kill
                // produces none). "turbo": -XX:AOTCache maps it straight back in.
                // Only ever added on the Turbo Java 25 runtime — the flags don't
                // exist on Java 21 and would abort the JVM.
                string  vspeedMode = "standard";     // standard | training | turbo
                string? turboJava  = null;
                string  turboCache = TurboRuntime.CacheFile(instanceId);
                string  turboFp    = "";
                if (mode != "default" && javaMajor >= 21 && TurboRuntime.LoadState(instanceId).Enabled)
                {
                    turboJava = TurboRuntime.FindJavaw();
                    if (turboJava == null)
                        Logger.Warn($"Turbo enabled for {instanceId} but the Java 25 runtime isn't installed yet — standard launch");
                    else
                    {
                        Directory.CreateDirectory(TurboRuntime.AotDir);
                        turboFp = TurboRuntime.ComputeFingerprint(gameDir, versionName);
                        bool cacheValid = File.Exists(turboCache)
                                       && TurboRuntime.LoadState(instanceId).Fingerprint == turboFp;
                        vspeedMode = cacheValid ? "turbo" : "training";
                        extraJvm.Add(new CmlLib.Core.ProcessBuilder.MArgument(
                            cacheValid ? $"-XX:AOTCache={turboCache}" : $"-XX:AOTCacheOutput={turboCache}"));
                        Logger.Info($"Turbo {vspeedMode} launch for {instanceId} (fp={turboFp})");
                        Push("engineProgress", new { phase = "turbo", message = cacheValid
                            ? "VSpeed Turbo: launching from the AOT cache…"
                            : "VSpeed Turbo: training run — quit the game normally so the cache gets saved." });
                    }
                }

                // AppCDS auto-archive (-XX:+AutoCreateSharedArchive) only exists in Java 19+.
                // Older Minecraft uses Java 17/8 — adding it there makes the JVM abort on start
                // ("Unrecognized VM option"). Gate it on the Java the MC version actually uses.
                // Turbo supersedes it: the JVM rejects -XX:SharedArchiveFile next to the AOT cache.
                if (vspeedMode == "standard" && javaMajor >= 19)
                {
                    try
                    {
                        var cdsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "cds");
                        Directory.CreateDirectory(cdsDir);
                        var safe = new string(instanceId.Where(char.IsLetterOrDigit).ToArray());
                        var jsa  = Path.Combine(cdsDir, (safe.Length > 0 ? safe : "inst") + ".jsa");
                        // Single-string MArgument: kept as ONE argument and quoted by
                        // CmlLib, so a spaced path (e.g. a spaced Windows user name) is safe.
                        extraJvm.Add(new CmlLib.Core.ProcessBuilder.MArgument("-XX:+AutoCreateSharedArchive"));
                        extraJvm.Add(new CmlLib.Core.ProcessBuilder.MArgument($"-XX:SharedArchiveFile={jsa}"));
                    }
                    catch (Exception ex) { Logger.Warn($"AppCDS setup skipped for engine launch: {ex.Message}"); }
                }
                else Logger.Info($"AppCDS skipped for {instanceId}: MC {meta.Mc} uses Java {javaMajor} (<19)");

                // Capture the game's stdout/stderr so an early JVM crash is diagnosable
                // even when the game never wrote its own latest.log.
                var engineLog = Path.Combine(gameDir, "logs", "cryo-engine.log");

                // ── Java selection ───────────────────────────────────────────
                // 1) An explicit user override (instance.cfg → JavaPath) wins, but
                //    only if the file actually exists (a stale path must not break
                //    launch — fall through to auto-detect instead).
                // 2) Otherwise pick the bundled Mojang JRE whose major matches the
                //    MC version. This hardens modded launches: a Fabric/Forge JSON
                //    may not carry its own javaVersion, so CmlLib could otherwise
                //    fall back to the wrong runtime (e.g. Java 8 → ClassFormatError).
                // 3) If no suitable bundled JRE is present yet, leave null so CmlLib
                //    downloads and resolves the correct runtime itself (vanilla path).
                string? javaExe   = null;
                if (vspeedMode is "training" or "turbo")
                {
                    // Turbo runs MUST use the Java 25 runtime (the AOT flags were added).
                    javaExe = turboJava;
                    Logger.Info($"Java: VSpeed Turbo runtime → {javaExe}");
                }
                var     userJava  = ReadInstanceJavaPath(instanceId);
                if (javaExe == null && !string.IsNullOrWhiteSpace(userJava))
                {
                    if (File.Exists(userJava)) { javaExe = userJava; Logger.Info($"Java: user override → {userJava}"); }
                    else Logger.Warn($"Java: configured path not found, ignoring → {userJava}");
                }
                if (javaExe == null)
                {
                    javaExe = ResolveBundledJava(javaMajor);
                    if (javaExe != null) Logger.Info($"Java: auto-selected bundled JRE for Java {javaMajor} → {javaExe}");
                    else Logger.Info($"Java: no bundled Java {javaMajor} on disk yet — letting CmlLib resolve/download");
                }

                // "Join server": pass quickPlay/server args so the game connects on launch.
                var extraGame = BuildJoinGameArgs(meta.Mc, joinServer);
                if (extraGame.Count > 0) Push("engineProgress", new { phase = "join", message = $"Will join {joinServer} on launch…" });

                var proc = await core.InstallAndLaunchAsync(
                    versionName, session, meta.RamMax > 0 ? meta.RamMax : 4096,
                    gameDir: gameDir, javaPath: javaExe, extraJvmArgs: extraJvm, stdoutLog: engineLog,
                    extraGameArgs: extraGame);

                inst.PrismProcess = proc;
                inst.Notify();
                var launchedAt = DateTime.UtcNow;
                Logger.Info($"Engine launch: '{instanceId}' pid={proc.Id} version={versionName} vspeed={vspeedMode}");
                Push("engineProgress", new { phase = "launched", pid = proc.Id });

                // Measure boot-to-menu from the stdout log (ModernFix / Realms /
                // quiet-log markers — no pipe mod needed) and record it, so the
                // Performance tab can show Default-vs-Turbo times from real launches.
                var launchMode = mode == "default" ? "default" : vspeedMode;
                _ = Task.Run(async () =>
                {
                    long secs = await TurboRuntime.WatchBootAsync(engineLog, proc);
                    if (secs > 0)
                    {
                        TurboRuntime.RecordBoot(instanceId, secs, launchMode);
                        Logger.Info($"Boot measured for {instanceId}: {secs}s ({launchMode})");
                        Push("bootMeasured", new { id = instanceId, seconds = secs, mode = launchMode });
                    }
                    bootTcs?.TrySetResult(secs);
                });

                // Watch exit. There's no READY pipe in standalone, so the instance stays
                // in "Loading" for its whole run — we must NOT treat every exit as a crash.
                // Only a non-zero exit *during startup* is a real crash; a clean exit (code 0),
                // a long-running session that's then closed, or a user-requested stop are normal.
                _ = Task.Run(async () =>
                {
                    await proc.WaitForExitAsync();
                    bool userStopped   = inst.State == InstanceState.Stopped;   // Kill set this
                    var  ranFor        = DateTime.UtcNow - launchedAt;
                    bool startupCrash  = !userStopped && proc.ExitCode != 0 && ranFor < TimeSpan.FromSeconds(60);
                    if (!userStopped)
                    {
                        if (startupCrash)
                        {
                            inst.LastError = $"Game exited (code {proc.ExitCode}) during startup.";
                            inst.State     = InstanceState.Crashed;
                        }
                        else
                        {
                            inst.State = InstanceState.Stopped;   // normal close / ran fine then exited
                        }
                        WpfApp.Current?.Dispatcher.Invoke(inst.Notify);
                    }

                    // ── Turbo bookkeeping ────────────────────────────────────
                    // A JVM NATIVE crash (hs_err, "A fatal error has been detected")
                    // on the Turbo path can happen at ANY point of the run — seen live
                    // on ATM10: a G1 GC thread died reading corrupted metadata from the
                    // mapped 637 MB AOT cache (JDK 25 bug on very large caches). That
                    // must disable Turbo AND delete the cache, or every launch crashes.
                    bool jvmFatal = false;
                    if (proc.ExitCode != 0 && vspeedMode is "training" or "turbo")
                    {
                        try
                        {
                            using var fs = new FileStream(engineLog, FileMode.Open, FileAccess.Read,
                                                          FileShare.ReadWrite | FileShare.Delete);
                            var take = Math.Min(fs.Length, 64 * 1024);
                            fs.Seek(-take, SeekOrigin.End);
                            var buf = new byte[take];
                            int n = fs.Read(buf, 0, buf.Length);
                            jvmFatal = System.Text.Encoding.UTF8.GetString(buf, 0, n)
                                             .Contains("A fatal error has been detected");
                        }
                        catch { /* log unreadable — fall back to the startup-crash rule */ }
                    }

                    if ((startupCrash || jvmFatal) && vspeedMode is "training" or "turbo")
                    {
                        // Auto-fallback: a Turbo-only crash must not brick the instance.
                        var st = TurboRuntime.LoadState(instanceId);
                        st.Enabled     = false;
                        st.Fingerprint = "";
                        st.TrainedAt   = 0;
                        try { File.Delete(turboCache); } catch { /* keep going */ }
                        try { File.Delete(TurboRuntime.CacheConfigFile(instanceId)); } catch { /* keep going */ }
                        st.LastError = jvmFatal
                            ? "The Turbo run hit a fatal JVM error (a known Java 25 AOT-cache instability on very large packs). Turbo was disabled and the cache deleted — normal launches are unaffected."
                            : $"Turbo launch crashed during startup (exit {proc.ExitCode}) — Turbo was disabled, normal launch works again. A mod may be incompatible with Java 25.";
                        TurboRuntime.SaveState(instanceId, st);
                        Logger.Warn($"Turbo auto-disabled for {instanceId}: {(jvmFatal ? "fatal JVM error on the Turbo path" : "startup crash on the Java 25 path")}");
                        Push("turboEvent", new { id = instanceId, phase = "crashed", message = st.LastError });
                    }
                    else if (vspeedMode == "training" && !startupCrash)
                    {
                        // The cache is assembled by a forked JVM after the game closes —
                        // on a big pack that grinds for MINUTES (the training record alone
                        // is ~700 MB on ATM10). Wait on the actual assembler process.
                        // A force-killed game produces no cache at all (expected).
                        var size = await TurboRuntime.AwaitTrainedCacheAsync(turboCache, launchedAt, proc.Id,
                            onAssembling: () => Push("turboEvent", new { id = instanceId, phase = "assembling",
                                message = "Building the Turbo AOT cache in the background — this can take several minutes…" }));
                        try { File.Delete(TurboRuntime.CacheConfigFile(instanceId)); } catch { /* reclaim the ~700 MB record */ }
                        if (size > 0)
                        {
                            var st = TurboRuntime.LoadState(instanceId);
                            st.Fingerprint = turboFp;
                            st.TrainedAt   = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                            st.LastError   = "";
                            TurboRuntime.SaveState(instanceId, st);
                            Logger.Info($"Turbo trained for {instanceId}: {size / (1024 * 1024)} MB AOT cache");
                            Push("turboEvent", new { id = instanceId, phase = "trained", cacheSizeMb = size / (1024 * 1024) });
                        }
                        else
                        {
                            var st = TurboRuntime.LoadState(instanceId);
                            st.LastError = "The training run ended but the AOT cache assembly didn't produce a cache — launch again to retrain (quit the game normally, don't force-Stop).";
                            TurboRuntime.SaveState(instanceId, st);
                            Logger.Warn($"Turbo training ended without a cache for {instanceId} (force-killed / assembly failed) — next launch trains again");
                            Push("turboEvent", new { id = instanceId, phase = "trainIncomplete" });
                        }
                    }
                });
                return proc;
            }
            catch (Exception e)
            {
                Logger.Warn($"Engine launch failed ({instanceId}): {e.Message}");
                var inst = _manager.FindById(instanceId);
                if (inst != null)
                {
                    inst.LastError = e.Message;
                    inst.State     = InstanceState.Crashed;
                    WpfApp.Current?.Dispatcher.Invoke(inst.Notify);
                }
                Push("engineError", new { error = e.Message });
                bootTcs?.TrySetResult(-1);
                return null;
            }
    }

    // ── Standalone engine (CmlLib.Core) — beta self-test: install + launch offline ──
    private object CoreTest(string version, int ram)
    {
        if (string.IsNullOrWhiteSpace(version)) version = "1.21.1";
        _ = Task.Run(async () =>
        {
            try
            {
                var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VSpeedLauncher", "game");
                var core = new LauncherCore(root);
                core.FileProgress += (name, done, total) => Push("coreProgress", new { name, done, total });
                core.ByteProgress += (b, t) => Push("coreProgress", new { bytesDone = b, bytesTotal = t });
                Push("coreProgress", new { name = "Starting install of Minecraft " + version + "…", done = 0, total = 0 });
                var session = MSession.CreateOfflineSession("CryoTest");
                var proc = await core.InstallAndLaunchAsync(version, session, ram > 0 ? ram : 4096);
                Push("coreDone", new { ok = true, pid = proc.Id, version });
            }
            catch (Exception e)
            {
                Logger.Warn($"Core engine test failed: {e.Message}");
                Push("coreError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    // ── Microsoft account ──────────────────────────────────────────────────────
    private async Task<object?> AccountStatusAsync()
    {
        if (!MicrosoftAccount.Instance.LoggedIn)
            await MicrosoftAccount.Instance.RestoreSilentAsync();
        return new
        {
            loggedIn = MicrosoftAccount.Instance.LoggedIn,
            username = MicrosoftAccount.Instance.Username,
            uuid     = MicrosoftAccount.Instance.Uuid,
        };
    }

    private object AccountLogin()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var s = await MicrosoftAccount.Instance.LoginInteractiveAsync();
                Push("accountChanged", new { loggedIn = true, username = s.Username, uuid = s.UUID });
            }
            catch (Exception e)
            {
                Logger.Warn($"Microsoft login failed: {e.Message}");
                Push("accountError", new { error = e.Message });
            }
        });
        return new { ok = true };
    }

    private object AccountLogout()
    {
        _ = Task.Run(async () =>
        {
            await MicrosoftAccount.Instance.LogoutAsync();
            Push("accountChanged", new { loggedIn = false });
        });
        return new { ok = true };
    }

    /// <summary>Reads vspeed-stats.json written by the mod (real data-load timings).</summary>
    private object GetStats(string id)
    {
        var path = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "vspeed-stats.json");
        if (!File.Exists(path))
            return new { available = false };
        try
        {
            var node = JsonNode.Parse(File.ReadAllText(path))!;
            var types = node["types"]?.AsObject();
            var outTypes = new List<object>();
            long totalMs = 0; int totalEntries = 0; string mode = "unknown";
            if (types != null)
                foreach (var kv in types)
                {
                    var v = kv.Value!;
                    long ms = v["ms"]?.GetValue<long>() ?? 0;
                    int en  = v["entries"]?.GetValue<int>() ?? 0;
                    string m = v["mode"]?.GetValue<string>() ?? "";
                    totalMs += ms; totalEntries += en; mode = m;
                    outTypes.Add(new { type = kv.Key, ms, entries = en, mode = m });
                }
            return new
            {
                available    = true,
                updatedAt    = node["updatedAt"]?.GetValue<long>() ?? 0,
                cacheEnabled = node["cacheEnabled"]?.GetValue<bool>() ?? true,
                mode,                        // "hit" (cached) or "cold" (scanned)
                totalMs, totalEntries,
                types        = outTypes,
            };
        }
        catch (Exception e)
        {
            Logger.Warn($"GetStats({id}): {e.Message}");
            return new { available = false, error = e.Message };
        }
    }

    private object StopInstance(string id)
    {
        var inst = _manager.FindById(id);
        if (inst != null) _manager.Kill(inst);
        return new { ok = true };
    }

    // ── Window controls ───────────────────────────────────────────────────────

    private object WindowMinimize()
    {
        WpfApp.Current?.Dispatcher.Invoke(() =>
            WpfApp.Current.MainWindow!.WindowState = System.Windows.WindowState.Minimized);
        return new { ok = true };
    }

    private object WindowMaximize()
    {
        WpfApp.Current?.Dispatcher.Invoke(() =>
        {
            var w = WpfApp.Current.MainWindow!;
            w.WindowState = w.WindowState == System.Windows.WindowState.Maximized
                            ? System.Windows.WindowState.Normal
                            : System.Windows.WindowState.Maximized;
        });
        return new { ok = true };
    }

    private object WindowClose()
    {
        WpfApp.Current?.Dispatcher.Invoke(
            () => WpfApp.Current.MainWindow?.Hide());
        return new { ok = true };
    }

    // Frameless window drag — WebView2 swallows WPF non-client hit-testing, so we
    // initiate the OS move loop manually on titlebar mousedown.
    [DllImport("user32.dll")] private static extern bool ReleaseCapture();
    [DllImport("user32.dll")] private static extern nint SendMessage(nint hWnd, int msg, nint wParam, nint lParam);
    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;

    private object WindowDragStart()
    {
        WpfApp.Current?.Dispatcher.Invoke(() =>
        {
            var w = WpfApp.Current.MainWindow;
            if (w == null) return;
            var h = new System.Windows.Interop.WindowInteropHelper(w).Handle;
            if (h == 0) return;
            ReleaseCapture();
            SendMessage(h, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        });
        return new { ok = true };
    }

    // ── Config ────────────────────────────────────────────────────────────────

    private object GetConfig() => new
    {
        prismExe         = _config.Data.PrismExe,
        prismDataDir     = _config.Data.PrismDataDir,
        showOnLaunch     = _config.Data.ShowOnLaunch,
        autoHibernate    = _config.Data.AutoHibernate,
        autoHideOnLaunch = _config.Data.AutoHideOnLaunch,
        autoBackupBeforeLaunch = _config.Data.AutoBackupBeforeLaunch,
        startWithWindows = _config.Data.StartWithWindows,
        autoCleanCache   = _config.Data.AutoCleanCache,
        notifyLaunchDone = _config.Data.NotifyLaunchDone,
        notifyCacheBuilt = _config.Data.NotifyCacheBuilt,
        notifyCrash      = _config.Data.NotifyCrash,
        defaultRamMax    = _config.Data.DefaultRamMax,
        defaultJvmPreset = _config.Data.DefaultJvmPreset,
        // AI assistant — never echo the raw key back to the UI.
        aiHasKey         = !string.IsNullOrWhiteSpace(_config.Data.AiApiKey),
        aiBaseUrl        = _config.Data.AiBaseUrl,
        aiModel          = _config.Data.AiModel,
        aiAutoApply      = _config.Data.AiAutoApply,
        curseHasKey      = !string.IsNullOrWhiteSpace(_config.Data.CurseForgeApiKey),
        curseEnabled     = !string.IsNullOrWhiteSpace(EffectiveCurseKey()),
        discordEnabled   = _config.Data.DiscordEnabled,
        discordHasId     = !string.IsNullOrWhiteSpace(DiscordRpc.EmbeddedClientId),
        instances        = _config.Data.Instances,
    };

    private object SaveConfig(JsonNode args)
    {
        if (args["prismExe"]         is JsonNode pe)  _config.Data.PrismExe         = pe.GetValue<string>();
        if (args["autoHibernate"]    is JsonNode ah)  _config.Data.AutoHibernate    = ah.GetValue<bool>();
        if (args["showOnLaunch"]     is JsonNode sl)  _config.Data.ShowOnLaunch     = sl.GetValue<bool>();
        if (args["autoHideOnLaunch"] is JsonNode hl)  _config.Data.AutoHideOnLaunch = hl.GetValue<bool>();
        if (args["autoBackupBeforeLaunch"] is JsonNode abl) _config.Data.AutoBackupBeforeLaunch = abl.GetValue<bool>();
        if (args["autoCleanCache"]   is JsonNode ac)  _config.Data.AutoCleanCache   = ac.GetValue<bool>();
        if (args["notifyLaunchDone"] is JsonNode n1)  _config.Data.NotifyLaunchDone = n1.GetValue<bool>();
        if (args["notifyCacheBuilt"] is JsonNode n2)  _config.Data.NotifyCacheBuilt = n2.GetValue<bool>();
        if (args["notifyCrash"]      is JsonNode n3)  _config.Data.NotifyCrash      = n3.GetValue<bool>();
        if (args["defaultRamMax"]    is JsonNode dr)  _config.Data.DefaultRamMax    = dr.GetValue<int>();
        if (args["defaultJvmPreset"] is JsonNode dp)  _config.Data.DefaultJvmPreset = dp.GetValue<string>();
        if (args["aiApiKey"]    is JsonNode ak) _config.Data.AiApiKey    = ak.GetValue<string>() ?? "";
        if (args["aiBaseUrl"]   is JsonNode ab) _config.Data.AiBaseUrl   = (ab.GetValue<string>() ?? "").Trim().TrimEnd('/');
        if (args["aiModel"]     is JsonNode am) _config.Data.AiModel     = am.GetValue<string>() ?? "";
        if (args["aiAutoApply"] is JsonNode aa) _config.Data.AiAutoApply = aa.GetValue<bool>();
        if (args["curseForgeApiKey"] is JsonNode ck) _config.Data.CurseForgeApiKey = ck.GetValue<string>() ?? "";
        bool discordTouched = false;
        if (args["discordClientId"] is JsonNode dci) { _config.Data.DiscordClientId = (dci.GetValue<string>() ?? "").Trim(); discordTouched = true; }
        if (args["discordEnabled"]  is JsonNode den) { _config.Data.DiscordEnabled  = den.GetValue<bool>(); discordTouched = true; }
        _config.Save();
        if (discordTouched) UpdateDiscordPresence();
        return new { ok = true };
    }

    // ── Instance config (instance.cfg) ───────────────────────────────────────

    private object GetInstanceCfg(string id)
    {
        var cfgPath = Path.Combine(InstanceDataDir(id), "instances", id, "instance.cfg");
        var kv = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(cfgPath))
        {
            bool inGeneral = true;
            foreach (var raw in File.ReadAllLines(cfgPath))
            {
                var l = raw.Trim();
                if (l.StartsWith("[")) { inGeneral = l.Equals("[General]", StringComparison.OrdinalIgnoreCase); continue; }
                if (!inGeneral) continue;
                var eq = l.IndexOf('=');
                if (eq > 0) kv[l[..eq]] = l[(eq + 1)..];
            }
        }
        // Prism wraps space-containing JvmArgs in quotes — strip them for clean chips.
        var jvmRaw = kv.GetValueOrDefault("JvmArgs", "").Trim();
        if (jvmRaw.Length >= 2 && jvmRaw.StartsWith("\"") && jvmRaw.EndsWith("\""))
            jvmRaw = jvmRaw[1..^1];
        return new
        {
            jvmArgs  = jvmRaw,
            javaPath = kv.GetValueOrDefault("JavaPath", "").Trim('"'),
            ramMin   = int.TryParse(kv.GetValueOrDefault("MinMemAlloc", "2048"), out var mn) ? mn : 2048,
            ramMax   = int.TryParse(kv.GetValueOrDefault("MaxMemAlloc", "8192"), out var mx) ? mx : 8192,
        };
    }

    private object SaveInstanceCfg(string id, JsonNode args)
    {
        var cfgPath = Path.Combine(InstanceDataDir(id), "instances", id, "instance.cfg");
        if (!File.Exists(cfgPath))
            return new { ok = false, error = "instance.cfg not found" };

        var lines = File.ReadAllLines(cfgPath).ToList();
        var updates = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        if (args["jvmArgs"]  is JsonNode ja) { updates["JvmArgs"] = ja.GetValue<string>() ?? ""; updates["OverrideJavaArgs"] = "true"; }
        if (args["javaPath"] is JsonNode jp)   updates["JavaPath"]     = jp.GetValue<string>() ?? "";
        if (args["ramMin"]   is JsonNode mn)   updates["MinMemAlloc"]  = mn.GetValue<int>().ToString();
        if (args["ramMax"]   is JsonNode mx)   updates["MaxMemAlloc"]  = mx.GetValue<int>().ToString();

        bool inGeneral = true;
        for (int i = 0; i < lines.Count; i++)
        {
            var l = lines[i].Trim();
            if (l.StartsWith("[")) { inGeneral = l.Equals("[General]", StringComparison.OrdinalIgnoreCase); continue; }
            if (!inGeneral) continue;
            var eq = l.IndexOf('=');
            if (eq <= 0) continue;
            var k = l[..eq];
            if (updates.TryGetValue(k, out var v)) { lines[i] = k + "=" + v; updates.Remove(k); }
        }
        // Append remaining keys before [UI] section (or at end)
        foreach (var kv in updates)
        {
            var ui = lines.FindIndex(l => l.Trim().Equals("[UI]", StringComparison.OrdinalIgnoreCase));
            if (ui >= 0) lines.Insert(ui, kv.Key + "=" + kv.Value);
            else lines.Add(kv.Key + "=" + kv.Value);
        }

        File.WriteAllLines(cfgPath, lines);
        Logger.Info($"SaveInstanceCfg({id}): updated JvmArgs/Java/RAM");
        return new { ok = true };
    }

    // ── Shell / file actions ─────────────────────────────────────────────────

    private object OpenFolder(string id)
    {
        if (!IsSafeSegment(id)) return new { ok = false, error = "Invalid instance." };
        var mc = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft");
        var dir = Directory.Exists(mc) ? mc : Path.Combine(InstanceDataDir(id), "instances", id);
        if (Directory.Exists(dir))
            System.Diagnostics.Process.Start("explorer.exe", dir);
        else
            Logger.Warn($"OpenFolder: directory not found: {dir}");
        return new { ok = true };
    }

    private object OpenCrashReport(string id)
    {
        var crashDir = Path.Combine(InstanceDataDir(id), "instances", id, "minecraft", "crash-reports");
        if (!Directory.Exists(crashDir))
            return new { ok = false, error = "No crash-reports folder found" };
        var latest = Directory.GetFiles(crashDir, "*.txt")
            .OrderByDescending(File.GetLastWriteTime)
            .FirstOrDefault();
        if (latest == null)
            return new { ok = false, error = "No crash reports found" };
        System.Diagnostics.Process.Start("notepad.exe", latest);
        Logger.Info($"OpenCrashReport({id}): {latest}");
        return new { ok = true, path = latest };
    }

    private object ExportLogs(string id, string content)
    {
        string savePath = "";
        WpfApp.Current?.Dispatcher.Invoke(() =>
        {
            var dlg = new Microsoft.Win32.SaveFileDialog
            {
                Title      = $"Export logs — {id}",
                FileName   = $"cryo-log-{id}-{DateTime.Now:yyyy-MM-dd_HH-mm}",
                DefaultExt = ".log",
                Filter     = "Log files (*.log)|*.log|Text files (*.txt)|*.txt|All files (*.*)|*.*",
            };
            if (dlg.ShowDialog() == true) savePath = dlg.FileName;
        });

        if (string.IsNullOrEmpty(savePath))
            return new { ok = false };

        File.WriteAllText(savePath, content);
        Logger.Info($"ExportLogs({id}): saved {content.Length} chars → {savePath}");
        // Highlight the file in Explorer
        System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{savePath}\"");
        return new { ok = true, path = savePath };
    }

    private object RemoveFromLauncher(string id)
    {
        // Kill the running instance if any
        var inst = _manager.FindById(id);
        if (inst != null) _manager.Kill(inst);

        // Remove from config
        _config.Data.Instances.RemoveAll(i => i.Id == id);
        _config.Save();

        // Remove from InstanceManager's observable collection
        WpfApp.Current?.Dispatcher.Invoke(() =>
        {
            var running = _manager.Instances.FirstOrDefault(i => i.Entry.Id == id);
            if (running != null) _manager.Instances.Remove(running);
        });

        Logger.Info($"RemoveFromLauncher({id}): removed from config");
        return new { ok = true };
    }
}

// ── JsonNode extension helpers ────────────────────────────────────────────────

internal static class JsonNodeExt
{
    public static string Str(this JsonNode n, string key, string def = "")
        => n[key] is JsonNode v ? (v.GetValue<string?>() ?? def) : def;

    public static int Int(this JsonNode n, string key, int def = 0)
        => n[key] is JsonNode v && v.GetValue<int?>() is int i ? i : def;

    public static bool Bool(this JsonNode n, string key, bool def = false)
    {
        if (n[key] is not JsonNode v) return def;
        try { return v.GetValue<bool>(); } catch { return def; }
    }
}
