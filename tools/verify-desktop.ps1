<#
.SYNOPSIS
  Behavioural checks for the desktop overlay that a headless test cannot do.

.DESCRIPTION
  Verifies the overlay does not steal focus, does not appear in Alt-Tab, and
  covers every monitor. Focus stealing is the one that actually matters: a
  jumpscare that eats the sentence you were typing is a bug, not a feature.

  Deliberately does not screenshot. An earlier screenshot-based approach
  captured the whole desktop, including whatever the user had open.

.EXAMPLE
  pwsh -File tools/verify-desktop.ps1
#>
[CmdletBinding()]
param(
    [string]$Exe = "desktop\FoxyJumpscare\bin\Debug\net8.0-windows\FoxyJumpscare.exe"
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class Win {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    public delegate bool EnumProc(IntPtr h, IntPtr param);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr param);

    /// The overlay Window sets no Title, so it cannot be found by name.
    /// Match on owning process instead.
    public static IntPtr[] VisibleWindowsOf(uint pid) {
        var found = new System.Collections.Generic.List<IntPtr>();
        EnumWindows((h, p) => {
            uint owner;
            GetWindowThreadProcessId(h, out owner);
            if (owner == pid && IsWindowVisible(h)) found.Add(h);
            return true;
        }, IntPtr.Zero);
        return found.ToArray();
    }

    public const int GWL_EXSTYLE     = -20;
    public const int WS_EX_NOACTIVATE = 0x08000000;
    public const int WS_EX_TOOLWINDOW = 0x00000080;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr h, StringBuilder s, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
    public const uint GW_OWNER = 4;

    // The actual Win32 rule for "does this show up in Alt-Tab": a visible
    // window appears unless it has an owner or WS_EX_TOOLWINDOW. WPF keeps the
    // overlay out with the style; Avalonia's ShowInTaskbar=false uses an owner
    // window instead. Both satisfy the property, so test the property.
    public static bool InAltTab(IntPtr h) {
        if (!IsWindowVisible(h)) return false;
        if (GetWindow(h, GW_OWNER) != IntPtr.Zero) return false;
        long ex = (long)GetWindowLongPtr(h, -20);
        return (ex & 0x00000080) == 0;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
        public int Width  { get { return Right - Left; } }
        public int Height { get { return Bottom - Top; } }
    }

    public static string TitleOf(IntPtr h) {
        var sb = new StringBuilder(512);
        GetWindowTextW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public static string ClassOf(IntPtr h) {
        var sb = new StringBuilder(512);
        GetClassNameW(h, sb, sb.Capacity);
        return sb.ToString();
    }

    public static RECT RectOf(IntPtr h) {
        RECT r;
        GetWindowRect(h, out r);
        return r;
    }
}
'@

if (-not (Test-Path $Exe)) {
    Write-Error "Executable not found: $Exe`nRun: dotnet build desktop/FoxyJumpscare"
}

$results = @()
function Check([string]$label, [bool]$ok, [string]$detail) {
    $script:results += [pscustomobject]@{ Label = $label; Ok = $ok; Detail = $detail }
    $tag = if ($ok) { 'PASS' } else { 'FAIL' }
    if ($detail) { "  $tag  $label - $detail" } else { "  $tag  $label" }
}

# A target window to hold focus, so "the overlay never steals focus" has
# something to steal it from.
#
# This was `Start-Process notepad` until Windows 11, where system32\notepad.exe
# is a stub that hands the launch to the Store app and exits immediately. The
# PID it returns owns no window, MainWindowHandle stays 0, SetForegroundWindow(0)
# is a no-op, and the entire focus assertion silently tested nothing - it
# compared the foreground window against whatever happened to be focused when
# the run started. Worse, on some Win11 builds Start-Process itself throws
# "cannot find all the information required" and the script dies before any
# check runs.
#
# A WinForms window hosted in a child pwsh is owned by a process we control, so
# its handle is real and we can wait for it instead of guessing. Found by
# enumerating the child's visible windows rather than trusting
# MainWindowHandle, which races the window's creation.
$holderScript = @'
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Foxy focus holder'
$f.Width = 480
$f.Height = 220
[void]$f.ShowDialog()
'@
$target = Start-Process pwsh -PassThru -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-Command', $holderScript
)

