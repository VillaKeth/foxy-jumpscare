using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Threading;
using LibVLCSharp.Avalonia;
using LibVLCSharp.Shared;

namespace FoxyJumpscare.Views;

/// <summary>
/// The fullscreen scare, on every monitor, with an independent failsafe
/// teardown. Video plays through LibVLCSharp - the one mature cross-platform
/// media path for Avalonia; WPF's MediaElement has no equivalent here.
///
/// One decoder per monitor rather than mirroring a single one, because
/// LibVLCSharp binds one MediaPlayer to one VideoView. All but the first are
/// muted, so the scream plays once. The overlay ALWAYS tears itself down:
/// normal dismissal is the primary player's EndReached, and an independent
/// hard timer closes everything regardless, so a video that never decodes
/// cannot strand a fullscreen window on screen.
/// </summary>
public static class OverlayWindow
{
    private static readonly bool Trace =
        Environment.GetEnvironmentVariable("FOXY_TRACE") == "1";

    // Mutes even the primary player. For testing without a scream, and it is
    // the honest way to "leave it armed but silent while I work".
    private static readonly bool MuteAll =
        Environment.GetEnvironmentVariable("FOXY_MUTE") == "1";

    private static LibVLC? _libvlc;
    private static readonly List<Window> _windows = new();
    private static readonly List<VideoView> _views = new();
    private static readonly List<MediaPlayer> _players = new();
    private static readonly List<Media> _media = new();

    private static LibVLC Vlc()
    {
        if (_libvlc is null)
        {
            // Fully qualified: bare "Core" would bind to the FoxyJumpscare.Core
            // namespace, not LibVLCSharp's Core class.
            LibVLCSharp.Shared.Core.Initialize();
            _libvlc = new LibVLC();
        }
        return _libvlc;
    }

    public static void ShowAll(string? videoPath, int failsafeMarginMs)
    {
        Close(); // never stack overlays

        var probe = BuildWindow();
        probe.Show();
        _windows.Add(probe);

        var screens = probe.Screens.All;
        for (var i = 1; i < screens.Count; i++)
        {
            var w = BuildWindow();
            w.Show();
            _windows.Add(w);
        }
        for (var i = 0; i < _windows.Count && i < screens.Count; i++)
            Place(_windows[i], screens[i]);

        if (videoPath is not null)
        {
            try { StartVideo(videoPath); }
            catch (Exception ex) { Log($"video start failed: {ex.Message}"); }
        }

        // The hard failsafe. Independent of media state: even if nothing ever
        // decodes or EndReached never fires, the overlay is gone by now.
        var hardMs = Math.Max(4000, failsafeMarginMs + 8000);
        DispatcherTimer.RunOnce(Close, TimeSpan.FromMilliseconds(hardMs));
    }

    private static void StartVideo(string videoPath)
    {
        var vlc = Vlc();

        for (var i = 0; i < _windows.Count; i++)
        {
            var player = new MediaPlayer(vlc) { Mute = i != 0 || MuteAll }; // scream once
            var view = new VideoView { MediaPlayer = player };
            _windows[i].Content = view;

            // FromPath, not a Uri: the install path legitimately contains
            // spaces, which a file:// Uri would have to escape.
            var media = new Media(vlc, videoPath, FromType.FromPath);
            _media.Add(media);
            _players.Add(player);
            _views.Add(view);
            player.Play(media);
        }

        var primary = _players[0];
        // Stop() must not be called from inside the EndReached callback (it
        // deadlocks libVLC), so bounce to the UI thread.
        primary.EndReached += (_, _) => Dispatcher.UIThread.Post(Close);
        if (Trace)
        {
            primary.Playing += (_, _) => Log("playing");
            primary.EndReached += (_, _) => Log("end reached");
            primary.EncounteredError += (_, _) => Log("libvlc error");
        }
    }

    private static Window BuildWindow() => new()
    {
        SystemDecorations = SystemDecorations.None,
        Background = Brushes.Black,
        Topmost = true,
        ShowInTaskbar = false,
        CanResize = false,
    };

    private static void Place(Window w, Screen screen)
    {
        // Physical-pixel position, then FullScreen fills that monitor - which
        // sidesteps per-monitor DPI-to-DIP conversion.
        w.Position = screen.Bounds.Position;
        w.WindowState = WindowState.FullScreen;
    }

    public static void Close()
    {
        // Order matters, and getting it wrong is a native use-after-free.
        // Detach each player from its VideoView FIRST, so closing the window
        // does not tear down a native host that still points at a player we are
        // about to dispose. Then stop, then close windows, then dispose.
        foreach (var view in _views)
        {
            try { view.MediaPlayer = null; } catch { }
        }
        _views.Clear();

        foreach (var player in _players)
        {
            try { player.Stop(); } catch { }
        }

        foreach (var w in _windows)
        {
            try { w.Close(); } catch { }
        }
        _windows.Clear();

        // Dispose the now-detached, stopped players off the UI thread after a
        // short beat. libVLC can fault if a player is disposed while its vout
        // is still tearing down on another thread; letting the windows finish
        // closing first avoids the race.
        var players = _players.ToList();
        var media = _media.ToList();
        _players.Clear();
        _media.Clear();
        Task.Run(async () =>
        {
            await Task.Delay(300);
            foreach (var p in players) { try { p.Dispose(); } catch { } }
            foreach (var m in media) { try { m.Dispose(); } catch { } }
        });
    }

    private static void Log(string message) => Console.Error.WriteLine($"[foxy overlay] {message}");
}
