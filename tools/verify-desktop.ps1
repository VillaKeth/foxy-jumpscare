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

# A target window to hold focus. Notepad is always present and harmless.
$target = Start-Process notepad -PassThru
Start-Sleep -Milliseconds 900
[void][Win]::SetForegroundWindow($target.MainWindowHandle)
Start-Sleep -Milliseconds 400

$before = [Win]::GetForegroundWindow()
$beforeTitle = [Win]::TitleOf($before)
"  focus holder: '$beforeTitle'"

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
        if (-not $overlay.ContainsKey($h)) {
            $overlay[$h] = [pscustomobject]@{
                ExStyle = [int64][Win]::GetWindowLongPtr($h, [Win]::GWL_EXSTYLE)
                Rect    = [Win]::RectOf($h)
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
    Check "overlay stays out of Alt-Tab (WS_EX_TOOLWINDOW)" ($toolWindow -eq $overlay.Count) `
          "$toolWindow/$($overlay.Count) windows"

    # One window is supposed to span the whole virtual desktop.
    $virt = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $spanning = $overlay.Values | Where-Object {
        $_.Rect.Width -ge ($virt.Width - 2) -and $_.Rect.Height -ge ($virt.Height - 2)
    }
    Check "overlay covers the whole virtual desktop" ($spanning.Count -ge 1) `
          "$(($overlay.Values | ForEach-Object { '{0}x{1}' -f $_.Rect.Width, $_.Rect.Height }) -join ', ') vs $($virt.Width)x$($virt.Height)"
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
