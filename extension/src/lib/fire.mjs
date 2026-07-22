import { isInjectableUrl } from './ticker.mjs';
import { injectOverlayFn } from './inject.mjs';

/**
 * Generous: the video is short, but a slow decode should not have the failsafe
 * yank the overlay mid-scream. The overlay reports 'ended' long before this on
 * the normal path.
 */
const FAILSAFE_MS = 8000;

/**
 * Put the overlay up across the whole browser. Returns whether it actually
 * happened - the caller uses this to decide whether the roll was spent. A
 * refused fire must not consume it.
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

  const injected = results.filter((r) => {
    if (r.status !== 'fulfilled') return false;
    const result = r.value?.[0]?.result;
    return result === 'injected' || result === 'already-present';
  }).length;

  if (injected > 0) return true;

  // Nothing anywhere would take it - every tab is a store page, a PDF, or
  // about:config. Fall back to a standalone fullscreen window so the scare
  // still lands. It cannot be transparent, but a black fullscreen Foxy beats
  // nothing at all.
  try {
    await browser.windows.create({
      url: iframeUrl,
      type: 'popup',
      state: 'fullscreen',
    });
    return true;
  } catch {
    return false;
  }
}
