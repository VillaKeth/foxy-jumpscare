# Windows Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A .NET 8 WPF tray application that fires a fullscreen Foxy overlay at 1-in-300,000 per active second, on every monitor, without stealing focus.

**Architecture:** Three projects. `FoxyJumpscare.Core` is plain `net8.0` with no UI and no P/Invoke, holding the roll, the tick accounting, and config persistence — so it tests without a desktop runtime. `FoxyJumpscare` is `net8.0-windows` WPF and holds everything that touches Windows. `FoxyJumpscare.Core.Tests` is xunit against Core only.

**Tech Stack:** .NET 8, WPF for the overlay and `MediaElement`, WinForms solely for `NotifyIcon`, xunit.

## Global Constraints

- Desktop default `OneInN` is **300000**. Same four presets as the extension: `ultra-rare` 1000000, `rare` 300000, `normal` 100000, `terraria-faithful` 10000.
- Tick period **30 seconds**. Active means idle time below `IdleThresholdSeconds` (60) **and** the session is not locked.
- The roll must match the extension's definition exactly: `max(1, ceil(ln(U) / ln(1 - p)))` for `U ~ (0,1]`, `p = 1/OneInN`.
- Overlay is **one window per monitor**. Only the **primary** monitor's window plays audio; every other is muted.
- Overlay never activates: `ShowActivated = false` plus `WS_EX_NOACTIVATE`.
- Teardown is `MediaEnded`, plus an **independent failsafe timer** at video duration + `FailsafeMarginMs` (1500) that force-closes regardless of media state.
- Per-monitor DPI conversion is mandatory. `Screen.AllScreens` is physical pixels; WPF positions in DIPs.
- `RunAtStartup` defaults **false**.
- Config and state live in `%APPDATA%\FoxyJumpscare\`.
- No `durationMs` setting — on-screen time is the video's own length.

---

### Task 1: Solution skeleton and the roll

**Files:**
- Create: `desktop/FoxyJumpscare.sln`
- Create: `desktop/FoxyJumpscare.Core/FoxyJumpscare.Core.csproj`
- Create: `desktop/FoxyJumpscare.Core/Roll.cs`
- Create: `desktop/FoxyJumpscare.Core.Tests/FoxyJumpscare.Core.Tests.csproj`
- Test: `desktop/FoxyJumpscare.Core.Tests/RollTests.cs`

**Interfaces:**
- Produces: `Roll.Presets`, `Roll.DefaultOneInN`, `Roll.DrawRemaining(int oneInN, Func<double>? rand = null) -> long`

- [ ] **Step 1: Create the projects**

```bash
cd desktop
dotnet new classlib -n FoxyJumpscare.Core -f net8.0
dotnet new xunit    -n FoxyJumpscare.Core.Tests -f net8.0
dotnet new sln      -n FoxyJumpscare
dotnet sln add FoxyJumpscare.Core FoxyJumpscare.Core.Tests
dotnet add FoxyJumpscare.Core.Tests reference FoxyJumpscare.Core
rm FoxyJumpscare.Core/Class1.cs FoxyJumpscare.Core.Tests/UnitTest1.cs
```

- [ ] **Step 2: Write the failing test**

Create `desktop/FoxyJumpscare.Core.Tests/RollTests.cs`:

```csharp
using FoxyJumpscare.Core;

namespace FoxyJumpscare.Core.Tests;

public class RollTests
{
    [Fact]
    public void Presets_MatchTheSpec()
    {
        Assert.Equal(1_000_000, Roll.Presets["ultra-rare"]);
        Assert.Equal(300_000, Roll.Presets["rare"]);
        Assert.Equal(100_000, Roll.Presets["normal"]);
        Assert.Equal(10_000, Roll.Presets["terraria-faithful"]);
    }

    [Fact]
    public void DefaultOneInN_IsTheRarePreset()
    {
        Assert.Equal(300_000, Roll.DefaultOneInN);
    }

    [Fact]
    public void DrawRemaining_HasMeanAboutN()
    {
        const int n = 1000;
        const int trials = 200_000;
        double total = 0;
        for (var i = 0; i < trials; i++) total += Roll.DrawRemaining(n);
        var mean = total / trials;

        // Geometric(p=1/n) has mean n and sd ~n, so the sample mean's standard
        // error is n/sqrt(trials) ~ 2.24. A 5% band is ~22x that.
        Assert.InRange(mean, n * 0.95, n * 1.05);
    }