$holder = [IntPtr]::Zero
for ($i = 0; $i -lt 60 -and $holder -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 100
    $wins = [Win]::VisibleWindowsOf([uint32]$target.Id)
    if ($wins.Count -gt 0) { $holder = $wins[0] }
}
if ($holder -eq [IntPtr]::Zero) {
    if ($target -and -not $target.HasExited) { Stop-Process -Id $target.Id -Force }
    Write-Error "focus holder window never appeared - cannot test focus stealing"
}

[void][Win]::SetForegroundWindow($holder)
Start-Sleep -Milliseconds 500

$before = [Win]::GetForegroundWindow()
$beforeTitle = [Win]::TitleOf($before)
"  focus holder: '$beforeTitle'"
if ($before -ne $holder) {
    "  warning: the focus holder did not take the foreground (got '$beforeTitle')."
    "           Focus-stealing results below are weaker than they look."
}

$virtBounds = [System.Windows.Forms.SystemInformation]::VirtualScreen

$foxy = Start-Process $Exe -ArgumentList "--test-scare" -PassThru

# Poll across the overlay's lifetime. Styles must be read while the window is
# alive: querying a dead handle after the process exits returns 0, which reads
# as "no styles set" and fails for entirely the wrong reason.
$samples = 0
$takenByOverlay = 0
$otherApps = @()
$overlay = @{}
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 100
    $samples++

    # The property under test is "the overlay never takes focus", NOT "focus
    # never changes". Asserting the latter fails whenever the person running
    # this clicks something, which says nothing about the overlay.
    $fg = [Win]::GetForegroundWindow()
    $fgPid = 0
    [void][Win]::GetWindowThreadProcessId($fg, [ref]$fgPid)

    if ($fgPid -eq $foxy.Id) {
        $takenByOverlay++
    } elseif ($fg -ne $before) {
        $otherApps += "'{0}'" -f [Win]::TitleOf($fg)
    }

    foreach ($h in [Win]::VisibleWindowsOf([uint32]$foxy.Id)) {
        $r = [Win]::RectOf($h)

        # Only count windows actually ON the desktop. The app also builds a
        # throwaway window at startup to pay Avalonia's first-window cost; it
        # is parked at (-32000,-32000) and clamped to a ~32x39 minimum by
        # Win32, and counting it made every style check read "1/3 windows"
        # against windows that are not the overlay.
        $onScreen = ($r.Right -gt $virtBounds.Left) -and ($r.Left -lt $virtBounds.Right) -and
                    ($r.Bottom -gt $virtBounds.Top) -and ($r.Top -lt $virtBounds.Bottom)
        if (-not $onScreen) { continue }

        if (-not $overlay.ContainsKey($h)) {
            $overlay[$h] = [pscustomobject]@{
                ExStyle = [int64][Win]::GetWindowLongPtr($h, [Win]::GWL_EXSTYLE)
                Rect    = $r
                InAltTab = [Win]::InAltTab($h)
            }
        }
    }
}

if (-not $foxy.HasExited) { Stop-Process -Id $foxy.Id -Force }

