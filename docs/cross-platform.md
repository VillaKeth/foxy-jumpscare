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
| Builds | ✅ | ✅ (same net8.0 output) | ✅ **verified** (Ubuntu 24.04) |
| App runs, tray + settings window | ✅ **verified** | ⚠️ written, **not run** | ✅ **verified** — settings window screenshotted on X11; tray unverified (no systray in the test WM) |
| Idle detection | ✅ `GetLastInputInfo` | ⚠️ `CGEventSource…` (unrun) | ✅ **verified live** — climbs 0.55 → 1.05 → 1.55 → 2.05 → 2.55s under a real X server |
| Autostart | ✅ registry Run key | ⚠️ LaunchAgent plist (unrun) | ◑ XDG reads cleanly; writing a `.desktop` not end-to-end tested |
| Overlay: all-monitor + failsafe | ✅ **verified** | ⚠️ unrun | ✅ **verified** fullscreen + clean teardown (single screen; multi-monitor unrun) |
| Video in the overlay | ✅ **verified** | ⚠️ needs system libvlc, unrun | ✅ **verified** — 22 frames, correct colours, screenshotted |
| Audio in the overlay | ✅ **verified** (WaveOut) | ⚠️ needs system libvlc, unrun | ◑ PulseAudio module engages, 2 audio tracks decoded; no speakers in the VM to hear it |

Windows audio uses the **WaveOut** module explicitly. libVLC's own default
(mmdevice/WASAPI) crashed this STA app once real audio played, and its
DirectSound module opened an output device that never reached the speakers.
WaveOut routes to the system default output and is verified working.

"Verified" means it was built and run on this Windows machine and observed to
work. "Not run" means the code is written from the documented APIs but has
never executed on that OS — treat it as a draft until someone runs it there.

## The honest gaps

1. **Video plays, in sync, on Windows.** ONE decoder, mirrored to every
   monitor — the same lesson the WPF build learned. libVLC software-renders into
   a single shared buffer, copied into one `WriteableBitmap` that every screen's
   Image draws, so the monitors are identical frame-for-frame with no
   per-decoder drift. One player means the scream plays once. Verified: 22
   frames rendered across two monitors from a single decoder, clean teardown, no
   crash. Teardown stops the player before freeing the buffer, so a late
   callback can never touch freed memory. Native libVLC ships with the Windows
   build via `VideoLAN.LibVLC.Windows`; Linux and macOS expect a **system
   libvlc** — `apt install libvlc5 vlc-plugin-base` or `brew install vlc`.
   Linux is verified; macOS is not.

   `FOXY_MUTE=1` forces the `adummy` output module — a module that cannot make
   a sound, rather than `MediaPlayer.Mute`, which libVLC drops when it is set
   before the audio output exists. `FOXY_TRACE=1` logs playback state to
   stderr. Both were added for headless verification and are handy for a
   silent-but-armed setup.
2. **macOS is unrun.** This is a Windows box with a Linux VM on it and no Mac.
   `MacPlatform.cs` was written against Apple's documented APIs and has never
   executed. Treat it as a draft. Linux was in the same state until the run
   below, which found three real bugs in it — assume macOS holds a similar
   number.
3. **Linux idle is X11-only.** Under Wayland there is no portable idle query, so
   the monitor reports "active" and the countdown advances even while you are
   away. That over-fires rather than failing silent, which is the safer
   direction, but it is not correct.
4. **Linux tray needs a systray-capable desktop.** GNOME hides legacy tray icons
   without an extension (e.g. AppIndicator). The app still runs; the icon may
   just not appear.

## How Linux was verified

WSL2 Ubuntu 24.04, entered as root (`wsl -d Ubuntu -u root`, which needs no
password), driving a real X server rather than WSLg:

```bash
apt-get install -y xvfb openbox imagemagick libxss1 libvlc5 vlc-plugin-base \
                   fonts-dejavu-core x11-utils
Xvfb :99 -screen 0 1920x1080x24 &   # a real X server, WITH MIT-SCREEN-SAVER
DISPLAY=:99 openbox &               # a real window manager - see bug 3
DISPLAY=:99 dotnet FoxyJumpscare.dll --probe-idle
DISPLAY=:99 dotnet FoxyJumpscare.dll --test-scare   # screenshot with `import`
```

WSLg alone is not enough: its Xwayland has no `MIT-SCREEN-SAVER`, so idle
always reads 0 and the bug below stays invisible. Xvfb has the extension.

Results: build clean (0/0), settings window renders, idle climbs correctly,
overlay covers the screen with 22 decoded frames in the right colours, and
teardown is clean. Screenshots were taken with ImageMagick's `import` and
inspected.

### Three bugs this found, all invisible to a compile

1. **Idle detection did nothing.** `IdleSeconds()` opened *and closed* an X
   display on every call, and reconnecting resets the X server's idle counter.
   Polling at 500ms reported a flat ~0.49s forever — always "the user is right
   here". The whole point of the idle check is to not fire at an empty desk, so
   on Linux it was silently inert. Fixed by holding one long-lived connection,
   which is what real idle daemons do; the value now climbs linearly.
2. **Video could never load.** LibVLCSharp P/Invokes the bare name `libvlc`,
   and .NET probes `libvlc.so` / `liblibvlc.so` — but distributions ship only
   the SONAME'd `libvlc.so.5`, with the unversioned symlink in the `-dev`
   package no ordinary user installs. Every scare died with *"Unable to load
   shared library 'libvlc'"* and 0 frames. Fixed in `Platform/VlcNative.cs`
   with a `DllImportResolver` that tries `libvlc.so.5` first (and the usual
   Homebrew / VLC.app paths on macOS).
3. **Fullscreen was only a request.** `WindowState.FullScreen` maps to
   `_NET_WM_STATE_FULLSCREEN`, which a *window manager* has to honour. With no
   WM the scare rendered at the video's natural size in the top-left corner.
   `Place()` now also sets Width/Height from the screen bounds, so the overlay
   covers the monitor even where the hint is ignored.

### Still unverified on Linux

The tray icon (openbox has no system tray; GNOME hides legacy trays without an
AppIndicator extension), multi-monitor mirroring, audio actually reaching
speakers — the PulseAudio module engages and both audio tracks decode, but the
VM has no output device — and writing the XDG autostart `.desktop` end to end.

The noisy `Failed to create video converter` / `video output creation failed`
lines libVLC prints on Linux are benign: they are its first vout attempt before
it falls back to our software callbacks, and frames render regardless.

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
- `Platform/VlcNative.cs` — finds the system libVLC on Linux/macOS, where the
  library is versioned and .NET's default probe misses it.
- `Views/SettingsWindow.axaml` — the settings/stats window; a port of the WPF
  `StatsWindow`, same custom-odds field.
- `Views/OverlayWindow.cs` — the fullscreen overlay, one decoder mirrored to
  every monitor.

`Program.cs --probe-idle` runs the platform layer with no GUI, for checking the
per-OS idle query on a machine you cannot eyeball.

## Next steps, in order

1. Run on a real Mac; fix what `MacPlatform.cs` got wrong.
2. Linux: verify the tray on a systray-capable desktop, multi-monitor
   mirroring, and audio on a box with a sound device.
3. Packaging: a macOS `.app` bundle and a Linux AppImage or `.desktop` install.