    [Fact]
    public void DrawRemaining_IsNeverLessThanOne()
    {
        for (var i = 0; i < 10_000; i++)
            Assert.True(Roll.DrawRemaining(10) >= 1);
    }

    [Fact]
    public void DrawRemaining_ReturnsOne_AtTheUpperBoundary()
    {
        // rand() == 0 gives u = 1, and ln(1) == 0.
        Assert.Equal(1, Roll.DrawRemaining(100_000, () => 0.0));
    }

    [Fact]
    public void DrawRemaining_ReturnsLargeFiniteValue_AsUApproachesZero()
    {
        var draw = Roll.DrawRemaining(100_000, () => 1.0 - 1e-12);
        Assert.True(draw > 1_000_000);
    }

    [Fact]
    public void DrawRemaining_HandlesOneInOne()
    {
        // p == 1 puts -Infinity in the denominator; the result must still be 1.
        Assert.Equal(1, Roll.DrawRemaining(1, () => 0.5));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void DrawRemaining_RejectsNonsensicalN(int oneInN)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Roll.DrawRemaining(oneInN));
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `dotnet test desktop/FoxyJumpscare.Core.Tests`
Expected: build failure — `Roll` does not exist.

- [ ] **Step 4: Write the implementation**

Create `desktop/FoxyJumpscare.Core/Roll.cs`:

```csharp
namespace FoxyJumpscare.Core;

/// <summary>
/// The roll. Pure — no UI, no P/Invoke, so it tests without a desktop runtime.
///
/// The original Terraria mod rolls 1-in-N once per wall-clock second. Doing that
/// literally is wrong for a process that runs all day: timers drift across sleep
/// and hibernation, and a dropped tick silently biases the odds. Instead we
/// sample the wait once from the equivalent geometric distribution and count it
/// down against measured active time.
///
/// Must stay identical to extension/src/lib/roll.mjs.
/// </summary>
public static class Roll
{
    public static readonly IReadOnlyDictionary<string, int> Presets =
        new Dictionary<string, int>
        {
            ["ultra-rare"] = 1_000_000,
            ["rare"] = 300_000,
            ["normal"] = 100_000,
            ["terraria-faithful"] = 10_000,
        };

    public const int DefaultOneInN = 300_000;

    /// <summary>
    /// Inverse-transform sample of X ~ Geometric(p), p = 1/oneInN,
    /// support {1,2,...}. E[X] = oneInN.
    /// </summary>
    public static long DrawRemaining(int oneInN, Func<double>? rand = null)
    {
        if (oneInN < 1)
            throw new ArgumentOutOfRangeException(
                nameof(oneInN), oneInN, "oneInN must be >= 1");

        rand ??= Random.Shared.NextDouble;

        var p = 1.0 / oneInN;
        // NextDouble() returns [0,1); 1 - it gives (0,1], keeping Log finite.
        var u = 1.0 - rand();
        var draw = Math.Log(u) / Math.Log(1.0 - p);

        // ln(1) == 0 yields -0, and oneInN == 1 puts -Infinity in the
        // denominator; both floor to 1, the correct minimum.
        return Math.Max(1, (long)Math.Ceiling(draw));
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test desktop/FoxyJumpscare.Core.Tests`
Expected: Passed! 9 tests.

- [ ] **Step 6: Commit**

```bash
git add desktop
git commit -m "feat(desktop): add solution skeleton and geometric roll core"
```

---

### Task 2: Tick accounting

**Files:**
- Create: `desktop/FoxyJumpscare.Core/Ticker.cs`
- Test: `desktop/FoxyJumpscare.Core.Tests/TickerTests.cs`

**Interfaces:**
- Produces: `Ticker.TickSeconds`, `TickResult(long Remaining, bool ShouldFire)`, `Ticker.Credit(long remaining, int activeSeconds) -> TickResult`

- [ ] **Step 1: Write the failing test**

Create `desktop/FoxyJumpscare.Core.Tests/TickerTests.cs`:

```csharp
using FoxyJumpscare.Core;

namespace FoxyJumpscare.Core.Tests;

public class TickerTests
{
    [Fact]
    public void TickSeconds_Is30()
    {
        Assert.Equal(30, Ticker.TickSeconds);
    }

    [Fact]
    public void Credit_SubtractsActiveSeconds()
    {
        var result = Ticker.Credit(500, 30);
        Assert.Equal(470, result.Remaining);
        Assert.False(result.ShouldFire);
    }

    [Fact]
    public void Credit_FiresWhenCountdownReachesZero()
    {
        var result = Ticker.Credit(30, 30);
        Assert.Equal(0, result.Remaining);
        Assert.True(result.ShouldFire);
    }

    [Fact]
    public void Credit_ClampsAtZeroRatherThanGoingNegative()
    {
        var result = Ticker.Credit(10, 30);
        Assert.Equal(0, result.Remaining);
        Assert.True(result.ShouldFire);
    }

    [Fact]
    public void Credit_KeepsFiringWhileRemainingIsZero()
    {
        // A failed overlay leaves Remaining at 0; the next tick must retry
        // rather than treating the roll as spent.
        var result = Ticker.Credit(0, 30);
        Assert.True(result.ShouldFire);
    }

    [Fact]
    public void Credit_DoesNotAdvanceWhenNothingIsCredited()
    {
        var result = Ticker.Credit(500, 0);
        Assert.Equal(500, result.Remaining);
        Assert.False(result.ShouldFire);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test desktop/FoxyJumpscare.Core.Tests`
Expected: build failure — `Ticker` does not exist.

- [ ] **Step 3: Write the implementation**

Create `desktop/FoxyJumpscare.Core/Ticker.cs`:

```csharp
namespace FoxyJumpscare.Core;

public readonly record struct TickResult(long Remaining, bool ShouldFire);

/// <summary>Pure tick accounting. Must stay identical to extension/src/lib/ticker.mjs.</summary>
public static class Ticker
{
    public const int TickSeconds = 30;

    /// <summary>
    /// Credit elapsed active time against the countdown. Remaining clamps at 0
    /// rather than going negative, and ShouldFire stays true while it sits at 0.
    /// That is what lets a failed overlay retry on the next tick instead of
    /// silently spending the roll.
    /// </summary>
    public static TickResult Credit(long remaining, int activeSeconds)
    {
        var next = Math.Max(0, remaining - activeSeconds);
        return new TickResult(next, next <= 0);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test desktop/FoxyJumpscare.Core.Tests`
Expected: Passed! 15 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop
git commit -m "feat(desktop): add tick accounting"
```

---

### Task 3: Config and state persistence

**Files:**
- Create: `desktop/FoxyJumpscare.Core/AppConfig.cs`
- Create: `desktop/FoxyJumpscare.Core/Store.cs`
- Test: `desktop/FoxyJumpscare.Core.Tests/StoreTests.cs`

**Interfaces:**
- Produces:
  - `AppConfig` with `Enabled`, `OneInN`, `TickSeconds`, `IdleThresholdSeconds`, `FailsafeMarginMs`, `RunAtStartup`
  - `AppState` with `Remaining`
  - `Store.LoadConfig(string dir) -> AppConfig`, `Store.SaveConfig(string dir, AppConfig)`
  - `Store.LoadState(string dir) -> AppState`, `Store.SaveState(string dir, AppState)`
  - `Store.DefaultDirectory -> string`

- [ ] **Step 1: Write the failing test**

Create `desktop/FoxyJumpscare.Core.Tests/StoreTests.cs`:

```csharp
using FoxyJumpscare.Core;

namespace FoxyJumpscare.Core.Tests;

public class StoreTests : IDisposable
{
    private readonly string _dir = Path.Combine(
        Path.GetTempPath(), "foxy-store-" + Guid.NewGuid().ToString("N"));

