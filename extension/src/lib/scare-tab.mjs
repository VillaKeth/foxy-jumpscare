import { backdropFragment } from './backdrop-shot.mjs';

/**
 * The scare for a page that will not take the overlay: a tab of its own,
 * opened right beside that page and, in Firefox, painted with a photo of it.
 *
 * A PDF, the new tab page, about: pages and addons.mozilla.org all refuse
 * injection. This used to open a fullscreen popup window instead, which blacked
 * out the tab strip, the toolbar and the taskbar for the length of the scare,
 * took twice as long to appear, and drew privileged about: pages ~80px too high.
 * A tab in the same window replaces only the page area - the real tab strip and
 * toolbar stay where they are - so the photo covers exactly what it pictures.
 */

export const CLOSE_SCARE_TAB = 'foxy:close-scare-tab';

/**
 * Backstop for a scare tab that never closes itself. overlay.js has its own
 * hard stop at 8s; this only matters if the page is wedged past even that.
 */
const OUTSIDE_FAILSAFE_MS = 10_000;

/** How long closing waits for the blank page to land before closing anyway. */
const BLANK_WAIT_MS = 500;

/**
 * Open the scare beside `page`, the restricted tab the user is on, and in
 * front of them. Resolves to whether the tab opened: the caller spends the
 * roll on it, and nothing user-visible happens when it does not.
 *
 * `scare` tells the page it is one - a top-level copy without it is a stray,
 * and stays silent - and `title` is the page's own, so the tab strip shows a
 * duplicate rather than a stranger. Where to hand the user back to is not in
 * here: it is the tab's opener, which the browser records.
 */
export async function openScareTab(browser, page) {
  const base = browser.runtime.getURL('overlay.html');
  const query = `?scare&title=${encodeURIComponent(page.title ?? '')}`;
  const photo = historyIgnores(base) ? await backdropFragment(browser, page) : '';
  const url = base + query + photo;

  let tab;
  try {
    tab = await browser.tabs.create({
      windowId: page.windowId,
      index: page.index + 1,
      openerTabId: page.id,
      active: true,
      url,
    });
  } catch {
    return false;
  }

  setTimeout(async () => {
    const stillOpen = await browser.tabs.get(tab.id).catch(() => null);
    if (stillOpen) {
      await closeScareTab(browser, { tabId: tab.id, returnTo: page.id, wasActive: stillOpen.active });
    }
  }, OUTSIDE_FAILSAFE_MS);
  return true;
}

/**
 * Whether the browser keeps pages at `url` out of its history.
 *
 * The photo travels in the scare tab's URL, so it may only go where that URL
 * is never written down. Firefox records no moz-extension: page, however short
 * its URL. Chrome records extension pages like any other, full URL and all -
 * measured, a photo fragment landed in its history intact - and there the
 * picture of the page would outlive the scare for as long as history is kept.
 * Chromium browsers rarely have a photo to send anyway: they refuse to
 * photograph their own chrome:// pages, which is most of what refuses the
 * overlay there.
 */
function historyIgnores(url) {
  return url.startsWith('moz-extension:');
}

/**
 * Put the user back on their page, then get rid of the scare tab without it
 * landing in Recently Closed, where Ctrl+Shift+T would play it again.
 *
 * Back first, so they never see the blank page. Only if they are still on the
 * scare tab: someone who switched away mid-scare is not dragged back.
 *
 * Firefox keeps no closed tab whose whole history is about:blank, so the tab's
 * one entry is replaced with that before it goes, and the close waits for the
 * blank page to land. Chrome has no loadReplace and rejects the call; there it
 * simply closes, and overlay.js keeps a restored copy silent.
 */
export async function closeScareTab(browser, { tabId, returnTo, wasActive }) {
  if (wasActive && Number.isInteger(returnTo)) {
    try { await browser.tabs.update(returnTo, { active: true }); } catch { /* tab is gone */ }
  }

  const blank = nextLoad(browser, tabId, BLANK_WAIT_MS);
  try {
    await browser.tabs.update(tabId, { url: 'about:blank', loadReplace: true });
    await blank.landed;
  } catch {
    // No loadReplace here, or the tab is already gone. Close it as it is.
  } finally {
    blank.stop();
  }

  try { await browser.tabs.remove(tabId); } catch { /* already closed */ }
}

/** Resolves when `tabId` next finishes loading, or after `ms`, whichever is first. */
function nextLoad(browser, tabId, ms) {
  let stop;
  const landed = new Promise((resolve) => {
    const onUpdated = (id, change) => {
      if (id === tabId && change.status === 'complete') stop();
    };
    const timer = setTimeout(() => stop(), ms);
    stop = () => {
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
  });
  return { landed, stop };
}

/**
 * The background's answer to a scare tab asking to be closed.
 *
 * Only overlay.html loaded top-level in a tab may ask. Copies of the same page
 * also run as iframes inside ordinary web pages, and their `sender.tab` is the
 * user's own page - obeying one of those would close the page they were
 * reading. The tab to close is always the sender's own, and the tab to hand
 * the user back to is always its opener - never anything the message names.
 * overlay.html is reachable from web pages, so a page could load it top-level
 * and say whatever it liked.
 */
export function onCloseRequest(browser, message, sender) {
  if (message?.type !== CLOSE_SCARE_TAB) return undefined;
  if (!sender?.tab || sender.frameId !== 0) return undefined;
  if (sender.url?.split(/[?#]/)[0] !== browser.runtime.getURL('overlay.html')) return undefined;

  return closeScareTab(browser, {
    tabId: sender.tab.id,
    returnTo: sender.tab.openerTabId,
    wasActive: sender.tab.active,
  });
}
