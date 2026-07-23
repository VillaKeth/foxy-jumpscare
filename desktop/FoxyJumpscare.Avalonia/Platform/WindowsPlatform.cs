using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace FoxyJumpscare.Platform;

[SupportedOSPlatform("windows")]
public sealed class WindowsPlatform : IPlatformServices
{
    public IIdleMonitor Idle { get; } = new WinIdle();
    public IAutostart Autostart { get; } = new WinAutostart();

    private sealed class WinIdle : IIdleMonitor
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct LastInputInfo
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        private static extern bool GetLastInputInfo(ref LastInputInfo plii);

        public double IdleSeconds()
        {
            var info = new LastInputInfo { cbSize = (uint)Marshal.SizeOf<LastInputInfo>() };
            if (!GetLastInputInfo(ref info)) return 0;

            // Both values are uint milliseconds since boot. The unchecked
            // subtraction is correct even across the ~49.7-day tick wrap,
            // because both operands wrap together.
            var idleMs = unchecked((uint)Environment.TickCount - info.dwTime);
            return idleMs / 1000.0;
        }
    }

    private sealed class WinAutostart : IAutostart
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string ValueName = "FoxyJumpscare";

        public bool IsEnabled
        {
            get
            {
                using var key = Registry.CurrentUser.OpenSubKey(RunKey);
                return key?.GetValue(ValueName) is not null;
            }
        }

        public void Set(bool enabled)
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKey);
            if (key is null) return;

            if (enabled)
            {
                var exe = Environment.ProcessPath;
                if (exe is not null) key.SetValue(ValueName, $"\"{exe}\"");
            }
            else
            {
                key.DeleteValue(ValueName, throwOnMissingValue: false);
            }
        }
    }
}
