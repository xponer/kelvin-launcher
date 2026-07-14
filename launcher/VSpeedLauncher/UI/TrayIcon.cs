using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
using VSpeedLauncher.Core;
using ContextMenuStrip  = System.Windows.Forms.ContextMenuStrip;
using ToolStripMenuItem = System.Windows.Forms.ToolStripMenuItem;

namespace VSpeedLauncher.UI;

/// <summary>
/// System-tray icon + context menu. Uses the app's own <c>cryo.ico</c> (multi-resolution,
/// crisp at any DPI) and a dark, themed context menu matching the launcher UI.
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly InstanceManager  _manager;
    private readonly ConfigStore      _config;
    private readonly Action           _openMain;
    private readonly Action           _exit;
    private readonly NotifyIcon       _icon;
    private readonly ContextMenuStrip _menu;
    private readonly Icon             _trayIco;

    public TrayIcon(InstanceManager manager, ConfigStore config, Action openMain, Action exit)
    {
        _manager  = manager;
        _config   = config;
        _openMain = openMain;
        _exit     = exit;

        _trayIco = LoadIcon();

        // Dark theme for the menu AND every submenu (ManagerRenderMode picks this up).
        ToolStripManager.Renderer = new CryoRenderer(new CryoColors());

        _menu = new ContextMenuStrip
        {
            ShowImageMargin = true,
            ShowCheckMargin = false,
            BackColor       = CryoColors.MenuBg,
            ForeColor       = CryoColors.Text,
            Font            = new Font("Segoe UI", 9f),
            RenderMode      = ToolStripRenderMode.ManagerRenderMode,
        };

        _icon = new NotifyIcon
        {
            Icon             = _trayIco,
            Visible          = true,
            Text             = "Kelvin",
            ContextMenuStrip = _menu,
        };
        _icon.DoubleClick += (_, _) => _openMain();
        _menu.Opening     += (_, _) => RebuildMenu();
        RebuildMenu();

        foreach (var inst in _manager.Instances)
            inst.Changed += OnInstanceChanged;

        _manager.Instances.CollectionChanged += (_, _) =>
        {
            foreach (var inst in _manager.Instances)
            {
                inst.Changed -= OnInstanceChanged;
                inst.Changed += OnInstanceChanged;
            }
        };
    }

    private void OnInstanceChanged(RunningInstance inst)
    {
        var counts = _manager.Instances
            .GroupBy(i => i.State)
            .Select(g => $"{g.Key}: {g.Count()}");
        _icon.Text = ("Kelvin: " + string.Join(", ", counts)).Truncate(127);
    }

    private void RebuildMenu()
    {
        _menu.Items.Clear();

        // ── Header (branding) ──
        _menu.Items.Add(new ToolStripMenuItem($"Kelvin    {VersionString()}")
        {
            Image   = Glyphs.App(_trayIco),
            Enabled = false,
            Font    = new Font("Segoe UI Semibold", 9.5f, FontStyle.Bold),
        });
        _menu.Items.Add(new ToolStripSeparator());

        // ── Global actions ──
        _menu.Items.Add(Item("Open launcher",     Glyphs.App(_trayIco), (_, _) => _openMain()));
        _menu.Items.Add(Item("Open game folder",  Glyphs.Folder(),      (_, _) => OpenFolder(GameDir())));
        _menu.Items.Add(Item("Check for updates", Glyphs.Update(),      (_, _) => { _ = CheckUpdatesAsync(); }));
        _menu.Items.Add(new ToolStripSeparator());

        // ── Instances ──
        int active = 0;
        if (_manager.Instances.Count == 0)
        {
            _menu.Items.Add(new ToolStripMenuItem("No instances found") { Enabled = false });
        }
        else
        {
            foreach (var inst in _manager.Instances)
            {
                if (IsActive(inst.State)) active++;
                var sub = new ToolStripMenuItem(inst.Entry.DisplayName)
                {
                    Image       = Glyphs.Dot(StateColor(inst.State)),
                    ToolTipText = inst.State.ToString(),
                };
                if (inst.State is InstanceState.Stopped or InstanceState.Crashed)
                    sub.DropDownItems.Add(Item("Play", Glyphs.Play(),
                        async (_, _) => await _manager.LaunchAsync(inst)));
                if (IsActive(inst.State))
                    sub.DropDownItems.Add(Item("Force stop", Glyphs.Stop(CryoColors.Red),
                        (_, _) => _manager.Kill(inst)));
                sub.DropDownItems.Add(Item("Open folder", Glyphs.Folder(),
                    (_, _) => OpenFolder(InstanceDir(inst.Entry.Id))));
                _menu.Items.Add(sub);
            }
        }

        // ── Footer ──
        _menu.Items.Add(new ToolStripSeparator());
        if (active > 0)
            _menu.Items.Add(Item($"Stop all ({active})", Glyphs.Stop(CryoColors.Red), (_, _) => StopAll()));
        _menu.Items.Add(Item("Quit Cryo", Glyphs.Quit(), (_, _) => _exit()));
    }

    /// <summary>Show a Windows tray balloon notification.</summary>
    public void Notify(string title, string text)
    {
        try
        {
            _icon.BalloonTipTitle = title;
            _icon.BalloonTipText  = text;
            _icon.ShowBalloonTip(4000);
        }
        catch (Exception e) { Logger.Warn($"Notify failed: {e.Message}"); }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private static ToolStripMenuItem Item(string text, Image image, EventHandler onClick)
        => new(text, image, onClick);

    private static bool IsActive(InstanceState s)
        => s is InstanceState.Loading or InstanceState.Ready
             or InstanceState.Hibernated or InstanceState.Waking;

    private static Color StateColor(InstanceState s) => s switch
    {
        InstanceState.Ready      => Color.FromArgb(0x36, 0xD3, 0x99), // green
        InstanceState.Loading    => Color.FromArgb(0xF1, 0xC4, 0x0F), // amber
        InstanceState.Waking     => Color.FromArgb(0xF1, 0xC4, 0x0F),
        InstanceState.Hibernated => Color.FromArgb(0x6C, 0x8C, 0xFF), // blue
        InstanceState.Crashed    => Color.FromArgb(0xE5, 0x5A, 0x5A), // red
        _                        => Color.FromArgb(0x7A, 0x7E, 0x96), // gray (stopped)
    };

    private static string VersionString()
    {
        var v = Assembly.GetExecutingAssembly().GetName().Version;
        return v == null ? "" : $"v{v.Major}.{v.Minor}.{v.Build}";
    }

    private static string GameDir()
    {
        var d = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "VSpeedLauncher", "game");
        try { Directory.CreateDirectory(d); } catch { }
        return d;
    }

    private string InstanceDir(string id)
    {
        var baseDir = string.IsNullOrEmpty(_config.Data.PrismDataDir)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "PrismLauncher")
            : _config.Data.PrismDataDir;
        return Path.Combine(baseDir, "instances", id);
    }

    private void OpenFolder(string path)
    {
        try
        {
            if (!Directory.Exists(path)) { Notify("Kelvin", "Folder not found:\n" + path); return; }
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }
        catch (Exception e) { Logger.Warn($"OpenFolder failed: {e.Message}"); }
    }

    private void StopAll()
    {
        foreach (var inst in _manager.Instances.ToList())
            if (IsActive(inst.State))
                try { _manager.Kill(inst); } catch { /* ignore */ }
    }

    private async System.Threading.Tasks.Task CheckUpdatesAsync()
    {
        try
        {
            var up = new UpdateService();
            if (!up.IsInstalled)
            {
                Notify("Kelvin", "Auto-update is available only for the installed app (Setup.exe).");
                return;
            }
            Notify("Kelvin", "Checking for updates…");
            var v = await up.CheckAsync();
            if (string.IsNullOrEmpty(v))
            {
                Notify("Kelvin", $"You're on the latest version ({up.CurrentVersion}).");
                return;
            }

            var disp = System.Windows.Application.Current?.Dispatcher;
            bool yes = disp != null && disp.Invoke(() =>
                System.Windows.MessageBox.Show(
                    $"Kelvin {v} is available (you have {up.CurrentVersion}).\n\nDownload and restart now?",
                    "Kelvin update",
                    System.Windows.MessageBoxButton.YesNo,
                    System.Windows.MessageBoxImage.Information) == System.Windows.MessageBoxResult.Yes);
            if (!yes) return;

            Notify("Kelvin", $"Downloading {v}…");
            await up.DownloadAsync();
            up.ApplyAndRestart(); // restarts into the new version
        }
        catch (Exception e)
        {
            Logger.Warn($"Tray update check failed: {e.Message}");
            Notify("Kelvin", "Update check failed: " + e.Message);
        }
    }

    private static Icon LoadIcon()
    {
        // 1) Full multi-resolution cryo.ico from the embedded WPF resource (crisp at any DPI).
        try
        {
            var uri  = new Uri("pack://application:,,,/cryo.ico", UriKind.Absolute);
            var info = System.Windows.Application.GetResourceStream(uri);
            if (info?.Stream != null) { using var s = info.Stream; return new Icon(s); }
        }
        catch { }
        // 2) The running exe's own icon (also cryo.ico, via <ApplicationIcon>).
        try
        {
            var exe = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(exe))
            {
                var ico = Icon.ExtractAssociatedIcon(exe);
                if (ico != null) return ico;
            }
        }
        catch { }
        // 3) Legacy file / system fallback.
        var legacy = Path.Combine(AppContext.BaseDirectory, "Assets", "tray.ico");
        if (File.Exists(legacy)) try { return new Icon(legacy); } catch { }
        return SystemIcons.Application;
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
        _menu.Dispose();
        try { _trayIco.Dispose(); } catch { }
    }
}

