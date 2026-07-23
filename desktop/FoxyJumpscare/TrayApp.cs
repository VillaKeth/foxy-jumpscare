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
    private Timer? _timer;
    private AppConfig _config = new();
    private AppState _state = new();

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
        // and useful for checking a build on a machine you are sat at.
        if (Environment.GetCommandLineArgs().Contains("--test-scare"))
        {
            var kick = new Timer(TimeSpan.FromMilliseconds(600)) { AutoReset = false };
            kick.Elapsed += (_, _) => Fire();
            kick.Start();
        }
    }

    private void BuildTrayIcon()
    {
        _icon.Icon = LoadTrayIcon();
        _icon.Text = "Foxy Jumpscare";
        _icon.Visible = true;

        var menu = new Forms.ContextMenuStrip();

        var enabled = new Forms.ToolStripMenuItem("Enabled")
        {
            Checked = _config.Enabled,
            CheckOnClick = true,
        };
        enabled.CheckedChanged += (_, _) =>
        {
            _config.Enabled = enabled.Checked;
            Store.SaveConfig(_dir, _config);
        };
        menu.Items.Add(enabled);

        var odds = new Forms.ToolStripMenuItem("Rarity");
        foreach (var (name, value) in Roll.Presets)
        {
            var preset = value;
            var item = new Forms.ToolStripMenuItem(name) { Checked = _config.OneInN == preset };
            item.Click += (_, _) =>
            {
                _config.OneInN = preset;
                Store.SaveConfig(_dir, _config);

                // Re-draw, or a countdown started at the old odds keeps running
                // and the change appears to do nothing for weeks.
                _state.Remaining = Roll.DrawRemaining(preset);
                Store.SaveState(_dir, _state);

                foreach (Forms.ToolStripMenuItem sibling in odds.DropDownItems)
                    sibling.Checked = ReferenceEquals(sibling, item);
            };
            odds.DropDownItems.Add(item);
        }
        menu.Items.Add(odds);

        var test = new Forms.ToolStripMenuItem("Test Scare");
        test.Click += (_, _) => Fire();
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

    private void Fire()
    {
        var video = Path.Combine(AppContext.BaseDirectory, "foxy.mp4");
        if (!File.Exists(video))
        {
            Debug.WriteLine($"[foxy] no video at {video} - run npm run assets");
            return;
        }

        // Timer callbacks run on a pool thread; WPF windows must be created on
        // the UI thread.
        Application.Current.Dispatcher.Invoke(
            () => OverlayWindow.ShowAll(video, _config.FailsafeMarginMs));

        _state.Remaining = Roll.DrawRemaining(_config.OneInN);
        Store.SaveState(_dir, _state);
    }

    public void Dispose()
    {
        _timer?.Stop();
        _timer?.Dispose();
        _icon.Visible = false;
        _icon.Dispose();
    }
}