Check "overlay never takes foreground focus" ($takenByOverlay -eq 0) `
      "$samples samples, $takenByOverlay taken by overlay"

if ($otherApps.Count -gt 0) {
    "  note: focus moved to $((($otherApps | Select-Object -Unique) -join ', ')) during the run"
    "        - that is someone using the machine, not the overlay, and is not a failure."
}

$screens = [System.Windows.Forms.Screen]::AllScreens
if ($overlay.Count -gt 0) {
    $noActivate = ($overlay.Values | Where-Object { ($_.ExStyle -band [Win]::WS_EX_NOACTIVATE) -ne 0 }).Count
    $toolWindow = ($overlay.Values | Where-Object { ($_.ExStyle -band [Win]::WS_EX_TOOLWINDOW) -ne 0 }).Count

    Check "overlay sets WS_EX_NOACTIVATE" ($noActivate -eq $overlay.Count) `
          "$noActivate/$($overlay.Count) windows"
    # Test the PROPERTY, not one implementation of it. WPF stays out of Alt-Tab
    # with WS_EX_TOOLWINDOW; Avalonia's ShowInTaskbar=false uses an owner
    # window and never sets the style. Asserting the style failed the Avalonia
    # build for doing the same thing a different way.
    $inAltTab = ($overlay.Values | Where-Object { $_.InAltTab }).Count
    Check "overlay stays out of Alt-Tab" ($inAltTab -eq 0) `
          "$inAltTab/$($overlay.Count) windows would appear (owner-window or WS_EX_TOOLWINDOW)"
    if ($toolWindow -ne $overlay.Count) {
        "  note: $toolWindow/$($overlay.Count) set WS_EX_TOOLWINDOW; the rest use an owner window."
    }

    # Cover every monitor, not "one window covering everything". WPF used a
    # single window spanning the virtual desktop with mirrored brushes;
    # Avalonia opens one window per monitor. Both are correct, and requiring
    # the WPF shape reported a false failure against a build that covered all
    # 3840x1080 with two perfectly placed 1920x1080 windows.
    $uncovered = @()
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
        $b = $s.Bounds
        $covered = $overlay.Values | Where-Object {
            $_.Rect.Left -le ($b.Left + 2) -and $_.Rect.Top -le ($b.Top + 2) -and
            $_.Rect.Right -ge ($b.Right - 2) -and $_.Rect.Bottom -ge ($b.Bottom - 2)
        }
        if ($covered.Count -eq 0) { $uncovered += "$($s.DeviceName) $($b.Width)x$($b.Height)@($($b.X),$($b.Y))" }
    }
    Check "overlay covers every monitor" ($uncovered.Count -eq 0) `
          "$(($overlay.Values | ForEach-Object { '{0}x{1}@({2},{3})' -f $_.Rect.Width, $_.Rect.Height, $_.Rect.Left, $_.Rect.Top }) -join ', ')$(if ($uncovered.Count) { ' - UNCOVERED: ' + ($uncovered -join ', ') })"

    # Nothing may be mapped at the wrong size, even briefly. Every scare used
    # to open a 1440x753 window at (26,26) for ~31ms because windows were
    # Show()n before they were placed - a flash in the corner immediately
    # before the scare. Any on-screen window that matches no monitor is that
    # bug returning.
    $strays = $overlay.Values | Where-Object {
        $r = $_.Rect
        -not ([System.Windows.Forms.Screen]::AllScreens | Where-Object {
            [Math]::Abs($_.Bounds.Width - $r.Width) -le 2 -and [Math]::Abs($_.Bounds.Height - $r.Height) -le 2
        })
    }
    Check "no mis-sized window ever appears on screen" ($strays.Count -eq 0) `
          "$(($strays | ForEach-Object { '{0}x{1}@({2},{3})' -f $_.Rect.Width, $_.Rect.Height, $_.Rect.Left, $_.Rect.Top }) -join ', ')"
} else {
    # The overlay is short-lived; a slow machine can miss it between polls.
    Check "overlay window observed" $false "never caught it - is assets/foxy.mp4 built?"
}

$screens = $screens.Count
"  monitors attached: $screens"
if ($screens -gt 1) {
    "  note: all monitors are driven by one window with mirrored brushes;"
    "        confirm by eye that every screen shows the same frame."
}

if ($target -and -not $target.HasExited) { Stop-Process -Id $target.Id -Force }

""
if ($results | Where-Object { -not $_.Ok }) {
    Write-Error "Desktop verification FAILED"
}
"  Desktop verification passed"
