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
- [ ] With multiple monitors: an overlay on **each**, and **exactly one** audible
      audio stream
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

## Known

The published exe is unsigned. A resident tray process plus a `Run` key plus a
fullscreen topmost window is close to the behaviour profile antivirus heuristics
watch for, so SmartScreen on first run is expected, not a defect. Code signing is
out of scope for v1.
