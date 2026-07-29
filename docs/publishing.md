# Publishing to the Chrome Web Store and AMO

Everything here is prepared and ready. The submission itself needs your accounts
and your decision — read the first section before uploading anything.

---

## Read this first: the asset is not ours

The extension ships Withered Foxy footage and audio from Five Nights at Freddy's.
Uploading it to a store is different in kind from running it on your own machine:

- It **distributes** that material at scale, under a developer account tied to
  your real identity and payment method.
- Store takedowns are **executed on receipt of a notice**, not adjudicated. The
  listing disappears first and you argue afterwards.
- A DMCA strike attaches to the **account**, not the extension. The Chrome
  developer fee is per-account and one-time; a terminated account is not
  replaced by paying it again.
- Scott Cawthon and Steel Wool have historically been permissive toward fan
  work. That is goodwill, not a licence, and it does not bind the platform.

The mitigation is already built in: `assets/` is a swappable pack and neither app
hardcodes anything about its contents. Swapping in original art and re-uploading
is a rebuild, not a rewrite — see `assets/PACK.md`.

**Three options, in descending risk:**

1. Publish as-is with the real assets. Fastest, most recognisable, and the one
   that can cost you the account.
2. Publish with original art, keep the real assets for your local build. The
   pack swap is a single command. This is the one worth taking seriously.
3. Don't publish publicly. Firefox supports self-hosted signed XPI, and Chrome
   supports unlisted listings shared by direct link, both of which reach friends
   without a public storefront. **This is the path that is actually wired up** —
   `npm run sign:firefox`, documented in `docs/install-firefox.md`. It needs a
   free AMO account, no review, and no fee.

Nothing below assumes which you pick.

---

## Build the packages

```powershell
npm run assets      # needs assets/foxy-src.mp4
npm run icons
npm run build
npm run lint:firefox    # must be 0 errors, 0 warnings
npm run verify:firefox  # behavioural check in real Firefox
npm run test && npm run test:e2e
npm run package
```

Output:

```
dist/packages/foxy-jumpscare-chrome-v0.1.5.zip     ~248 KB
dist/packages/foxy-jumpscare-firefox-v0.1.5.zip    ~248 KB
```

Bump `version` in `extension/manifest.base.json` before every resubmission —
both stores reject a version that already exists.

---

## Listing copy

**Name:** Foxy Jumpscare

**Short summary** (Chrome: 132 chars max)

> A rare jumpscare while you browse. One in 100,000 chance every second — you'll forget it's installed long before it fires.

**Description**

> Somewhere between right now and about a week from now, something is going to
> lunge at you.
>
> This is a port of the Terraria mod "1/10000 Chance for Withered Foxy Jumpscare
> Every Second" by yonsan (YMY), retuned for a browser you leave open all day
> rather than a play session. It rolls once per second of active browsing, at
> 1 in 100,000 by default — roughly once a week for most people.
>
> It only counts seconds you're actually browsing. It does not roll while the
> browser is in the background, while your machine is idle, or while your screen
> is locked.
>
> Rarity is configurable from the toolbar button: Ultra-rare (~10 weeks), Rare
> (~3 weeks), Normal (~1 week), Terraria-faithful (~17 hours), or any 1-in-N you
> care to type. There is also a Test button, if you would rather see it once on
> your own terms than be ambushed.
>
> WARNING: This is a sudden loud video with a scream, by design. Do not install
> it if you are photosensitive, and think carefully about headphones.
>
> It reads nothing, stores nothing about you, and sends nothing anywhere. The
> only data it keeps is your own settings and a countdown, both on your device.

**Category:** Fun / Entertainment
**Language:** English

---

## Permission justifications

Chrome requires a written justification per permission. These are accurate — do
not embellish them.

| Permission | Justification |
|---|---|
| `alarms` | Drives the once-per-minute countdown tick. A regular timer cannot be used because MV3 service workers are terminated when idle. |
| `idle` | Determines whether the user is actively at the computer, so the odds count only active browsing time rather than time the machine is switched on. |
| `storage` | Stores the user's rarity setting, enabled state, and the countdown, locally on the device. |
| `scripting` | Injects the overlay into the page when the jumpscare fires. |
| `host_permissions: <all_urls>` | The jumpscare must be able to appear on whatever page the user is on when it fires. The extension does not read, collect, or transmit page content — it only appends an overlay element and removes it a second later. |

**Single purpose** (Chrome requires one sentence):

> Displays a rare, randomly-timed jumpscare overlay while browsing.

`<all_urls>` is the permission most likely to slow review. The justification
above is the honest one: it needs to draw anywhere, and it reads nothing.

---

## Privacy policy