/// <summary>Dark color table that makes the WinForms context menu match the launcher UI.</summary>
internal sealed class CryoColors : ProfessionalColorTable
{
    public static readonly Color MenuBg = Color.FromArgb(0x1E, 0x1F, 0x2B);
    public static readonly Color Margin = Color.FromArgb(0x17, 0x18, 0x22);
    public static readonly Color Hover  = Color.FromArgb(0x2E, 0x33, 0x55);
    public static readonly Color Accent = Color.FromArgb(0x6C, 0x8C, 0xFF);
    public static readonly Color Text   = Color.FromArgb(0xEC, 0xEC, 0xF1);
    public static readonly Color Dim    = Color.FromArgb(0x8A, 0x90, 0xA8);
    public static readonly Color Sep    = Color.FromArgb(0x3A, 0x3B, 0x4D);
    public static readonly Color Red    = Color.FromArgb(0xE5, 0x5A, 0x5A);

    public CryoColors() { UseSystemColors = false; }

    public override Color ToolStripDropDownBackground      => MenuBg;
    public override Color ImageMarginGradientBegin         => Margin;
    public override Color ImageMarginGradientMiddle        => Margin;
    public override Color ImageMarginGradientEnd           => Margin;
    public override Color MenuBorder                       => Sep;
    public override Color MenuItemBorder                   => Accent;
    public override Color MenuItemSelected                 => Hover;
    public override Color MenuItemSelectedGradientBegin    => Hover;
    public override Color MenuItemSelectedGradientEnd      => Hover;
    public override Color MenuItemPressedGradientBegin     => Margin;
    public override Color MenuItemPressedGradientEnd       => Margin;
    public override Color SeparatorDark                    => Sep;
    public override Color SeparatorLight                   => Color.Transparent;
}

