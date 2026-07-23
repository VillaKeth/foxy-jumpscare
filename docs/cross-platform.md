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
| Builds | ✅ | ✅ (same net8.0 output) | ✅ **verified** (Ubuntu 24.04 + Fedora 41) |
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

In containers, reproducibly. From a Linux shell with Docker — on this project
that is WSL, `wsl -d Ubuntu -u root`, which needs no password and runs systemd
as PID 1:

```bash
./docker/run-linux-verify.sh        # Ubuntu 24.04
./docker/run-linux-verify.sh all    # + Fedora 41
```

Each container builds the app, then checks the things a compile cannot: idle
returns a *climbing* value, the settings window maps with the right title, and
the overlay decodes video across the whole screen. It exits non-zero if any
check fails, so it works as a gate. Screenshots and logs land in `docker/out/`.

Both distros currently report **ALL CHECKS PASSED**.

Two properties of the container matter and are easy to lose:

- **It is empty.** A developer box accumulates `-dev` packages that hide
  missing dependencies — in particular an unversioned `libvlc.so` symlink,
  whose presence would mask bug 2 below. The run asserts that only
  `libvlc.so.5` exists, so the resolver is genuinely exercised.
- **It runs a real X server and a real window manager.** Xvfb has
  `MIT-SCREEN-SAVER`, which WSLg's Xwayland does not, so idle can actually be
  measured; and `_NET_WM_STATE_FULLSCREEN` needs a WM to be honoured, so
  openbox is what makes bug 3 visible.

### Runtime dependencies, as measured

The scare video is **VP9** (see "The codec" below), whose decoder ships in the
base VLC package everywhere, so no distro needs an extra codec package:

| | Debian / Ubuntu | Fedora | Arch / EndeavourOS |
|---|---|---|---|
| Video | `libvlc5`, `vlc-plugin-base` | `vlc-libs`, `vlc-plugins-base` | `vlc` |
| Idle | `libxss1` | `libXScrnSaver` | `libxss` |
| GUI | `libx11-6`, `libice6`, `libsm6`, `libfontconfig1`, plus any font | `libX11`, `libICE`, `libSM`, `fontconfig`, plus any font | `libx11`, `libice`, `libsm`, `fontconfig`, plus any font |

One thing on Fedora is still worth knowing even though the app no longer trips
it: `vlc-plugins-base` is not optional. `vlc-libs` alone installs the library
beside an empty plugin directory, and libVLC then fails to instantiate —
reporting a missing *NuGet* package, which is not the problem. The app prints
the per-distro package list to stderr when video fails to start, because
LibVLCSharp's own message points somewhere useless.

### The codec: VP9, not H.264

`foxy.mp4` holds **VP9** video, not H.264, and this is load-bearing on Linux.
H.264 is patent-encumbered, so Fedora and Arch ship their VLC *without* an
H.264 decoder — installing the full `vlc` player is not enough on Arch. The
scare was then a silent black screen there: libVLC loaded, every other plugin
loaded, and only the H.264 frames never decoded (`Codec `h264' ... is not
supported`, `0 frames rendered`). This was found by running the shipped tarball
in an Arch container mirroring a real EndeavourOS report.

VP9's decoder (libvpx) is royalty-free and ships in the base VLC on every
mainstream distro. Measured across the shipped package, no extra packages
installed:

| codec | Ubuntu | Fedora | Arch |
|---|---|---|---|
| H.264 (old) | ✅ | ⬛ black | ⬛ black |
| **VP9 (now)** | ✅ | ✅ | ✅ |

The container stays `.mp4` (codec tag `vp09`); libVLC probes by content so the
desktop apps load the same `foxy.mp4` path. Audio stays AAC, whose free `faad`
decoder is likewise default everywhere, so the scream plays where the picture
does — checked in the matrix, which fails on any unsupported codec, audio
included. On Windows the Avalonia build bundles its own libVLC and needs none of
this; the older WPF build decodes VP9 via Media Foundation (inbox on Windows 11,
a free Store extension on Windows 10).

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

## Shipping a Linux build

```powershell
pwsh tools/publish-desktop-linux.ps1     # -> dist/desktop/FoxyJumpscare-linux-x64.tar.gz
```

Self-contained (~36 MB): the .NET runtime is bundled, so the recipient installs
nothing but their distro's VLC libraries, which INSTALL.txt lists per distro.
The archive is built through WSL so the binary keeps its executable bit — a tar
written on Windows records mode 0666 and the recipient gets "permission denied".

Verify the archive the way a recipient would experience it, on a stock Ubuntu
that has never had .NET installed:

```bash
docker build -f docker/linux-package.ubuntu.Dockerfile -t foxy-package-test docker/
docker run --rm -v /path/to/dist:/pkg:ro -v /tmp/out:/out foxy-package-test
```

This is not the same test as `run-linux-verify.sh`, and it caught a bug that
one could not: the build images have the SDK, which masks anything the packaged
app gets wrong about running without it. On the first run the packaged app died
before drawing anything, because `GetFolderPath(ApplicationData)` returns an
empty string when `HOME` is unset, `Path.Combine` turned that into the relative
path `FoxyJumpscare`, and creating it collided with the executable of the same
name in the working directory. `Store.ConfigRoot` now always returns an
absolute path, and a failed settings write no longer aborts startup.

## Next steps, in order

1. Run on a real Mac; fix what `MacPlatform.cs` got wrong.
2. Linux: verify the tray on a systray-capable desktop, multi-monitor
   mirroring, and audio on a box with a sound device.
3. Packaging: a macOS `.app` bundle and a Linux AppImage or `.desktop` install.
