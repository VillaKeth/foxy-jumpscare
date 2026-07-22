# Firefox release checklist

Playwright cannot load MV3 extensions in Firefox — it needs `web-ext` plus
remote-debugging plumbing that is disproportionate for this project. So the
Chromium suite in `tests/e2e/` covers Chrome, and Firefox is verified by hand
against this list before every AMO submission.

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
