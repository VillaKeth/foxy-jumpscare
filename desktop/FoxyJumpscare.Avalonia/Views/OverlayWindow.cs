using System.Runtime.InteropServices;
using System.Runtime.Versioning;
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

    /// <summary>
    /// Width of one composited frame. Equals <see cref="_width"/> for the opaque
    /// cut, and half of it for the side-by-side matte cut, where the decoded
    /// picture is [colour | alpha] and only the left half is the picture.
    /// </summary>
    private static int _frameWidth;

    /// <summary>Whether the loaded video carries its alpha as a second half.</summary>
    private static bool _matte;

    private static volatile bool _tearing;
    private static int _frames;
    private static int _marginMs = 1500;

    /// <summary>How long the last frame holds after the clip ends.</summary>
    private static int _holdMs = 600;

    /// <summary>
    /// Time from "the scare fired" to each stage of getting a picture up. The
    /// gap that matters is fire -> first frame: until then the overlay is an
    /// empty transparent window and, to the user, nothing has happened yet.
    /// </summary>
    private static readonly System.Diagnostics.Stopwatch _since = new();

    private static readonly List<Window> _windows = new();
    private static readonly List<Image> _images = new();

    /// <summary>
    /// Serialises <see cref="Vlc"/>, which is now reached from two threads: the
    /// UI thread when a scare fires, and a background thread at startup via
    /// <see cref="Prewarm"/>.
    /// </summary>
    private static readonly object _vlcGate = new();

    /// <summary>
    /// Build the libVLC instance ahead of time, off the UI thread.
    ///
    /// Measured on the real machine: the FIRST scare of a session spent 360ms
    /// inside Core.Initialize() and plugin loading before a single frame
    /// reached the screen, against 25ms for every scare after it. That is the
    /// whole of the "sometimes Foxy takes a moment to jump" report - it is not
    /// decode, and it is not the overlay. Nothing here is on a deadline at
    /// startup, so paying it then costs nobody anything.
    ///
    /// Best effort by design: if libVLC cannot be built now it will be retried
    /// on the fire path, which already handles the failure and explains it.
    /// </summary>
    public static void Prewarm()
    {
        Task.Run(() =>
        {
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                Vlc();
                if (Trace) Log($"prewarmed libvlc in {sw.ElapsedMilliseconds}ms");
            }
            catch (Exception ex)
            {
                Log($"libvlc prewarm failed, will retry on first scare: {ex.Message}");
            }
        });

        // Avalonia's FIRST window costs about 150ms to build - renderer and
        // compositor setup, plus JIT of this whole path - and every one after
        // it about 20ms. With libVLC moved off the critical path that was the
        // largest remaining chunk of the first scare's delay. Build one and
        // throw it away, well off-screen so nothing can flash.
        //
        // Background priority: the tray icon has to appear first. register:false
        // keeps its Image out of the list the real scare paints into.
        Dispatcher.UIThread.Post(() =>
        {
            try
            {
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var w = BuildWindow(register: false);
                w.Width = 1;
                w.Height = 1;
                w.Position = new PixelPoint(-32000, -32000);
                w.Show();
                w.Close();
                if (Trace) Log($"prewarmed window in {sw.ElapsedMilliseconds}ms");
            }
            catch (Exception ex)
            {
                Log($"window prewarm failed, harmless: {ex.Message}");
            }
        }, DispatcherPriority.Background);
    }

    private static LibVLC Vlc()
    {
        lock (_vlcGate)
        {
            return VlcLocked();
        }
    }

    private static LibVLC VlcLocked()
    {
        if (_libvlc is null)
        {
            // Must come first: on Linux/macOS the system libvlc is versioned
            // (libvlc.so.5) and .NET's default probe never finds it.
            Platform.VlcNative.Register();

            // Fully qualified: bare "Core" would bind to the FoxyJumpscare.Core
            // namespace, not LibVLCSharp's Core class.
            LibVLCSharp.Shared.Core.Initialize();

            // WaveOut on Windows, not libVLC's own default of mmdevice
            // (WASAPI): WASAPI crashed this STA app once audio actually played,
            // and the DirectSound module opened a device that never reached the
            // speakers. WaveOut routes to the system default output - the one
            // the user actually hears - and is rock-simple. Other OSes keep
            // their sensible defaults (PulseAudio/PipeWire, CoreAudio).
            // FOXY_AOUT overrides.
            var aout = Environment.GetEnvironmentVariable("FOXY_AOUT");

            // FOXY_MUTE has to pick a silent OUTPUT MODULE, not just set
            // MediaPlayer.Mute: libVLC drops a mute/volume set that lands
            // before the audio output exists, and the trace showed mute=False
            // reading straight back. adummy cannot make a sound.
            if (MuteAll && string.IsNullOrEmpty(aout))
                aout = "adummy";
            else if (string.IsNullOrEmpty(aout) && OperatingSystem.IsWindows())
                aout = "waveout";

            _libvlc = string.IsNullOrEmpty(aout) ? new LibVLC() : new LibVLC($"--aout={aout}");

            if (Trace)
                _libvlc.Log += (_, e) =>
                {
                    if (e.Level >= LogLevel.Warning)
                        Console.Error.WriteLine($"[vlc:{e.Level}] {e.Module}: {e.Message}");
                };
        }
        return _libvlc;
    }

    /// <param name="sideBySideMatte">
    /// True when <paramref name="videoPath"/> is the [colour | alpha] cut built
    /// by tools/lib/ffmpeg-args.mjs <c>buildMatteArgs</c>. False for the plain
    /// opaque cut, which composites over black exactly as it always did.
    /// </param>
    public static void ShowAll(
        string? videoPath, int failsafeMarginMs, bool sideBySideMatte = false, int holdMs = 600)
    {
        Close(); // never stack overlays
        _tearing = false;
        _marginMs = failsafeMarginMs;
        _holdMs = holdMs;
        _matte = sideBySideMatte;
        _since.Restart();

        // Build the first window up front; on non-Windows it also carries the
        // Screens enumeration.
        var first = BuildWindow();
        first.Show();
        _windows.Add(first);

        // Monitor geometry, queried LIVE each fire. On Windows this comes from
        // Win32 directly (WinDisplays) rather than Avalonia's Window.Screens,
        // which caches and can be left stale by a resolution change - Remote
        // Desktop connect/disconnect being the reproducer. A stale cache is why
        // the overlay kept coming up at the smaller remote size, every scare,
        // until the app was restarted.
        var monitors = OperatingSystem.IsWindows()
            ? Platform.WinDisplays.Query()
            : first.Screens.All.Select(s => (Bounds: s.Bounds, Scaling: (double)s.Scaling)).ToList();

        if (monitors.Count == 0)
            monitors = new List<(PixelRect Bounds, double Scaling)> { (new PixelRect(0, 0, 1920, 1080), 1.0) };

        // One overlay window per monitor.
        while (_windows.Count < monitors.Count)
        {
            var w = BuildWindow();
            w.Show();
            _windows.Add(w);
        }

        for (var i = 0; i < monitors.Count && i < _windows.Count; i++)
            Place(_windows[i], monitors[i].Bounds, monitors[i].Scaling);

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
            if (Trace) Log($"t+{_since.ElapsedMilliseconds}ms libvlc ready");

            var media = new Media(vlc, videoPath, FromType.FromPath);

            // Parse for the real dimensions rather than assuming; fall back to
            // 720p if the parse turns up nothing.
            await media.Parse(MediaParseOptions.ParseLocal);
            if (Trace) Log($"t+{_since.ElapsedMilliseconds}ms parsed");
            var track = media.Tracks.FirstOrDefault(t => t.TrackType == TrackType.Video);
            _width = (int)(track.Data.Video.Width == 0 ? 1280 : track.Data.Video.Width);
            _height = (int)(track.Data.Video.Height == 0 ? 720 : track.Data.Video.Height);
            _stride = _width * 4;

            // An odd width cannot be split down the middle. Rather than blit
            // half a pixel off, fall back to treating the whole picture as
            // opaque - a black scare beats a torn one.
            if (_matte && _width % 2 != 0)
            {
                Log($"matte cut is {_width}px wide, not divisible by 2; falling back to opaque");
                _matte = false;
            }

            _frameWidth = _matte ? _width / 2 : _width;

            _buffer = Marshal.AllocHGlobal(_stride * _height);
            _bitmap = new WriteableBitmap(
                new PixelSize(_frameWidth, _height), new Vector(96, 96),
                PixelFormat.Bgra8888,
                // The colour half is flattened over black, which IS premultiplied
                // alpha - so no divide, and no bright halo around dark edges.
                _matte ? AlphaFormat.Premul : AlphaFormat.Opaque);

            foreach (var image in _images) image.Source = _bitmap;

            if (Trace && _windows.Count > 0)
                Log($"video {_width}x{_height} -> frame {_frameWidth}x{_height} " +
                    $"matte={_matte} transparency={_windows[0].ActualTransparencyLevel}");

            var player = new MediaPlayer(vlc);
            player.SetVideoFormat("RV32", (uint)_width, (uint)_height, (uint)_stride);
            player.SetVideoCallbacks(_lockCb, null, _displayCb);

            player.Playing += (_, _) =>
            {
                // Re-assert after playback starts: libVLC can ignore volume/mute
                // set before Play.
                player.Volume = 100;
                player.Mute = MuteAll;
                if (Trace)
                    Log($"playing; audioTracks={player.AudioTrackCount} vol={player.Volume} mute={player.Mute}");
            };

            // Hold the PLAYER past the end so the audio buffer drains: closing
            // the instant a sub-second clip decodes cut the scream before it
            // reached the speakers - the "no sound" bug.
            //
            // Hold the PICTURE for none of it. The margin used to leave the last
            // decoded frame frozen on screen for its whole duration, which was
            // two thirds of the scare: 0.77s of lunge followed by 1.5s of Foxy
            // hanging there, measured. He should land and be gone. Hiding the
            // image ends the visual on the last frame while the player, and so
            // the audio, keeps running underneath.
            player.EndReached += (_, _) => Dispatcher.UIThread.Post(() =>
            {
                // Never outlast the close, which frees the buffer this is
                // drawing from.
                var hold = Math.Clamp(_holdMs, 0, Math.Max(300, _marginMs));

                void HidePicture()
                {
                    foreach (var image in _images) image.IsVisible = false;
                    if (Trace) Log($"t+{_since.ElapsedMilliseconds}ms picture hidden");
                }

                if (hold <= 0) HidePicture();
                else DispatcherTimer.RunOnce(HidePicture, TimeSpan.FromMilliseconds(hold));

                DispatcherTimer.RunOnce(Close, TimeSpan.FromMilliseconds(Math.Max(300, _marginMs)));
            });
            if (Trace)
            {
                player.EndReached += (_, _) => Log($"t+{_since.ElapsedMilliseconds}ms end reached");
                player.EncounteredError += (_, _) => Log("libvlc error");
            }

            _media = media;
            _player = player;
            player.Play(media);
            if (Trace) Log($"t+{_since.ElapsedMilliseconds}ms play() returned");
        }
        catch (Exception ex)
        {
            Log($"video start failed: {ex.Message}");

            // LibVLCSharp's own message here tells you to install a
            // VideoLAN.LibVLC.<Platform> NuGet package, which is wrong on
            // Linux and macOS - the real cause is almost always libvlc being
            // present while its PLUGINS are not. Fedora's vlc-libs ships the
            // library and an empty plugin directory, which fails exactly this
            // way and sends you hunting for a NuGet package that does not
            // apply.
            if (!OperatingSystem.IsWindows())
                Log("hint: the system VLC libraries are needed - " +
                    "apt install libvlc5 vlc-plugin-base / " +
                    "dnf install vlc-libs vlc-plugins-base / " +
                    "pacman -S vlc / " +
                    "brew install vlc");
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

                if (!_matte)
                {
                    for (var y = 0; y < _height; y++)
                        Buffer.MemoryCopy(src + y * _stride, dst + y * fb.RowBytes, fb.RowBytes, _stride);
                }
                else
                {
                    // Reassemble BGRA from the two halves of the decoded picture:
                    // colour on the left, alpha matte on the right. The matte is
                    // grey, so any one of its channels is the alpha - green is
                    // taken because it is the channel VP9 codes most precisely.
                    var w = _frameWidth;
                    for (var y = 0; y < _height; y++)
                    {
                        var srow = src + y * _stride;
                        var drow = dst + y * fb.RowBytes;
                        var mrow = srow + w * 4;

                        for (var x = 0; x < w; x++)
                        {
                            var s = srow + x * 4;
                            var d = drow + x * 4;
                            d[0] = s[0];              // B
                            d[1] = s[1];              // G
                            d[2] = s[2];              // R
                            d[3] = (mrow + x * 4)[1]; // A, from the matte's green
                        }
                    }
                }
            }

            foreach (var image in _images) image.InvalidateVisual();
            if (Trace && _frames == 0) Log($"t+{_since.ElapsedMilliseconds}ms FIRST FRAME on screen");
            _frames++;
        }, DispatcherPriority.Render);
    }

    // --- windows -------------------------------------------------------------

    /// <param name="register">
    /// False only for the throwaway window <see cref="Prewarm"/> builds. Its
    /// Image must not join <see cref="_images"/>, or the next real scare would
    /// try to paint frames into a window that no longer exists.
    /// </param>
    private static Window BuildWindow(bool register = true)
    {
        var image = new Image
        {
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        if (register) _images.Add(image);

        return new Window
        {
            SystemDecorations = SystemDecorations.None,

            // Transparent, so Foxy lunges over the desktop you were actually
            // looking at. This used to be Brushes.Black, which turned the scare
            // into a video player covering the screen.
            //
            // Background and TransparencyLevelHint are both required and do
            // different jobs: the hint asks the platform for a per-pixel-alpha
            // window, the brush stops Avalonia painting an opaque fill inside
            // it. Setting only one leaves the window black.
            //
            // If the platform refuses the hint, ActualTransparencyLevel comes
            // back as None and the frames composite over black - which is
            // exactly the old behaviour, not a broken one. StartVideo logs it.
            Background = Brushes.Transparent,
            TransparencyLevelHint = new[] { WindowTransparencyLevel.Transparent },

            Topmost = true,
            ShowInTaskbar = false,
            CanResize = false,
            Content = image,
        };
    }

    private static void Place(Window w, PixelRect bounds, double scaling)
    {
        // Windows drives the HWND directly: Avalonia's FullScreen sizes from a
        // cached screen list that survives an RDP round trip stale, and being
        // applied last it beat the live geometry measured just above. See
        // WinDisplays.Cover.
        if (OperatingSystem.IsWindows())
        {
            PlaceWin32(w, bounds);
            return;
        }

        // Physical-pixel position, then FullScreen fills that monitor - which
        // sidesteps per-monitor DPI-to-DIP conversion.
        w.Position = bounds.Position;

        // Size the window explicitly as well, because FullScreen is only a
        // REQUEST: on X11 it is _NET_WM_STATE_FULLSCREEN, which a window
        // manager has to honour. Measured on a bare X server with no WM, the
        // scare rendered at the video's natural size in the top-left corner
        // instead of covering the screen. Sizing first means the overlay
        // covers the monitor even if the request is ignored; where it is
        // honoured, FullScreen wins and this is a no-op. Bounds are physical
        // pixels; Width/Height are DIPs.
        var s = scaling <= 0 ? 1 : scaling;
        w.Width = bounds.Width / s;
        w.Height = bounds.Height / s;

        w.WindowState = WindowState.FullScreen;

        if (Trace)
            Log($"placed monitor {bounds.Width}x{bounds.Height} @({bounds.X},{bounds.Y}) " +
                $"scaling={s:0.##} -> window {w.Width:0}x{w.Height:0} DIP");
    }

    /// <summary>
    /// Cover a monitor on Windows, in physical pixels, with no Avalonia sizing
    /// in the path - then check the window actually landed there and correct it
    /// once if it did not.
    ///
    /// The check is not paranoia about this specific call: the bug it replaces
    /// logged a perfectly correct intended size while the window on screen was
    /// the wrong size, so intent alone is not evidence. Measuring the result
    /// means any future source of divergence self-corrects and says so.
    /// </summary>
    [SupportedOSPlatform("windows")]
    private static void PlaceWin32(Window w, PixelRect bounds)
    {
        var hwnd = w.TryGetPlatformHandle()?.Handle ?? IntPtr.Zero;
        if (hwnd == IntPtr.Zero)
        {
            // No native handle yet. Fall back rather than skip: a scare at the
            // wrong size still beats no scare at all.
            w.Position = bounds.Position;
            w.WindowState = WindowState.FullScreen;
            Log("no HWND at placement time; fell back to Avalonia FullScreen");
            return;
        }

        Platform.WinDisplays.Cover(hwnd, bounds);

        // Only meaningful now that the overlay is see-through: a transparent
        // window that still swallowed clicks would read as a frozen machine.
        Platform.WinDisplays.ClickThrough(hwnd);

        if (Trace)
            Log($"placed monitor {bounds.Width}x{bounds.Height} @({bounds.X},{bounds.Y}) via Win32");

        DispatcherTimer.RunOnce(() =>
        {
            if (_tearing) return;
            var actual = Platform.WinDisplays.RectOf(hwnd);
            if (actual is not { } r || r == bounds) return;

            Log($"placement drifted: wanted {bounds.Width}x{bounds.Height} @({bounds.X},{bounds.Y}), " +
                $"got {r.Width}x{r.Height} @({r.X},{r.Y}) - reasserting");
            Platform.WinDisplays.Cover(hwnd, bounds);
        }, TimeSpan.FromMilliseconds(250));
    }

    public static void Close()
    {
        if (Trace && _windows.Count > 0)
            Log($"t+{_since.ElapsedMilliseconds}ms closing: {_frames} frames rendered " +
                $"across {_windows.Count} monitor(s)");
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

    private static void Log(string message) =>
        Console.Error.WriteLine($"[foxy overlay +{Environment.TickCount & 0xFFFFF}ms] {message}");
}
