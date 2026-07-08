using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Threading;
// The project also links WinForms (tray icon), so disambiguate the WPF types:
using Brush       = System.Windows.Media.Brush;
using Color       = System.Windows.Media.Color;
using Button      = System.Windows.Controls.Button;
using CheckBox    = System.Windows.Controls.CheckBox;
using RichTextBox = System.Windows.Controls.RichTextBox;
using FontFamily  = System.Windows.Media.FontFamily;
using WpfApp      = System.Windows.Application;

namespace VSpeedLauncher.UI;

/// <summary>
/// A stand-alone, pop-out live console for one instance: tails the freshest of
/// <c>latest.log</c> / <c>cryo-engine.log</c> (same rule as <see cref="Core.LogReader"/> —
/// an early JVM abort only ever appears in cryo-engine.log) and renders each line
/// colour-coded by level. One window per instance; opening again focuses it.
/// Reading is incremental (position-based), so a 500 MB modpack log costs nothing.
/// </summary>
public sealed class ConsoleWindow : Window
{
    private static readonly Dictionary<string, ConsoleWindow> _open = new();

    /// <summary>Opens (or focuses) the console window for an instance. UI thread only.</summary>
    public static void Open(string instanceId, string title, string logDir)
    {
        if (_open.TryGetValue(instanceId, out var existing))
        {
            if (existing.WindowState == WindowState.Minimized) existing.WindowState = WindowState.Normal;
            existing.Activate();
            return;
        }
        var win = new ConsoleWindow(instanceId, title, logDir);
        _open[instanceId] = win;
        win.Closed += (_, _) => _open.Remove(instanceId);
        win.Show();
    }

    // ── colours ──────────────────────────────────────────────────────────────
    private static readonly Brush BgBrush     = new SolidColorBrush(Color.FromRgb(0x0C, 0x0F, 0x16));
    private static readonly Brush BarBrush    = new SolidColorBrush(Color.FromRgb(0x12, 0x16, 0x20));
    private static readonly Brush InfoBrush   = new SolidColorBrush(Color.FromRgb(0xC3, 0xCD, 0xDC));
    private static readonly Brush DimBrush    = new SolidColorBrush(Color.FromRgb(0x77, 0x81, 0x92));
    private static readonly Brush WarnBrush   = new SolidColorBrush(Color.FromRgb(0xFF, 0xC4, 0x6B));
    private static readonly Brush ErrorBrush  = new SolidColorBrush(Color.FromRgb(0xFF, 0x6B, 0x81));
    private static readonly Brush StackBrush  = new SolidColorBrush(Color.FromRgb(0xD8, 0x8A, 0x97));
    private static readonly Brush NoteBrush   = new SolidColorBrush(Color.FromRgb(0x5C, 0xC8, 0xF2));

    private static readonly Regex _lvlRe = new(@"\[[^\]]*/(?<l>FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\]",
                                               RegexOptions.Compiled);

    // ── state ────────────────────────────────────────────────────────────────
    private readonly string _logDir;
    private readonly RichTextBox _rtb;
    private readonly Paragraph _para;
    private readonly CheckBox _autoScroll;
    private readonly CheckBox _topMost;
    private readonly DispatcherTimer _timer;
    private string? _curFile;
    private long   _pos;
    private string _carry = "";
    private const int MaxLines = 2000;   // rolling cap (each line = Run + LineBreak)

