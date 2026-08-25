#requires -Version 5.1
<#
.SYNOPSIS
  Build the TRANSPARENT Windows build you can send to a friend.

.DESCRIPTION
  This packages the Avalonia app (desktop/FoxyJumpscare.Avalonia), whose overlay
  composites Foxy over whatever is already on screen. It is the same program the
  author runs day to day, and the counterpart to publish-desktop.ps1, which
  packages the older WPF app and paints an opaque black backdrop.

  Two Windows builds therefore exist, and the artifact names are how a recipient
  tells them apart:

    FoxyJumpscare-win-x64.zip        this script    Avalonia, transparent
    FoxyJumpscare-win-x64-black.zip  publish-desktop.ps1  WPF, opaque

  Codec: this build carries its own libVLC (VideoLAN.LibVLC.Windows) and depends
  on no OS decoder, so unlike the WPF build there is no Windows 10 "install VP9
  Video Extensions" caveat to pass on. That independence is why the zip is large
  - libvlc/win-x64 is ~102 MB of decoder plugins, and they have to sit on disk
  next to the exe because LibVLCSharp's Core.Initialize() discovers the plugin
  tree by path, relative to the app directory.

  NOT single-file, unlike the other two publish scripts, and that is deliberate.
  PublishSingleFile + IncludeNativeLibrariesForSelfExtract pulls every native
  .dll into the bundle - which here means libvlc.dll, libvlccore.dll and all 650
  plugins, producing a 137 MB exe and a libvlc\win-x64 containing nothing but
  hrtfs, lua and two .lib import libraries. Self-extraction then flattens those
  natives into a temp directory, so the plugins\ subtree libVLC scans for no
  longer exists in the shape it expects. The scare initialises and plays
  nothing.

  Turning single-file off restores the exact on-disk layout the app is developed
  and tested against (desktop/FoxyJumpscare.Avalonia/bin/Release/net8.0), at the
  cost of ~40 loose runtime DLLs beside the exe. Single-file bought nothing here
  regardless: the 102 MB plugin tree keeps this a folder-you-must-keep-together
  either way. The plugins\ assertion below is what catches a regression on this.

  The package deliberately excludes libvlc/win-x86 and the .lib import libraries.
  The NuGet package lays down both architectures, the publish is win-x64
  self-contained, and the 32-bit tree is another ~99 MB that nothing here can
  load. The .lib files are link-time artifacts; only the .dlls run.

  Assets are copied in explicitly rather than trusted to the build, for the same
  reason the other two scripts do it: the app loads them from disk beside the
  exe at runtime, and MSBuild drops an ApplicationIcon file from loose
  single-file publish output. foxy-alpha.mp4 is the load-bearing one - it is the
  double-width [colour | alpha matte] cut the transparent overlay actually
  plays, and without it the app silently falls back to foxy.mp4 over black, i.e.
  back to the build this one exists to replace. Both ship, so deleting
  foxy-alpha.mp4 stays a working escape hatch for a recipient whose machine
  cannot decode the double-width cut.

  Odds are left at the Core default of 1 in 100,000 per 30s tick - roughly a
  couple of days of active use. That is a recipient-facing default and is not
  the author's own setting; config is per-machine, in %APPDATA%\FoxyJumpscare.

  libVLC prewarm is on. It is default-on in OverlayWindow.Prewarm and only
  FOXY_NO_PREWARM=1 disables it; nothing in this package sets that.

  Self-contained means the .NET runtime is bundled: the recipient double-clicks
  and it runs, with nothing to install first.

  The exe is unsigned, so SmartScreen will warn on first run. INSTALL.txt in the
  zip tells the recipient how to get past it.

.EXAMPLE
  pwsh tools/publish-desktop-windows.ps1