    public StoreTests() => Directory.CreateDirectory(_dir);
    public void Dispose() => Directory.Delete(_dir, true);

    [Fact]
    public void LoadConfig_ReturnsSpecDefaults_WhenNoFileExists()
    {
        var config = Store.LoadConfig(_dir);
        Assert.True(config.Enabled);
        Assert.Equal(300_000, config.OneInN);
        Assert.Equal(30, config.TickSeconds);
        Assert.Equal(60, config.IdleThresholdSeconds);
        Assert.Equal(1500, config.FailsafeMarginMs);
        Assert.False(config.RunAtStartup);
    }

    [Fact]
    public void SaveConfig_ThenLoadConfig_RoundTrips()
    {
        Store.SaveConfig(_dir, new AppConfig { Enabled = false, OneInN = 10_000, RunAtStartup = true });
        var loaded = Store.LoadConfig(_dir);
        Assert.False(loaded.Enabled);
        Assert.Equal(10_000, loaded.OneInN);
        Assert.True(loaded.RunAtStartup);
    }

    [Fact]
    public void LoadConfig_FallsBackToDefaults_OnCorruptFile()
    {
        // A half-written file after a power cut must not brick the app.
        File.WriteAllText(Path.Combine(_dir, "config.json"), "{ this is not json");
        var config = Store.LoadConfig(_dir);
        Assert.Equal(300_000, config.OneInN);
    }

