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

## Known risk: Manifest V3 may be refused

Read this before spending time on the listing.

This extension is Manifest V3 (`manifest_version: 3`). Opera's own manifest
documentation still describes **V2** as the format to target and does not
mention V3 at all, and developers report the upload form rejecting V3 packages
with *"Manifest format version is not supported"* and spurious schema errors on
valid V3 keys. Opera has separately said it is moving to an MV3-only store and
has stopped accepting new MV2 uploads.

Those two positions cannot both be true forever, and the only way to find out
which one the upload form implements today is to try it. So try the upload
first, before writing any listing copy.

If it is refused, there is no reasonable fix:

- Rewriting to MV2 is a real fork (service worker → background page,
  `action` → `browser_action`) **and** new MV2 uploads are banned, so it lands
  in a catch-22.
- The fallback is sideloading, which already works and is documented in
  `dist/packages/INSTALL_OPERA.txt`. Opera GX runs the MV3 build perfectly when
  installed by hand — the store is the only thing objecting.

## What to upload

```
dist/packages/foxy-jumpscare-opera-v0.1.2.zip
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
