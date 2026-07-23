using System.Runtime.InteropServices;

namespace FoxyJumpscare.Platform;

/// <summary>Seconds since the last user input, system-wide.</summary>
public interface IIdleMonitor
{
    double IdleSeconds();
}

/// <summary>Whether the app launches at login, and how to change that.</summary>
public interface IAutostart
{
    bool IsEnabled { get; }
    void Set(bool enabled);
}

/// <summary>
/// The per-OS pieces the rest of the app is written against, so nothing above
/// this line knows which platform it is on.
/// </summary>
public interface IPlatformServices
{
    IIdleMonitor Idle { get; }
    IAutostart Autostart { get; }
}

public static class PlatformServices
{
    /// <summary>
    /// OperatingSystem.Is* rather than RuntimeInformation.IsOSPlatform so the
    /// platform-compatibility analyzer can see the guard and not warn about the
    /// Windows-only registry calls inside <see cref="WindowsPlatform"/>.
    /// </summary>
    public static IPlatformServices Detect()
    {
        if (OperatingSystem.IsWindows()) return new WindowsPlatform();
        if (OperatingSystem.IsMacOS()) return new MacPlatform();
        if (OperatingSystem.IsLinux()) return new LinuxPlatform();
        throw new PlatformNotSupportedException(
            $"Unsupported OS: {RuntimeInformation.OSDescription}");
    }
}
