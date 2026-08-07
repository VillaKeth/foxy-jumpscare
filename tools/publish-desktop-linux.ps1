#requires -Version 5.1
<#
.SYNOPSIS
  Build a self-contained Linux build you can send to a friend.

.DESCRIPTION
  Publishes the Avalonia app (not the Windows-only WPF one) for linux-x64 with
  the .NET runtime bundled, so the recipient needs no SDK and no runtime.

  What they DO still need is the system VLC libraries, because libVLC is not
  redistributable the way the Windows NuGet build is - see INSTALL.txt, which
  carries the package list for their distro. Everything else is in the tarball.

  The archive is built through WSL when it is available, because a tar created
  on Windows records mode 0666 and the recipient then gets "permission denied"
  on a binary that has lost its executable bit. Without WSL the script still
  produces a working tarball and tells you to warn them about chmod.

.EXAMPLE
  pwsh tools/publish-desktop-linux.ps1
#>
param(
  [string]$Configuration = 'Release',
  [string]$Runtime = 'linux-x64'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."
$proj = "$repo\desktop\FoxyJumpscare.Avalonia\FoxyJumpscare.Avalonia.csproj"
$dotnet = "$env:ProgramFiles\dotnet\dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = 'dotnet' }

$publishDir = "$repo\dist\desktop\publish-$Runtime"
$outDir     = "$repo\dist\desktop"
$tarball    = "$outDir\FoxyJumpscare-$Runtime.tar.gz"

if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }

Write-Host "  publishing self-contained ($Runtime, $Configuration)..."
& $dotnet publish $proj `
  -c $Configuration `
  -r $Runtime `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -p:DebugType=none `
  -o $publishDir `
  --nologo `
  -v quiet
if ($LASTEXITCODE -ne 0) { throw "publish failed" }

# Copy the assets explicitly: the app loads both from disk beside the binary at
# runtime, and MSBuild drops an ApplicationIcon file from single-file output.
foreach ($asset in 'foxy.mp4', 'foxy-alpha.mp4', 'foxy.ico') {
  $srcAsset = "$repo\assets\$asset"
  if (Test-Path $srcAsset) { Copy-Item $srcAsset $publishDir -Force }
}
if (-not (Test-Path "$publishDir\foxy.mp4")) {
  throw "foxy.mp4 is missing. Run 'npm run assets' first."
}
# The transparent cut is what the overlay actually plays; without it the app
# silently falls back to compositing over black, which is the bug this build
# exists to fix. Ship foxy.mp4 as well, so deleting one file is a working
# escape hatch if a recipient's VLC cannot decode the double-width cut.
if (-not (Test-Path "$publishDir\foxy-alpha.mp4")) {
  throw "foxy-alpha.mp4 is missing. Run 'npm run assets' first."
}

$install = @"
Foxy Jumpscare - install (Linux)

============================================================
EASIEST WAY - set it up once, then forget about it
============================================================

STEP 1. Make sure VLC is installed (one-time - it is the video codec).
        If you already have the VLC media player, skip this.

        - From your Software Center / app store: search "VLC", install it.
        - Or in a terminal:
            Arch / EndeavourOS / Manjaro:      sudo pacman -S vlc
            Debian / Ubuntu / Mint / Pop!_OS:  sudo apt install libvlc5 vlc-plugin-base
            Fedora:                            sudo dnf install vlc-libs vlc-plugins-base

        The base package is enough everywhere - the scare video is VP9, whose
        decoder ships with VLC on every distro. No extra codec package needed.

STEP 2. Double-click  install.sh  in this folder. If your file manager asks,
        choose "Run" (or "Run in Terminal"). If it opens as a text file
        instead, open a terminal in this folder and run:

            bash install.sh

        That is the whole install. It:
          - copies the app to a permanent spot (~/.local/share/FoxyJumpscare),
          - starts it right now,
          - makes it launch automatically every time you log in.

        You can delete this folder afterwards. It keeps running and keeps
        coming back at every login until you remove it.

TO SEE IT / CHANGE SETTINGS
        Open your app menu and search "Foxy" - that opens the settings window
        ("Test it now" fires one immediately). Otherwise it just sits in the
        background until it strikes.

TO REMOVE IT
        Double-click  uninstall.sh  (or "bash uninstall.sh"). Stops it and
        removes the autostart entry, the installed copy, and your settings.

============================================================
PREFER TO DO IT BY HAND?
============================================================

            tar -xzf FoxyJumpscare-linux-x64.tar.gz
            cd FoxyJumpscare
            chmod +x FoxyJumpscare      # only if it will not start
            ./FoxyJumpscare             # background tray app - nothing visible is normal
            ./FoxyJumpscare --settings  # to open the window now

        For launch-at-login by hand: open the settings window and tick "Run at
        startup" (or the same item in the tray menu). Keep the app folder where
        it is - the entry points at that location.