    [Fact]
    public void LoadState_ReturnsZeroRemaining_WhenNoFileExists()
    {
        Assert.Equal(0, Store.LoadState(_dir).Remaining);
    }

    [Fact]
    public void SaveState_ThenLoadState_RoundTrips()
    {
        Store.SaveState(_dir, new AppState { Remaining = 12_345 });
        Assert.Equal(12_345, Store.LoadState(_dir).Remaining);
    }

    [Fact]
    public void SaveConfig_CreatesTheDirectoryIfMissing()
    {
        var nested = Path.Combine(_dir, "nested");
        Store.SaveConfig(nested, new AppConfig());
        Assert.True(File.Exists(Path.Combine(nested, "config.json")));
    }

    [Fact]
    public void DefaultDirectory_IsUnderAppData()
    {
        Assert.Contains("FoxyJumpscare", Store.DefaultDirectory);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test desktop/FoxyJumpscare.Core.Tests`
Expected: build failure — `Store` does not exist.

- [ ] **Step 3: Write the config types**

Create `desktop/FoxyJumpscare.Core/AppConfig.cs`:

```csharp
namespace FoxyJumpscare.Core;

public sealed class AppConfig
{
    public bool Enabled { get; set; } = true;
    public int OneInN { get; set; } = Roll.DefaultOneInN;
    public int TickSeconds { get; set; } = Ticker.TickSeconds;
    public int IdleThresholdSeconds { get; set; } = 60;

    /// <summary>
    /// How long past the video's own length the force-close waits. There is no
    /// duration setting — on-screen time is the video's length.
    /// </summary>
    public int FailsafeMarginMs { get; set; } = 1500;

    public bool RunAtStartup { get; set; }
}

public sealed class AppState
{
    public long Remaining { get; set; }
}
```

- [ ] **Step 4: Write the store**

Create `desktop/FoxyJumpscare.Core/Store.cs`:

```csharp
using System.Text.Json;

namespace FoxyJumpscare.Core;

public static class Store
{
    private const string ConfigFile = "config.json";
    private const string StateFile = "state.json";

    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static string DefaultDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "FoxyJumpscare");

    public static AppConfig LoadConfig(string dir) => Load<AppConfig>(dir, ConfigFile);
    public static AppState LoadState(string dir) => Load<AppState>(dir, StateFile);

    public static void SaveConfig(string dir, AppConfig config) => Save(dir, ConfigFile, config);
    public static void SaveState(string dir, AppState state) => Save(dir, StateFile, state);

    /// <summary>
    /// Missing or unreadable files fall back to defaults rather than throwing.
    /// A half-written file after a power cut must not stop the app starting.
    /// </summary>
    private static T Load<T>(string dir, string name) where T : new()
    {
        var path = Path.Combine(dir, name);
        if (!File.Exists(path)) return new T();

        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path)) ?? new T();
        }
        catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException)
        {
            return new T();
        }
    }

    private static void Save<T>(string dir, string name, T value)
    {
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, name), JsonSerializer.Serialize(value, Options));
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test desktop/FoxyJumpscare.Core.Tests`
Expected: Passed! 22 tests.

- [ ] **Step 6: Commit**

```bash
git add desktop
git commit -m "feat(desktop): add config and state persistence"
```

---

### Task 4: WPF app project, idle detection, autostart

Produces a running tray app that ticks and logs but does not yet show an overlay.

**Files:**
- Create: `desktop/FoxyJumpscare/FoxyJumpscare.csproj`
- Create: `desktop/FoxyJumpscare/app.manifest`
- Create: `desktop/FoxyJumpscare/Platform/IdleMonitor.cs`
- Create: `desktop/FoxyJumpscare/Platform/Autostart.cs`
- Create: `desktop/FoxyJumpscare/App.xaml`, `App.xaml.cs`
- Create: `desktop/FoxyJumpscare/TrayApp.cs`
- Modify: `desktop/FoxyJumpscare.sln`

**Interfaces:**
- Consumes: `Roll`, `Ticker`, `Store` (Tasks 1-3)
- Produces: `IdleMonitor.GetIdleTime() -> TimeSpan`, `IdleMonitor.IsSessionLocked`, `Autostart.Set(bool)`, `Autostart.IsEnabled`

- [ ] **Step 1: Create the WPF project**

```bash
cd desktop
dotnet new wpf -n FoxyJumpscare -f net8.0
dotnet sln add FoxyJumpscare
dotnet add FoxyJumpscare reference FoxyJumpscare.Core
rm FoxyJumpscare/MainWindow.xaml FoxyJumpscare/MainWindow.xaml.cs
```

- [ ] **Step 2: Configure the csproj**

Replace `desktop/FoxyJumpscare/FoxyJumpscare.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <UseWPF>true</UseWPF>
    <!-- WinForms is here solely for NotifyIcon, which WPF has no equivalent of. -->
    <UseWindowsForms>true</UseWindowsForms>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <AssemblyName>FoxyJumpscare</AssemblyName>
    <RootNamespace>FoxyJumpscare</RootNamespace>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\FoxyJumpscare.Core\FoxyJumpscare.Core.csproj" />
  </ItemGroup>

