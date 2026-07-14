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

        Tray = new TrayIcon(Manager, Config, OpenMainWindow, OnExitRequested);

        if (Config.Data.ShowOnLaunch)
            OpenMainWindow();
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
