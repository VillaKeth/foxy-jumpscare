import { isInjectableUrl } from './ticker.mjs';
import { injectOverlayFn } from './inject.mjs';

/**
 * Generous: the video is short, but a slow decode should not have the failsafe
 * yank the overlay mid-scream. The overlay reports 'ended' long before this on
 * the normal path.
 */
const FAILSAFE_MS = 8000;

/**
 * Try to put the overlay on screen. Returns whether it actually happened - the
 * caller uses this to decide whether the roll was spent. A refused injection
 * must not consume it.
 */
export async function attemptFire(browser) {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !isInjectableUrl(tab.url)) return false;

  const iframeUrl = browser.runtime.getURL('overlay.html');

  try {
    const [first] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      // Passed directly. An earlier version wrapped this in
      // `new Function(source)` so document/window could be handed in as
      // arguments; MV3 runs injected code under the extension's CSP, which has
      // no 'unsafe-eval', and the wrapper silently evaluated to null instead of
      // throwing. The injector reads the globals itself for that reason.
      func: injectOverlayFn,
      args: [iframeUrl, FAILSAFE_MS],
    });

    const result = first?.result;
    return result === 'injected' || result === 'already-present';
  } catch {
    // Restricted page, tab closed mid-flight, or a host that refuses
    // injection. Not exceptional - just retry on the next tick.
    return false;
  }
}
