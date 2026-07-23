#requires -Version 5.1
<#
.SYNOPSIS
  Build assets/foxy.ico for the desktop tray from a source image.

.DESCRIPTION
  The tray icon is a cropped still, the same way foxy.mp4/foxy.webm are keyed
  from the source video: a derived, copyrighted asset that is gitignored and
  never committed. See assets/PACK.md.

  A full-body render is an unreadable smudge at 16px, so this crops to the head
  before resizing. The default crop is tuned to the Withered Foxy source in the
  pack; override with -CropX/-CropY/-CropSide for a different image.

  Emits a multi-resolution .ico (PNG-compressed frames, 16..256) so Windows can
  pick the right size for the tray, Alt-Tab, and the taskbar.

.EXAMPLE
  pwsh tools/build-tray-icon.ps1 -Source "$HOME\Downloads\foxy.png"
#>
param(
  [string]$Source = "$HOME\Downloads\foxy.png",
  [string]$OutFile = "$PSScriptRoot\..\assets\foxy.ico",
  [int]$CropX = 285,
  [int]$CropY = 45,
  [int]$CropSide = 430
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "Source image not found: $Source" }

$src = [System.Drawing.Bitmap]::new($Source)
try {
  $sizes = 16, 32, 48, 64, 128, 256
  $pngs = @()

  foreach ($size in $sizes) {
    $dst = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = 'HighQualityBicubic'
    $g.PixelOffsetMode = 'HighQuality'
    $g.SmoothingMode = 'HighQuality'
    $g.CompositingQuality = 'HighQuality'
    $srcRect = [System.Drawing.Rectangle]::new($CropX, $CropY, $CropSide, $CropSide)
    $dstRect = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
    $g.DrawImage($src, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()

    $ms = [System.IO.MemoryStream]::new()
    $dst.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
    $pngs += , @{ Size = $size; Bytes = $ms.ToArray() }
  }

  # --- assemble the ICO container --------------------------------------------
  # ICONDIR: reserved(2)=0, type(2)=1, count(2). Then one 16-byte ICONDIRENTRY
  # per image, then the PNG blobs. All little-endian, which BinaryWriter is.
  $out = [System.IO.MemoryStream]::new()
  $w = [System.IO.BinaryWriter]::new($out)

  $w.Write([uint16]0)               # reserved
  $w.Write([uint16]1)               # type: icon
  $w.Write([uint16]$pngs.Count)     # image count

  # Data starts after the header (6) and all directory entries (16 each).
  $offset = 6 + 16 * $pngs.Count
  foreach ($img in $pngs) {
    $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }  # 0 means 256 in ICO
    $w.Write([byte]$dim)            # width
    $w.Write([byte]$dim)            # height
    $w.Write([byte]0)              # palette count (0 = none)
    $w.Write([byte]0)              # reserved
    $w.Write([uint16]1)            # colour planes
    $w.Write([uint16]32)          # bits per pixel
    $w.Write([uint32]$img.Bytes.Length)
    $w.Write([uint32]$offset)
    $offset += $img.Bytes.Length
  }
  foreach ($img in $pngs) { $w.Write($img.Bytes) }

  $w.Flush()
  $resolved = [System.IO.Path]::GetFullPath($OutFile)
  [System.IO.File]::WriteAllBytes($resolved, $out.ToArray())
  $w.Dispose(); $out.Dispose()

  Write-Host "  wrote $resolved ($([math]::Round((Get-Item $resolved).Length / 1024, 1)) KB, $($pngs.Count) frames)"
} finally {
  $src.Dispose()
}
