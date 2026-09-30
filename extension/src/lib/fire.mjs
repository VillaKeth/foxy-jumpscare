import { isInjectableUrl } from './ticker.mjs';
import { injectOverlayFn } from './inject.mjs';
import { backdropFragment } from './backdrop-shot.mjs';

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
 * one, so the scare follows you if you switch tabs while it is up. Only the
 * one in front of the user makes a sound. Every copy used to carry its own
 * soundtrack, so ten open tabs was ten screams a few milliseconds apart, from
 * tabs nobody could see. The copies in background tabs are muted now unless
 * `soundEveryTab` asks for the old chorus back.
 *
 * `allowStandaloneWindow` governs the fallback at the bottom of this function
 * and nothing else. Both options default to their stored settings' defaults in
 * state.mjs, so the two cannot drift apart: pass nothing and you get the
 * behaviour the shipped extension has out of the box.
 */
export async function attemptFire(
  browser,
  { allowStandaloneWindow = true, soundEveryTab = false } = {}
) {
  // Nothing below reaches somebody who is not looking at the browser, and two
  // of the three paths actively intrude on whatever they ARE looking at.
  //
  // This used to run anyway, deliberately: the retry path can land on a tick
  // while the whole browser sits in the background, and the reasoning was that
  // only the standalone window reaches the screen at all then. True, and
  // exactly the problem - "the screen" is somebody's game, call or full-screen
  // video, and what it reaches them with is an opaque black rectangle and a
  // scream from an app they had put away. The tab path is no better unfocused:
  // it injects into EVERY injectable tab, so a minimised window played the
  // scream once per open tab, all at once, from tabs nobody could see. The
  // background copies are muted by default now, but even one scream from a
  // browser nobody is looking at is the same intrusion - and with
  // `soundEveryTab` on, it is still the whole chorus.
  //
  // Declining costs nothing. Reporting false leaves `remaining` at 0, so the
  // next tick tries again and lands the moment they are back in the browser -
  // the same bargain the standalone-window setting makes. A jumpscare is only
  // a jumpscare where the user is; anywhere else it is an interruption.
  const focusedWindow = await browser.windows.getLastFocused().catch(() => null);
  if (!focusedWindow?.focused) return false;

  const iframeUrl = browser.runtime.getURL('overlay.html');
  // overlay.js reads the flag and mutes before it calls play().
  const backgroundUrl = soundEveryTab ? iframeUrl : `${iframeUrl}?muted`;
  const inject = (tabId, url) =>
    browser.scripting.executeScript({
      target: { tabId },
      // Passed directly. An earlier version wrapped this in
      // `new Function(source)` so document/window could be handed in as
      // arguments; MV3 runs injected code under the extension's CSP, which
      // has no 'unsafe-eval', and the wrapper silently evaluated to null
      // instead of throwing. The injector reads the globals itself for that
      // reason.
      func: injectOverlayFn,
      args: [url, FAILSAFE_MS],
    });

  const [[activeTab], tabs] = await Promise.all([
    browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []),
    browser.tabs.query({}).catch(() => []),
  ]);

  // The active tab goes first and on its own, because it is the only one the
  // user can see and the only one the decision below turns on.
  //
  // This used to be one Promise.allSettled over every injectable tab, awaited
  // in full before anything else could happen. On the ordinary path that is
  // harmless - the injections run concurrently, so the visible one is not held
  // up by the rest. On the FALLBACK path it was the whole delay: the black
  // window could not even begin to open until a round trip to every background
  // tab had come back, which measured 226-245ms against 101-170ms for
  // windows.create on its own. The scare the user is about to see must never
  // queue behind scares nobody can.
  const landedActive = activeTab && isInjectableUrl(activeTab.url)
    ? inject(activeTab.id, iframeUrl).then(
        (r) => r?.[0]?.result === 'injected' || r?.[0]?.result === 'already-present',
        () => false
      )
    : Promise.resolve(false);

  // Every other tab, started now and deliberately never awaited. These cover a
  // tab switch mid-scream, which is worth having and worth nothing if it costs
  // the visible scare its timing. They are silent by default: the scream is
  // already playing from the tab the user was on, and background audio keeps
  // going after a switch. Failures are ordinary here - a tab can be
  // navigating, discarded, or privileged - so they are swallowed rather than
  // inspected; nothing downstream asks about them.
  for (const tab of tabs) {
    if (tab.id === activeTab?.id || !isInjectableUrl(tab.url)) continue;
    inject(tab.id, backgroundUrl).catch(() => {});
  }

  // Spending the roll requires the scare to land IN FRONT of the user: the
  // active tab, the window having already been checked for focus above.
  // Counting any tab was the "heard it, never saw it" bug - a fire while the
  // active tab was restricted (addons.mozilla.org, about:*) reached only
  // background tabs, whose audio plays from pages the user cannot see.
  if (await landedActive) return true;

  // The user-facing scare has nowhere to live in a tab - the active tab is a
  // store page, a PDF, or about:config. The user IS at the browser (checked
  // at the top); it is only this one page that will not take the overlay. A
  // standalone fullscreen window carries it instead; safe to lean on since
  // 0.1.1, when the overlay page learned to tear itself down. Background-tab
  // overlays from above still cover a tab switch mid-scream.
  //
  // That window is the one overlay that cannot be transparent - there is no
  // page behind it to composite over, so it is painted black - which makes it
  // a fullscreen black screen rather than the effect this extension is for.
  // It is on by default anyway: a scare that silently does nothing reads as a
  // broken extension, and a rare scare you miss entirely is worse than one
  // that arrives on a plain background. Anyone who disagrees can switch it off
  // in the panel, and this is the only thing that switch controls.
  //
  // Declining it is cheap: reporting false leaves the roll unspent, so the
  // next tick tries again and lands transparently on the first ordinary tab
  // the user opens. The scare arrives late rather than wrong.
  if (!allowStandaloneWindow) return false;

  return openStandaloneWindow(browser, iframeUrl);
}

