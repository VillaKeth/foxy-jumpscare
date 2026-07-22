# Installing Foxy Jumpscare in Firefox

Two audiences here: you, testing it on your own machine, and whoever you send
it to.

---

## Why there is an .xpi at all

Release Firefox refuses to permanently install an unsigned extension, and
unlike Chrome there is no developer-mode toggle that changes that. Mozilla's
supported answer is **unlisted signing**: they sign the package, but it is never
published on addons.mozilla.org and never appears in search. You hand out the
file yourself.

This is the better route for a private build. There is no Chrome equivalent —
Chrome's closest option is an unlisted store listing, which still means a
review, a $5 developer account, and a public URL.

---

## Trying it right now (no account, nothing installed)

```powershell
npm run build
npm run dev:firefox
```

Opens a fresh Firefox with the extension temporarily loaded. **It disappears
when that Firefox closes** — this is for a look, not for living with.

---

## Building the .xpi

One-time setup:

1. Sign in at <https://addons.mozilla.org/developers/addon/api/key/> (free, and
   you do not have to publish anything to hold credentials).
2. Generate credentials.
3. Save them to `.amo-credentials.json` in the repo root:

   ```json
   { "apiKey": "user:12345678:123", "apiSecret": "a1b2c3..." }
   ```

   That file is gitignored. Anyone holding those two strings can publish an
   update under this add-on's id, so treat them like a password.

Then, every time:

```powershell
npm run build
npm run sign:firefox
```

The signed `.xpi` lands in `dist/packages/`. Signing usually takes under a
minute — unlisted submissions are validated automatically, not reviewed by a
human.

**Bump `version` in `extension/manifest.base.json` before every re-sign.** AMO
will not issue a second signature for a version number it has already seen.

---

## Installing it

Drag the `.xpi` onto a Firefox window, or `Ctrl+O` and pick it. Firefox shows a
permission prompt — "Access your data for all websites" is the overlay needing
to be able to draw on whatever page you are on when it fires.

Then **pin the toolbar icon**: Firefox hides new extensions behind the puzzle
piece by default. Click it, find Foxy Jumpscare, and choose Pin to Toolbar.
Without that there is no obvious way back to the settings.

---

## The panel

Click the fox in the toolbar.

| Control | What it does |
|---|---|
| **Enabled** | Off means nothing fires, ever. The countdown stops too. |
| **Rarity** | Presets from Ultra-rare (~10 weeks) to Terraria-faithful (~2h46m of browsing). |
| **Custom** | Any 1-in-N you like. `60` fires within a minute or two — good for showing someone. |
| **Test it now** | Fires immediately. Does **not** spend the real countdown. |

Changing the rarity restarts the countdown. It has to — a countdown drawn at
the old odds would keep running against the new setting, and the change would
look like it did nothing for a week.

"Active browsing" is literal: the countdown only advances while Firefox is
focused and you are not idle. It does not run while you are in another app,
away from the machine, or locked.

---

## What to tell whoever you send it to

> This is a jumpscare extension. Somewhere in the next week or so, at random,
> a screaming animatronic fox takes over your browser window for about a
> second, then goes away on its own.
>
> Don't install it if you're photosensitive, and think about it before you
> install it on a work laptop or wear headphones all day.
>
> Drag the file onto Firefox to install. Click the fox icon to change how often
> it happens, or to turn it off.

---

## Updates

Unlisted add-ons do not auto-update unless the manifest points at an update
manifest you host. This one deliberately doesn't. A new version means sending
out a new `.xpi`.

## Uninstalling

`about:addons` → Extensions → Foxy Jumpscare → Remove. Settings and countdown
go with it.