</Project>
```

- [ ] **Step 3: Write the DPI manifest**

Per-monitor DPI awareness must be declared, or Windows reports scaled coordinates and the overlay lands in the wrong place on mixed-DPI setups.

Create `desktop/FoxyJumpscare/app.manifest`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="FoxyJumpscare.app" />

  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
    </windowsSettings>
  </application>

  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
```

- [ ] **Step 4: Write the idle monitor**

Create `desktop/FoxyJumpscare/Platform/IdleMonitor.cs`:

```csharp
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace FoxyJumpscare.Platform;

/// <summary>
/// System-wide input idle time and session lock state. This is what makes
/// "1 in N per second" mean per second of actually using the computer, rather
/// than per second of the machine being powered on.
/// </summary>
public static class IdleMonitor
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    private static bool _locked;

    static IdleMonitor()
    {
        SystemEvents.SessionSwitch += (_, e) =>
        {
            if (e.Reason == SessionSwitchReason.SessionLock) _locked = true;
            else if (e.Reason == SessionSwitchReason.SessionUnlock) _locked = false;
        };
    }

    public static bool IsSessionLocked => _locked;

    public static TimeSpan GetIdleTime()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info)) return TimeSpan.Zero;

        // dwTime comes from GetTickCount, which wraps every ~49.7 days.
        // Unsigned subtraction gives the correct delta across the wrap;
        // signed arithmetic would produce a huge bogus idle time.
        var now = unchecked((uint)Environment.TickCount);
        var idleMs = unchecked(now - info.dwTime);
        return TimeSpan.FromMilliseconds(idleMs);
    }

    /// <summary>Active means recent input and an unlocked session. Both.</summary>
    public static bool IsActive(int idleThresholdSeconds) =>
        !IsSessionLocked && GetIdleTime().TotalSeconds < idleThresholdSeconds;
}
```

- [ ] **Step 5: Write autostart**

Create `desktop/FoxyJumpscare/Platform/Autostart.cs`:

```csharp
using Microsoft.Win32;

namespace FoxyJumpscare.Platform;

public static class Autostart
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "FoxyJumpscare";

    private static string ExecutablePath =>
        Environment.ProcessPath ?? throw new InvalidOperationException("No process path");

    public static bool IsEnabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKey);
            return key?.GetValue(ValueName) is not null;
        }
    }

    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true)
                        ?? Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled) key.SetValue(ValueName, $"\"{ExecutablePath}\"");
        else key.DeleteValue(ValueName, throwOnMissingValue: false);
    }
}
```

- [ ] **Step 6: Write the application entry point**

Create `desktop/FoxyJumpscare/App.xaml`:

```xml
<Application x:Class="FoxyJumpscare.App"
             xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
             xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
             ShutdownMode="OnExplicitShutdown" />
```

Create `desktop/FoxyJumpscare/App.xaml.cs`:

```csharp
using System.Windows;

namespace FoxyJumpscare;

public partial class App : Application
{
    private TrayApp? _tray;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        _tray = new TrayApp();
        _tray.Start();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _tray?.Dispose();
        base.OnExit(e);
    }
}
```

- [ ] **Step 7: Write the tray app (overlay not yet wired)**

Create `desktop/FoxyJumpscare/TrayApp.cs`:

