using System.Diagnostics;
using System.IO;
using System.Timers;
using System.Windows;
using FoxyJumpscare.Core;
using FoxyJumpscare.Platform;
using Forms = System.Windows.Forms;
using Timer = System.Timers.Timer;

namespace FoxyJumpscare;

public sealed class TrayApp : IDisposable
{
    private readonly string _dir = Store.DefaultDirectory;
    private readonly Forms.NotifyIcon _icon = new();
    private readonly Dictionary<int, Forms.ToolStripMenuItem> _oddsItems = new();
    private Forms.ToolStripMenuItem? _enabledItem;
    private Timer? _timer;
    private AppConfig _config = new();
    private AppState _state = new();
    private StatsWindow? _window;

    /// <summary>Current configuration. The window reads this; it never caches it.</summary>
    public AppConfig Config => _config;

    /// <summary>Active seconds left before the next fire.</summary>
    public long Remaining => _state.Remaining;

    public void Start()
    {
        _config = Store.LoadConfig(_dir);
        // Write it straight back, so the file exists and is editable after a
        // first run rather than only appearing once a menu item is touched.
        Store.SaveConfig(_dir, _config);

        _state = Store.LoadState(_dir);

        if (_state.Remaining <= 0)
        {
            _state.Remaining = Roll.DrawRemaining(_config.OneInN);
            Store.SaveState(_dir, _state);
        }

        BuildTrayIcon();

        _timer = new Timer(TimeSpan.FromSeconds(_config.TickSeconds)) { AutoReset = true };
        _timer.Elapsed += OnTick;
        _timer.Start();

        // --test-scare fires once shortly after startup, so the overlay can be
        // exercised without clicking a tray menu. Used by the capture script
        // and useful for checking a build on a machine you are sat at. It does
        // not spend the countdown.
        if (Environment.GetCommandLineArgs().Contains("--test-scare"))
        {
            var kick = new Timer(TimeSpan.FromMilliseconds(600)) { AutoReset = false };
            kick.Elapsed += (_, _) => FireTest();
            kick.Start();
        }

        // --settings opens the window on launch, so a shortcut can jump
        // straight to it. Deferred until the app has finished starting.
        if (Environment.GetCommandLineArgs().Contains("--settings"))
        {
            Application.Current.Dispatcher.BeginInvoke(ShowWindow);
        }
    }

    private void BuildTrayIcon()
    {
        _icon.Icon = LoadTrayIcon();
        _icon.Text = "Foxy Jumpscare";
        _icon.Visible = true;

        // Double-clicking the tray icon is the conventional "open the app".
        _icon.DoubleClick += (_, _) => ShowWindow();

        var menu = new Forms.ContextMenuStrip();

        // Settings... is also in the menu, because a tray icon that only
        // responds to a double-click is undiscoverable.
        var settings = new Forms.ToolStripMenuItem("Settings…");
        settings.Click += (_, _) => ShowWindow();
        menu.Items.Add(settings);

        menu.Items.Add(new Forms.ToolStripSeparator());

        _enabledItem = new Forms.ToolStripMenuItem("Enabled") { Checked = _config.Enabled };
        _enabledItem.Click += (_, _) => SetEnabled(!_config.Enabled);
        menu.Items.Add(_enabledItem);

        var odds = new Forms.ToolStripMenuItem("Rarity");
        foreach (var (name, value) in Roll.Presets)
        {
            var preset = value;
            var item = new Forms.ToolStripMenuItem(name) { Checked = _config.OneInN == preset };
            item.Click += (_, _) => SetOdds(preset);
            _oddsItems[preset] = item;
            odds.DropDownItems.Add(item);
        }
        menu.Items.Add(odds);

        var test = new Forms.ToolStripMenuItem("Test Scare");
        test.Click += (_, _) => FireTest();
        menu.Items.Add(test);

        var startup = new Forms.ToolStripMenuItem("Run at startup")
        {
            Checked = Autostart.IsEnabled,
            CheckOnClick = true,
        };
        startup.CheckedChanged += (_, _) =>
        {
            Autostart.Set(startup.Checked);
            _config.RunAtStartup = startup.Checked;
            Store.SaveConfig(_dir, _config);
        };
        menu.Items.Add(startup);

        menu.Items.Add(new Forms.ToolStripSeparator());

        var quit = new Forms.ToolStripMenuItem("Quit");
        quit.Click += (_, _) => Application.Current.Shutdown();
        menu.Items.Add(quit);

        _icon.ContextMenuStrip = menu;
    }

