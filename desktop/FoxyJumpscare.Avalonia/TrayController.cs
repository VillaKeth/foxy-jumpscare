using System.Timers;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform;
using Avalonia.Threading;
using FoxyJumpscare.Core;
using FoxyJumpscare.Platform;
using FoxyJumpscare.Views;
using Timer = System.Timers.Timer;

namespace FoxyJumpscare;

/// <summary>
/// The desktop app, minus anything platform-specific (which lives behind
/// <see cref="IPlatformServices"/>). Owns the tray icon, the tick loop, and all
/// the state; the settings window only reads this and calls back, so the two
/// can never disagree. The counterpart of the WPF build's TrayApp.
/// </summary>
public sealed class TrayController : IDisposable
{
    private readonly IClassicDesktopStyleApplicationLifetime _desktop;
    private readonly IPlatformServices _platform = PlatformServices.Detect();
    private readonly string _dir = Store.DefaultDirectory;
    private readonly Dictionary<int, NativeMenuItem> _oddsItems = new();

    private TrayIcon? _tray;
    private NativeMenuItem? _enabledItem;
    private NativeMenuItem? _startupItem;
    private Timer? _timer;
    private AppConfig _config = new();
    private AppState _state = new();
    private SettingsWindow? _window;

    public TrayController(IClassicDesktopStyleApplicationLifetime desktop) => _desktop = desktop;

    public AppConfig Config => _config;
    public long Remaining => _state.Remaining;

    public void Start()
    {
        _config = Store.LoadConfig(_dir);
        _state = Store.LoadState(_dir);
        if (_state.Remaining <= 0)
            _state.Remaining = Roll.DrawRemaining(_config.OneInN);

        // Settings that cannot be written must not stop the app running. A
        // read-only or unwritable config directory used to throw out of here,
        // before any window or tray icon existed, so the app simply died on
        // startup with a stack trace the user never saw. Loading already falls
        // back to defaults for the same reason; saving now matches.
        try
        {
            Store.SaveConfig(_dir, _config);
            Store.SaveState(_dir, _state);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[foxy] settings not saved ({_dir}): {ex.Message}");
        }

        BuildTray();

        _timer = new Timer(TimeSpan.FromSeconds(_config.TickSeconds)) { AutoReset = true };
        _timer.Elapsed += OnTick;
        _timer.Start();

        if (Environment.GetCommandLineArgs().Contains("--test-scare"))
            Dispatcher.UIThread.Post(FireTest);
        if (Environment.GetCommandLineArgs().Contains("--settings"))
            Dispatcher.UIThread.Post(ShowWindow);
    }

    private void BuildTray()
    {
        _tray = new TrayIcon
        {
            ToolTipText = "Foxy Jumpscare",
            Icon = LoadTrayIcon(),
            IsVisible = true,
        };
        _tray.Clicked += (_, _) => ShowWindow();

        var menu = new NativeMenu();

        var settings = new NativeMenuItem("Settings…");
        settings.Click += (_, _) => ShowWindow();
        menu.Add(settings);

        menu.Add(new NativeMenuItemSeparator());

        _enabledItem = new NativeMenuItem("Enabled")
        {
            ToggleType = NativeMenuItemToggleType.CheckBox,
            IsChecked = _config.Enabled,
        };
        _enabledItem.Click += (_, _) => SetEnabled(!_config.Enabled);
        menu.Add(_enabledItem);

        var rarity = new NativeMenuItem("Rarity") { Menu = new NativeMenu() };
        foreach (var (name, value) in Roll.Presets)
        {
            var preset = value;
            var item = new NativeMenuItem(name)
            {
                ToggleType = NativeMenuItemToggleType.Radio,
                IsChecked = _config.OneInN == preset,
            };
            item.Click += (_, _) => SetOdds(preset);
            _oddsItems[preset] = item;
            rarity.Menu.Add(item);
        }
        menu.Add(rarity);

        var test = new NativeMenuItem("Test Scare");
        test.Click += (_, _) => FireTest();
        menu.Add(test);

        _startupItem = new NativeMenuItem("Run at startup")
        {
            ToggleType = NativeMenuItemToggleType.CheckBox,
            IsChecked = _platform.Autostart.IsEnabled,
        };
        _startupItem.Click += (_, _) => SetAutostart(!AutostartEnabled);
        menu.Add(_startupItem);

        menu.Add(new NativeMenuItemSeparator());

        var quit = new NativeMenuItem("Quit");
        quit.Click += (_, _) => _desktop.Shutdown();
        menu.Add(quit);

        _tray.Menu = menu;
    }

