using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using FoxyJumpscare.Platform;
using Forms = System.Windows.Forms;

namespace FoxyJumpscare;

/// <summary>
/// A single fullscreen overlay spanning every monitor.
///
/// One window, not one per monitor. The earlier per-monitor design gave each
/// screen its own MediaElement, and WPF's MediaElement does not render reliably
/// on a secondary monitor: its playback clock advances normally while
/// presentation stalls. Measured on a dual 1920x1080 setup, the second screen
/// held byte-identical frames for ~900ms of an 880ms video. Synchronising the
/// players fixed the clocks to within 3ms and changed nothing on screen, which
/// is what proved the clocks were never the problem - it is the renderer.
///
/// So there is exactly one MediaElement, positioned over the primary screen,
/// and every other screen is painted with a VisualBrush of that same element.
/// A brush cannot drift from its source, so all monitors show the same frame by
/// construction, and only one decoder ever runs.
/// </summary>
public partial class OverlayWindow : Window
{
    /// <summary>
    /// Absolute ceiling on how long the overlay may live, armed before any
    /// media event. A file broken badly enough raises neither MediaOpened nor
    /// MediaFailed, and without this the user is left staring at a fullscreen
    /// window they cannot close.
    /// </summary>
    private static readonly TimeSpan HardStop = TimeSpan.FromSeconds(15);

    private readonly System.Drawing.Rectangle _virtualBounds;
    private readonly System.Drawing.Rectangle _primaryBounds;
    private readonly IReadOnlyList<System.Drawing.Rectangle> _mirrorBounds;
    private readonly int _failsafeMarginMs;
    private DispatcherTimer? _failsafe;
    private DispatcherTimer? _hardStop;
    private bool _closed;

    /// <summary>
    /// Set FOXY_TRACE=1 to append overlay timing to %TEMP%\foxy-overlay.log.
    /// Multi-monitor rendering problems are invisible without it.
    /// </summary>
    private static readonly bool Tracing =
        Environment.GetEnvironmentVariable("FOXY_TRACE") == "1";

    private static readonly string TracePath =
        Path.Combine(Path.GetTempPath(), "foxy-overlay.log");

    private static void Trace(string message)
    {
        if (!Tracing) return;
        try
        {
            File.AppendAllText(
                TracePath,
                $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch (IOException) { /* tracing must never break playback */ }
    }

    private OverlayWindow(string videoPath, int failsafeMarginMs)
    {
        InitializeComponent();

        _failsafeMarginMs = failsafeMarginMs;

        var screens = Forms.Screen.AllScreens;
        var primary = Forms.Screen.PrimaryScreen ?? screens[0];

        _primaryBounds = primary.Bounds;
        _mirrorBounds = screens
            .Where(s => s.DeviceName != primary.DeviceName)
            .Select(s => s.Bounds)
            .ToList();

        _virtualBounds = System.Drawing.Rectangle.FromLTRB(
            screens.Min(s => s.Bounds.Left),
            screens.Min(s => s.Bounds.Top),
            screens.Max(s => s.Bounds.Right),
            screens.Max(s => s.Bounds.Bottom));

        Player.Source = new Uri(videoPath);
        Player.MediaEnded += (_, _) => { Trace("MediaEnded"); CloseOnce(); };
        Player.MediaFailed += (_, e) =>
        {
            Trace($"MediaFailed: {e.ErrorException?.Message}");
            CloseOnce();
        };
        Player.MediaOpened += (_, _) =>
        {
            Trace($"MediaOpened natural={Player.NaturalDuration}");
            ArmFailsafe();
        };

        _hardStop = new DispatcherTimer { Interval = HardStop };
        _hardStop.Tick += (_, _) => CloseOnce();
        _hardStop.Start();
    }

    /// <summary>
    /// Cover every monitor and play. Returns immediately; the overlay tears
    /// itself down.
    /// </summary>
    public static void ShowAll(string videoPath, int failsafeMarginMs)
    {
        if (!File.Exists(videoPath)) return;

        var window = new OverlayWindow(videoPath, failsafeMarginMs);
        Trace($"Show() screens={Forms.Screen.AllScreens.Length}");
        window.Show();
        Trace("Play()");
        window.Player.Play();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        NoActivate.Apply(new WindowInteropHelper(this).Handle);

        // Screen bounds are physical pixels; WPF positions in device-independent
        // units. Without this conversion everything is mis-sized on a scaled
        // display.
        var source = PresentationSource.FromVisual(this);
        var toDip = source?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;

        Point ToDip(int x, int y) => toDip.Transform(new Point(x, y));

        var origin = ToDip(_virtualBounds.Left, _virtualBounds.Top);
        var extent = ToDip(_virtualBounds.Width, _virtualBounds.Height);

        Left = origin.X;
        Top = origin.Y;
        Width = extent.X;
        Height = extent.Y;

        // Everything inside the canvas is positioned relative to the window's
        // own top-left, which is the virtual desktop's top-left.
        Rect Local(System.Drawing.Rectangle bounds)
        {
            var tl = ToDip(bounds.Left - _virtualBounds.Left, bounds.Top - _virtualBounds.Top);
            var wh = ToDip(bounds.Width, bounds.Height);
            return new Rect(tl.X, tl.Y, wh.X, wh.Y);
        }

        var primaryRect = Local(_primaryBounds);
        Canvas.SetLeft(Player, primaryRect.X);
        Canvas.SetTop(Player, primaryRect.Y);
        Player.Width = primaryRect.Width;
        Player.Height = primaryRect.Height;

        foreach (var bounds in _mirrorBounds)
        {
            var rect = Local(bounds);
            var mirror = new System.Windows.Shapes.Rectangle
            {
                Width = rect.Width,
                Height = rect.Height,
                Fill = new VisualBrush(Player)
                {
                    Stretch = Stretch.Uniform,
                    // The brush must not cache, or the mirrors freeze on the
                    // first frame while the primary plays on.
                    AutoLayoutContent = false,
                },
            };
            Canvas.SetLeft(mirror, rect.X);
            Canvas.SetTop(mirror, rect.Y);
            Root.Children.Add(mirror);
        }

        Trace($"SourceInitialized window={Left},{Top} {Width}x{Height} mirrors={_mirrorBounds.Count}");
    }

    /// <summary>
    /// Scaled to the actual video length. The hard stop in the constructor
    /// covers the case where this never gets armed at all.
    /// </summary>
    private void ArmFailsafe()
    {
        // MediaOpened can fire after teardown - Player.Close() triggers a final
        // one. Without this guard that arms a fresh timer on a dead window.
        if (_closed) return;

        var natural = Player.NaturalDuration.HasTimeSpan
            ? Player.NaturalDuration.TimeSpan
            : TimeSpan.FromSeconds(5);

        _failsafe = new DispatcherTimer
        {
            Interval = natural + TimeSpan.FromMilliseconds(_failsafeMarginMs),
        };
        _failsafe.Tick += (_, _) => CloseOnce();
        _failsafe.Start();
    }

    private void CloseOnce()
    {
        if (_closed) return;
        _closed = true;

        Trace("CloseOnce");

        _failsafe?.Stop();
        _failsafe = null;
        _hardStop?.Stop();
        _hardStop = null;

        Player.Stop();
        Player.Close();
        Close();
    }
}
