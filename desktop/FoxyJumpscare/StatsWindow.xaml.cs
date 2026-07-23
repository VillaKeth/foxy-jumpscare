using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using FoxyJumpscare.Core;

namespace FoxyJumpscare;

/// <summary>
/// The desktop settings/stats window. All state lives in <see cref="TrayApp"/>;
/// this only reads it and calls back, so the window and the tray menu can never
/// disagree about the current odds or countdown.
/// </summary>
public partial class StatsWindow : Window
{
    private sealed record OddsChoice(string Display, int? Value);

    private readonly TrayApp _tray;
    private readonly DispatcherTimer _timer;
    private bool _loading;

    public StatsWindow(TrayApp tray)
    {
        _tray = tray;
        InitializeComponent();

        var choices = new List<OddsChoice>
        {
            new("Ultra-rare", Roll.Presets["ultra-rare"]),
            new("Rare", Roll.Presets["rare"]),
            new("Normal", Roll.Presets["normal"]),
            new("Terraria-faithful", Roll.Presets["terraria-faithful"]),
            new("Custom…", null),
        };
        RarityCombo.DisplayMemberPath = nameof(OddsChoice.Display);
        RarityCombo.ItemsSource = choices;

        Load(choices);

        EnabledCheck.Checked += OnEnabledChanged;
        EnabledCheck.Unchecked += OnEnabledChanged;
        RarityCombo.SelectionChanged += OnRarityChanged;
        CustomBox.LostFocus += (_, _) => CommitCustom();
        CustomBox.KeyDown += (_, e) => { if (e.Key == Key.Enter) CommitCustom(); };
        TestButton.Click += OnTest;

        // The background ticks every 30s; poll a little faster so the countdown
        // does not sit visibly stale while the window is open.
        _timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timer.Tick += (_, _) => RefreshCountdown();
        _timer.Start();
        Closed += (_, _) => _timer.Stop();
    }

    private void Load(List<OddsChoice> choices)
    {
        _loading = true;

        EnabledCheck.IsChecked = _tray.Config.Enabled;

        var current = _tray.Config.OneInN;
        var preset = choices.FirstOrDefault(c => c.Value == current);
        if (preset is not null)
        {
            RarityCombo.SelectedItem = preset;
            CustomPanel.Visibility = Visibility.Collapsed;
        }
        else
        {
            RarityCombo.SelectedItem = choices[^1]; // Custom
            CustomBox.Text = current.ToString();
            CustomPanel.Visibility = Visibility.Visible;
        }

        RefreshOdds();
        RefreshCountdown();

        _loading = false;
    }

    private void OnEnabledChanged(object sender, RoutedEventArgs e)
    {
        if (_loading) return;
        var on = EnabledCheck.IsChecked == true;
        _tray.SetEnabled(on);
        StatusText.Text = on ? "Enabled." : "Disabled. Nothing will fire.";
    }

    private void OnRarityChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_loading || RarityCombo.SelectedItem is not OddsChoice choice) return;

        if (choice.Value is int n)
        {
            CustomPanel.Visibility = Visibility.Collapsed;
            Commit(n);
        }
        else
        {
            // Switching to Custom should not commit whatever number is already
            // in the box - wait for the user to type one.
            CustomPanel.Visibility = Visibility.Visible;
            CustomBox.Text = _tray.Config.OneInN.ToString();
            CustomBox.Focus();
            CustomBox.SelectAll();
        }
    }

    private void CommitCustom()
    {
        if (_loading || RarityCombo.SelectedItem is not OddsChoice { Value: null }) return;

        if (int.TryParse(CustomBox.Text.Trim(), out var n) && n >= 1)
        {
            Commit(n);
        }
        else
        {
            StatusText.Text = "Enter a whole number of 1 or more.";
        }
    }

    /// <summary>Persist new odds and restart the countdown.</summary>
    private void Commit(int oneInN)
    {
        // The redraw is not optional: a countdown drawn at the old odds keeps
        // running against the new setting, so the change would appear to do
        // nothing for hours. TrayApp.SetOdds does the redraw.
        _tray.SetOdds(oneInN);
        RefreshOdds();
        RefreshCountdown();
        StatusText.Text = "Saved. Countdown restarted.";
    }

    private void OnTest(object sender, RoutedEventArgs e)
    {
        // FireTest shows the overlay without spending the roll, so testing does
        // not reset the real countdown.
        _tray.FireTest();
        StatusText.Text = "Fired. The countdown was not spent.";
    }

    private void RefreshOdds()
    {
        var n = _tray.Config.OneInN;
        OddsNote.Text = $"1 in {n:N0} chance every active second — {Format.DescribeOdds(n)}.";
    }

    private void RefreshCountdown()
    {
        var remaining = _tray.Remaining;
        CountdownRun.Text = remaining <= 0 ? "any second" : Format.Duration(remaining);
    }
}
