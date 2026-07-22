using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using FoxyJumpscare.Platform;
using Forms = System.Windows.Forms;

namespace FoxyJumpscare;

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
    private DispatcherTimer? _failsafe;
    private DispatcherTimer? _hardStop;
    private bool _closed;

    private OverlayWindow(
        System.Drawing.Rectangle physicalBounds,
        string videoPath,
        bool muted,
        int failsafeMarginMs)
    {
        InitializeComponent();

        _physicalBounds = physicalBounds;
        _failsafeMarginMs = failsafeMarginMs;

        Player.Source = new Uri(videoPath);
        // Only the primary screen makes noise. Three monitors would otherwise
        // play three overlapping copies of the scream, slightly out of sync.
        Player.IsMuted = muted;

        Player.MediaEnded += (_, _) => CloseOnce();
        Player.MediaFailed += (_, _) => CloseOnce();
        Player.MediaOpened += (_, _) => ArmFailsafe();

        _hardStop = new DispatcherTimer { Interval = HardStop };
        _hardStop.Tick += (_, _) => CloseOnce();
        _hardStop.Start();
    }

    /// <summary>Show one overlay per monitor. Returns immediately.</summary>
    public static void ShowAll(string videoPath, int failsafeMarginMs)
    {
        if (!File.Exists(videoPath)) return;

        var primaryName = Forms.Screen.PrimaryScreen?.DeviceName;

        foreach (var screen in Forms.Screen.AllScreens)
        {
            var muted = screen.DeviceName != primaryName;
            var window = new OverlayWindow(screen.Bounds, videoPath, muted, failsafeMarginMs);
            window.Show();
            window.Player.Play();
        }
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
    }

    /// <summary>
    /// Scaled to the actual video length once it is known. The hard stop in the
    /// constructor covers the case where this never gets armed.
    /// </summary>
    private void ArmFailsafe()
    {
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

        _failsafe?.Stop();
        _failsafe = null;
        _hardStop?.Stop();
        _hardStop = null;

        Player.Stop();
        Player.Close();
        Close();
    }
}
