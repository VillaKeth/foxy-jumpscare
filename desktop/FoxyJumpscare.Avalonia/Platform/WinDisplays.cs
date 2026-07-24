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
