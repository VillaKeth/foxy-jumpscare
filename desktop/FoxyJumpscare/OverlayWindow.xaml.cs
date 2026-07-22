using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using FoxyJumpscare.Platform;
using Forms = System.Windows.Forms;

namespace FoxyJumpscare;

/// <summary>
/// A fullscreen overlay covering one monitor.
///
/// Only the primary monitor plays the video. Every other monitor gets a plain
/// black window. That is deliberate, and it is not just about avoiding
/// overlapping audio:
///
/// WPF's MediaElement does not render reliably on a secondary monitor. Its
/// playback clock advances normally while presentation stalls, so a second
/// screen sits frozen on an early frame for most of the clip while the primary
/// plays through. Measured on a dual 1920x1080 setup: identical frames for
/// ~900ms of an 880ms video. Starting the players together fixes the clocks and
/// changes nothing on screen, because the clocks were never the problem.
///
/// One video on the screen the user is actually looking at, with the rest
/// blacked out, sidesteps the whole thing and reads better anyway.
/// </summary>
public partial class OverlayWindow : Window
{
    /// <summary>
    /// Absolute ceiling on how long an overlay may live, armed before any media
    /// event. A file broken badly enough raises neither MediaOpened nor
    /// MediaFailed, and without this the user is left staring at a fullscreen
    /// window they cannot close.
    /// </summary>
    private static readonly TimeSpan HardStop = TimeSpan.FromSeconds(15);

    private readonly System.Drawing.Rectangle _physicalBounds;
    private readonly int _failsafeMarginMs;
    private readonly bool _playsVideo;
    private DispatcherTimer? _failsafe;
    private DispatcherTimer? _hardStop;
    private bool _closed;

    private string _tag = "?";

    /// <summary>
    /// Set FOXY_TRACE=1 to append overlay timing to %TEMP%\foxy-overlay.log.
    /// Multi-monitor rendering problems are invisible without it.
    /// </summary>
    private static readonly bool Tracing =
        Environment.GetEnvironmentVariable("FOXY_TRACE") == "1";

    private static readonly string TracePath =
        Path.Combine(Path.GetTempPath(), "foxy-overlay.log");

    private void Trace(string message)
    {
        if (!Tracing) return;
        try
        {
            File.AppendAllText(
                TracePath,
                $"{DateTime.Now:HH:mm:ss.fff} [{_tag}] {message}{Environment.NewLine}");
        }
        catch (IOException) { /* tracing must never break playback */ }
    }

    private OverlayWindow(
        System.Drawing.Rectangle physicalBounds,
        string? videoPath,
        int failsafeMarginMs)
    {
        InitializeComponent();

        _physicalBounds = physicalBounds;
        _failsafeMarginMs = failsafeMarginMs;
        _playsVideo = videoPath is not null;

        if (_playsVideo)
        {
            Player.Source = new Uri(videoPath!);
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
        }
        else
        {
            // Nothing to play; this window is only here to black out a screen.
            Player.Visibility = Visibility.Collapsed;
        }

        _hardStop = new DispatcherTimer { Interval = HardStop };
        _hardStop.Tick += (_, _) => CloseOnce();
        _hardStop.Start();
    }

    /// <summary>
    /// Black out every monitor and play the video on the primary one. Returns
    /// immediately; the overlays tear themselves down.
    /// </summary>
    public static void ShowAll(string videoPath, int failsafeMarginMs)
    {
        if (!File.Exists(videoPath)) return;

        var primaryScreen = Forms.Screen.PrimaryScreen ?? Forms.Screen.AllScreens[0];
        OverlayWindow? primary = null;
        var blanks = new List<OverlayWindow>();

        foreach (var screen in Forms.Screen.AllScreens)
        {
            var isPrimary = screen.DeviceName == primaryScreen.DeviceName && primary is null;
            var window = new OverlayWindow(
                screen.Bounds,
                isPrimary ? videoPath : null,
                failsafeMarginMs)
            {
                _tag = $"{screen.DeviceName}{(isPrimary ? " PRIMARY" : " blank")}",
            };

            if (isPrimary) primary = window;
            else blanks.Add(window);

            window.Trace("Show()");
            window.Show();
        }

        if (primary is null) return;

        // The blanks have no media of their own, so they follow the primary.
        // Their own hard stop still applies if the primary somehow never closes.
        primary.Closed += (_, _) =>
        {
            foreach (var blank in blanks) blank.CloseOnce();
        };

        primary.Trace("Play()");
        primary.Player.Play();
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        NoActivate.Apply(new WindowInteropHelper(this).Handle);

        // Screen.Bounds is physical pixels; WPF positions in device-independent
        // units. Without this conversion the overlay is mis-sized on any
        // mixed-DPI setup - which is most laptops with an external display.
        var source = PresentationSource.FromVisual(this);
        var toDip = source?.CompositionTarget?.TransformFromDevice ?? Matrix.Identity;

        var topLeft = toDip.Transform(new Point(_physicalBounds.Left, _physicalBounds.Top));
        var size = toDip.Transform(new Point(_physicalBounds.Width, _physicalBounds.Height));

        Left = topLeft.X;
        Top = topLeft.Y;
        Width = size.X;
        Height = size.Y;

        Trace($"SourceInitialized bounds={Left},{Top} {Width}x{Height} video={_playsVideo}");
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

        if (_playsVideo)
        {
            Player.Stop();
            Player.Close();
        }

        Close();
    }
}
