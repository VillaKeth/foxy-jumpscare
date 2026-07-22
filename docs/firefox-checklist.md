# Firefox verification

Firefox is a fully supported target and is now verified automatically.

```powershell
npm run lint:firefox      # addons-linter — the validator AMO runs on submission
npm run verify:firefox    # behavioural checks in real Firefox
```

## What is automated

`npm run lint:firefox` reports **0 errors, 0 warnings, 0 notices**. It covers
manifest, permission and API-compatibility problems, and caught three real ones:
a missing `data_collection_permissions` declaration, `options_page` being
unsupported below Firefox 126 (switched to `options_ui`), and a
`strict_min_version` too low for the keys being declared.

`npm run verify:firefox` drives real Firefox via Mozilla's `web-ext`, which
installs the extension as a temporary add-on. A throwaway copy of `dist/firefox`
is patched with probes that report back to a local collector, so nothing depends
on reading the screen. Checks:

- extension fired
- overlay iframe injected, with the right `z-index` and `allow="autoplay"`
- VP9 video decoded
- playing, not blocked
- **audio not muted** — the biggest Chrome/Firefox divergence, since Firefox
  handles autoplay delegation to cross-origin iframes differently
- **transparency present** — Firefox's VP9 alpha implementation is separate from
  Chromium's, so this is checked independently rather than assumed
- no green fringe

Last run on Firefox 153: all pass, 83.3% of the frame keyed clear, 0% green.

### Why not Playwright

Playwright exposes no API for loading an extension in Firefox, unlike Chromium's
`--load-extension`. `web-ext` is Mozilla's own tool and does it properly.

### Note if this ever breaks

Both the repo path and Firefox's install path usually contain spaces. `web-ext`'s
`.bin` shim is a `.cmd` on Windows, which requires `shell: true`, and a shell
concatenates arguments unescaped — which silently tears the command apart. The
script therefore runs `node node_modules/web-ext/bin/web-ext.js` directly with no
shell. Do not "simplify" it back to the shim.

## Still manual

Nothing behavioural, but worth an eyeball before an AMO submission:

- [ ] Install from a built XPI rather than a temporary add-on, and confirm it
      survives a browser restart
- [ ] Options page renders correctly and saves (embedded via `options_ui`)
- [ ] The install prompt's permission wording is acceptable — `<all_urls>` reads
      alarmingly, and the listing should explain why it is needed
