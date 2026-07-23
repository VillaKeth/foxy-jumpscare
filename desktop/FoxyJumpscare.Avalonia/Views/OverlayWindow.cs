using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Threading;

namespace FoxyJumpscare.Views;

/// <summary>
/// A fullscreen black overlay on every monitor, with an independent failsafe
/// teardown. Video playback is added in a later step; this proves the overlay
/// mechanics - all-monitor coverage and guaranteed self-close - cross-platform.
///
/// Mirrors the WPF build's invariant: the overlay ALWAYS tears itself down. A
/// timer closes it no matter what, so no bug can leave an un-closable
/// fullscreen window on screen.
/// </summary>
public static class OverlayWindow
{
    private static readonly List<Window> Open = new();

    public static void ShowAll(string? videoPath, int failsafeMs)
    {
        Close(); // never stack overlays

        var first = Build();
        first.Show();
        Open.Add(first);

        var screens = first.Screens.All;
        if (screens.Count > 0)
        {
            Place(first, screens[0]);
            for (var i = 1; i < screens.Count; i++)
            {
                var w = Build();
                w.Show();
                Open.Add(w);
                Place(w, screens[i]);
            }
        }

        // The failsafe. With video this becomes (duration + margin); until then
        // a short fixed lifetime. Never below ~1.2s so it is actually visible.
        DispatcherTimer.RunOnce(Close, TimeSpan.FromMilliseconds(Math.Max(1200, failsafeMs)));
    }

    private static void Place(Window w, Screen screen)
    {
        // Position in physical pixels, then FullScreen fills that monitor -
        // which sidesteps per-monitor DPI-to-DIP conversion entirely.
        w.Position = screen.Bounds.Position;
        w.WindowState = WindowState.FullScreen;
    }

    private static Window Build() => new()
    {
        SystemDecorations = SystemDecorations.None,
        Background = Brushes.Black,
        Topmost = true,
        ShowInTaskbar = false,
        CanResize = false,
        Content = new TextBlock
        {
            Text = "FOXY",
            Foreground = Brushes.DarkRed,
            FontSize = 120,
            FontWeight = FontWeight.Bold,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        },
    };

    public static void Close()
    {
        foreach (var w in Open)
        {
            try { w.Close(); }
            catch { /* already gone */ }
        }
        Open.Clear();
    }
}
