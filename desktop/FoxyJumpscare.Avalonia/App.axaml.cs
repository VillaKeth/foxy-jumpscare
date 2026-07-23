using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace FoxyJumpscare;

public partial class App : Application
{
    private TrayController? _controller;

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            // A tray app has no main window, and closing the settings window
            // must not quit. Only the Quit menu item calls Shutdown().
            desktop.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            _controller = new TrayController(desktop);
            desktop.Exit += (_, _) => _controller.Dispose();
            _controller.Start();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
