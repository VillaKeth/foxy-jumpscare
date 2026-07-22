using Microsoft.Win32;

namespace FoxyJumpscare.Platform;

/// <summary>
/// Opt-in only, off by default. Note that this Run key plus a resident process
/// plus a fullscreen topmost window is close to the behaviour profile antivirus
/// heuristics watch for; expect SmartScreen on an unsigned build.
/// </summary>
public static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "FoxyJumpscare";

    private static string ExecutablePath =>
        Environment.ProcessPath ?? throw new InvalidOperationException("No process path");

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is not null;
        }
    }

    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true)
                        ?? Registry.CurrentUser.CreateSubKey(RunKey);
        if (key is null) return;

        if (enabled) key.SetValue(ValueName, $"\"{ExecutablePath}\"");
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