    /// <summary>
    /// The tray icon, built from the asset pack by tools/build-tray-icon.ps1.
    /// Falls back to a generic icon when the pack is absent, so a source
    /// checkout without assets still runs.
    /// </summary>
    private static System.Drawing.Icon LoadTrayIcon()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "foxy.ico");
        if (File.Exists(path))
        {
            try
            {
                // Ask for the frame nearest the tray's icon size at this DPI,
                // rather than letting a 256px frame be squashed down to 16.
                return new System.Drawing.Icon(path, Forms.SystemInformation.SmallIconSize);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[foxy] tray icon load failed, using default: {ex.Message}");
            }
        }
        return System.Drawing.SystemIcons.Application;
    }

    /// <summary>Open the settings window, or focus it if already open.</summary>
    public void ShowWindow()
    {
        _window ??= CreateWindow();
        if (!_window.IsVisible) _window.Show();
        if (_window.WindowState == WindowState.Minimized) _window.WindowState = WindowState.Normal;
        _window.Activate();
        // Nudge to the foreground without staying pinned there.
        _window.Topmost = true;
        _window.Topmost = false;
    }

    private StatsWindow CreateWindow()
    {
        var window = new StatsWindow(this);
        window.Closed += (_, _) => _window = null;
        return window;
    }

    /// <summary>Enable or disable firing. Called by both the menu and the window.</summary>
    public void SetEnabled(bool enabled)
    {
        _config.Enabled = enabled;
        Store.SaveConfig(_dir, _config);
        if (_enabledItem is not null) _enabledItem.Checked = enabled;
    }

    /// <summary>
    /// Change the odds and restart the countdown. Called by both the menu and
    /// the window. The redraw is required: a countdown drawn at the old odds
    /// keeps running against the new setting, so the change would otherwise
    /// appear to do nothing.
    /// </summary>
    public void SetOdds(int oneInN)
    {
        _config.OneInN = oneInN;
        Store.SaveConfig(_dir, _config);

        _state.Remaining = Roll.DrawRemaining(oneInN);
        Store.SaveState(_dir, _state);

        foreach (var (value, item) in _oddsItems) item.Checked = value == oneInN;
    }

    private void OnTick(object? sender, ElapsedEventArgs e)
    {
        if (!_config.Enabled) return;

        var active = IdleMonitor.IsActive(_config.IdleThresholdSeconds);
        var credited = active ? _config.TickSeconds : 0;
        var result = Ticker.Credit(_state.Remaining, credited);

        _state.Remaining = result.Remaining;
        Store.SaveState(_dir, _state);

        if (result.ShouldFire) Fire();
    }

    /// <summary>
    /// Show the overlay. Returns false if it could not be shown (no video), so
    /// callers can decide whether to spend the roll.
    /// </summary>
    private bool ShowOverlay()
    {
        var video = Path.Combine(AppContext.BaseDirectory, "foxy.mp4");
        if (!File.Exists(video))
        {
            Debug.WriteLine($"[foxy] no video at {video} - run npm run assets");
            return false;
        }

        // Timer callbacks run on a pool thread; WPF windows must be created on
        // the UI thread.
        Application.Current.Dispatcher.Invoke(
            () => OverlayWindow.ShowAll(video, _config.FailsafeMarginMs));
        return true;
    }

    /// <summary>A real fire: show the overlay, then spend the roll.</summary>
    private void Fire()
    {
        // A failed show must not spend the roll - leave Remaining at 0 so the
        // next tick retries rather than silently skipping this fire.
        if (!ShowOverlay()) return;

        _state.Remaining = Roll.DrawRemaining(_config.OneInN);
        Store.SaveState(_dir, _state);
    }

    /// <summary>
    /// Show the overlay without spending the countdown. For the Test button and
    /// --test-scare, so trying it out does not reset the real timer.
    /// </summary>
    public void FireTest() => ShowOverlay();

    public void Dispose()
    {
        _timer?.Stop();
        _timer?.Dispose();
        _icon.Visible = false;
        _icon.Dispose();
    }
}
