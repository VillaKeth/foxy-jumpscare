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
      // executeScript serialises this function and re-creates it inside the
      // page, where module scope does not exist. So the injector cannot be
      // passed directly - it travels as source text and is rebuilt on arrival,
      // which is also the only way to hand it the page's document/window.
      func: (source, url, failsafeMs) => {
        const fn = new Function(`return (${source})`)();
        return fn(document, window, url, failsafeMs);
      },
      args: [injectOverlayFn.toString(), iframeUrl, FAILSAFE_MS],
    });

    const result = first?.result;
    return result === 'injected' || result === 'already-present';
  } catch {
    // Restricted page, tab closed mid-flight, or a host that refuses
    // injection. Not exceptional - just retry on the next tick.
    return false;
  }
}
