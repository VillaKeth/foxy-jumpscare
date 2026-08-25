# Publishing to the Microsoft Edge Add-ons store

Everything for the submission is prepared and pasteable below. What is missing is
a Partner Center account, which only you can create.

Read `docs/publishing.md` first — the section on the asset not being ours applies
here unchanged. Microsoft executes takedowns on receipt, exactly as Google does,
and a strike lands on the account rather than the listing.

## Before anything else: the account

Register and sign in at
<https://partner.microsoft.com/dashboard/microsoftedge/public/login>.

**Use a neutral identity — not the work email.** The developer name, website and
support contact you register with are displayed publicly on every extension page.
Same rule as AMO and Opera; see `docs/publishing.md`.

The publishing documentation names no registration fee for the Edge program.
Treat the registration page as authoritative — confirm at signup before assuming
it is free.

## Manifest V3 is required, not merely tolerated

Partner Center accepts **only** MV3 submissions now. This is the exact inverse of
the Opera situation in `docs/publishing-opera.md`, where the form still targets V2
and new V2 uploads are banned at the same time. Our package is MV3, so Edge is the
one Chromium store with no manifest problem at all.

Remote code is prohibited under MV3 and we load none, so that declaration is
honest and easy.

## What to upload

```powershell
npm run build      # writes dist/edge (byte-identical to dist/chrome)
npm run icons      # writes dist/store/logo-300.png
npm run package    # writes dist/packages/foxy-jumpscare-edge-vX.Y.Z.zip
```

| Partner Center asks for | File |
| --- | --- |
| Extension package | `dist/packages/foxy-jumpscare-edge-vX.Y.Z.zip` |
| Extension logo (1:1, 300x300 recommended, 128 minimum) | `dist/store/logo-300.png` |
| Screenshots (max 6, must be exactly 640x480 or 1280x800) | `dist/store/screenshot-*.png` |
| Small promotional tile (440x280, optional) | `dist/store/promo-small-440x280.png` |
| Large promotional tile (1400x560, optional) | `dist/store/promo-marquee-1400x560.png` |

Both tiles come from `npm run promo`. Chrome wants the same two sizes, so one
run serves both listings — see `docs/publishing.md`.

`dist/` is gitignored, so none of these are in the repository — regenerate them
rather than looking for committed copies.

### Regenerating the screenshots

The overlay captures come from the demo Playwright test:

```powershell
$env:FOXY_CAPTURE=1; npx playwright test _demo
```

That writes `docs/screenshots/*.png`. Four of the five are already 1280x800 and
are copied to `dist/store/` unchanged. The panel capture is 360x400 and has to be
placed on a 1280x800 canvas, since Edge accepts no other size:

```powershell
ffmpeg -y -v error -i docs/screenshots/05-panel.png `
  -vf "scale=720:800:flags=lanczos,pad=1280:800:(ow-iw)/2:0:color=0xECECEC" `
  dist/store/screenshot-05-panel.png
```

## The field that decides whether this passes

**Notes for certification.** At 1-in-100,000 the expected outcome of a reviewer
installing this and browsing normally is that nothing happens, and an extension
that appears to do nothing fails certification. Tell them how to fire it on
purpose:

> Foxy Jumpscare fires at random — by default a 1-in-100,000 chance per second of
> active browsing, which averages about a week. It will almost certainly not fire
> on its own during review, and that is working as intended, not a broken build.
>
> To see the full behaviour immediately:
>
> 1. Click the Foxy Jumpscare button in the toolbar. The panel opens.
> 2. Click "Test it now". The scare plays at once, over whatever page is open.
>
> The test button does not touch the countdown, so it can be pressed repeatedly.
>
> Please have audio enabled — the extension is a horror prank and plays a sudden
> loud scream by design. This is disclosed in the listing description and in the
> panel itself.
>
> To confirm the odds behave, set Rarity to "Terraria-faithful" (1 in 10,000) in
> the panel; the panel shows the recalculated expected wait immediately.
>
> The extension makes no network requests of any kind. Full source:
> https://github.com/VillaKeth/foxy-jumpscare

## Availability

- **Visibility:** Public.
- **Markets:** all markets, including future ones (the default). There is no
  region-specific behaviour and nothing localised.

## Properties

| Field | Value |
| --- | --- |
| Category | The closest available to Entertainment / Fun. AMO's equivalent is `games-entertainment`; record which one Edge actually offers when you get there, and note it here. |
| Website | `https://github.com/VillaKeth/foxy-jumpscare` |
| Support contact | `https://github.com/VillaKeth/foxy-jumpscare/issues` |
| Mature content | **Your decision — see below.** |

### Mature content

Genuinely a judgement call, and it cuts both ways for reach:

- **Ticked:** narrows the audience and may suppress the listing in some contexts.
- **Not ticked:** a sudden loud scream and a horror image, undisclosed, is the
  kind of thing a policy reviewer can decide against you — and the cost is the
  listing, which is the whole point of being here.

The description and the panel both warn about the audio and the startle
prominently, which is the strongest argument that the extension is not concealing
what it is. Whichever you choose, keep it consistent with the description.

## Privacy page