/**
 * The fullscreen fallback window, opened without the corner flash.
 *
 * `{ state: 'fullscreen' }` on its own is the obvious spelling and it is what
 * shipped through 0.1.10. Firefox maps the popup at its DEFAULT size first and
 * applies fullscreen after, so a small window appears in the top-left corner
 * for a frame or two before it expands - long enough to see, and it announces
 * the scare before it lands, which is the one thing a jumpscare cannot afford.
 *
 * Creating it at explicit screen-sized bounds instead means the first size it
 * is ever mapped at is the whole screen: there is no smaller intermediate to
 * catch. `state` is then applied separately, because Firefox rejects the two
 * together outright - "state: fullscreen may not be combined with left, top,
 * width, or height". Measured, that second call costs 1-9ms, and creating this
 * way was FASTER overall besides: 112ms against 196ms.
 *
 * Off-screen-then-reveal was tried and does not work: `left: -30000` is clamped
 * straight back onto the display (it landed at 0,-48), so the window is visible
 * wherever you put it. Building it minimized and revealing when the video is
 * ready was also tried, and was four times WORSE - a minimized window never
 * reaches `loadeddata` in time, so it waited out the grace period and then paid
 * for a restore on top: 1324ms against 322ms cold.
 *
 * `screen` is read defensively. Firefox's MV3 background is a real page and has
 * it; Chrome's service worker does not, and there is no synchronous substitute
 * worth taking a dependency on. Without it this falls back to the plain
 * fullscreen create - the corner flash is a Firefox report, and a Chrome user
 * keeps exactly the behaviour they have today rather than a guessed geometry.
 */
async function openStandaloneWindow(browser, iframeUrl) {
  // Photograph the page first, so the window can composite over it instead of
  // replacing it with a black rectangle. Empty string means it could not be
  // taken, and the window falls back to black exactly as before - the capture
  // is an improvement to this path, never a requirement of it.
  const fragment = await backdropFragment(browser);
  const base = { url: iframeUrl + fragment, type: 'popup' };
  const width = globalThis.screen?.width;
  const height = globalThis.screen?.height;
  const sized = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

  let win;
  try {
    win = await browser.windows.create(
      sized ? { ...base, left: 0, top: 0, width, height } : { ...base, state: 'fullscreen' }
    );
  } catch {
    // Nothing user-visible happened - leave the roll unspent so the next
    // tick retries.
    return false;
  }

  // Already fullscreen on the fallback path; nothing left to do.
  if (!sized) return true;

  // Chrome off the window. If this fails the scare is still on screen at full
  // size, just with a title bar - worth reporting as landed rather than
  // throwing away a roll over trim.
  await browser.windows
    .update(win.id, { state: 'fullscreen' })
    .catch(() => {});
  return true;
}
