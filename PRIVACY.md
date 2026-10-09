# Privacy Policy — Foxy Jumpscare

**Last updated:** 9 October 2026
**Applies to:** the Foxy Jumpscare browser extension, all versions, on every store
it is listed at.

## The short version

Foxy Jumpscare collects nothing, transmits nothing, and makes no network requests
at all. It has no server to send anything to.

The only data it keeps is your own settings and a countdown, stored by your
browser on your own device. In Firefox it may also take a momentary picture of
the tab you are looking at, which it keeps for about a second and never saves
or sends — see "The picture of the page" below.

## What is stored, and where

Six values, in your browser's local extension storage (`chrome.storage.local`):

| Key | What it is |
| --- | --- |
| `oneInN` | The odds you chose, e.g. 100000 for 1-in-100,000. |
| `enabled` | Whether the extension is currently switched on. |
| `fallbackWindow` | Whether a scare may open in a tab of its own when the page you are on will not let the overlay in. |
| `fallbackChosen` | Whether you changed the setting above yourself, so a later default never overrides your choice. |
| `soundEveryTab` | Whether every open tab screams, or only the one you are looking at. |
| `remaining` | How many active seconds are left before the next scare. |

That is the complete list. None of it identifies you, and none of it leaves your
device. Uninstalling the extension removes it.

## What is not collected

No browsing history. No page contents. No URLs. No search queries. No cookies. No
IP address. No device or browser fingerprint. No account, no login, no email
address. No analytics, no telemetry, no crash reporting, no advertising
identifiers.

The extension contains no third-party SDK, tracker, or analytics library, and
loads no remotely hosted code. Everything it runs ships inside the package.

## Nothing is shared, because nothing is gathered

There is no data to sell, rent, share, or disclose — to anyone, including us. No
third party receives anything, because the extension never contacts one.

## Why it asks for the permissions it does

| Permission | Why it is needed |
| --- | --- |
| `storage` | To remember the settings above between browser restarts. |
| `alarms` | To count down while you browse. MV3 service workers are terminated when idle, so a timer alone cannot survive; alarms are the supported replacement. |
| `idle` | To pause the countdown when you are away from the keyboard or your screen is locked, so a tab left open overnight does not burn your odds. It reads only a three-state status — active, idle, or locked. |
| `scripting` | To place the overlay in the tab you are currently looking at when a scare fires. Nothing is injected until that moment. |
| `<all_urls>` | A scare can land on whatever page you happen to be on, which is not known ahead of time, so the overlay must be placeable in any tab. It is used to *display* the overlay, to check whether the current tab permits it, and — in Firefox, on a page that will not take the overlay — to take the momentary picture described below. It is never used to collect or transmit page content. |

The extension requests no other permissions.

## The overlay

The scare is rendered in an iframe served from the extension's own package, not
injected into the page's own document. The iframe is a separate origin: the page
cannot reach into it, and it cannot reach into the page. It draws over the page
and removes itself when the clip ends. It does not read, modify, or transmit
anything about the page underneath it.

## The picture of the page (Firefox only)

Some pages will not take the overlay — PDFs, the new tab page, Firefox's own
`about:` pages, and addons.mozilla.org. When a scare lands on one of them, it
opens in a tab of its own right beside the page instead, and closes itself about
a second later. So that this tab looks like your page rather than a black
screen, the extension takes one picture of the tab you are looking at
(`tabs.captureVisibleTab`) and shows Foxy over it.

The picture is handed to that one tab in its address, which the tab clears as
soon as it has drawn the picture. Firefox does not record the extension's own
pages in its history, and the tab is closed so that it does not appear under
Recently Closed either. The extension never saves the picture and never sends
it anywhere.

On Chrome, Edge and Opera no picture is taken. Those browsers would write the
tab's address, picture included, into your history, so there the tab shows
Foxy over black instead. Unticking "Scare me even with no page to draw on" in
the panel turns this tab, and the picture, off entirely.

## Children

The extension is a horror prank containing a sudden loud scream and a startling
image. It is not directed at children, and it collects no data from anyone
regardless of age.

## Changes

Any future change to this policy will be published in this file, with the date at
the top updated. The file's revision history is public in the repository.

## Source and contact

The complete source is public at
<https://github.com/VillaKeth/foxy-jumpscare>. Every claim on this page can be
checked against it — the absence of network calls in particular.

Questions or reports: open an issue at
<https://github.com/VillaKeth/foxy-jumpscare/issues>.