Every field here is mandatory, and Microsoft treats an inaccurate disclosure as a
policy violation rather than a mistake. All of the below is true of the shipped
code and was checked against `extension/src/` — there are no `fetch`,
`XMLHttpRequest`, `sendBeacon`, or `WebSocket` calls anywhere in it.

### Single Purpose Description

> Foxy Jumpscare displays a brief full-screen horror animation at random,
> infrequent intervals while the user browses. Its single purpose is to deliver
> that scare on a user-configured probability, and nothing else. The user sets the
> odds, can disable it at any time, and can trigger one on demand from the
> toolbar panel.

### Permission justification

| Permission | Paste this |
| --- | --- |
| `storage` | Stores the user's four settings locally — chosen odds, enabled/disabled, whether the standalone fallback window is allowed, and the remaining countdown. Nothing else is written, and nothing is synced or transmitted. |
| `alarms` | Drives the countdown between scares. An MV3 service worker is terminated when idle, so an in-memory timer cannot survive; alarms are the supported mechanism for resuming a countdown after the worker is torn down. |
| `idle` | Pauses the countdown when the user is away or the screen is locked, so that a browser left open overnight does not consume the odds while nobody is watching. Only the three-state idle status is read — active, idle, or locked. No activity data is recorded or transmitted. |
| `scripting` | Places the overlay into the active tab at the moment a scare fires. Nothing is injected at any other time. The injected frame is served from the extension package and does not read or modify the host page. |
| `<all_urls>` | A scare can occur while the user is on any page, and which page that will be is not knowable in advance, so the overlay must be placeable in an arbitrary tab. The host permission is used solely to display the overlay and to determine whether the current tab permits injection at all. No page content, URL, or form data is read, stored, or transmitted. |

If the reviewer questions `scripting` as unused, note what Opera's analyser also
hit: `attemptFire` calls `browser.scripting.executeScript` through a parameter
named `browser`, so a literal `chrome.scripting` never appears for static analysis
to find. The permission is genuinely required.

### Are you using remote code?

**No, I am not using remote code.** Everything executed ships inside the package.
MV3 forbids remotely hosted code and the extension does not attempt it.

### Data usage

Tick nothing under "what user data do you plan to collect" — the honest answer is
none. Then certify the disclosures, which are all true here.

This matches the `data_collection_permissions: { required: ['none'] }` already
declared to AMO in the Firefox manifest.

### Privacy Policy URL

```
https://github.com/VillaKeth/foxy-jumpscare/blob/main/PRIVACY.md
```

`PRIVACY.md` is at the repository root. Confirm it renders at that URL before
submitting — Partner Center requires the link to be reachable, and a reviewer
will open it.

## Store listing

**Extension name** and **Short description** are read-only here; they come from
the manifest and are already correct:

- Name: `Foxy Jumpscare`
- Short description: `A rare jumpscare while you browse. A 1 in 100,000 chance every active second.`

**Description** must be 250–10,000 characters. Reuse the AMO copy verbatim from
`tools/amo-metadata.json` — it is browser-neutral, already reviewed by one store,
and leads on the differentiators. Do not use the "Generate with AI" button: it
describes the package back to you and will not know why the geometric draw or the
transparency matter.

**Search terms** — maximum 7 terms, 30 characters each, 21 words total. They are
not shown to users.

Conservative set:

```
jumpscare, jump scare, horror prank, random scare, animatronic, scary extension, prank
```

Higher-reach set, which is how people actually search:

```
fnaf, five nights at freddys, withered foxy, jumpscare, horror prank, animatronic, scary
```

The second will find more people and puts trademarked terms in metadata under
your developer account. That is the same trade you already took on the asset
itself, but it is a separate, explicit choice — decide it rather than inheriting
it.

**YouTube video** is optional and is the single strongest listing asset for
something this visual. A silent 10-second capture of one scare would do it. Turn
advertisements off on the video, which Microsoft requires.

## Review

Certification takes **up to seven business days**. AMO cleared this extension in
under an hour, four times running; do not read Edge's silence against that
baseline. Status becomes "In the Store" on success.

## Gotchas worth knowing before you hit them

- **Partner Center throws opaque errors.** `Something went wrong. Please try
  again. correlationId : undefined` on the Properties page is a known one.
  Microsoft's own fix is to clear cache and cookies, or retry in an InPrivate
  window or a different browser.
- **The package is the only way to change name or short description.** Both are
  read-only in the dashboard. Changing either means editing
  `extension/manifest.base.json`, rebuilding, and re-uploading the zip.
- **One locale will appear** because the manifest uses hardcoded strings rather
  than `__MSG_*` placeholders and there is no `_locales` directory. That is
  expected and fine for an en-US-only listing.
- **Do not re-upload the Chrome zip.** It is byte-identical today, but the whole
  reason `edge` exists as a build target is that "identical" is an assumption
  that a future manifest change could quietly break. The test
  `builds Edge identically to Chrome` in `tests/extension/build-extension.test.mjs`
  is what holds that assumption honest.

## Recording the outcome

When the submission goes in, append the extension id, the listing URL, and the
dashboard link here — the way `docs/publishing-opera.md` records package 305717.
The next person to touch this should not have to go looking in Partner Center to
find out what state the listing is in.
