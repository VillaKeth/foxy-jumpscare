# Foxy Jumpscare

A rare fullscreen jumpscare, ported from the Terraria mod "1/10000 Chance for Withered
Foxy Jumpscare Every Second" by yonsan (YMY). One browser extension and two desktop
apps, the latter sharing a single core.

- `extension/` — MV3 browser extension, builds to Chrome + Firefox
- `desktop/FoxyJumpscare` — WPF + WinForms tray, `net8.0-windows`. Opaque black overlay.
  Older, most-tested. Ships as `FoxyJumpscare-win-x64-black.zip`.
- `desktop/FoxyJumpscare.Avalonia` — Avalonia + LibVLCSharp, plain `net8.0`. Transparent
  overlay, Windows/Linux/macOS. Where current work happens. See `docs/cross-platform.md`.
- `desktop/FoxyJumpscare.Core` — roll, ticker, config store, formatter. Shared by both,
  no UI. Tests live in `FoxyJumpscare.Core.Tests`.
- `assets/` — shared asset pack (**gitignored**, see `assets/PACK.md`)
- `docs/superpowers/specs/` — design docs; start with the 2026-07-22 one

## Invariants

**The roll algorithm is specified once and implemented twice.** Both apps sample the
wait from a geometric distribution rather than rolling every second:
`remaining = max(1, ceil(ln(U) / ln(1 - p)))` for `U ~ Uniform(0,1]`, `p = 1/N`.
Do not "simplify" either implementation into a `setInterval(1000)` — browsers throttle
background timers and MV3 service workers get killed, which silently biases the odds.
If you change the math, change it in both places and in the spec.

**Assets are never committed.** They are copyrighted FNAF material. `.gitignore` keeps
them out deliberately — do not add them, and do not `git add -f` them.

**A failed jumpscare must not consume the roll.** If injection fails (restricted page)
or an overlay can't be shown, leave `remaining` at 0 and retry next tick.

**The overlay always has a hard failsafe teardown.** Normal dismissal is the video's
`ended` / `MediaEnded` event; an independent timer force-closes at video duration +
1.5s regardless of media state. A video that fails to decode never raises `ended`.
Never ship a path where a bug can leave an un-closable fullscreen window on a screen.

**The browser overlay is an extension-origin iframe, not injected elements.** This is
load-bearing for three separate reasons — page CSP blocks injected media on sites like
GitHub, page autoplay policy silently kills content-script audio, and host CSS leaks
into injected nodes. Do not "simplify" it back to a raw `<video>` node.

**The source greenscreen video is never consumed directly.** `tools/build-assets.mjs`
keys it into `foxy.webm` (VP9+alpha, extension), `foxy-alpha.mp4` (double-width
colour|matte, desktop) and `foxy.mp4` (VP9 over black, desktop fallback). All VP9 on
purpose: H.264 is patent-encumbered, so Fedora and Arch ship VLC without its decoder
and the desktop scare is a silent black screen there — VP9's decoder is royalty-free
and always present. The alpha (WebM) pass must pass `-auto-alt-ref 0` or the alpha
channel is destroyed. On Windows the WPF build decodes `foxy.mp4` via Media
Foundation, which needs the (inbox on Win11) VP9 extension; the Avalonia build
carries its own libVLC and never depends on an OS codec.

**Neither overlay paints a backdrop.** Browser and desktop both composite Foxy over
whatever was already on screen; an opaque backdrop turns the scare into a video
player. The one exception is the extension's standalone fallback window, which has
no page behind it — `overlay.js` paints that black when `window.parent === window`.
The desktop gets its alpha from `foxy-alpha.mp4`'s right half, not from any codec
feature: nothing in the libVLC stack can decode WebM alpha. When building that file,
do not flatten the colour half by overlaying onto a `color=` source — it synthesises
a 25 fps timeline, the matte branch keeps the source rate, and the two halves stop
being the same frame. `buildMatteArgs` uses `premultiply=inplace=1` for that reason,
and the build asserts frame parity with the source.

## Toolchain

Node 24 / npm 11, .NET 8 SDK, ffmpeg, git. No pnpm, no rust on this box.

```powershell
# single root package.json covers tools + extension — no per-package installs
npm install

# assets — run first; every build expects the derived files.
# No assets/foxy-src.mp4 on this checkout? assets:placeholder writes a stand-in so
# the pipeline is exercisable without copyrighted input.
npm run assets:placeholder            # only if the source clip is missing
npm run assets

# extension
npm run build                         # -> dist/chrome, dist/firefox
npm test

# desktop — the test project is Core.Tests; there is no FoxyJumpscare.Tests
dotnet test  desktop/FoxyJumpscare.Core.Tests

# desktop, transparent (Avalonia) — the one under active development
dotnet run   --project desktop/FoxyJumpscare.Avalonia -- --test-scare
pwsh tools/publish-desktop-windows.ps1  # -> FoxyJumpscare-win-x64.zip
pwsh tools/publish-desktop-linux.ps1    # -> FoxyJumpscare-linux-x64.tar.gz

# desktop, black background (WPF, Windows only)
pwsh tools/publish-desktop.ps1          # -> FoxyJumpscare-win-x64-black.zip
```

Two Windows zips exist and the `-black` suffix is the only thing telling them apart:
`FoxyJumpscare-win-x64.zip` is the Avalonia/transparent build, `-black` is WPF. The
Avalonia one is **not** single-file, unlike the other two — `PublishSingleFile` pulls
all 650 libVLC plugin DLLs into the bundle, and self-extraction flattens the
`plugins/` subtree that `Core.Initialize()` scans for, so the scare plays nothing.
The script asserts `libvlc/win-x64/plugins` survived for exactly that reason.

Publish through the scripts, not raw `dotnet publish`. They copy the assets the apps
load from disk at runtime and assert the ones whose absence degrades silently — a
missing `foxy-alpha.mp4` turns the transparent overlay back into the black one.

`TEST_MODE` forces `oneInN = 5` so the overlay fires in seconds. Use it — otherwise
you are waiting a week to see your own change.

## ⚠️ Sub-Agent & Workflow Token Guardrail

A prior session burned the token budget by silently building a multi-step automated
workflow that fired ~100 model calls. Do not repeat it.

1. **Hard cap: 3 sub-agents / Task-tool invocations at once**, for any reason. If a plan
   seems to need more, stop and ask first — do not queue extras behind the cap.
2. **No self-directed multi-agent workflows.** Do not design or start a pipeline that
   chains model calls in a loop without explicit approval of that specific plan, in that
   session.
3. **Before spawning any sub-agent, state:** how many will run and what each is for. Get
   confirmation if the count is more than 1.
4. **Never call a non-default model in an automated loop.**
5. If a task looks big enough to "need" a workflow, say so and ask how to scope it down.
6. This sits above "be helpful" — a runaway workflow is a cost incident, not a win.