```csharp
using System.Diagnostics;
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

        _timer = new Timer(TimeSpan.FromSeconds(_config.TickSeconds));
        _timer.Elapsed += OnTick;
        _timer.AutoReset = true;
        _timer.Start();
    }

    private void BuildTrayIcon()
    {
        _icon.Icon = System.Drawing.SystemIcons.Application;
        _icon.Text = "Foxy Jumpscare";
        _icon.Visible = true;

        var menu = new Forms.ContextMenuStrip();

        var enabled = new Forms.ToolStripMenuItem("Enabled") { Checked = _config.Enabled, CheckOnClick = true };
        enabled.CheckedChanged += (_, _) =>
        {
            _config.Enabled = enabled.Checked;
            Store.SaveConfig(_dir, _config);
        };
        menu.Items.Add(enabled);

        var odds = new Forms.ToolStripMenuItem("Rarity");
        foreach (var (name, value) in Roll.Presets)
        {
            var item = new Forms.ToolStripMenuItem(name) { Checked = _config.OneInN == value };
            item.Click += (_, _) =>
            {
                _config.OneInN = value;
                Store.SaveConfig(_dir, _config);
                // Re-draw, or a countdown started at the old odds keeps running
                // and the change appears to do nothing for weeks.
                _state.Remaining = Roll.DrawRemaining(value);
                Store.SaveState(_dir, _state);
                foreach (Forms.ToolStripMenuItem sibling in odds.DropDownItems)
                    sibling.Checked = sibling.Text == name;
            };
            odds.DropDownItems.Add(item);
        }
        menu.Items.Add(odds);

        var test = new Forms.ToolStripMenuItem("Test Scare");
        test.Click += (_, _) => Fire();
        menu.Items.Add(test);

        var startup = new Forms.ToolStripMenuItem("Run at startup")
            { Checked = Autostart.IsEnabled, CheckOnClick = true };
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
```

- [ ] **Step 8: Build and run**

Run: `dotnet build desktop/FoxyJumpscare`
Expected: build succeeds with no warnings.

Run: `dotnet run --project desktop/FoxyJumpscare`
Expected: a tray icon appears. Right-click shows Enabled / Rarity / Test Scare / Run at startup / Quit. Quit exits cleanly.

- [ ] **Step 9: Commit**

```bash
git add desktop
git commit -m "feat(desktop): add tray app, idle gating, and autostart"
```

---

### Task 5: The overlay window

**Files:**
- Create: `desktop/FoxyJumpscare/OverlayWindow.xaml`, `OverlayWindow.xaml.cs`
- Create: `desktop/FoxyJumpscare/Platform/NoActivate.cs`
- Modify: `desktop/FoxyJumpscare/TrayApp.cs` (wire `Fire`)

**Interfaces:**
- Consumes: `AppConfig` (Task 3)
- Produces: `OverlayWindow.ShowAll(string videoPath, int failsafeMarginMs)`

- [ ] **Step 1: Write the no-activate helper**

Create `desktop/FoxyJumpscare/Platform/NoActivate.cs`:

```csharp
using System.Runtime.InteropServices;

namespace FoxyJumpscare.Platform;

/// <summary>
/// WS_EX_NOACTIVATE keeps the overlay from taking focus or swallowing
/// keystrokes; WS_EX_TOOLWINDOW keeps it out of Alt-Tab. ShowActivated=false
/// alone is not sufficient — the window can still steal focus on some
/// compositor paths.
/// </summary>
public static class NoActivate
{
    private const int GwlExStyle = -20;
    private const int WsExNoActivate = 0x08000000;
    private const int WsExToolWindow = 0x00000080;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    public static void Apply(IntPtr hwnd)
    {
        var style = GetWindowLong(hwnd, GwlExStyle);
        SetWindowLong(hwnd, GwlExStyle, style | WsExNoActivate | WsExToolWindow);
    }
}
```

- [ ] **Step 2: Write the overlay XAML**

Create `desktop/FoxyJumpscare/OverlayWindow.xaml`:

```xml
<Window x:Class="FoxyJumpscare.OverlayWindow"
        xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None"
        ResizeMode="NoResize"
        ShowInTaskbar="False"
        Topmost="True"
        ShowActivated="False"
        Background="Black"
        WindowStartupLocation="Manual">
    <MediaElement x:Name="Player"
                  LoadedBehavior="Manual"
                  UnloadedBehavior="Stop"
                  Stretch="Uniform"
                  ScrubbingEnabled="False" />
</Window>
```