    private WindowIcon? LoadTrayIcon()
    {
        var path = System.IO.Path.Combine(AppContext.BaseDirectory, "foxy.ico");
        try
        {
            if (System.IO.File.Exists(path)) return new WindowIcon(path);
        }
        catch { /* fall back to no icon */ }
        return null;
    }

    public void ShowWindow()
    {
        _window ??= CreateWindow();
        _window.Show();
        _window.Activate();
    }

    private SettingsWindow CreateWindow()
    {
        var window = new SettingsWindow(this);
        window.Closed += (_, _) => _window = null;
        return window;
    }

    /// <summary>Enable or disable firing. Shared by the menu and the window.</summary>
    public void SetEnabled(bool enabled)
    {
        _config.Enabled = enabled;
        Store.SaveConfig(_dir, _config);
        if (_enabledItem is not null) _enabledItem.IsChecked = enabled;
    }

    /// <summary>Whether the app is registered to launch at login, read live from
    /// the OS (the registry Run key / LaunchAgent / XDG .desktop), not cached.</summary>
    public bool AutostartEnabled => _platform.Autostart.IsEnabled;

    /// <summary>
    /// Register or unregister launch-at-login. Shared by the tray menu and the
    /// settings window, so the checkbox that lives in each stays in step - which
    /// is why the window exposes this at all: on a desktop that hides the tray
    /// icon (GNOME without an AppIndicator extension), the menu is unreachable
    /// and the window is the only way to reach the toggle.
    ///
    /// Returns the state actually in effect afterwards. Writing the autostart
    /// entry can fail (a read-only home, a locked file); rather than throw into
    /// a UI click handler, we swallow it and report the real state, so the
    /// checkbox can snap back instead of lying.
    /// </summary>
    public bool SetAutostart(bool on)
    {
        try { _platform.Autostart.Set(on); }
        catch (Exception ex) { Console.Error.WriteLine($"[foxy] autostart: {ex.Message}"); }

        var actual = _platform.Autostart.IsEnabled;
        _config.RunAtStartup = actual;
        try { Store.SaveConfig(_dir, _config); } catch { /* best effort */ }
        if (_startupItem is not null) _startupItem.IsChecked = actual;
        return actual;
    }

    /// <summary>
    /// Change odds and restart the countdown. Shared by the menu and the
    /// window. The redraw is required: a countdown at the old odds keeps
    /// running against the new setting, so the change would appear to do
    /// nothing.
    /// </summary>
    public void SetOdds(int oneInN)
    {
        _config.OneInN = oneInN;
        Store.SaveConfig(_dir, _config);

        _state.Remaining = Roll.DrawRemaining(oneInN);
        Store.SaveState(_dir, _state);

        foreach (var (value, item) in _oddsItems) item.IsChecked = value == oneInN;
    }

    private void OnTick(object? sender, ElapsedEventArgs e)
    {
        if (!_config.Enabled) return;

        var active = _platform.Idle.IdleSeconds() < _config.IdleThresholdSeconds;
        var credited = active ? _config.TickSeconds : 0;
        var result = Ticker.Credit(_state.Remaining, credited);

        _state.Remaining = result.Remaining;
        Store.SaveState(_dir, _state);

        if (result.ShouldFire) Dispatcher.UIThread.Post(Fire);
    }

    /// <summary>
    /// Show the overlay. Returns false if it could not be shown, so a real fire
    /// can decide whether to spend the roll. Must run on the UI thread.
    /// </summary>
    private bool ShowOverlay()
    {
        var video = System.IO.Path.Combine(AppContext.BaseDirectory, "foxy.mp4");
        OverlayWindow.ShowAll(System.IO.File.Exists(video) ? video : null, _config.FailsafeMarginMs);
        return true;
    }

    private void Fire()
    {
        if (!ShowOverlay()) return;
        _state.Remaining = Roll.DrawRemaining(_config.OneInN);
        Store.SaveState(_dir, _state);
    }

    /// <summary>Show the overlay without spending the countdown. For the Test button.</summary>
    public void FireTest() => Dispatcher.UIThread.Post(() => ShowOverlay());

    public void Dispose()
    {
        _timer?.Stop();
        _timer?.Dispose();
        if (_tray is not null) _tray.IsVisible = false;
        _tray?.Dispose();
    }
}