Chrome requires a **hosted URL**. Publish this as a GitHub Pages page or a gist
and paste the link into the listing.

> **Foxy Jumpscare — Privacy Policy**
>
> Foxy Jumpscare does not collect, store, transmit, or sell any personal
> information.
>
> It does not read page content. It does not track browsing history. It contains
> no analytics, no telemetry, and no remote code. It makes no network requests of
> any kind.
>
> The only data it stores is your own configuration — whether the extension is
> enabled, your chosen rarity, and a countdown value — kept locally on your
> device using the browser's extension storage. Uninstalling the extension
> removes it.
>
> The `<all_urls>` host permission is required so the jumpscare overlay can be
> displayed on whatever page you are viewing when it triggers. It is used only to
> add a visual overlay and remove it again.
>
> Contact: <your email>

Chrome's privacy tab also needs the data-use certifications ticked: no data
collected, no sale of data, no use for creditworthiness or lending.

Firefox's equivalent is already declared in the manifest —
`data_collection_permissions: { required: ["none"] }` — and passes
`addons-linter` cleanly.

---

## Screenshots

Chrome requires at least one 1280×800 or 640×400 screenshot. Generate them with:

```powershell
$env:FOXY_CAPTURE=1; npx playwright test _demo
```

That writes to `docs/screenshots/` (gitignored, because they contain the asset).
Use the mid-lunge frames; the overlay reads best against the mock inbox page.

**If you publish with original art, regenerate these afterwards** — a listing
whose screenshots show different characters than the extension ships is both
misleading and an obvious flag during review.

---

## Chrome Web Store

1. Register at <https://chrome.google.com/webstore/devconsole> — **$5 one-time**,
   per account.
2. New item → upload `foxy-jumpscare-chrome-v0.1.5.zip`.
3. Fill in the listing copy, screenshots, and the 128×128 icon (already in the
   package).
4. Privacy tab: paste the hosted policy URL, tick the data-use certifications,
   and paste the single-purpose sentence and permission justifications above.
5. Choose visibility. **Unlisted** is worth considering — reachable by direct
   link, not browsable in the store.
6. Submit. Review is typically 1–3 days; `<all_urls>` can push it longer.

## Firefox AMO

Free, no developer fee. The one irreversible decision is the **add-on id**:
The id in `tools/build-extension.mjs` is claimed by whichever channel you submit
to first, and an id cannot be moved between accounts.

### First submission — the web UI

The CLI cannot do this one, because a new listing needs metadata (screenshots,
category, support contact) that `web-ext` has no way to supply.

1. Sign in at <https://addons.mozilla.org/developers/>.
2. **Submit a New Add-on** → choose distribution:
   - **On this site** — the public listing.
   - **On your own** — private signing. Same as `npm run sign:firefox`; see
     `docs/install-firefox.md`.
3. Upload `dist/packages/foxy-jumpscare-firefox-v0.1.5.zip`.
4. Automated validation runs `addons-linter` — the same tool as
   `npm run lint:firefox`, already clean, so this passes without comment.
5. **Source code:** not required. The build copies plain, readable JavaScript;
   nothing is minified, bundled, or transpiled. Only `manifest.json` is
   generated. If a reviewer asks anyway, point them at the repository, or
   re-submit with `web-ext sign --upload-source-code`.
6. Fill in the listing copy above, plus:
   - **Screenshots** — at least one. `$env:FOXY_CAPTURE=1; npx playwright test _demo`
   - **Categories** — Fun, or Photos/Music/Videos.
   - **Licence** — the code is yours; the video is not. See the warning at the
     top of this file.
   - **Support email** and, ideally, a repository link.
7. Flag the content: sudden loud audio and a startle effect. Say it in the
   description as well as any ratings field. This is the single most likely
   source of angry reviews, and the honest warning is also the best defence.
8. Submit. Listed reviews are usually hours to a couple of days — faster than
   Chrome, and `<all_urls>` is less of a flashpoint on AMO.

### Subsequent versions — one command

```powershell
# bump "version" in extension/manifest.base.json first
npm run build
npm run publish:firefox   # listed channel
npm run sign:firefox      # or: private, unlisted
```

AMO refuses to sign a version number it has already seen, including one it
rejected. Bump before every attempt.

---

## After publishing

- Keep the source tag matching the submitted version, so a takedown or bug report
  can be traced to an exact build.
- If a listing is pulled, the fastest recovery is the original-art pack: swap
  `assets/`, bump the version, rebuild, resubmit. Nothing else changes.
- Watch the first reviews for autoplay complaints on Firefox. Audio is verified
  automatically by `npm run verify:firefox`, but only on the configuration this
  repo has tested.