WHAT IT DOES
  At random - by default about once every couple of days of active use - a
  screaming animatronic fox takes over your screen for about a second, then
  goes away on its own. Change how often, or turn it off, in the settings
  window. "Test it now" fires one immediately without affecting the countdown.

  Sudden loud audio and a startle, by design. Skip it if you are
  photosensitive, and think twice on a work machine or in headphones.

LINUX NOTES
  - The tray icon needs a desktop that still supports system tray icons. GNOME
    hides them unless you have an AppIndicator extension. Either way the app
    works and the menu entry ("search Foxy") opens everything, including
    "Run at startup".
  - Idle detection uses X11. On Wayland it cannot tell whether you are at the
    keyboard, so the countdown keeps running while you are away.
  - Foxy is composited OVER your screen, not onto a black background. That needs
    a compositing desktop, which GNOME, KDE and anything on Wayland all are. On
    a bare X11 session with no compositor the fox still appears, just on black -
    nothing breaks, it only looks less good.
  - While he is on screen (about a second and a half) clicks land on the overlay
    rather than on what is underneath. Windows passes them through; the same
    trick is not wired up here yet.
  - If the scare plays sound but shows nothing, your VLC could not decode the
    double-width transparent video. Delete foxy-alpha.mp4 from the app folder
    (~/.local/share/FoxyJumpscare) and it falls back to foxy.mp4 automatically -
    black background, but working.

Settings live in ~/.config/FoxyJumpscare. Autostart, once on, is
~/.config/autostart/foxyjumpscare.desktop.
"@

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
# LF endings: this file is read on Linux, and CRLF makes shell snippets in it
# annoying to copy out.
$installLf = $install -replace "`r`n", "`n"
[System.IO.File]::WriteAllText("$publishDir\INSTALL.txt", $installLf)

# Ship the one-time installer / uninstaller. LF endings: they run on Linux, and
# a CR at the end of the shebang line makes the kernel look for "/bin/bash\r".
foreach ($sh in 'install.sh', 'uninstall.sh') {
  $shSrc = "$repo\tools\linux\$sh"
  if (-not (Test-Path $shSrc)) { throw "missing $shSrc - expected tools/linux/$sh" }
  $shLf = (Get-Content $shSrc -Raw) -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText("$publishDir\$sh", $shLf)
}

# foxy.ico is the one optional entry. Both desktop apps fall back to a default
# tray icon when it is absent (TrayController.LoadTrayIcon), and a clean clone
# cannot build it - it comes from a source still that is gitignored like the
# rest of the pack. Requiring it here made this script the only thing in the
# repo that a fresh checkout could not run; the Windows script always treated it
# as optional. Everything else is load-bearing: drop one and the scare has
# nothing to show, or the recipient has no way to install it.
$optional = @('foxy.ico')
$ship = @('FoxyJumpscare', 'foxy.mp4', 'foxy-alpha.mp4', 'foxy.ico',
          'INSTALL.txt', 'install.sh', 'uninstall.sh') |
  Where-Object {
    $present = Test-Path (Join-Path $publishDir $_)
    if (-not $present) {
      if ($optional -notcontains $_) { throw "missing from publish output: $_" }
      Write-Warning "no $_ - shipping without it; the tray falls back to a default icon."
    }
    $present
  }

if (Test-Path $tarball) { Remove-Item $tarball -Force }

# Build the archive in WSL so the binary keeps its executable bit.
$wsl = Get-Command wsl -ErrorAction SilentlyContinue
$madeWithWsl = $false
if ($wsl) {
  $wslPublish = (& wsl wslpath -a ($publishDir -replace '\\', '/')) 2>$null
  $wslOut     = (& wsl wslpath -a ($tarball    -replace '\\', '/')) 2>$null
  if ($wslPublish -and $wslOut) {
    $names = $ship -join ' '
    $cmd = "cd '$wslPublish' && chmod +x FoxyJumpscare install.sh uninstall.sh && " +
           "tar --transform 's,^,FoxyJumpscare/,' -czf '$wslOut' $names"
    & wsl bash -lc $cmd
    $madeWithWsl = ($LASTEXITCODE -eq 0)
  }
}

if (-not $madeWithWsl) {
  Write-Warning "WSL unavailable - archiving from Windows, which loses the executable bit."
  Write-Warning "Tell the recipient to run: chmod +x FoxyJumpscare"
  Push-Location $publishDir
  try { & tar -czf $tarball @ship } finally { Pop-Location }
}

if (-not (Test-Path $tarball)) { throw "archive was not created" }

$size = [math]::Round((Get-Item $tarball).Length / 1MB, 1)
Write-Host ""
Write-Host "  $tarball  ($size MB)"
Write-Host "  contains: $($ship -join ', ')"
if ($madeWithWsl) { Write-Host "  executable bit preserved (archived via WSL)." }
Write-Host "  the recipient also needs their distro's VLC libraries - see INSTALL.txt."