/// <summary>Professional renderer that forces light text on the dark menu.</summary>
internal sealed class CryoRenderer : ToolStripProfessionalRenderer
{
    public CryoRenderer(ProfessionalColorTable table) : base(table) { }

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? CryoColors.Text : CryoColors.Dim;
        base.OnRenderItemText(e);
    }
}

/// <summary>Tiny anti-aliased 16×16 menu glyphs drawn with GDI+ and cached for the app lifetime.</summary>
internal static class Glyphs
{
    private static readonly Dictionary<int, Image> _dots  = new();
    private static readonly Dictionary<int, Image> _stops = new();
    private static Image? _play, _folder, _update, _quit, _app;

    public static Image App(Icon ico)
    {
        if (_app != null) return _app;
        try { using var small = new Icon(ico, new Size(16, 16)); return _app = small.ToBitmap(); }
        catch { return _app = New(g => { }); }
    }

    public static Image Dot(Color c)
    {
        if (_dots.TryGetValue(c.ToArgb(), out var img)) return img;
        img = New(g =>
        {
            using var b = new SolidBrush(c);
            g.FillEllipse(b, 3, 3, 10, 10);
            using var p = new Pen(Color.FromArgb(70, 0, 0, 0), 1f);
            g.DrawEllipse(p, 3, 3, 10, 10);
        });
        _dots[c.ToArgb()] = img;
        return img;
    }

    public static Image Play() => _play ??= New(g =>
    {
        using var b = new SolidBrush(Color.FromArgb(0x36, 0xD3, 0x99));
        g.FillPolygon(b, new[] { new PointF(4.5f, 3f), new PointF(4.5f, 13f), new PointF(13f, 8f) });
    });

    public static Image Stop(Color c)
    {
        if (_stops.TryGetValue(c.ToArgb(), out var img)) return img;
        img = New(g =>
        {
            using var b = new SolidBrush(c);
            using var path = Rounded(new RectangleF(4, 4, 8, 8), 2f);
            g.FillPath(b, path);
        });
        _stops[c.ToArgb()] = img;
        return img;
    }

    public static Image Folder() => _folder ??= New(g =>
    {
        var col = Color.FromArgb(0x9A, 0xA2, 0xC4);
        using var b = new SolidBrush(col);
        g.FillRectangle(b, 2f, 4f, 6f, 3f);
        using var body = Rounded(new RectangleF(2f, 5.5f, 12f, 7.5f), 1.5f);
        g.FillPath(b, body);
    });

    public static Image Update() => _update ??= New(g =>
    {
        using var b = new SolidBrush(Color.FromArgb(0x6C, 0x8C, 0xFF));
        g.FillPolygon(b, new[] { new PointF(8f, 2.5f), new PointF(2.5f, 8.5f), new PointF(13.5f, 8.5f) });
        using var stem = Rounded(new RectangleF(6.5f, 7.5f, 3f, 6f), 1f);
        g.FillPath(b, stem);
    });

    public static Image Quit() => _quit ??= New(g =>
    {
        using var p = new Pen(Color.FromArgb(0xE5, 0x5A, 0x5A), 2.4f)
        { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawLine(p, 4.5f, 4.5f, 11.5f, 11.5f);
        g.DrawLine(p, 11.5f, 4.5f, 4.5f, 11.5f);
    });

    private static Image New(Action<Graphics> draw)
    {
        var bmp = new Bitmap(16, 16);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        draw(g);
        return bmp;
    }

    private static GraphicsPath Rounded(RectangleF r, float radius)
    {
        float d = radius * 2;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}

internal static class StringExt
{
    public static string Truncate(this string s, int max)
        => s.Length <= max ? s : s[..(max - 1)] + "…";
}
