# Publishing to the Opera add-ons store

Everything for the submission is prepared. What is missing is an Opera account,
which only you can create — there is no API for this store, so no equivalent of
`npm run publish:firefox`. The upload is a web form.

## Before anything else: the account

Register at <https://auth.opera.com/account/signup>, then sign in to
<https://addons.opera.com/developer/>.

**Use a neutral identity — not the work email.** The same rule that applies to
the AMO listing applies here: the display name and contact email on the
developer account are public on every extension page. See `docs/publishing.md`.

## Manifest V3 is accepted

Settled by doing it on 2026-07-27: the MV3 package uploaded first try. The
forum reports of *"Manifest format version is not supported"*, and Opera's
manifest documentation still describing V2, are both out of date. No MV2 fork
is needed.

## Submitted listing

Package **305717**, slug `foxy-jumpscare`, extension id
`imdbnepnjfkfldahjmmhponddjbhmikm`, category Fun.
Dashboard: <https://addons.opera.com/developer/package/305717/>

## Dashboard behaviour worth knowing

- **Every text field is an inline editor.** Typing into it does not save —
  a green ✓ appears beside the field and has to be clicked. Check all of them
  before submitting; a field can look filled and still be unsaved.
- **The status heading lies after a successful submit.** It keeps saying
  "changes not submitted for the moderators review" until the page is reloaded.
  Submitting again returns `400 This version can not be submitted for
  moderation.`, which means *already submitted*, not *rejected*. Reload: the
  Submit button goes disabled and the status becomes "follow the conversation
  with moderators".
- **The permission analyzer flags `scripting` as unused.** `attemptFire` calls
  `browser.scripting.executeScript` where `browser` is a parameter, so the
  literal `chrome.scripting` never appears for static analysis to find. The
  permission is genuinely required — answer any moderator query in the
  Conversation tab rather than removing it.
- **The listing icon must be 64x64**, which the extension does not ship.
  Generate one by temporarily adding `64` to `SIZES` in `tools/make-icons.mjs`,
  then delete the file: shipping an icon the manifest never references would
  trip the "no unused files" criterion.

## What to upload

```
dist/packages/foxy-jumpscare-opera-v0.1.6.zip
```

Rebuild with `npm run build && npm run package` if the version has moved on.
The Opera package is the Chrome build with no `browser_specific_settings`;
Opera loads it unchanged.

## Listing fields

Reuse the approved AMO copy verbatim — it already passed one review, and it is
kept in `tools/amo-metadata.json`.

- **Name:** Foxy Jumpscare
- **Category:** Fun / Other
- **License:** All rights reserved. The code is ours; the video in the asset
  pack is not, so an open-source licence would claim rights we do not hold.
- **Summary:** A rare jumpscare while you browse. A 1 in 100,000 chance every
  active second.
- **Description:** the `description` field of `tools/amo-metadata.json`.

Lead the description with the warning that is already in that copy — a sudden
loud video with a scream, with photosensitivity and headphone cautions. Opera's
acceptance criteria expect an extension to state one clear purpose, and burying
the warning is the kind of thing that draws a reviewer's attention.

**Screenshots:** generate with

```powershell
$env:FOXY_CAPTURE='1'; npx playwright test _demo
```

which writes `docs/screenshots/` — the overlay firing over a realistic page at
three points in the lunge, plus the toolbar panel. That directory is gitignored
on purpose: the frames show the copyrighted asset.

## Review

Moderators test the extension by hand against the
[acceptance criteria](https://help.opera.com/en/extensions/acceptance-criteria/).
Two of those criteria are worth knowing in advance:

- *No redundant permissions.* Every permission in the manifest is load-bearing:
  `alarms` (the tick), `idle` (only count active seconds), `storage` (odds and
  countdown), `scripting` + `<all_urls>` (the overlay must reach any tab).
- *No obfuscated or minified code.* The build copies plain, readable
  JavaScript — nothing is bundled or minified, so there is no source-upload
  step to satisfy.
