using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using FoxyJumpscare.Core;

namespace FoxyJumpscare.Views;

/// <summary>
/// The settings/stats window. All state lives in <see cref="TrayController"/>;
/// this reads it and calls back, so the window and the tray menu cannot
/// disagree. The Avalonia counterpart of the WPF build's StatsWindow.
/// </summary>
public partial class SettingsWindow : Window
{
    private sealed record OddsChoice(string Display, int? Value)
    {
        // The ComboBox renders items via ToString when no template is set.
        public override string ToString() => Display;
    }

    private readonly TrayController _controller;
    private readonly DispatcherTimer _timer;
    private readonly List<OddsChoice> _choices;
    private bool _loading;

    // Avalonia's designer needs a parameterless constructor.
    public SettingsWindow() : this(null!) { }

    public SettingsWindow(TrayController controller)
    {
        _controller = controller;
        InitializeComponent();

        _choices = new List<OddsChoice>
        {
            new("Ultra-rare", Roll.Presets["ultra-rare"]),
            new("Rare", Roll.Presets["rare"]),
            new("Normal", Roll.Presets["normal"]),
            new("Terraria-faithful", Roll.Presets["terraria-faithful"]),
            new("Custom…", null),
        };
        RarityCombo.ItemsSource = _choices;

        if (controller is not null) Load();

        EnabledCheck.IsCheckedChanged += OnEnabledChanged;
        RarityCombo.SelectionChanged += OnRarityChanged;
        CustomBox.LostFocus += (_, _) => CommitCustom();
        CustomBox.KeyDown += (_, e) => { if (e.Key == Key.Enter) CommitCustom(); };
        TestButton.Click += OnTest;

        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timer.Tick += (_, _) => RefreshCountdown();
        _timer.Start();
        Closed += (_, _) => _timer.Stop();
    }

    private void Load()
    {
        _loading = true;

        EnabledCheck.IsChecked = _controller.Config.Enabled;

        var current = _controller.Config.OneInN;
        var preset = _choices.FirstOrDefault(c => c.Value == current);
        if (preset is not null)
        {
            RarityCombo.SelectedItem = preset;
            CustomPanel.IsVisible = false;
        }
        else
        {
            RarityCombo.SelectedItem = _choices[^1]; // Custom
            CustomBox.Text = current.ToString();
            CustomPanel.IsVisible = true;
        }

        RefreshOdds();
        RefreshCountdown();

        _loading = false;
    }

    private void OnEnabledChanged(object? sender, RoutedEventArgs e)
    {
        if (_loading) return;
        var on = EnabledCheck.IsChecked == true;
        _controller.SetEnabled(on);
        StatusText.Text = on ? "Enabled." : "Disabled. Nothing will fire.";
    }

    private void OnRarityChanged(object? sender, SelectionChangedEventArgs e)
    {
        if (_loading || RarityCombo.SelectedItem is not OddsChoice choice) return;

        if (choice.Value is int n)
        {
            CustomPanel.IsVisible = false;
            Commit(n);
        }
        else
        {
            // Switching to Custom should not commit whatever number is already
            // in the box - wait for the user to type one.
            CustomPanel.IsVisible = true;
            CustomBox.Text = _controller.Config.OneInN.ToString();
            CustomBox.Focus();
            CustomBox.SelectAll();
        }
    }

    private void CommitCustom()
    {
        if (_loading || RarityCombo.SelectedItem is not OddsChoice { Value: null }) return;

        if (int.TryParse(CustomBox.Text?.Trim(), out var n) && n >= 1)
            Commit(n);
        else
            StatusText.Text = "Enter a whole number of 1 or more.";
    }

    private void Commit(int oneInN)
    {
        _controller.SetOdds(oneInN);
        RefreshOdds();
        RefreshCountdown();
        StatusText.Text = "Saved. Countdown restarted.";
    }

    private void OnTest(object? sender, RoutedEventArgs e)
    {
        _controller.FireTest();
        StatusText.Text = "Fired. The countdown was not spent.";
    }

    private void RefreshOdds()
    {
        var n = _controller.Config.OneInN;
        OddsNote.Text = $"1 in {n:N0} chance every active second — {Format.DescribeOdds(n)}.";
    }

    private void RefreshCountdown()
    {
        var remaining = _controller.Remaining;
        CountdownText.Text =
            $"Next scare in about {(remaining <= 0 ? "any second" : Format.Duration(remaining))} of active use.";
    }
}
