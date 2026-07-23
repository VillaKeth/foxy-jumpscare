# Foxy Jumpscare

Two apps that fire a rare fullscreen jumpscare, ported from the Terraria mod
"1/10000 Chance for Withered Foxy Jumpscare Every Second" by yonsan (YMY).

- `extension/` — MV3 browser extension, builds to Chrome + Firefox
- `desktop/` — C# .NET 8 WinForms tray app, Windows only
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
keys it into `foxy.webm` (VP9+alpha, extension) and `foxy.mp4` (VP9 over black,
desktop). Both are VP9 on purpose: H.264 is patent-encumbered, so Fedora and Arch
ship VLC without its decoder and the desktop scare is a silent black screen there —
VP9's decoder is royalty-free and always present. The alpha (WebM) pass must pass
`-auto-alt-ref 0` or the alpha channel is destroyed. On Windows the WPF build decodes
`foxy.mp4` via Media Foundation, which needs the (inbox on Win11) VP9 extension; the
Avalonia build carries its own libVLC and never depends on an OS codec.

## Toolchain

Node 24 / npm 11, .NET 8 SDK, ffmpeg, git. No pnpm, no rust on this box.

```powershell
# single root package.json covers tools + extension — no per-package installs
npm install

# assets — run first; both builds expect the derived files
npm run assets

# extension
npm run build                         # -> dist/chrome, dist/firefox
npm test

# desktop
dotnet build   desktop/FoxyJumpscare
dotnet test    desktop/FoxyJumpscare.Tests
dotnet publish desktop/FoxyJumpscare -c Release
```

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
