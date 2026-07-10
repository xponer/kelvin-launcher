using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using VSpeedLauncher.Core;

namespace VSpeedLauncher.UI;

public partial class MainWindow : Window
{
    private CryoBridge? _bridge;

    public MainWindow()
    {
        InitializeComponent();
        // Taskbar / Alt-Tab icon (the window has custom chrome, so set it explicitly).
        try { Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri("pack://application:,,,/cryo.ico", UriKind.Absolute)); }
        catch { /* icon is optional — never block startup on it */ }
        // Clamp the maximized size to the monitor work area. Without this, a
        // WindowStyle=None window maximizes over the whole monitor and its bottom
        // edge slides under the taskbar (the "bar covering the launcher" bug).
        SourceInitialized += (_, _) =>
            HwndSource.FromHwnd(new WindowInteropHelper(this).Handle)?.AddHook(WndProc);
        Loaded += async (_, _) => await InitWebViewAsync();
        // Launcher sleeps while you play: minimized or hidden-to-tray → suspend
        // the WebView2 renderer and release its memory back to the game.
        StateChanged     += (_, _) => UpdateSuspendState();
        IsVisibleChanged += (_, _) => UpdateSuspendState();
    }

    // ── Sleep while hidden/minimized ─────────────────────────────────────────
    // The WebView2 UI holds 300–500 MB while idle. When the window is minimized
    // or hidden to the tray (typically: while the game runs), suspend the
    // renderer (memory released to the OS) and queue bridge events; on restore,
    // resume and flush so the UI catches up instantly.
    private bool _webSuspended;

    private async void UpdateSuspendState()
    {
        if (WebView?.CoreWebView2 == null) return;
        bool shouldSleep = !IsVisible || WindowState == WindowState.Minimized;
        if (shouldSleep == _webSuspended) return;
        try
        {
            if (shouldSleep)
            {
                _webSuspended = true;
                CryoBridge.WebSuspended = true;               // queue pushes from now on
                WebView.Visibility = Visibility.Collapsed;    // suspend requires IsVisible=false
                WebView.CoreWebView2.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Low;
                await Task.Delay(150);                        // let visibility propagate
                if (_webSuspended) await WebView.CoreWebView2.TrySuspendAsync();
                Logger.Info("WebView suspended — launcher UI memory released while hidden");
            }
            else
            {
                _webSuspended = false;
                WebView.CoreWebView2.Resume();
                WebView.CoreWebView2.MemoryUsageTargetLevel = CoreWebView2MemoryUsageTargetLevel.Normal;
                WebView.Visibility = Visibility.Visible;
                CryoBridge.WebSuspended = false;
                _bridge?.FlushPendingPushes();
            }
        }
        catch (Exception ex) { Logger.Warn($"WebView suspend/resume: {ex.Message}"); }
    }

    private async Task InitWebViewAsync()
    {
        var dataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "VSpeedLauncher", "webview2");

        var env = await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: dataDir,
            options: new CoreWebView2EnvironmentOptions
            {
                // GPU-accelerated (no --disable-gpu) so the glass/blur UI stays smooth.
                // msWebView2BrowserHitTransparent enables -webkit-app-region:drag.
                AdditionalBrowserArguments = "--enable-features=msWebView2BrowserHitTransparent",
            });

        await WebView.EnsureCoreWebView2Async(env);
        // The WebView paints white before content loads — make that initial paint dark
        // (matches the UI), so there's no white flash if the splash fades a touch early.
        try { WebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 0x08, 0x0B, 0x10); } catch { }

        var uiFolder = Path.Combine(AppContext.BaseDirectory, "WebUI");
        // Dev convenience: if the source WebUI exists (4 levels up from bin/.../win-x64),
        // serve from it so JS/CSS edits apply on relaunch without a full rebuild.
        try
        {
            var dev = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "WebUI"));
            if (File.Exists(Path.Combine(dev, "Cryo Launcher.html")) && Directory.Exists(Path.Combine(dev, "src")))
            {
                uiFolder = dev;
                Logger.Info($"Serving UI from source: {dev}");
            }
        }
        catch { /* fall back to bundled output */ }

        if (Directory.Exists(uiFolder))
        {
            WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "cryo.local", uiFolder,
                CoreWebView2HostResourceAccessKind.Allow);
        }
        else
        {
            Logger.Warn($"WebUI folder not found: {uiFolder}");
        }

        WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        WebView.CoreWebView2.Settings.AreDevToolsEnabled            = true;  // F12 to debug
        WebView.CoreWebView2.Settings.IsStatusBarEnabled            = false;
        WebView.CoreWebView2.Settings.IsZoomControlEnabled          = false;
        WebView.CoreWebView2.Settings.IsWebMessageEnabled           = true;

        WebView.CoreWebView2.NavigationStarting += (_, args) =>
        {
            if (!args.Uri.StartsWith("https://cryo.local/", StringComparison.OrdinalIgnoreCase)
             && !args.Uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                args.Cancel = true;
            }
        };

        _bridge = new CryoBridge(
            App.Current.Manager,
            App.Current.Config,
            App.Current.History,
            WebView);

        WebView.CoreWebView2.WebMessageReceived += _bridge.OnWebMessageReceived;

        // Surface page-side problems (CSP violations, MIME/script-load refusals, network
        // errors, uncaught JS exceptions) into launcher.log — invaluable when the WebUI
        // silently fails to render. Enabled before Navigate so load-time errors are caught.
        try
        {
            WebView.CoreWebView2.GetDevToolsProtocolEventReceiver("Log.entryAdded")
                .DevToolsProtocolEventReceived += (_, e) =>
                {
                    // Only surface errors (CSP/MIME refusals, failed loads). Skipping
                    // warning-level entries keeps benign noise (e.g. tracking-prevention
                    // storage notices for the CDN font CSS) out of the log.
                    var j = e.ParameterObjectAsJson;
                    if (j.Contains("\"level\":\"error\"")) Logger.Warn("WebLog: " + j);
                };
            WebView.CoreWebView2.GetDevToolsProtocolEventReceiver("Runtime.exceptionThrown")
                .DevToolsProtocolEventReceived += (_, e) => Logger.Error("WebError: " + e.ParameterObjectAsJson);
            await WebView.CoreWebView2.CallDevToolsProtocolMethodAsync("Log.enable", "{}");
            await WebView.CoreWebView2.CallDevToolsProtocolMethodAsync("Runtime.enable", "{}");
        }
        catch (Exception ex) { Logger.Warn($"DevTools diagnostics unavailable: {ex.Message}"); }

        // Drop the dark init-cover once the page (and its in-page splash) has painted,
        // so the user never sees the WebView's flickery first frames.
        WebView.CoreWebView2.NavigationCompleted += (_, _) =>
            Dispatcher.Invoke(() => { if (InitCover != null) InitCover.Visibility = Visibility.Collapsed; });
        WebView.CoreWebView2.Navigate("https://cryo.local/Cryo Launcher.html");
    }

    private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
    {
        e.Cancel = true;
        Hide();
    }

    // ── Maximize fix ─────────────────────────────────────────────────────────────
    // A WindowStyle=None window maximizes to the full monitor (under the taskbar) by
    // default. Handle WM_GETMINMAXINFO to clamp the maximized rect to the work area.
    private const int WM_GETMINMAXINFO       = 0x0024;
    private const int MONITOR_DEFAULTTONEAREST = 0x00000002;

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WM_GETMINMAXINFO) return IntPtr.Zero;
        try
        {
            var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if (monitor == IntPtr.Zero) return IntPtr.Zero;

            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(monitor, ref mi)) return IntPtr.Zero;

            var mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam);
            // Position/size are relative to the monitor (handles taskbar on any edge
            // and secondary monitors).
            mmi.ptMaxPosition.x = mi.rcWork.left   - mi.rcMonitor.left;
            mmi.ptMaxPosition.y = mi.rcWork.top    - mi.rcMonitor.top;
            mmi.ptMaxSize.x     = mi.rcWork.right  - mi.rcWork.left;
            mmi.ptMaxSize.y     = mi.rcWork.bottom - mi.rcWork.top;
            Marshal.StructureToPtr(mmi, lParam, true);
            handled = true;
        }
        catch { /* fall back to default maximize behavior */ }
        return IntPtr.Zero;
    }

    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr hwnd, int flags);
    [DllImport("user32.dll")] private static extern bool   GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MINMAXINFO
    {
        public POINT ptReserved;
        public POINT ptMaxSize;
        public POINT ptMaxPosition;
        public POINT ptMinTrackSize;
        public POINT ptMaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int left, top, right, bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int  cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public int  dwFlags;
    }
}
