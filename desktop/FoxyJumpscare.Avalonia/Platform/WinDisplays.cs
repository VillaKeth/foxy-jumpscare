using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Avalonia;

namespace FoxyJumpscare.Platform;

/// <summary>
/// Live monitor geometry from Win32, queried fresh on every scare.
///
/// Why not Avalonia's <c>Window.Screens</c>: that collection is cached, and
/// after a display-resolution change it can be left stale until the app is
/// restarted. Remote Desktop is the reproducer - connecting resizes the desktop
/// to the client's (smaller) resolution and disconnecting restores it, and
/// Avalonia missed the restore, so every subsequent scare sized itself to the
/// remote resolution and no longer covered the monitor.
///
/// EnumDisplayMonitors / GetMonitorInfo read the OS's current state with nothing
/// cached in between, so the overlay always fits each monitor as it is right
/// now - across RDP, docking, monitor hot-swaps, and resolution changes.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class WinDisplays
{
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public int dwFlags;
    }

    private const int MONITORINFOF_PRIMARY = 0x1;
    private const int MDT_EFFECTIVE_DPI = 0;

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT lprc, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);

    [DllImport("shcore.dll")]
    private static extern int GetDpiForMonitor(IntPtr hMonitor, int dpiType, out uint dpiX, out uint dpiY);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    private static readonly IntPtr HWND_TOPMOST = new(-1);
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;

    /// <summary>
    /// Make a window cover exactly this physical-pixel rectangle.
    ///
    /// This drives the HWND straight from Win32 instead of going through
    /// Avalonia's Position/Width/Height and WindowState.FullScreen. Those route
    /// the final size through Avalonia's cached screen list, which does not
    /// refresh when a Remote Desktop session hands the desktop back to the
    /// physical monitors - and because it is applied last, the stale cache
    /// overrode the live geometry the caller had just measured. The overlay came
    /// up at the remote machine's working area (a 1440x810 screen less its 57px
    /// taskbar) on a 1920x1080 monitor, every scare, until the app restarted.
    ///
    /// Nothing here is remembered between calls, so there is no cache left to go
    /// stale. Topmost with the monitor's full bounds also covers the taskbar,
    /// which is what fullscreen was there for.
    /// </summary>
    public static bool Cover(IntPtr hwnd, PixelRect bounds) =>
        hwnd != IntPtr.Zero &&
        SetWindowPos(hwnd, HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
                     SWP_NOACTIVATE | SWP_SHOWWINDOW);

    /// <summary>
    /// A window's real on-screen rectangle, so placement can be checked rather
    /// than assumed. The bug this guards against printed a correct intended size
    /// in the log while the window on screen was a different size entirely.
    /// </summary>
    public static PixelRect? RectOf(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !GetWindowRect(hwnd, out var r)) return null;
        return new PixelRect(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
    }

    /// <summary>Every monitor's physical-pixel bounds and DPI scaling, primary first.</summary>
    public static List<(PixelRect Bounds, double Scaling)> Query()
    {
        var monitors = new List<(PixelRect Bounds, double Scaling)>();

        // The callback runs synchronously during EnumDisplayMonitors, so this
        // local delegate cannot be collected mid-enumeration.
        MonitorEnumProc callback = (IntPtr hMon, IntPtr hdc, ref RECT lprc, IntPtr data) =>
        {
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(hMon, ref mi)) return true;

            var rc = mi.rcMonitor;
            var bounds = new PixelRect(rc.Left, rc.Top, rc.Right - rc.Left, rc.Bottom - rc.Top);

            double scaling = 1.0;
            try
            {
                if (GetDpiForMonitor(hMon, MDT_EFFECTIVE_DPI, out var dpiX, out _) == 0 && dpiX > 0)
                    scaling = dpiX / 96.0;
            }
            catch { /* pre-8.1 or shcore missing: physical == logical, leave 1.0 */ }

            var entry = (bounds, scaling);
            // Primary monitor first, to match how the rest of the app enumerates.
            if ((mi.dwFlags & MONITORINFOF_PRIMARY) != 0) monitors.Insert(0, entry);
            else monitors.Add(entry);
            return true;
        };

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
        return monitors;
    }
}
