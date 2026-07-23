using System.Reflection;
using System.Runtime.InteropServices;

namespace FoxyJumpscare.Platform;

/// <summary>
/// Teaches .NET how to find the system libVLC on Linux and macOS.
///
/// LibVLCSharp P/Invokes the bare name "libvlc". .NET's default probe tries
/// libvlc.so, liblibvlc.so, libvlc and gives up - but distributions ship only
/// the SONAME'd libvlc.so.5, and the unversioned symlink lives in the -dev
/// package that no ordinary user installs. Measured on a stock Ubuntu 24.04
/// with libvlc5 + vlc-plugin-base present: every scare died with "Unable to
/// load shared library 'libvlc'" and rendered 0 frames.
///
/// Windows needs none of this - the VideoLAN.LibVLC.Windows package drops
/// libvlc.dll next to the exe, where the default probe finds it.
/// </summary>
internal static class VlcNative
{
    private static bool _registered;

    // Ordered by how likely they are to be the one the user actually has.
    private static readonly string[] LinuxCandidates =
    {
        "libvlc.so.5",
        "libvlc.so",
    };

    private static readonly string[] MacCandidates =
    {
        "/opt/homebrew/lib/libvlc.dylib",                        // brew, Apple silicon
        "/usr/local/lib/libvlc.dylib",                           // brew, Intel
        "/Applications/VLC.app/Contents/MacOS/lib/libvlc.dylib",  // the .app
        "libvlc.dylib",
    };

    public static void Register()
    {
        if (_registered) return;
        _registered = true;

        // Windows ships its own libvlc.dll via NuGet; leave the default probe.
        if (OperatingSystem.IsWindows()) return;

        // The resolver is per-assembly, and it is LibVLCSharp's DllImports we
        // need to redirect, not our own.
        NativeLibrary.SetDllImportResolver(
            typeof(LibVLCSharp.Shared.LibVLC).Assembly, Resolve);
    }

    private static IntPtr Resolve(string name, Assembly assembly, DllImportSearchPath? path)
    {
        // Anything else falls through to the default probe.
        if (name != "libvlc") return IntPtr.Zero;

        var candidates = OperatingSystem.IsMacOS() ? MacCandidates : LinuxCandidates;
        foreach (var candidate in candidates)
        {
            if (!NativeLibrary.TryLoad(candidate, out var handle)) continue;
            UsePluginsBesideLibrary(candidate);
            return handle;
        }

        // Returning zero lets the default probe run and raise its own error,
        // which names every path it tried - better diagnostics than ours.
        return IntPtr.Zero;
    }

    /// <summary>
    /// A libvlc inside VLC.app has its plugin directory next to it rather than
    /// at the compiled-in system path, and finds nothing without a hint.
    /// Distro packages already know where their plugins are, so only set this
    /// when the directory is actually there.
    /// </summary>
    private static void UsePluginsBesideLibrary(string libraryPath)
    {
        if (!Path.IsPathRooted(libraryPath)) return;
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VLC_PLUGIN_PATH"))) return;

        var dir = Path.GetDirectoryName(libraryPath);
        if (dir is null) return;

        foreach (var plugins in new[] {
                     Path.Combine(dir, "vlc", "plugins"),
                     Path.Combine(dir, "..", "plugins"),
                 })
        {
            if (Directory.Exists(plugins))
            {
                Environment.SetEnvironmentVariable("VLC_PLUGIN_PATH", Path.GetFullPath(plugins));
                return;
            }
        }
    }
}
