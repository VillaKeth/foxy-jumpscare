using System.Linq;
using System.Runtime.InteropServices;
using Avalonia;
using FoxyJumpscare.Platform;

namespace FoxyJumpscare;

internal static class Program
{
    // Avalonia needs an STA thread on Windows; harmless elsewhere.
    [STAThread]
    public static void Main(string[] args)
    {
        // Headless verification of the platform layer, with no GUI. Used to
        // check the per-OS idle P/Invoke on a machine (or container) where the
        // full app cannot be eyeballed - see docs/cross-platform.md.
        if (args.Contains("--probe-idle"))
        {
            ProbeIdle();
            return;
        }

        // Round-trip the autostart registration with no GUI, to check the
        // per-OS write (registry Run key / LaunchAgent / XDG .desktop) actually
        // takes - see docs/cross-platform.md. Leaves autostart ON at the end so
        // the resulting file can be inspected.
        if (args.Contains("--probe-autostart"))
        {
            ProbeAutostart();
            return;
        }

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    // Referenced by name from the Avalonia designer tooling.
    public static AppBuilder BuildAvaloniaApp() =>
        AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .LogToTrace();

    private static void ProbeIdle()
    {
        var services = PlatformServices.Detect();
        Console.WriteLine($"os        : {RuntimeInformation.OSDescription}");
        Console.WriteLine($"platform  : {services.GetType().Name}");
        Console.WriteLine($"autostart : {services.Autostart.IsEnabled}");

        // With no input (e.g. under Xvfb) idle should climb by ~0.5s a step.
        // A flat 0, or a wild value, means the platform's idle query or struct
        // offset is wrong.
        for (var i = 0; i < 6; i++)
        {
            Console.WriteLine($"idle      : {services.Idle.IdleSeconds():F2}s");
            Thread.Sleep(500);
        }
    }

    private static void ProbeAutostart()
    {
        var services = PlatformServices.Detect();
        var autostart = services.Autostart;
        Console.WriteLine($"platform  : {services.GetType().Name}");
        Console.WriteLine($"before    : {autostart.IsEnabled}");

        autostart.Set(true);
        Console.WriteLine($"after on  : {autostart.IsEnabled}");   // want True

        autostart.Set(false);
        Console.WriteLine($"after off : {autostart.IsEnabled}");   // want False

        // Leave it on so the caller can inspect the written entry (its Exec
        // line in particular - a wrong path is the usual autostart failure).
        autostart.Set(true);
        Console.WriteLine($"final     : {autostart.IsEnabled}");   // want True
    }
}