    private ConsoleWindow(string instanceId, string title, string logDir)
    {
        _logDir = logDir;
        Title   = "Console — " + title;
        Width   = 980; Height = 620;
        MinWidth = 420; MinHeight = 260;
        Background = BgBrush;
        try { Icon = WpfApp.Current?.MainWindow?.Icon; } catch { /* cosmetic */ }

        // toolbar
        _autoScroll = new CheckBox { Content = "Auto-scroll", IsChecked = true, Foreground = InfoBrush,
                                     VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 12, 0) };
        _topMost    = new CheckBox { Content = "Always on top", IsChecked = false, Foreground = InfoBrush,
                                     VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 12, 0) };
        _topMost.Checked   += (_, _) => Topmost = true;
        _topMost.Unchecked += (_, _) => Topmost = false;
        var clearBtn = new Button { Content = "Clear", Padding = new Thickness(12, 3, 12, 3), Margin = new Thickness(0, 0, 10, 0) };
        var bar = new DockPanel { Background = BarBrush, Height = 34, LastChildFill = false };
        DockPanel.SetDock(_autoScroll, Dock.Left);
        DockPanel.SetDock(_topMost, Dock.Left);
        DockPanel.SetDock(clearBtn, Dock.Right);
        bar.Children.Add(_autoScroll);
        bar.Children.Add(_topMost);
        bar.Children.Add(clearBtn);

        // log surface
        _para = new Paragraph { Margin = new Thickness(0), LineHeight = 16 };
        _rtb  = new RichTextBox(new FlowDocument(_para) { PageWidth = 4000 })  // wide page = no per-line wrap-measure cost
        {
            IsReadOnly = true,
            IsReadOnlyCaretVisible = false,
            Background = BgBrush,
            Foreground = InfoBrush,
            BorderThickness = new Thickness(0),
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            Padding = new Thickness(8, 6, 8, 6),
        };
        clearBtn.Click += (_, _) => _para.Inlines.Clear();

        var root = new DockPanel();
        DockPanel.SetDock(bar, Dock.Top);
        root.Children.Add(bar);
        root.Children.Add(_rtb);
        Content = root;

        AppendNote($"Tailing {logDir}");
        // Show the recent tail immediately so the window isn't empty when opened mid-boot.
        SeedFromTail();

        _timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(700) };
        _timer.Tick += (_, _) => Poll();
        _timer.Start();
        Closed += (_, _) => _timer.Stop();
    }

    // ── tailing ──────────────────────────────────────────────────────────────

    private string? PickFreshest()
    {
        string a = Path.Combine(_logDir, "latest.log");
        string b = Path.Combine(_logDir, "cryo-engine.log");
        DateTime ta = File.Exists(a) ? File.GetLastWriteTimeUtc(a) : DateTime.MinValue;
        DateTime tb = File.Exists(b) ? File.GetLastWriteTimeUtc(b) : DateTime.MinValue;
        if (ta == DateTime.MinValue && tb == DateTime.MinValue) return null;
        return ta >= tb ? a : b;
    }

    /// <summary>On open: show the last ~300 lines of the current log, then tail from its end.</summary>
    private void SeedFromTail()
    {
        try
        {
            var f = PickFreshest();
            if (f == null) { AppendNote("No log yet — waiting for the game to start…"); return; }
            _curFile = f;
            using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var take = Math.Min(fs.Length, 256 * 1024);           // last 256 KB ≈ plenty of tail
            fs.Seek(-take, SeekOrigin.End);
            var buf = new byte[take];
            int n = fs.Read(buf, 0, buf.Length);
            var lines = Encoding.UTF8.GetString(buf, 0, n).Split('\n');
            foreach (var l in lines.Skip(1).TakeLast(300)) AppendLine(l.TrimEnd('\r'));
            _pos = fs.Length;
            if (_autoScroll.IsChecked == true) _rtb.ScrollToEnd();
        }
        catch { /* transient — the poll loop recovers */ }
    }

    private void Poll()
    {
        try
        {
            var f = PickFreshest();
            if (f == null) return;
            if (!string.Equals(f, _curFile, StringComparison.OrdinalIgnoreCase))
            {
                _curFile = f; _pos = 0; _carry = "";
                AppendNote($"── switched to {Path.GetFileName(f)} ──");
            }
            using var fs = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (fs.Length < _pos) { _pos = 0; _carry = ""; AppendNote("── log restarted ──"); }
            if (fs.Length == _pos) return;
            fs.Seek(_pos, SeekOrigin.Begin);
            var buf = new byte[Math.Min(fs.Length - _pos, 512 * 1024)];   // ≤512 KB per tick
            int n = fs.Read(buf, 0, buf.Length);
            _pos += n;
            _carry += Encoding.UTF8.GetString(buf, 0, n);

            int nl;
            bool any = false;
            while ((nl = _carry.IndexOf('\n')) >= 0)
            {
                AppendLine(_carry[..nl].TrimEnd('\r'));
                _carry = _carry[(nl + 1)..];
                any = true;
            }
            if (any && _autoScroll.IsChecked == true) _rtb.ScrollToEnd();
        }
        catch (IOException) { /* rotating — next tick */ }
        catch { /* never let the console kill the app */ }
    }

    // ── rendering ────────────────────────────────────────────────────────────

    private void AppendNote(string text)
    {
        _para.Inlines.Add(new Run(text) { Foreground = NoteBrush, FontStyle = FontStyles.Italic });
        _para.Inlines.Add(new LineBreak());
    }

    private void AppendLine(string line)
    {
        if (line.Length == 0) return;
        if (line.Length > 4000) line = line[..4000] + " …";
        _para.Inlines.Add(new Run(line) { Foreground = BrushFor(line) });
        _para.Inlines.Add(new LineBreak());

        // rolling cap: drop the oldest Run+LineBreak pairs
        while (_para.Inlines.Count > MaxLines * 2)
        {
            _para.Inlines.Remove(_para.Inlines.FirstInline);
            if (_para.Inlines.FirstInline != null) _para.Inlines.Remove(_para.Inlines.FirstInline);
        }
    }

    private static Brush BrushFor(string line)
    {
        var m = _lvlRe.Match(line);
        if (m.Success)
        {
            return m.Groups["l"].Value switch
            {
                "FATAL" or "ERROR" => ErrorBrush,
                "WARN"             => WarnBrush,
                "DEBUG" or "TRACE" => DimBrush,
                _                  => InfoBrush,
            };
        }
        // un-structured lines: stack traces / raw JVM stderr
        var t = line.TrimStart();
        if (t.StartsWith("at ") || t.StartsWith("Caused by") || t.StartsWith("..."))    return StackBrush;
        if (line.Contains("Exception") || line.Contains("Error:") || line.Contains("error", StringComparison.OrdinalIgnoreCase) && line.Contains("fatal", StringComparison.OrdinalIgnoreCase)) return ErrorBrush;
        return InfoBrush;
    }
}