- [ ] **Step 3: Write the overlay code-behind**

Create `desktop/FoxyJumpscare/OverlayWindow.xaml.cs`:

```csharp
using System.IO;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using FoxyJumpscare.Platform;
using Forms = System.Windows.Forms;

namespace FoxyJumpscare;

public partial class OverlayWindow : Window
{
    private readonly System.Drawing.Rectangle _physicalBounds;
    private readonly int _failsafeMarginMs;
    private DispatcherTimer? _failsafe;
    private bool _closed;

    private OverlayWindow(System.Drawing.Rectangle physicalBounds, string videoPath, bool muted, int failsafeMarginMs)
    {
        InitializeComponent();
        _physicalBounds = physicalBounds;
        _failsafeMarginMs = failsafeMarginMs;

        Player.Source = new Uri(videoPath);
        // Only the primary screen makes noise. Three monitors would otherwise
        // play three overlapping copies of the scream, slightly out of sync.
        Player.IsMuted = muted;

        Player.MediaEnded += (_, _) => CloseOnce();
        Player.MediaFailed += (_, _) => CloseOnce();
        Player.MediaOpened += (_, _) => ArmFailsafe();
    }

    /// <summary>Show one overlay per monitor. Returns immediately.</summary>
    public static void ShowAll(string videoPath, int failsafeMarginMs)
    {
        if (!File.Exists(videoPath)) return;

        var primary = Forms.Screen.PrimaryScreen;
        foreach (var screen in Forms.Screen.AllScreens)
        {
            var muted = !ReferenceEquals(screen, primary) && screen.DeviceName != primary?.DeviceName;
            var window = new OverlayWindow(screen.Bounds, videoPath, muted, failsafeMarginMs);
            window.Show();
            window.Player.Play();
        }
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);

        var handle = new WindowInteropHelper(this).Handle;
        NoActivate.Apply(handle);

        // Screen.Bounds is physical pixels; WPF positions in device-independent
        // units. Without this conversion the overlay is mis-sized on any
        // mixed-DPI setup — which is most laptops with an external display.
        var source = PresentationSource.FromVisual(this);
        var toDip = source?.CompositionTarget?.TransformFromDevice ?? System.Windows.Media.Matrix.Identity;

        var topLeft = toDip.Transform(new Point(_physicalBounds.Left, _physicalBounds.Top));
        var size = toDip.Transform(new Point(_physicalBounds.Width, _physicalBounds.Height));

        Left = topLeft.X;
        Top = topLeft.Y;
        Width = size.X;
        Height = size.Y;
    }

    /// <summary>
    /// Independent of the media element. If the video fails to decode,
    /// MediaEnded never fires, and without this the user is left staring at a
    /// fullscreen window they cannot close.
    /// </summary>
    private void ArmFailsafe()
    {
        var natural = Player.NaturalDuration.HasTimeSpan
            ? Player.NaturalDuration.TimeSpan
            : TimeSpan.FromSeconds(5);

        _failsafe = new DispatcherTimer
        {
            Interval = natural + TimeSpan.FromMilliseconds(_failsafeMarginMs),
        };
        _failsafe.Tick += (_, _) => CloseOnce();
        _failsafe.Start();
    }

    private void CloseOnce()
    {
        if (_closed) return;
        _closed = true;

        _failsafe?.Stop();
        _failsafe = null;

        Player.Stop();
        Player.Close();
        Close();
    }
}
```

Note: `ArmFailsafe` only runs on `MediaOpened`. If the file is so broken that neither `MediaOpened` nor `MediaFailed` fires, nothing closes the window. Add a second, unconditional guard in the constructor:

```csharp
        // Belt and braces: armed immediately, independent of any media event.
        var hardStop = new DispatcherTimer { Interval = TimeSpan.FromSeconds(15) };
        hardStop.Tick += (_, _) => CloseOnce();
        hardStop.Start();
```

- [ ] **Step 4: Wire it into the tray app**

In `desktop/FoxyJumpscare/TrayApp.cs`, replace `Fire`:

```csharp
    private void Fire()
    {
        var video = Path.Combine(AppContext.BaseDirectory, "foxy.mp4");

        // Timer callbacks are not on the UI thread; WPF windows must be.
        Application.Current.Dispatcher.Invoke(() =>
            OverlayWindow.ShowAll(video, _config.FailsafeMarginMs));

        _state.Remaining = Roll.DrawRemaining(_config.OneInN);
        Store.SaveState(_dir, _state);
    }
```