#>
param(
  [string]$Configuration = 'Release',
  [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."
$proj = "$repo\desktop\FoxyJumpscare.Avalonia\FoxyJumpscare.Avalonia.csproj"
$dotnet = "$env:ProgramFiles\dotnet\dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = 'dotnet' }

# Distinct from publish-desktop.ps1's "publish" directory on purpose: the two
# Windows builds produce a same-named FoxyJumpscare.exe, and sharing an output
# directory would let whichever ran last masquerade as the other.
$publishDir = "$repo\dist\desktop\publish-avalonia-$Runtime"
$stageDir   = "$repo\dist\desktop\stage-avalonia-$Runtime\FoxyJumpscare"
$outDir     = "$repo\dist\desktop"
$zip        = "$outDir\FoxyJumpscare-$Runtime.zip"

foreach ($dir in $publishDir, (Split-Path $stageDir -Parent)) {
  if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
}

Write-Host "  publishing self-contained ($Runtime, $Configuration)..."
& $dotnet publish $proj `
  -c $Configuration `
  -r $Runtime `
  --self-contained true `
  -p:DebugType=none `
  -o $publishDir `
  --nologo `
  -v quiet
if ($LASTEXITCODE -ne 0) { throw "publish failed" }

foreach ($asset in 'foxy.mp4', 'foxy-alpha.mp4', 'foxy.ico') {
  $srcAsset = "$repo\assets\$asset"
  if (Test-Path $srcAsset) { Copy-Item $srcAsset $publishDir -Force }
}

if (-not (Test-Path "$publishDir\foxy.mp4")) {
  throw "foxy.mp4 is missing. Run 'npm run assets' first."
}
# Asserted, not warned about: its absence degrades silently to the black build.
if (-not (Test-Path "$publishDir\foxy-alpha.mp4")) {
  throw "foxy-alpha.mp4 is missing. Run 'npm run assets' first."
}
# Same for the decoder tree - a missing plugins directory is a scare that plays
# no video, which looks like a crash rather than a packaging mistake.
$vlcDir = "$publishDir\libvlc\$Runtime"
if (-not (Test-Path "$vlcDir\plugins")) {
  throw "libvlc\$Runtime\plugins is missing from the publish output - LibVLCSharp cannot initialise without it."
}

# Instructions for a non-technical recipient. Written into the zip.
$install = @"
Foxy Jumpscare - install (Windows)

WHICH VERSION IS THIS
  The TRANSPARENT one. When it fires, Foxy lunges out over whatever is already
  on your screen - you keep seeing your desktop, your browser, your game behind
  him - for about a second and a half, then he vanishes on his own. Your clicks
  pass straight through him to what is underneath.

  There is an older build that turns the whole screen black instead. This is not
  that one. If Foxy ever appears on a black rectangle here, see the last section.

1. Unzip this folder anywhere (Desktop is fine). Keep the files together - the
   app needs the folder it came in.
2. Double-click FoxyJumpscare.exe.
3. Windows will say "Windows protected your PC" because the app is not
   code-signed. Click "More info", then "Run anyway". (This warning appears for
   any unsigned app; it is not a virus warning.)
4. It runs in the system tray - the little icons by the clock, possibly behind
   the ^ arrow. Look for the Foxy face. Nothing else visible is normal.
5. Double-click that tray icon to open settings. Right-click it for a menu.

WHAT IT DOES
  At random - by default about once every couple of days of active use - a
  screaming animatronic fox takes over your screen for about a second, then
  goes away on its own. Change how often, or turn it off, from the settings
  window. "Test it now" fires one immediately without affecting the countdown.

  Sudden loud audio and a startle, by design. Skip it if you are
  photosensitive, and think twice on a work machine or in headphones.

  It only counts down while you are actually at the keyboard, so it will not
  spend its odds overnight and jump you the moment you sit down.

  Keep it running: turn on "Run at startup" in the settings window or the tray
  menu, or it stops when you reboot.

TO REMOVE IT
  Right-click the tray icon and choose Quit, then delete the folder. Turn off
  "Run at startup" first, or clear it afterwards from Task Manager's Startup
  tab. Settings live in %APPDATA%\FoxyJumpscare, which you can delete too.

IF IT PLAYS SOUND BUT SHOWS NOTHING, OR FOXY IS ON A BLACK BOX
  Your machine could not decode the transparent video. Delete foxy-alpha.mp4
  from the app folder and restart it - it falls back to foxy.mp4 automatically.
  Black background, but working.

  No codec to install either way: this build carries its own video decoder and
  does not use Windows'.
"@

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Set-Content -Path "$publishDir\INSTALL.txt" -Value $install -Encoding UTF8

# Stage what ships, then zip the staging directory. Compress-Archive on a
# 650-file plugin tree is punishingly slow; CreateFromDirectory is not, and
# staging is where the pruning happens.
#
# A non-single-file publish is ~40 runtime DLLs whose names are an
# implementation detail of the SDK and the Avalonia/LibVLCSharp package graph,
# so this copies the publish output wholesale and removes what must not ship,
# rather than enumerating a ship list that would silently drop a dependency the
# next package bump introduces. The assertions below are what keep "wholesale"
# honest.
New-Item -ItemType Directory -Force -Path (Split-Path $stageDir -Parent) | Out-Null
Copy-Item $publishDir $stageDir -Recurse -Force

Remove-Item "$stageDir\libvlc\win-x86" -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $stageDir -Recurse -File -Include '*.lib', '*.pdb' |
  Remove-Item -Force -ErrorAction SilentlyContinue

# foxy.ico is the one optional entry - it comes from the gitignored asset pack,
# and both desktop apps fall back to a default tray icon without it
# (TrayController.LoadTrayIcon). Everything else is load-bearing: without it the
# recipient gets a scare with nothing to show, or no instructions to install by.
$optional = @('foxy.ico')
$required = @('FoxyJumpscare.exe', 'FoxyJumpscare.dll', 'foxy.mp4', 'foxy-alpha.mp4',
              'foxy.ico', 'INSTALL.txt', "libvlc\$Runtime\libvlc.dll",
              "libvlc\$Runtime\plugins")
$ship = foreach ($name in $required) {
  if (Test-Path (Join-Path $stageDir $name)) { $name }
  elseif ($optional -notcontains $name) { throw "missing from staged package: $name" }
  else { Write-Warning "no $name - shipping without it; the tray falls back to a default icon." }
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $stageDir, $zip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $true)  # includeBaseDirectory: everything lands under FoxyJumpscare\

if (-not (Test-Path $zip)) { throw "archive was not created" }

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$count = (Get-ChildItem $stageDir -Recurse -File).Count
Write-Host ""
Write-Host "  $zip  ($size MB, $count files)"
Write-Host "  contains: $($ship -join ', ')"
Write-Host "  TRANSPARENT build (Avalonia), odds 1 in 100,000 per 30s tick."
Write-Host "  the opaque one is publish-desktop.ps1 -> FoxyJumpscare-win-x64-black.zip."
Write-Host "  send this zip. The recipient needs nothing else installed."
