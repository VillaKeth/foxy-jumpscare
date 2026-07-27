import { isInjectableUrl } from './ticker.mjs';
import { injectOverlayFn } from './inject.mjs';

/**
 * Generous: the video is short, but a slow decode should not have the failsafe
 * yank the overlay mid-scream. The overlay reports 'ended' long before this on
 * the normal path.
 */
const FAILSAFE_MS = 8000;

/**
 * Put the overlay up across the whole browser. Returns whether the scare
 * landed somewhere the user can actually see - the caller uses this to decide
 * whether the roll was spent. A fire nobody could have seen must not consume
 * it.
 *
 * Every injectable tab in every window gets the overlay, not just the active
 * one. Scoping it to the active tab meant the scare silently did nothing
 * whenever you happened to be sitting on a restricted page, and it did not
 * follow you if you switched tabs while it was up.
 */
export async function attemptFire(browser) {
  const tabs = await browser.tabs.query({});
  const targets = tabs.filter((tab) => isInjectableUrl(tab.url));
  const iframeUrl = browser.runtime.getURL('overlay.html');

  const results = await Promise.allSettled(
    targets.map((tab) =>
      browser.scripting.executeScript({
        target: { tabId: tab.id },
        // Passed directly. An earlier version wrapped this in
        // `new Function(source)` so document/window could be handed in as
        // arguments; MV3 runs injected code under the extension's CSP, which
        // has no 'unsafe-eval', and the wrapper silently evaluated to null
        // instead of throwing. The injector reads the globals itself for that
        // reason.
        func: injectOverlayFn,
        args: [iframeUrl, FAILSAFE_MS],
      })
    )
  );

  const landed = new Set();
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const result = r.value?.[0]?.result;
    if (result === 'injected' || result === 'already-present') landed.add(targets[i].id);
  });

  // Spending the roll requires the scare to land IN FRONT of the user: the
  // active tab of a window that actually has focus. Counting any tab was the
  // "heard it, never saw it" bug - a fire while the active tab was restricted
  // (addons.mozilla.org, about:*) reached only background tabs, whose audio
  // plays from pages the user cannot see.
  const [activeTab] = await browser.tabs
    .query({ active: true, lastFocusedWindow: true })
    .catch(() => []);
  const win = await browser.windows.getLastFocused().catch(() => null);
  if (win?.focused && activeTab && landed.has(activeTab.id)) return true;

  // The user-facing scare has nowhere to live in a tab - the active tab is a
  // store page, a PDF, or about:config, or no browser window has focus at
  // all (the retry path can fire from the background). A standalone
  // fullscreen window carries it instead; safe to lean on since 0.1.1, when
  // the overlay page learned to tear itself down. It cannot be transparent,
  // but a black fullscreen Foxy beats nothing at all. Background-tab overlays
  // from above still cover a tab switch mid-scream.
  try {
    await browser.windows.create({
      url: iframeUrl,
      type: 'popup',
      state: 'fullscreen',
    });
    return true;
  } catch {
    // Nothing user-visible happened - leave the roll unspent so the next
    // tick retries.
    return false;
  }
}
