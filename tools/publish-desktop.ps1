#requires -Version 5.1
<#
.SYNOPSIS
  Build a self-contained Windows build you can send to a friend.

.DESCRIPTION
  Self-contained means the .NET runtime is bundled: the recipient double-clicks
  and it runs, with nothing to install first. Framework-dependent builds are a
  tenth the size but need the .NET Desktop Runtime, which non-developers will
  not have.

  Produces dist/desktop/FoxyJumpscare-win-x64.zip containing the single-file
  exe alongside foxy.mp4 (the scare) and foxy.ico (the tray icon). Both assets
  sit next to the exe rather than embedded, because the app loads them from
  disk at runtime.

  The exe is unsigned, so SmartScreen will warn on first run. INSTALL.txt in the
  zip tells the recipient how to get past it.
#>
param(
  [string]$Configuration = 'Release',
  [string]$Runtime = 'win-x64'
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\.."
$proj = "$repo\desktop\FoxyJumpscare\FoxyJumpscare.csproj"
$dotnet = "$env:ProgramFiles\dotnet\dotnet.exe"
if (-not (Test-Path $dotnet)) { $dotnet = 'dotnet' }

$publishDir = "$repo\dist\desktop\publish"
$outDir = "$repo\dist\desktop"
$zip = "$outDir\FoxyJumpscare-$Runtime.zip"

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

# Copy the assets in explicitly rather than trusting the build to. A file used
# as ApplicationIcon is embedded in the exe, and MSBuild then drops it from the
# loose single-file publish output - but the tray loads foxy.ico from disk at
# runtime, so it has to be shipped alongside regardless.
foreach ($asset in 'foxy.mp4', 'foxy.ico') {
  $srcAsset = "$repo\assets\$asset"
  if (Test-Path $srcAsset) { Copy-Item $srcAsset $publishDir -Force }
}

if (-not (Test-Path "$publishDir\foxy.mp4")) {
  throw "foxy.mp4 is missing. Run 'npm run assets' first."
}

# Instructions for a non-technical recipient. Written into the zip.
$install = @"
Foxy Jumpscare - install

1. Unzip this folder anywhere (Desktop is fine).
2. Double-click FoxyJumpscare.exe.
3. Windows will say "Windows protected your PC" because the app is not
   code-signed. Click "More info", then "Run anyway". (This warning appears
   for any unsigned app; it is not a virus warning.)
4. It runs in the system tray - the little icons by the clock, possibly behind
   the ^ arrow. Look for the Foxy face.
5. Double-click that tray icon to open settings. Right-click it for a menu.

WHAT IT DOES
  At random - by default about once every couple of days of active use - a
  screaming animatronic fox takes over your screen for about a second, then
  goes away on its own. Change how often, or turn it off, from the settings
  window. "Test it now" fires one immediately without affecting the countdown.

  Sudden loud audio and a startle, by design. Skip it if you are
  photosensitive, and think twice on a work machine or in headphones.

  Keep it running: turn on "Run at startup" in the menu, or it stops when you
  reboot.

  To remove it: right-click the tray icon and choose Quit, then delete the
  folder. It stores only a tiny settings file in
  %APPDATA%\FoxyJumpscare, which you can delete too.
"@

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Set-Content -Path "$publishDir\INSTALL.txt" -Value $install -Encoding UTF8

# Ship only what the recipient needs: the exe, the two assets, the readme.
$ship = @('FoxyJumpscare.exe', 'foxy.mp4', 'foxy.ico', 'INSTALL.txt') |
  ForEach-Object { Join-Path $publishDir $_ } |
  Where-Object { Test-Path $_ }

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $ship -DestinationPath $zip -CompressionLevel Optimal

$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host "  $zip  ($size MB)"
Write-Host "  contains: $((($ship | Split-Path -Leaf)) -join ', ')"
Write-Host "  send this zip. The recipient needs nothing else installed."
