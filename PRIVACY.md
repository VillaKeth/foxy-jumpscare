# Privacy Policy — Foxy Jumpscare

**Last updated:** 25 August 2026
**Applies to:** the Foxy Jumpscare browser extension, all versions, on every store
it is listed at.

## The short version

Foxy Jumpscare collects nothing, transmits nothing, and makes no network requests
at all. It has no server to send anything to.

The only data it keeps is your own settings and a countdown, stored by your
browser on your own device.

## What is stored, and where

Four values, in your browser's local extension storage (`chrome.storage.local`):

| Key | What it is |
| --- | --- |
| `oneInN` | The odds you chose, e.g. 100000 for 1-in-100,000. |
| `enabled` | Whether the extension is currently switched on. |
| `fallbackWindow` | Whether you allowed the standalone window on pages that cannot be drawn on. |
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
| `storage` | To remember the four settings above between browser restarts. |
| `alarms` | To count down while you browse. MV3 service workers are terminated when idle, so a timer alone cannot survive; alarms are the supported replacement. |
| `idle` | To pause the countdown when you are away from the keyboard or your screen is locked, so a tab left open overnight does not burn your odds. It reads only a three-state status — active, idle, or locked. |
| `scripting` | To place the overlay in the tab you are currently looking at when a scare fires. Nothing is injected until that moment. |
| `<all_urls>` | A scare can land on whatever page you happen to be on, which is not known ahead of time, so the overlay must be placeable in any tab. It is used to *display* the overlay and to check whether the current tab permits it — never to read, collect, or transmit page content. |

The extension requests no other permissions.

## The overlay

The scare is rendered in a sandboxed iframe served from the extension's own
package, not injected into the page's own document. It draws over the page and
removes itself when the clip ends. It does not read, modify, or transmit anything
about the page underneath it.

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
