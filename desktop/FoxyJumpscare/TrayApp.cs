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
    }

    private void BuildTrayIcon()
    {
        _icon.Icon = System.Drawing.SystemIcons.Application;
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
        Debug.WriteLine("[foxy] would fire (overlay not wired yet)");
    }

    public void Dispose()
    {
        _timer?.Stop();
        _timer?.Dispose();
        _icon.Visible = false;
        _icon.Dispose();
    }
}
