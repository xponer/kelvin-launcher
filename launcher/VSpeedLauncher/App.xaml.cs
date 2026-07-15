using System.IO;
using System.Threading;
using System.Windows;
using VSpeedLauncher.Core;
using VSpeedLauncher.UI;
using Application      = System.Windows.Application;
using MessageBox       = System.Windows.MessageBox;
using StartupEventArgs = System.Windows.StartupEventArgs;

namespace VSpeedLauncher;

public partial class App : Application
{
    public new static App Current => (App)Application.Current;

    public ConfigStore     Config   { get; private set; } = null!;
    public InstanceManager Manager  { get; private set; } = null!;
    public PipeServer      Pipe     { get; private set; } = null!;
    public TrayIcon        Tray     { get; private set; } = null!;
    public HistoryStore    History  { get; private set; } = null!;

    private Mutex? _singleInstanceMutex;

    private void OnStartup(object sender, StartupEventArgs e)
    {
        _singleInstanceMutex = new Mutex(initiallyOwned: true,
            name: @"Local\VSpeedLauncher.SingleInstance",
            createdNew: out var firstInstance);

        if (!firstInstance)
        {
            MessageBox.Show(
                "Kelvin is already running.\n\n" +
                "Look for its icon in the system tray (bottom-right corner) " +
                "— double-click it to open the main window.",
                "Kelvin", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        var dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "VSpeedLauncher");
        Directory.CreateDirectory(dataDir);

        var logPath     = Path.Combine(dataDir, "launcher.log");
        var configPath  = Path.Combine(dataDir, "config.json");
        var historyPath = Path.Combine(dataDir, "history.json");

        Logger.Init(logPath);
        Logger.Info("Kelvin starting.");

        Config  = new ConfigStore(configPath);
        Config.Load();

        History = new HistoryStore(historyPath);
        History.Load();

        Manager = new InstanceManager(Config);
        // Wire up history recording + tray notification on every READY signal.
        Manager.OnReadyCallback = (instanceId, loadSeconds) =>
        {
            History.Record(instanceId, loadSeconds);
            if (Config.Data.NotifyLaunchDone)
            {
                var name = Manager.FindById(instanceId)?.Entry.DisplayName ?? instanceId;
                Tray?.Notify("Kelvin — game ready", $"{name} reached the main menu in {loadSeconds}s");
            }
        };

        Pipe = new PipeServer(Manager);
        Pipe.Start();

        // Rebrand cleanup: Velopack renames its shortcuts on update, but their icon
        // points at the ROOT stub exe, which updates never replace — so users kept
        // the old snowflake after Cryo→Kelvin. Repoint the icon at the versioned
        // exe and sweep any dead legacy link. Cheap and idempotent.
        _ = Task.Run(FixBrandShortcuts);

        // Session Boost safety: if a previous session left the machine on the
        // High-Performance power plan (launcher crashed/restarted mid-game),
        // put the user's plan back now.
        try { CryoBridge.RestoreOrphanedPowerPlan(); } catch { }

        Tray = new TrayIcon(Manager, Config, OpenMainWindow, OnExitRequested);

        if (Config.Data.ShowOnLaunch)
            OpenMainWindow();
    }

    /// <summary>
    /// After the Cryo→Kelvin rebrand: fix the managed shortcuts' icons (they
    /// reference the never-updated root stub exe → old icon persisted) and
    /// delete dead legacy "Cryo Launcher" links. Safe to run every start.
    /// </summary>
    private static void FixBrandShortcuts()
    {
        try
        {
            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe)) return;
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic? shell = Activator.CreateInstance(shellType);
            if (shell == null) return;

            foreach (var dir in new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                             @"Microsoft\Windows\Start Menu\Programs"),
            })
            {
                try
                {
                    var dead = Path.Combine(dir, "Cryo Launcher.lnk");
                    if (File.Exists(dead)) File.Delete(dead);

                    var lnkPath = Path.Combine(dir, "Kelvin.lnk");
                    if (!File.Exists(lnkPath)) continue;
                    dynamic lnk = shell.CreateShortcut(lnkPath);
                    var want = exe + ",0";
                    if (!string.Equals((string)lnk.IconLocation, want, StringComparison.OrdinalIgnoreCase))
                    {
                        lnk.IconLocation = want;
                        lnk.Save();
                        Logger.Info($"Shortcut icon refreshed: {lnkPath}");
                    }
                }
                catch (Exception inner) { Logger.Warn($"Shortcut fix ({dir}): {inner.Message}"); }
            }
        }
        catch (Exception e) { Logger.Warn($"Shortcut migration: {e.Message}"); }
    }

    public void OpenMainWindow()
    {
        Dispatcher.Invoke(() =>
        {
            if (MainWindow is { IsVisible: true } w) { w.Activate(); return; }
            var window = new MainWindow();
            MainWindow = window;
            window.Show();
            window.Activate();
        });
    }

    private void OnExitRequested()
    {
        Logger.Info("Exit requested.");
        Manager.WakeAndCloseAll();
        Pipe.Stop();
        Tray.Dispose();
        Config.Save();
        try { _singleInstanceMutex?.ReleaseMutex(); } catch { }
        _singleInstanceMutex?.Dispose();
        Shutdown();
    }
}
