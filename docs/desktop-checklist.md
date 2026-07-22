# Desktop release checklist

Everything testable without a desktop — the roll, the tick accounting,
persistence — is covered by xunit in `FoxyJumpscare.Core.Tests`. The overlay's
real failure modes are DPI, focus stealing, and multi-monitor audio, none of
which a headless test can observe. This list is the honest substitute.

## Build

```powershell
dotnet publish desktop/FoxyJumpscare -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true
```

## Checks

- [ ] Tray icon appears; every menu item works; Quit exits with no orphan process
      (confirm in Task Manager — a surviving process keeps firing invisibly)
- [ ] Test Scare plays fullscreen on the **primary** monitor with audio
      (`FoxyJumpscare.exe --test-scare` fires once without touching the tray menu)
- [ ] With multiple monitors: the video plays on the **primary** only, and every
      other screen goes **solid black**. This is deliberate — see below.
- [ ] **Mixed-DPI**: overlay covers each monitor exactly, no gaps or overhang.
      Laptop panel plus an external display at different scaling is the case that
      breaks — this is what `app.manifest`'s PerMonitorV2 and the
      `TransformFromDevice` conversion exist for
- [ ] Overlay does **not** steal focus — keep typing in another window while it
      plays and confirm no keystrokes are lost
- [ ] Overlay does not appear in Alt-Tab
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

## Why only the primary monitor plays the video

WPF's `MediaElement` does not render reliably on a secondary monitor. Its playback
clock advances normally while presentation stalls — measured on a dual 1920x1080
setup, the second screen held byte-identical frames for ~900ms of an 880ms video
while the primary played through cleanly.

Two fixes were tried and rejected before landing on this one:

1. Show all windows, then play them in one pass — no change; the clocks were
   never the problem.
2. Prime each player with Play/Pause and hold until every `MediaOpened` fired,
   then start together. This did synchronise the clocks to within 3ms and
   changed nothing on screen.

Playing on the primary and blacking out the rest sidesteps the renderer entirely,
makes overlapping audio structurally impossible rather than merely muted, and
puts the scare on the screen the user is actually looking at.

Set `FOXY_TRACE=1` to append overlay timing to `%TEMP%\foxy-overlay.log` if this
ever needs revisiting.

## Known

The published exe is unsigned. A resident tray process plus a `Run` key plus a
fullscreen topmost window is close to the behaviour profile antivirus heuristics
watch for, so SmartScreen on first run is expected, not a defect. Code signing is
out of scope for v1.