Add `using System.IO;` at the top.

- [ ] **Step 5: Copy the video into the build output**

Add to `desktop/FoxyJumpscare/FoxyJumpscare.csproj`:

```xml
  <ItemGroup>
    <None Include="..\..\assets\foxy.mp4" Condition="Exists('..\..\assets\foxy.mp4')"
          CopyToOutputDirectory="PreserveNewest" Link="foxy.mp4" />
  </ItemGroup>
```

- [ ] **Step 6: Build and test by hand**

Run: `dotnet build desktop/FoxyJumpscare`
Expected: succeeds.

Run: `dotnet run --project desktop/FoxyJumpscare`, then tray → Test Scare.
Expected: with `assets/foxy.mp4` present, Foxy plays fullscreen on every monitor and closes itself. Without it, nothing happens and the app stays running.

- [ ] **Step 7: Commit**

```bash
git add desktop
git commit -m "feat(desktop): add per-monitor overlay window"
```

---

### Task 6: Release build and manual verification

**Files:**
- Create: `docs/desktop-checklist.md`

- [ ] **Step 1: Publish a single-file build**

Run:

```bash
dotnet publish desktop/FoxyJumpscare -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true
```

Expected: an exe under `desktop/FoxyJumpscare/bin/Release/net8.0-windows/win-x64/publish/`.

- [ ] **Step 2: Write the checklist**

Create `docs/desktop-checklist.md`:

```markdown
# Desktop release checklist

Verified by hand — these are the failures that only appear on real hardware.

- [ ] Tray icon appears; every menu item works; Quit exits with no orphan process
- [ ] Test Scare plays fullscreen on the **primary** monitor with audio
- [ ] With multiple monitors: an overlay on **each**, and **exactly one** audible
      audio stream
- [ ] **Mixed-DPI**: overlay covers each monitor exactly, no gaps or overhang
      (laptop panel + external display at different scaling)
- [ ] Overlay does **not** steal focus — keep typing in another window while it plays
      and no keystrokes are lost
- [ ] Overlay does not appear in Alt-Tab
- [ ] Overlay closes itself; the desktop is fully interactive afterwards
- [ ] **Failsafe**: replace foxy.mp4 with a truncated/corrupt file, fire, and confirm
      the window still closes
- [ ] Lock the session — confirm no overlay fires while locked
- [ ] Run at startup toggles the HKCU Run key both directions
- [ ] Odds change re-draws the countdown (state.json Remaining changes immediately)
- [ ] First run shows a SmartScreen warning; note the exact wording for the README
```

- [ ] **Step 3: Commit**

```bash
git add docs/desktop-checklist.md
git commit -m "docs: add desktop release checklist"
```

---

## Self-Review

**Spec coverage.** Roll identical to the extension's (Task 1, cross-referenced in both files' comments), 30s tick (Task 2), idle + lock gating (Task 4), config keys exactly as specified with no `durationMs` (Task 3), `%APPDATA%\FoxyJumpscare\` (Task 3), one window per monitor (Task 5), primary-only audio (Task 5), `ShowActivated=false` plus `WS_EX_NOACTIVATE` (Task 5), per-monitor DPI conversion plus the manifest that makes it meaningful (Tasks 4, 5), `MediaEnded` teardown with independent failsafe (Task 5), autostart off by default and opt-in (Tasks 3, 4), tray menu contents (Task 4), single-file publish (Task 6).

**Type consistency.** `Remaining` is `long` in `AppState`, `Ticker.Credit`, and `Roll.DrawRemaining`'s return. `OneInN` is `int` throughout. `TickResult` is a readonly record struct with `Remaining` and `ShouldFire`, matching every use.

**Deliberate gap.** There are no automated UI tests. Everything testable without a desktop — the roll, the tick, persistence — is covered by xunit in `FoxyJumpscare.Core.Tests`. The overlay's real failure modes are DPI, focus stealing, and multi-monitor audio, none of which a headless test can observe. Task 6's checklist is the honest substitute, not an oversight.

**Known rough edge, flagged.** Task 5 Step 3 arms the failsafe on `MediaOpened`, then immediately adds an unconditional hard stop in the constructor. Both are needed: the first scales to the actual video length, the second covers a file so broken that no media event fires at all. Implement both.
