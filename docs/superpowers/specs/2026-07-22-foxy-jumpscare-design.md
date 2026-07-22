# Foxy Jumpscare — Design

**Date:** 2026-07-22
**Status:** Approved, ready for implementation planning

## Summary

Port the Terraria "Foxy jumpscare" mod out of the game and onto the whole computer.
Two deliverables sharing one asset pack and one roll algorithm:

1. **Browser extension** — MV3, published to the Chrome Web Store and Firefox AMO.
   Fires inside the active tab.
2. **Windows desktop app** — C# .NET 8 tray app. Fires over whatever you're doing,
   regardless of application.

Both roll once per *active* second at a configurable 1-in-N, matching the original
mod's semantics exactly.

## Background: what the original actually does

The reference mod is **"1/10000 Chance for Withered Foxy Jumpscare Every Second"**
by **yonsan (YMY)**, for Terraria via tModLoader
([Steam Workshop](https://steamcommunity.com/sharedfiles/filedetails/?id=3481943642)).

Two corrections to common assumptions, both verified against the listing:

- The unit is a **wall-clock second**, not a game tick and not a rendered frame.
  One Bernoulli trial per second of game runtime.
- The odds are **1/10,000**, not 1/100,000. The larger number is drift introduced by
  the ports to [Minecraft](https://modrinth.com/mod/one-in-ten-thousand-110000-chance-for-withered-foxy-jumpscare),
  [GTFO](https://thunderstore.io/c/gtfo/p/AuriRex/Foxy_Jumpscare/), and
  [PEAK](https://thunderstore.io/c/peak/p/Citroos/Random_Jumpscares/).
- Both the interval and the chance are user-configurable in the original. We match that.

At 1/10,000 per second the mean wait is **2h46m** of play and the median is **1h55m** —
which is why it reads as "relatively frequent" despite the large-sounding denominator.

## Decisions

| Question | Decision |
|---|---|
| Assets | Real FNAF Withered Foxy — **greenscreen video**, keyed at build time. Swappable pack; untracked in git. |
| Target frequency | ~1–2 weeks for a typical user |
| Roll unit | One trial per **active** second (faithful to the original) |
| Desktop clock gating | Only while actively using the PC — recent input, session unlocked |
| Presentation | Video plays to its natural length, auto-dismiss, no input blocking, no forced volume |
| Browser look | **Transparent over the live page** — alpha video, page still visible behind Foxy |
| Desktop look | Fullscreen black |
| Desktop stack | C# / .NET 8 **WPF** |
| Repo | Public code, assets gitignored |

### Derived defaults

| | N (1 in N per active sec) | Expected wait |
|---|---|---|
| Extension | **100,000** | ~7 days @ 4h/day browsing |
| Desktop | **300,000** | ~10 days @ 8h/day at the PC |
| Both (preset) | 10,000 | "Terraria faithful" — ~2h46m |

## Shared core: the roll

### Why not `setInterval(1000)`

A literal per-second timer is wrong on both platforms. Browsers throttle background
timers, MV3 service workers are killed after ~30s idle, and Windows timers drift
across sleep and hibernation. A dropped tick silently biases the odds.

### The algorithm

Sample the wait **once** from the equivalent geometric distribution, then count down
against measured active time. Statistically identical to rolling 1/N every second,
but correct under a coarse and unreliable timer.

For `p = 1/N` and `U ~ Uniform(0,1]`:

```
remaining = max(1, ceil( ln(U) / ln(1 - p) ))
```

This is inverse-transform sampling of `X ~ Geometric(p)` on support `{1, 2, ...}`,
with `E[X] = 1/p = N`.

Implementation notes:

- `Math.random()` / `Random.NextDouble()` both return `[0, 1)`. Use `1 - rand()` to get
  `(0, 1]`, and clamp the result to `>= 1` for the `U == 1` case where `ln(1) == 0`.
- `remaining` is **persisted**. It survives browser restart, service-worker death,
  and reboot. (The geometric distribution is memoryless, so resampling on restart
  would also be unbiased — persisting is about not needing a live 1 Hz timer.)
- On fire, draw a fresh `remaining`.

### Active-time accounting

A coarse tick credits `T` seconds of active time when the tick observes an active
state. This samples rather than integrates, so it slightly overcounts a user who
goes idle mid-window. The error is bounded by `T` per tick and is acceptable at
these magnitudes; it is not corrected in v1.

| | Tick period | "Active" means |
|---|---|---|
| Extension | 60s (`chrome.alarms` minimum on Chrome) | `chrome.idle.queryState(15) === 'active'` **and** a browser window has focus |
| Desktop | 30s | `GetLastInputInfo` reports input within 60s **and** session not locked |

The extension's focus check is load-bearing: `chrome.idle` measures *system* idle, so
without it a user working in another app all day with Chrome open in the background
would accrue "browsing" seconds they never spent.

## Component: browser extension

One source tree, two build outputs. `webextension-polyfill` for API parity;
`tools/build.mjs` templates the manifest and emits `dist/chrome/` and `dist/firefox/`.

### Behavior

- `chrome.alarms` at 1-minute period drives the tick. Not `setTimeout` — the service
  worker will not be alive to receive it.
- On fire, `chrome.scripting.executeScript` injects a single element into the active
  tab: an **`<iframe>` whose `src` is an extension-origin `overlay.html`**, styled
  `position: fixed; inset: 0; z-index: 2147483647; border: 0; background: transparent`
  with `pointer-events: none`. Guarded by a sentinel element id so it can never
  double-inject. Removed when the video ends.
- `overlay.html` holds a `<video autoplay>` playing `foxy.webm` (VP9 + alpha) over a
  transparent background, so the user's actual page stays visible behind Foxy.

### Why an extension-origin iframe, not raw injected elements

Injecting a bare `<video>` into the page looked simpler and is wrong for three
independent reasons, each of which alone would break it on real sites:

1. **Page CSP.** Sites with a strict `Content-Security-Policy` — GitHub, most banks —
   block injected media and inline styles outright. An extension-origin document has
   its own CSP and is unaffected.
2. **Autoplay policy.** Content-script media inherits the *page's* autoplay permission,
   so audio is silently blocked on any page the user hasn't clicked. Extension-origin
   documents are not subject to the page's gesture requirement.
3. **Page CSS.** Host stylesheets can and do reach injected nodes. An iframe is immune.

This also removes the need for Chrome's offscreen-document audio workaround and the
Firefox degradation it implied — one mechanism now works identically on both browsers,
which is a meaningful simplification.

**Fallback:** a page may still restrict `frame-src` and block the iframe. On
`load` failure the content script falls back to direct element injection, accepting
possible silence. Both paths are exercised in testing.

### Why WebM, not the source MP4

MP4/H.264 cannot carry an alpha channel, so a transparent overlay is impossible in that
container regardless of anything else. WebM/VP9 is additionally the safer codec in
Firefox, where H.264 depends on OS decoders while VP9 ships in-browser. See
`assets/PACK.md` for the keying pipeline.

### Constraints

- Not injectable into `chrome://`, `about:`, the extension stores, the PDF viewer, or
  blank tabs. **When injection fails the roll is not consumed** — `remaining` stays at
  0 and it retries on the next tick. Without this the odds quietly skew against users
  who sit on restricted pages.
- Requires the `<all_urls>` host permission. Unavoidable for inject-anywhere behavior;
  it means a scarier install prompt and slower store review.
- Permissions: `alarms`, `idle`, `storage`, `scripting`, host `<all_urls>`. No
  `offscreen` — the extension-origin iframe removed the need for it.
- `foxy.webm` must be listed in `web_accessible_resources`, as must `overlay.html`.

### Options page

Minimal, because store users expect one: an enable toggle and an odds dropdown,
persisted to `chrome.storage.local`. Changing the odds re-draws `remaining`.

The same four presets are offered in the desktop tray menu, so the two apps stay
comparable. Expected waits differ because the clocks differ (4h/day browsing vs
8h/day at the PC).

| Preset | N | Extension wait | Desktop wait |
|---|---|---|---|
| Ultra-rare | 1,000,000 | ~69 days | ~35 days |
| Rare | 300,000 | ~21 days | ~10 days *(desktop default)* |
| Normal | 100,000 | ~7 days *(extension default)* | ~3.5 days |
| Terraria-faithful | 10,000 | ~17 hours | ~8 hours |

### Publishing

- **Chrome Web Store** — $5 one-time developer fee, 1–3 day review, requires a privacy
  policy URL and a written justification for each permission.
- **Firefox AMO** — free, faster review, and additionally supports self-hosted signed
  XPI, which is the fallback distribution channel if the listing is ever pulled.
- The listing must describe the behavior plainly. A jumpscare extension that says it
  is a jumpscare extension is within policy; one that conceals it is not.
- First-run page carries a photosensitivity and volume warning.

## Component: Windows desktop app

.NET 8, `net8.0-windows`, **WPF**, single-file publish. The project sets both
`UseWPF` and `UseWindowsForms` — WPF for the overlay and video, WinForms purely for
`NotifyIcon`, which WPF has no equivalent of. This keeps the tray icon dependency-free.

WPF rather than WinForms because the asset is video: `MediaElement` decodes H.264
through Media Foundation with no third-party package, and carries the audio with it.
WinForms would have needed LibVLCSharp or a WPF interop host to do the same job.

- **Tray menu:** Enabled · Odds · Test Scare · Run at startup · Quit
- **Idle gating:** `GetLastInputInfo` P/Invoke; `SystemEvents.SessionSwitch` suppresses
  the clock while the session is locked.
- **Overlay:** one borderless `Window` **per monitor**, `WindowStyle = None`,
  `ResizeMode = NoResize`, `Topmost = true`, `ShowInTaskbar = false`,
  **`ShowActivated = false`** so it never steals focus or swallows keystrokes,
  `Background = Black`, hosting a `MediaElement` with `LoadedBehavior = Manual`,
  `Stretch = Uniform`.
- **Multi-monitor:** **one** window spanning the whole virtual desktop, containing
  exactly **one** `MediaElement` positioned over the primary screen. Every other screen
  is a `Rectangle` painted with a `VisualBrush` of that same element.

  Three designs were tried. One `MediaElement` per monitor fails: WPF's `MediaElement`
  does not render reliably on a secondary monitor — its playback clock advances while
  presentation stalls, holding byte-identical frames for ~900ms of an 880ms video.
  Synchronising the players fixed the clocks to within 3ms and changed nothing on
  screen, proving the renderer was at fault, not the timing. Playing on the primary
  only and blacking out the rest worked but gave up the effect on every other screen.

  The brush approach keeps it: a `VisualBrush` cannot drift from its source, so all
  monitors show the same frame **by construction**, and only one decoder ever runs.
  Overlapping audio is structurally impossible for the same reason — there is one
  player, so there is one audio stream.

  Known limit: a single window spanning monitors of **different DPI** gets one DPI from
  WPF, and Windows scales the rest. Acceptable; the mixed-DPI case is on the manual
  checklist.
- **DPI:** `Screen.AllScreens` reports *physical pixels* while WPF positions in
  device-independent units. Window bounds must be converted per-monitor via
  `VisualTreeHelper.GetDpi` / the window's `CompositionTarget` matrix. Skipping this
  leaves the overlay mis-sized on any mixed-DPI setup, which is most laptops with an
  external display.
- **Teardown:** `MediaElement.MediaEnded` closes the overlays. A **separate failsafe
  timer at video duration + 1500ms** force-closes every overlay unconditionally. A bug
  in the normal path — or a video that fails to decode and never raises `MediaEnded` —
  must never be able to leave the user staring at an un-closable fullscreen window.
- **Autostart:** off by default, opt-in from the tray, written to
  `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.

### Config and state

`%APPDATA%\FoxyJumpscare\config.json`:

| Key | Default |
|---|---|
| `enabled` | `true` |
| `oneInN` | `300000` |
| `tickSeconds` | `30` |
| `idleThresholdSeconds` | `60` |
| `failsafeMarginMs` | `1500` |
| `runAtStartup` | `false` |

There is no `durationMs`. On-screen time is the video's own length; `failsafeMarginMs`
is how long past that the force-close waits before firing.

`state.json` holds `remaining` alongside it.

### Expected friction

The exe is unsigned, and "resident tray process + `Run` key + fullscreen topmost
overlay" is close to the behavior profile antivirus heuristics watch for. Expect a
SmartScreen prompt on first run. Code signing is out of scope for v1.

## Assets

`assets/` is a swappable pack. Neither app hardcodes anything about the contents, so if
the store build has to switch to original art, that is a pack swap and a re-upload, not
a code change.

The source asset is a **greenscreen MP4**. It is never consumed directly. A build step
(`tools/build-assets.mjs`, requires ffmpeg) keys the green and emits the two derived
formats the targets actually need:

| Output | Format | Consumer | Why |
|---|---|---|---|
| `foxy.webm` | VP9 + alpha, Opus | Extension | Only container that carries alpha; safest codec in Firefox |
| `foxy.mp4` | H.264 over black, AAC | Desktop | `MediaElement` plays it natively; overlay is black anyway |

Keying is `chromakey` + `despill`, with the tuned parameters stored in `pack.json` so a
rebuild reproduces the tuned result rather than the defaults. The VP9 pass sets
`-auto-alt-ref 0`, since alt-ref frames are documented to destroy the alpha channel.

**ffmpeg cannot verify its own alpha output.** It encodes VP9 alpha correctly but cannot
decode it back: `ffprobe` reports `pix_fmt` as `yuv420p`, and round-tripping through
`alphaextract` returns a fully opaque plane even for a genuinely transparent file. The
only ffmpeg-side signal is the `alpha_mode=1` container tag, which is set with or
without `-auto-alt-ref 0` and therefore proves only that alpha was requested. Real
verification is a browser pixel read — see `assets/PACK.md`.

All media is gitignored (see `.gitignore`), including the source. `assets/PACK.md`
documents the pipeline so the pack can be reconstituted locally.

## Testing

The roll is pure and testable on both sides. UI is verified manually.

- **JS (`vitest`)** and **C# (`xunit`)** both assert, against the same spec:
  - 1e6 draws at `p = 1/1000` have a sample mean within 1% of 1000
  - every draw is `>= 1`
  - the `U -> 1` edge yields exactly 1, and `U -> 0` yields a large finite value
  - the countdown fires exactly when cumulative credited seconds reach the drawn value
  - a failed/non-injectable fire does not consume `remaining` (extension only)
- **`TEST_MODE`** flag forces `oneInN = 5` so the overlay can be exercised in seconds
  rather than days.

Manual verification, per release — these are the things that break on real machines and
cannot be asserted in a unit test:

- Overlay fires correctly on a **strict-CSP page** (GitHub) and a **plain** page, in
  both Chrome and Firefox, with audio audible on both
- The `frame-src`-blocked fallback path actually engages, rather than failing silently
- No green fringe against a white page and against a dark page
- Desktop: correct sizing on a **mixed-DPI** two-monitor setup
- Desktop: exactly one audible audio stream with three monitors attached
- Desktop: overlay closes when the video file is deliberately corrupted (failsafe path)

## Out of scope for v1

- macOS and Linux desktop builds
- Suppression during fullscreen apps, screen sharing, and calls (v2)
- Global panic hotkey (v2)
- GitHub Actions release pipeline (v1.1)
- Code signing the Windows executable

## Open risks

| Risk | Mitigation |
|---|---|
| DMCA takedown of the store listing | Assets are a swappable pack; original-art build is a re-upload |
| DMCA against the repo | Assets gitignored, never pushed |
| Slow store review from `<all_urls>` | Written permission justification prepared with the submission |
| SmartScreen warning on the exe | Documented in the README; signing deferred |
| Green fringe from a bad key | Tuned params committed in `pack.json`; review over both light and dark backgrounds before shipping |
| Page `frame-src` blocks the overlay iframe | Content script detects load failure and falls back to direct injection |
| Overlay mis-sized on mixed-DPI multi-monitor | Explicit per-monitor DPI conversion; called out in the desktop section |
| Video fails to decode, `MediaEnded` never fires | Failsafe timer force-closes regardless of media state |
