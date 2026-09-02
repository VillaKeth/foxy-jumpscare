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
 *
 * `allowStandaloneWindow` governs the fallback at the bottom of this function
 * and nothing else. It defaults to true, matching the stored setting's default
 * in state.mjs, so the two cannot drift apart: pass nothing and you get the
 * behaviour the shipped extension has out of the box.
 */
export async function attemptFire(browser, { allowStandaloneWindow = true } = {}) {
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
  // scream once per open tab, all at once, from tabs nobody could see.
  //
  // Declining costs nothing. Reporting false leaves `remaining` at 0, so the
  // next tick tries again and lands the moment they are back in the browser -
  // the same bargain the standalone-window setting makes. A jumpscare is only
  // a jumpscare where the user is; anywhere else it is an interruption.
  const focusedWindow = await browser.windows.getLastFocused().catch(() => null);
  if (!focusedWindow?.focused) return false;

  const iframeUrl = browser.runtime.getURL('overlay.html');
  const inject = (tabId) =>
    browser.scripting.executeScript({
      target: { tabId },
      // Passed directly. An earlier version wrapped this in
      // `new Function(source)` so document/window could be handed in as
      // arguments; MV3 runs injected code under the extension's CSP, which
      // has no 'unsafe-eval', and the wrapper silently evaluated to null
      // instead of throwing. The injector reads the globals itself for that
      // reason.
      func: injectOverlayFn,
      args: [iframeUrl, FAILSAFE_MS],
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
    ? inject(activeTab.id).then(
        (r) => r?.[0]?.result === 'injected' || r?.[0]?.result === 'already-present',
        () => false
      )
    : Promise.resolve(false);

  // Every other tab, started now and deliberately never awaited. These cover a
  // tab switch mid-scream, which is worth having and worth nothing if it costs
  // the visible scare its timing. Failures are ordinary here - a tab can be
  // navigating, discarded, or privileged - so they are swallowed rather than
  // inspected; nothing downstream asks about them.
  for (const tab of tabs) {
    if (tab.id === activeTab?.id || !isInjectableUrl(tab.url)) continue;
    inject(tab.id).catch(() => {});
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
