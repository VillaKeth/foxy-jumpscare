using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using LibVLCSharp.Shared;

namespace FoxyJumpscare.Views;

/// <summary>
/// The fullscreen scare, on every monitor, in sync.
///
/// ONE decoder, mirrored to every screen - the same lesson the WPF build
/// learned. libVLC renders into a single shared buffer via software callbacks;
/// that buffer is copied into one <see cref="WriteableBitmap"/> shown by an
/// Image on each monitor. Because every monitor draws the same bitmap, they are
/// identical frame-for-frame - no per-decoder drift, and the scream (one
/// player) plays once.
///
/// The overlay ALWAYS tears itself down: EndReached is the normal dismissal, an
/// independent hard timer is the backstop, and teardown stops the player before
/// freeing the buffer so a late callback can never touch freed memory.
/// </summary>
public static class OverlayWindow
{
    private static readonly bool Trace =
        Environment.GetEnvironmentVariable("FOXY_TRACE") == "1";
    private static readonly bool MuteAll =
        Environment.GetEnvironmentVariable("FOXY_MUTE") == "1";

    // Kept in static fields so the GC cannot collect the delegates while libVLC
    // still holds native pointers to them.
    private static readonly MediaPlayer.LibVLCVideoLockCb _lockCb = OnLock;
    private static readonly MediaPlayer.LibVLCVideoDisplayCb _displayCb = OnDisplay;

    private static LibVLC? _libvlc;
    private static MediaPlayer? _player;
    private static Media? _media;
    private static WriteableBitmap? _bitmap;
    private static IntPtr _buffer;
    private static int _width, _height, _stride;
    private static volatile bool _tearing;
    private static int _frames;

    private static readonly List<Window> _windows = new();
    private static readonly List<Image> _images = new();

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
        _tearing = false;

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
            StartVideo(videoPath);

        // The hard failsafe: independent of media state. Even if nothing ever
        // decodes, the overlay is gone by now.
        var hardMs = Math.Max(4000, failsafeMarginMs + 8000);
        DispatcherTimer.RunOnce(Close, TimeSpan.FromMilliseconds(hardMs));
    }

    private static async void StartVideo(string videoPath)
    {
        try
        {
            var vlc = Vlc();
            var media = new Media(vlc, videoPath, FromType.FromPath);

            // Parse for the real dimensions rather than assuming; fall back to
            // 720p if the parse turns up nothing.
            await media.Parse(MediaParseOptions.ParseLocal);
            var track = media.Tracks.FirstOrDefault(t => t.TrackType == TrackType.Video);
            _width = (int)(track.Data.Video.Width == 0 ? 1280 : track.Data.Video.Width);
            _height = (int)(track.Data.Video.Height == 0 ? 720 : track.Data.Video.Height);
            _stride = _width * 4;

            _buffer = Marshal.AllocHGlobal(_stride * _height);
            _bitmap = new WriteableBitmap(
                new PixelSize(_width, _height), new Vector(96, 96),
                PixelFormat.Bgra8888, AlphaFormat.Opaque);

            foreach (var image in _images) image.Source = _bitmap;

            var player = new MediaPlayer(vlc) { Mute = MuteAll };
            player.SetVideoFormat("RV32", (uint)_width, (uint)_height, (uint)_stride);
            player.SetVideoCallbacks(_lockCb, null, _displayCb);
            player.EndReached += (_, _) => Dispatcher.UIThread.Post(Close);
            if (Trace)
            {
                player.Playing += (_, _) => Log("playing");
                player.EndReached += (_, _) => Log("end reached");
                player.EncounteredError += (_, _) => Log("libvlc error");
            }

            _media = media;
            _player = player;
            player.Play(media);
        }
        catch (Exception ex)
        {
            Log($"video start failed: {ex.Message}");
        }
    }

    // --- libVLC software-render callbacks (called on a libVLC thread) --------

    private static IntPtr OnLock(IntPtr opaque, IntPtr planes)
    {
        if (_buffer != IntPtr.Zero) Marshal.WriteIntPtr(planes, _buffer);
        return _buffer;
    }

    private static unsafe void OnDisplay(IntPtr opaque, IntPtr picture)
    {
        // Copy the freshly decoded frame into the shared bitmap on the UI
        // thread, then repaint every monitor's Image from it.
        Dispatcher.UIThread.Post(() =>
        {
            if (_tearing || _bitmap is null || _buffer == IntPtr.Zero) return;

            using (var fb = _bitmap.Lock())
            {
                var src = (byte*)_buffer;
                var dst = (byte*)fb.Address;
                for (var y = 0; y < _height; y++)
                    Buffer.MemoryCopy(src + y * _stride, dst + y * fb.RowBytes, fb.RowBytes, _stride);
            }

            foreach (var image in _images) image.InvalidateVisual();
            _frames++;
        }, DispatcherPriority.Render);
    }

    // --- windows -------------------------------------------------------------

    private static Window BuildWindow()
    {
        var image = new Image
        {
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        _images.Add(image);

        return new Window
        {
            SystemDecorations = SystemDecorations.None,
            Background = Brushes.Black,
            Topmost = true,
            ShowInTaskbar = false,
            CanResize = false,
            Content = image,
        };
    }

    private static void Place(Window w, Screen screen)
    {
        // Physical-pixel position, then FullScreen fills that monitor - which
        // sidesteps per-monitor DPI-to-DIP conversion.
        w.Position = screen.Bounds.Position;
        w.WindowState = WindowState.FullScreen;
    }

    public static void Close()
    {
        if (Trace && _windows.Count > 0)
            Log($"closing: {_frames} frames rendered across {_windows.Count} monitor(s)");
        _tearing = true;
        _frames = 0;

        // Stop the player FIRST, so no lock/display callback can run once the
        // buffer is freed below. Stop() blocks until playback has ended.
        var player = _player;
        var media = _media;
        _player = null;
        _media = null;
        if (player is not null)
        {
            try { player.Stop(); } catch { }
        }

        foreach (var w in _windows)
        {
            try { w.Close(); } catch { }
        }
        _windows.Clear();
        _images.Clear();
        _bitmap = null;

        var buffer = _buffer;
        _buffer = IntPtr.Zero;

        // Dispose off the UI thread after a beat: libVLC can fault if a player
        // is disposed while its threads are still unwinding. The buffer is
        // freed only after the player is gone, so no callback outlives it.
        Task.Run(async () =>
        {
            await Task.Delay(300);
            try { player?.Dispose(); } catch { }
            try { media?.Dispose(); } catch { }
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
        });
    }

    private static void Log(string message) => Console.Error.WriteLine($"[foxy overlay] {message}");
}
