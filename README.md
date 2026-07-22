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

Foxy lunges at you with the scream, then disappears. In the browser he's **transparent
over your actual page** — your inbox, your PR, still visible behind him. On the desktop
he takes the whole screen.

It does not block input, does not steal focus, and does not touch your system volume.
The desktop version only counts seconds where you are actually at the machine — it will
not fire at an empty desk, and it stays quiet while the session is locked.

⚠️ **Photosensitivity and volume warning.** This is a sudden loud image by design. Don't
install it if that's a problem for you, and think twice about headphones at 2am.

## Layout

```
assets/       shared asset pack (gitignored — see assets/PACK.md)
extension/    MV3, builds to both Chrome and Firefox
desktop/      C# .NET 8 WinForms tray app, Windows only
tools/        build scripts
docs/         design specs
```

## Build

Requires Node 24+, .NET 8 SDK, ffmpeg, git.

```powershell
npm install

# Assets — keys the greenscreen source into the two derived formats
npm run assets

# Extension -> dist/chrome, dist/firefox
npm run build

# Desktop -> a ~0.2 MB framework-dependent exe
dotnet publish desktop/FoxyJumpscare -c Release -r win-x64 `
  --self-contained false -p:PublishSingleFile=true
```

## Test

```powershell
npm test          # 69 unit tests — roll, tick accounting, asset pipeline, manifests
npm run test:e2e  # 6 Chromium end-to-end tests (opens a real browser window)
dotnet test desktop/FoxyJumpscare.Core.Tests   # 24 tests
```

Two things are verified by hand rather than automated, and the reasons are real
rather than laziness — see [`docs/firefox-checklist.md`](docs/firefox-checklist.md)
(Playwright cannot load MV3 extensions in Firefox) and
[`docs/desktop-checklist.md`](docs/desktop-checklist.md) (DPI, focus stealing, and
multi-monitor audio are invisible to a headless test).

Drop the greenscreen source into `assets/` first, per
[`assets/PACK.md`](assets/PACK.md) — every build expects the derived files.

Set `TEST_MODE` to force 1-in-5 odds so it fires in seconds instead of days.

## Notes

- The desktop executable is unsigned, so Windows SmartScreen will warn on first run.
- The extension needs the `<all_urls>` permission to inject anywhere. It reads nothing
  and sends nothing; it only draws an overlay.
- Autostart is off by default and opt-in from the tray menu.

## Assets and licensing

The code is this project's. The Withered Foxy footage and audio are **not** — they are
Five Nights at Freddy's material and are deliberately excluded from this repository.
The asset pack is swappable by design; see [`assets/PACK.md`](assets/PACK.md).
