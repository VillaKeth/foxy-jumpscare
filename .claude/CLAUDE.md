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

**The overlay always has a hard failsafe teardown.** Normal dismissal is ~1.5s; an
independent timer force-disposes at 3s regardless. Never ship a path where a bug can
leave an un-closable fullscreen window on a user's screen.

## Toolchain

Node 24 / npm 11, .NET 8 SDK, git. No pnpm, no rust on this box.

```powershell
# extension
npm --prefix extension install
npm --prefix extension run build      # -> dist/chrome, dist/firefox
npm --prefix extension test

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
