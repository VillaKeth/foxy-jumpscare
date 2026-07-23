using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FoxyJumpscare.Platform;

/// <summary>
/// macOS implementation. Written from the documented APIs but NOT yet run on
/// real hardware - see docs/cross-platform.md. Both pieces degrade safely: a
/// failed idle query reports "active", and autostart is a plain file.
/// </summary>
[SupportedOSPlatform("macos")]
public sealed class MacPlatform : IPlatformServices
{
    public IIdleMonitor Idle { get; } = new MacIdle();
    public IAutostart Autostart { get; } = new MacAutostart();

    private sealed class MacIdle : IIdleMonitor
    {
        private const string ApplicationServices =
            "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices";

        // kCGEventSourceStateHIDSystemState = 1; kCGAnyInputEventType = ~0.
        [DllImport(ApplicationServices)]
        private static extern double CGEventSourceSecondsSinceLastEventType(
            uint stateID, uint eventType);

        public double IdleSeconds()
        {
            try
            {
                return CGEventSourceSecondsSinceLastEventType(1, 0xFFFFFFFF);
            }
            catch
            {
                // Better to over-count active time than to silently stop firing.
                return 0;
            }
        }
    }

    private sealed class MacAutostart : IAutostart
    {
        private const string Label = "com.foxyjumpscare.agent";

        private static string PlistPath => System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Library", "LaunchAgents", $"{Label}.plist");

        public bool IsEnabled => System.IO.File.Exists(PlistPath);

        public void Set(bool enabled)
        {
            var path = PlistPath;
            if (!enabled)
            {
                if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
                return;
            }

            var exe = Environment.ProcessPath ?? "";
            var plist =
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
                "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" " +
                "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n" +
                "<plist version=\"1.0\"><dict>\n" +
                $"  <key>Label</key><string>{Label}</string>\n" +
                "  <key>ProgramArguments</key>\n" +
                $"  <array><string>{exe}</string></array>\n" +
                "  <key>RunAtLoad</key><true/>\n" +
                "</dict></plist>\n";

            System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path)!);
            System.IO.File.WriteAllText(path, plist);
        }
    }
}
