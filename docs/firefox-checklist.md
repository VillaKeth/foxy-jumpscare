# Firefox release checklist

Firefox is a fully supported target — `dist/firefox` builds and runs. What is not
automated here is *behavioural* testing: Playwright exposes no API for loading an
extension in Firefox, unlike Chromium's `--load-extension`. Other tools can —
Mozilla's `web-ext`, or Selenium's `installAddon` — they are simply not wired up
yet. That is a gap in this repo's tooling, not a limitation of the extension.

What **is** automated:

```powershell
npm run lint:firefox    # addons-linter — the same validator AMO runs on submission
```

It reports **0 errors, 0 warnings, 0 notices**, and it covers the whole class of
manifest, permission and API-compatibility problems. It caught three real ones:
a missing `data_collection_permissions` declaration, and `options_page` being
unsupported below Firefox 126 — switched to `options_ui`, which works on both
browsers.

The list below is what the linter cannot see: whether it actually behaves.

Load `dist/firefox` via `about:debugging` → This Firefox → Load Temporary Add-on
→ select `manifest.json`.

## Checks

- [ ] Loads with no manifest warnings in `about:debugging`
- [ ] Background script console shows no exceptions
- [ ] `__foxyTest.fireNow()` from the background console returns `true` and injects
- [ ] Overlay appears on an ordinary page (example.com)
- [ ] Overlay appears on a **strict-CSP** page (github.com)
- [ ] **Audio is audible.** This is the single biggest Chrome/Firefox divergence in
      the design — the iframe's `allow="autoplay"` is what carries it, and Firefox
      honours autoplay delegation differently from Chrome
- [ ] Foxy renders **with transparency**; the page is visible behind him. Firefox
      and Chrome both support VP9 alpha in WebM, but they are separate
      implementations and only one of them is covered by automated tests
- [ ] No green fringe against a light page **and** against a dark page
- [ ] Overlay disappears on its own and the page is fully interactive afterwards
- [ ] Overlay does not intercept clicks while visible (`pointer-events: none`)
- [ ] Options page saves and reloads correctly
- [ ] Changing rarity visibly resets `remaining` in `about:debugging` → Storage

## Notes

`chrome.*` is used directly rather than `browser.*`. Firefox aliases `chrome.*`
for MV3 compatibility, so this works — but if a call ever behaves differently
between the two, that alias is the first place to look.
