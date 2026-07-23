using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FoxyJumpscare.Platform;

/// <summary>
/// Linux implementation, verified on Ubuntu 24.04 - see docs/cross-platform.md.
///
/// Idle detection uses the X11 XScreenSaver extension. On Wayland there is no
/// portable equivalent, so the query fails and we report "active" - the
/// countdown then advances even while the user is away, which over-fires
/// rather than not firing. Autostart is an XDG .desktop file, which every
/// mainstream desktop environment honours.
/// </summary>
[SupportedOSPlatform("linux")]
public sealed class LinuxPlatform : IPlatformServices
{
    public IIdleMonitor Idle { get; } = new X11Idle();
    public IAutostart Autostart { get; } = new XdgAutostart();

    private sealed class X11Idle : IIdleMonitor
    {
        [DllImport("libX11.so.6")]
        private static extern IntPtr XOpenDisplay(string? displayName);

        [DllImport("libX11.so.6")]
        private static extern IntPtr XDefaultRootWindow(IntPtr display);

        [DllImport("libXss.so.1")]
        private static extern IntPtr XScreenSaverAllocInfo();

        [DllImport("libXss.so.1")]
        private static extern int XScreenSaverQueryInfo(
            IntPtr display, IntPtr drawable, IntPtr info);

        // XScreenSaverInfo layout: Window window; int state; int kind;
        // unsigned long til_or_since; unsigned long idle; unsigned long eventMask.
        // idle (ms) sits after two IntPtr-sized fields, two ints, and one
        // unsigned long.
        private static readonly int IdleOffset =
            IntPtr.Size + sizeof(int) + sizeof(int) + IntPtr.Size;

        // The display connection and the info block are opened ONCE and reused.
        //
        // This is load-bearing, not an optimisation. Opening and closing a
        // display on every query resets the X server's idle counter: measured
        // on Ubuntu 24.04, a per-call connection reported a flat ~0.49s while
        // polling every 500ms - i.e. exactly the time since the previous call,
        // never the real idle time. The monitor would then believe the user is
        // always at the keyboard and the scare would fire while they are away.
        // Long-lived X clients are also what every real idle daemon does.
        private IntPtr _display;
        private IntPtr _info;
        private bool _unavailable;
        private readonly object _gate = new();

        public double IdleSeconds()
        {
            // Xlib connections are not thread-safe without XInitThreads, and
            // both the tick timer and the settings window can ask.
            lock (_gate)
            {
                if (_unavailable) return 0;
                try
                {
                    if (_display == IntPtr.Zero)
                    {
                        _display = XOpenDisplay(null);
                        // No X11 at all (Wayland/headless). Latch it: retrying
                        // every second would just burn syscalls.
                        if (_display == IntPtr.Zero) { _unavailable = true; return 0; }
                    }

                    if (_info == IntPtr.Zero)
                    {
                        _info = XScreenSaverAllocInfo();
                        if (_info == IntPtr.Zero) { _unavailable = true; return 0; }
                    }

                    var root = XDefaultRootWindow(_display);
                    // Returns 0 when the server lacks MIT-SCREEN-SAVER (e.g.
                    // Xwayland). Not fatal, and not latched - report active.
                    if (XScreenSaverQueryInfo(_display, root, _info) == 0) return 0;

                    var idleMs = (ulong)Marshal.ReadIntPtr(_info, IdleOffset).ToInt64();
                    return idleMs / 1000.0;
                }
                catch
                {
                    _unavailable = true;
                    return 0;
                }
            }
        }
    }

    private sealed class XdgAutostart : IAutostart
    {
        private static string DesktopPath => System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "autostart", "foxyjumpscare.desktop");

        public bool IsEnabled => System.IO.File.Exists(DesktopPath);

        public void Set(bool enabled)
        {
            var path = DesktopPath;
            if (!enabled)
            {
                if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
                return;
            }

            var exe = Environment.ProcessPath ?? "";
            var entry =
                "[Desktop Entry]\n" +
                "Type=Application\n" +
                "Name=Foxy Jumpscare\n" +
                $"Exec=\"{exe}\"\n" +
                "X-GNOME-Autostart-enabled=true\n" +
                "NoDisplay=true\n";

            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
            System.IO.File.WriteAllText(path, entry);
        }
    }
}
