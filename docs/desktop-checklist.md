# Desktop release checklist

Most of this is now automated:

```powershell
dotnet test desktop/FoxyJumpscare.Core.Tests   # roll, ticks, persistence, DPI maths
pwsh -File tools/verify-desktop.ps1            # focus, window styles, screen coverage
```

`verify-desktop.ps1` opens Notepad purely as a focus holder, fires the overlay,
and samples the foreground window 40 times. It asserts the foreground is never
**the overlay** — not that focus never changes, which would fail whenever the
person running it clicks something and would prove nothing.

DPI arithmetic moved into `ScreenMath` in the Core project so it can be tested
against scale factors and monitor layouts this machine does not have: 125%, 150%,
200%, non-square scaling, and monitors positioned left of or above the primary
(which report negative coordinates).

What remains below is what neither can reach.

## Build

```powershell
dotnet publish desktop/FoxyJumpscare -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true
```

## Checks

- [ ] Tray icon appears; every menu item works; Quit exits with no orphan process
      (confirm in Task Manager — a surviving process keeps firing invisibly)
- [ ] **Audio** is audible, and only one stream of it. Nothing automated can hear
- [ ] With multiple monitors: every screen shows Foxy on the **same frame**
      (coverage is automated; frame-identity is by eye)
- [ ] **Mixed-DPI**: overlay covers each monitor exactly, no gaps or overhang.
      Laptop panel plus an external display at different scaling. The arithmetic
      is unit-tested; what is untested is whether Windows reports the bounds this
      code expects under PerMonitorV2. Needs hardware with two scale factors
- [ ] Overlay closes itself; the desktop is fully interactive afterwards
- [ ] **Failsafe**: truncate `foxy.mp4` to a few bytes, fire, and confirm the window
      still closes. Three independent paths should cover it — `MediaEnded`,
      `MediaFailed`, and the 15s hard stop
- [ ] Lock the session (Win+L), wait, unlock — confirm no overlay fired while locked
- [ ] Leave the machine idle past `IdleThresholdSeconds` and confirm the countdown
      stops advancing (`state.json` → `Remaining` holds steady)
- [ ] Run at startup toggles the `HKCU\...\CurrentVersion\Run` key both directions
- [ ] Changing rarity re-draws immediately (`state.json` → `Remaining` jumps)
- [ ] First run of the published exe shows a SmartScreen warning; note the exact
      wording for the README

## How multi-monitor works, and why it looks odd in the code

One window spanning the whole virtual desktop. One `MediaElement` over the primary
screen. Every other screen is a `Rectangle` filled with a `VisualBrush` of that
same element.

This is not the obvious design, and the obvious one does not work. Three attempts:

1. **One `MediaElement` per monitor.** Fails. WPF's `MediaElement` does not render
   reliably on a secondary monitor — its playback clock advances normally while
   presentation stalls. Measured here: the second screen held byte-identical
   frames for ~900ms of an 880ms video.
2. **Same, but start every player together** (prime with Play/Pause, hold until
   all `MediaOpened` fired). Synchronised the clocks to within 3ms and changed
   nothing on screen. That is what proved the renderer was at fault.
3. **One decoder, mirrored with a `VisualBrush`.** Works. A brush cannot drift
   from its source, so every monitor shows the same frame by construction, and
   overlapping audio is impossible because there is only one player.

The `VisualBrush` sets `AutoLayoutContent = false`; leaving it on lets the mirrors
freeze on the first frame while the primary plays through.

Set `FOXY_TRACE=1` to append overlay timing to `%TEMP%\foxy-overlay.log` if this
ever needs revisiting.

## Known

The published exe is unsigned. A resident tray process plus a `Run` key plus a
fullscreen topmost window is close to the behaviour profile antivirus heuristics
watch for, so SmartScreen on first run is expected, not a defect. Code signing is
out of scope for v1.
