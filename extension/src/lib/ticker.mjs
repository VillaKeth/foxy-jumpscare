/** Pure tick accounting and URL policy. No browser APIs. */

/** chrome.alarms will not schedule below one minute. */
export const TICK_SECONDS = 60;

const BLOCKED_SCHEME =
  /^(chrome|about|edge|devtools|view-source|chrome-extension|moz-extension|resource|data|blob):/i;

const BLOCKED_HOST = [
  /^https:\/\/chromewebstore\.google\.com/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/addons\.mozilla\.org/i,
];

/**
 * Credit elapsed active time against the countdown.
 *
 * remaining clamps at 0 rather than going negative, and shouldFire stays true
 * while it sits at 0. That is what lets a failed injection retry next tick
 * instead of silently spending the roll.
 *
 * Must stay identical to desktop/FoxyJumpscare.Core/Ticker.cs.
 */
export function creditTick(state, activeSeconds) {
  const remaining = Math.max(0, state.remaining - activeSeconds);
  return { remaining, shouldFire: remaining <= 0 };
}

/** Whether a content script can be injected into this URL at all. */
export function isInjectableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (BLOCKED_SCHEME.test(url)) return false;
  if (BLOCKED_HOST.some((re) => re.test(url))) return false;
  return /^https?:/i.test(url);
}
