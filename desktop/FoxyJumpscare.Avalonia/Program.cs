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
}
