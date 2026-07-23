# Cross-platform desktop (Avalonia)

`desktop/FoxyJumpscare.Avalonia` is a second desktop app that targets Windows,
macOS, and Linux from one codebase. It shares `FoxyJumpscare.Core` — the roll,
the ticker, the config store, the formatter — unchanged, with all 52 of its
tests still passing. Only the UI shell and the OS-specific pieces are new.

The Windows-only WPF app in `desktop/FoxyJumpscare` still exists and is still
the most-tested build. Avalonia is being brought up alongside it, not as a
big-bang replacement, so a regression in the new shell can't take down the
working one.

## Status

| Piece | Windows | macOS | Linux |
|---|---|---|---|
| Builds | ✅ | ✅ (same net8.0 output) | ✅ |
| App runs, tray + settings window | ✅ **verified** | ⚠️ written, **not run** | ⚠️ written, **not run** |
| Idle detection | ✅ `GetLastInputInfo` | ⚠️ `CGEventSource…` (unrun) | ⚠️ X11 `XScreenSaver` (unrun) |
| Autostart | ✅ registry Run key | ⚠️ LaunchAgent plist (unrun) | ⚠️ XDG `.desktop` (unrun) |
| Overlay: all-monitor + failsafe | ✅ **verified** | ⚠️ unrun | ⚠️ unrun |
| **Video + audio in the overlay** | ❌ **not built yet** | ❌ | ❌ |

"Verified" means it was built and run on this Windows machine and observed to
work. "Not run" means the code is written from the documented APIs but has
never executed on that OS — treat it as a draft until someone runs it there.

## The honest gaps

1. **No video yet.** The overlay is a black fullscreen window with a placeholder
   marker. It proves the mechanics that matter — coverage of every monitor and
   guaranteed self-teardown — but it does not play the scare. Adding playback is
   the next step, via LibVLCSharp (the one mature cross-platform media option
   for Avalonia; WPF's `MediaElement` is Windows-only and has no Avalonia
   equivalent). That pulls in native libVLC per platform and is the single
   biggest remaining risk.
2. **macOS and Linux are unrun by the author.** This is a Windows box. The
   platform files were written against Apple's and X11's documented APIs, but
   nobody has launched the app on either OS. The P/Invoke struct offsets in
   particular (the Linux `XScreenSaverInfo.idle` field) want checking on real
   hardware.
3. **Linux idle is X11-only.** Under Wayland there is no portable idle query, so
   the monitor reports "active" and the countdown advances even while you are
   away. That over-fires rather than failing silent, which is the safer
   direction, but it is not correct.
4. **Linux tray needs a systray-capable desktop.** GNOME hides legacy tray icons
   without an extension (e.g. AppIndicator). The app still runs; the icon may
   just not appear.

## Build and run

```bash
# any OS with the .NET 8 SDK
dotnet build desktop/FoxyJumpscare.Avalonia

dotnet run --project desktop/FoxyJumpscare.Avalonia               # tray
dotnet run --project desktop/FoxyJumpscare.Avalonia -- --settings # open settings on launch
dotnet run --project desktop/FoxyJumpscare.Avalonia -- --test-scare
```

`assets/foxy.mp4` and `assets/foxy.ico` are copied next to the build, same as
the WPF app.

## Architecture

- `Program.cs` / `App.axaml` — Avalonia entry point, explicit-shutdown lifetime.
- `TrayController.cs` — the tray icon, the tick loop, all state. The Avalonia
  counterpart of the WPF `TrayApp`. Nothing here is platform-specific.
- `Platform/` — `IPlatformServices` (idle + autostart) with one implementation
  per OS, chosen by `PlatformServices.Detect()`.
- `Views/SettingsWindow.axaml` — the settings/stats window; a port of the WPF
  `StatsWindow`, same custom-odds field.
- `Views/OverlayWindow.cs` — the fullscreen overlay. Video pending.

## Next steps, in order

1. Video + audio via LibVLCSharp, verified on Windows first.
2. Run on a real Mac and a real Linux box; fix what the drafts got wrong.
3. Packaging: a macOS `.app` bundle and a Linux AppImage or `.desktop` install.
