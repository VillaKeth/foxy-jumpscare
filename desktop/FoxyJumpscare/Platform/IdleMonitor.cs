using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace FoxyJumpscare.Platform;

/// <summary>
/// System-wide input idle time and session lock state. This is what makes
/// "1 in N per second" mean per second of actually using the computer, rather
/// than per second of the machine being powered on - and it is why the overlay
/// never fires to an empty desk at 4am.
/// </summary>
public static class IdleMonitor
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    private static bool _locked;

    static IdleMonitor()
    {
        SystemEvents.SessionSwitch += (_, e) =>
        {
            if (e.Reason == SessionSwitchReason.SessionLock) _locked = true;
            else if (e.Reason == SessionSwitchReason.SessionUnlock) _locked = false;
        };
    }

    public static bool IsSessionLocked => _locked;

    public static TimeSpan GetIdleTime()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info)) return TimeSpan.Zero;

        // dwTime comes from GetTickCount, which wraps every ~49.7 days.
        // Unsigned subtraction gives the correct delta across the wrap; signed
        // arithmetic would produce a huge bogus idle time and silently stop the
        // clock for a machine that had been up that long.
        var now = unchecked((uint)Environment.TickCount);
        var idleMs = unchecked(now - info.dwTime);
        return TimeSpan.FromMilliseconds(idleMs);
    }

    /// <summary>Active means recent input and an unlocked session. Both.</summary>
    public static bool IsActive(int idleThresholdSeconds) =>
        !IsSessionLocked && GetIdleTime().TotalSeconds < idleThresholdSeconds;
}
