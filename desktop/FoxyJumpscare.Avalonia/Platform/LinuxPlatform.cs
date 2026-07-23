using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FoxyJumpscare.Platform;

/// <summary>
/// Linux implementation. Written from the documented APIs but NOT yet run on
/// real hardware - see docs/cross-platform.md.
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

        public double IdleSeconds()
        {
            IntPtr display = IntPtr.Zero;
            IntPtr info = IntPtr.Zero;
            try
            {
                display = XOpenDisplay(null);
                if (display == IntPtr.Zero) return 0; // no X11 (Wayland/headless)

                info = XScreenSaverAllocInfo();
                if (info == IntPtr.Zero) return 0;

                var root = XDefaultRootWindow(display);
                if (XScreenSaverQueryInfo(display, root, info) == 0) return 0;

                var idleMs = (ulong)Marshal.ReadIntPtr(info, IdleOffset).ToInt64();
                return idleMs / 1000.0;
            }
            catch
            {
                return 0;
            }
            finally
            {
                if (info != IntPtr.Zero) XFree(info);
                if (display != IntPtr.Zero) XCloseDisplay(display);
            }
        }

        [DllImport("libX11.so.6")]
        private static extern int XCloseDisplay(IntPtr display);

        [DllImport("libX11.so.6")]
        private static extern int XFree(IntPtr data);
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
