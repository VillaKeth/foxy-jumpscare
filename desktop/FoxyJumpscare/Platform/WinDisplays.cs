using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FoxyJumpscare.Platform;

/// <summary>
/// Live monitor geometry from Win32, enumerated fresh on every scare.
///
/// The overlay must size itself to the monitors as they are *right now*. Reading
/// a cached snapshot is the bug that bit the Avalonia build under Remote Desktop:
/// connecting shrinks the desktop to the client's (smaller) resolution and
/// disconnecting restores it, and a stale cache kept sizing the overlay to the
/// remote resolution until the app was restarted.
///
/// WinForms' <c>Screen.AllScreens</c> caches too, and only drops the cache when
/// its display-change hook happens to run - good enough most of the time, but not
/// a guarantee. EnumDisplayMonitors reads the OS's current state with nothing
/// cached in between, so RDP, docking, monitor hot-swaps and resolution changes
/// can never leave the overlay mis-sized. That is the "prove it 100% of the time"
/// property we want.
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

    private delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdc, ref RECT lprc, IntPtr data);

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc proc, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO info);

    /// <summary>
    /// Every monitor's physical-pixel bounds, primary first. Primary-first ordering
    /// matches what the overlay relied on from Forms.Screen.PrimaryScreen: the one
    /// real MediaElement lands on the primary screen and the rest mirror it.
    /// </summary>
    public static List<Rectangle> Query()
    {
        var monitors = new List<Rectangle>();

        // The callback runs synchronously during EnumDisplayMonitors, so this
        // local delegate cannot be collected mid-enumeration.
        MonitorEnumProc callback = (IntPtr hMon, IntPtr hdc, ref RECT lprc, IntPtr data) =>
        {
            var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
            if (!GetMonitorInfo(hMon, ref mi)) return true;

            var rc = mi.rcMonitor;
            var bounds = new Rectangle(rc.Left, rc.Top, rc.Right - rc.Left, rc.Bottom - rc.Top);

            if ((mi.dwFlags & MONITORINFOF_PRIMARY) != 0) monitors.Insert(0, bounds);
            else monitors.Add(bounds);
            return true;
        };

        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
        return monitors;
    }
}
