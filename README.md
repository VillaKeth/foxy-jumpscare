# Foxy Jumpscare

A rare fullscreen jumpscare, ported out of Terraria and onto the whole computer.

Based on [1/10000 Chance for Withered Foxy Jumpscare Every Second](https://steamcommunity.com/sharedfiles/filedetails/?id=3481943642)
by yonsan (YMY). That mod rolls once per wall-clock second at 1/10,000 — a mean wait of
2h46m, which is why it feels far more frequent than the number suggests. This project
keeps the semantics and retunes the odds for something you run all day rather than for
a play session.

| | Rolls per active second | Expected wait |
|---|---|---|
| Browser extension | 1 in 100,000 | ~7 days @ 4h/day browsing |
| Desktop app | 1 in 300,000 | ~10 days @ 8h/day at the PC |

Both are configurable, including a "Terraria faithful" 1-in-10,000 preset.

## What it does

Foxy lunges at you with the scream, then disappears. He is **transparent over whatever
you were already looking at** — your inbox, your PR, your desktop, still visible behind
him. One exception: the older Windows-only WPF desktop build composites over black
instead. There are two desktop apps; see [Build](#build).

It does not block input, does not steal focus, and does not touch your system volume.
The desktop version only counts seconds where you are actually at the machine — it will
not fire at an empty desk, and it stays quiet while the session is locked.

⚠️ **Photosensitivity and volume warning.** This is a sudden loud image by design. Don't
install it if that's a problem for you, and think twice about headphones at 2am.

## Layout

```
assets/       shared asset pack (gitignored — see assets/PACK.md)
extension/    MV3, builds to both Chrome and Firefox
desktop/      two tray apps over one shared core:
  FoxyJumpscare/             WPF, net8.0-windows — opaque black overlay, Windows only
  FoxyJumpscare.Avalonia/    Avalonia + libVLC, net8.0 — transparent, cross-platform
  FoxyJumpscare.Core/        roll, ticker, config store, formatter — no UI
  FoxyJumpscare.Core.Tests/  xunit
tools/        build scripts
docs/         design specs
```

The two desktop apps share `FoxyJumpscare.Core` unchanged and differ only in shell.
Avalonia is where the transparency and the non-Windows work live; WPF is older and
still the most-tested. Neither replaces the other yet —
[`docs/cross-platform.md`](docs/cross-platform.md) has the per-OS verification matrix
and the honest gaps.

## Build

Requires Node 24+, .NET 8 SDK, ffmpeg, git.

### 1. Assets — do this first

Every build expects the derived media, and a fresh clone has nothing to derive it from:
the FNAF footage is deliberately excluded (see [Assets and licensing](#assets-and-licensing)).
So start with a source clip, real or fake:

```powershell
npm install

# If you have the greenscreen clip: put it at assets/foxy-src.mp4, then
npm run assets

# If you don't: generate a stand-in, then build from that
npm run assets:placeholder
npm run assets
```

`assets:placeholder` writes a crude blocky fox lunging on a pure-green background to
`assets/foxy-src.mp4`. It looks obviously fake and is meant to — the point is that the
whole pipeline is exercisable on a fresh checkout. Nothing downstream knows the
difference; drop the real clip over the top and re-run `npm run assets`.

It will not overwrite an existing `foxy-src.mp4` unless you pass `-- --force`. On a
populated checkout that file is the real source, it is gitignored, and nothing in the
repo can restore it.

`npm run assets` does **not** produce `assets/foxy.ico`, the desktop tray icon — that
comes from a source still, via `pwsh tools/build-tray-icon.ps1 -Source <image>`. It is
optional everywhere: both desktop apps fall back to a default tray icon, and both
publish scripts ship without it.

Either way you get three derived cuts — `foxy.webm` (extension), `foxy-alpha.mp4`
(transparent desktop) and `foxy.mp4` (desktop fallback). [`assets/PACK.md`](assets/PACK.md)
explains why each target needs its own.

### 2. Extension

```powershell
npm run build          # -> dist/chrome, dist/firefox
npm run package        # -> submittable store zips
```

### 3. Desktop — pick which one

**Transparent** — Avalonia. Cross-platform, and where current work happens. On Windows
it bundles its own libVLC and depends on no OS codec.

```powershell
# run it from source, any OS with the .NET 8 SDK
dotnet run --project desktop/FoxyJumpscare.Avalonia               # tray
dotnet run --project desktop/FoxyJumpscare.Avalonia -- --settings
dotnet run --project desktop/FoxyJumpscare.Avalonia -- --test-scare

# ship it to a Windows friend -> dist/desktop/FoxyJumpscare-win-x64.zip (~90 MB)
pwsh tools/publish-desktop-windows.ps1

# ship it to a Linux friend -> dist/desktop/FoxyJumpscare-linux-x64.tar.gz
pwsh tools/publish-desktop-linux.ps1
```

There is no packaging script for macOS yet. Linux recipients need their distro's VLC
libraries, which the tarball's INSTALL.txt lists per distro; the archive is built
through WSL so the binary keeps its executable bit.

The Windows zip carries its own libVLC, so the recipient installs nothing at all — not
even a codec. That is most of its ~90 MB. It is the one publish path here that is *not*
single-file: bundling pulls the 650 libVLC plugin DLLs into the exe, and self-extraction
flattens the `plugins/` subtree that `Core.Initialize()` scans for, leaving a scare that
initialises and plays nothing. Keep the extracted folder together.

**Black background** — WPF, Windows only. The overlay is opaque by design, not a stale
build; the transparency work landed in Avalonia and was never ported back.

```powershell
# -> dist/desktop/FoxyJumpscare-win-x64-black.zip (~64 MB)
pwsh tools/publish-desktop.ps1
```

Self-contained: the recipient double-clicks and it runs, with no .NET install. It
decodes VP9 through Media Foundation, which is inbox on Windows 11 and a free Store
extension on Windows 10. The zip carries its own INSTALL.txt.

## Test

```powershell
npm test                # unit tests — roll, tick accounting, asset pipeline, manifests
npm run test:e2e        # Chromium end-to-end (opens a real browser window)
npm run lint:firefox    # addons-linter — the validator AMO runs on submission
npm run verify:firefox  # behavioural checks in real Firefox, via web-ext
dotnet test desktop/FoxyJumpscare.Core.Tests
```

Both browsers are verified automatically, including the two things that differ
between them and cannot be checked with ffmpeg: whether audio survives autoplay
policy, and whether VP9 alpha actually renders transparent. See
[`docs/firefox-checklist.md`](docs/firefox-checklist.md).

The desktop app's remaining checks are genuinely manual — DPI, focus stealing and
multi-monitor behaviour are invisible to a headless test. See
[`docs/desktop-checklist.md`](docs/desktop-checklist.md).

Linux is verified in containers, reproducibly, against a real X server —
`./docker/run-linux-verify.sh` for Ubuntu 24.04, `all` to add Fedora 41. macOS has never
been run at all; treat `MacPlatform.cs` as a draft. Both caveats are detailed in
[`docs/cross-platform.md`](docs/cross-platform.md).

Set `TEST_MODE` to force 1-in-5 odds so it fires in seconds instead of days.

## Notes

- The desktop executable is unsigned, so Windows SmartScreen will warn on first run.
- The extension needs the `<all_urls>` permission to inject anywhere. It reads nothing
  and sends nothing; it only draws an overlay.
- Autostart is off by default and opt-in from the tray menu.
- All video is **VP9**, deliberately. H.264 is patent-encumbered, so Fedora and Arch ship
  VLC without its decoder and an H.264 scare is a silent black screen there. VP9's
  decoder is royalty-free and always present.
- The Avalonia build bundles libVLC on Windows but expects a **system** libVLC on Linux
  and macOS (`apt install libvlc5 vlc-plugin-base`, `brew install vlc`).
- `FOXY_MUTE=1` forces a silent audio module and `FOXY_TRACE=1` logs playback state to
  stderr. Both are for headless verification; nothing shipped sets either.

## Assets and licensing

The code is this project's. The Withered Foxy footage and audio are **not** — they are
Five Nights at Freddy's material and are deliberately excluded from this repository.
The asset pack is swappable by design; see [`assets/PACK.md`](assets/PACK.md).
