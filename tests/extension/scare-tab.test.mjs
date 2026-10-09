import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  openScareTab, closeScareTab, onCloseRequest, CLOSE_SCARE_TAB,
} from '../../extension/src/lib/scare-tab.mjs';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';

/** Where Firefox serves this extension's pages. */
const FIREFOX = 'moz-extension://abc/';

/** The restricted tab the user is sitting on: a PDF, say. */
const PAGE = { id: 9, index: 3, windowId: 2, active: true, title: 'report.pdf', height: 599, width: 1280 };

/**
 * A browser with one window. Navigating a tab "loads" on the next tick and
 * reports `complete`, as the real thing does, unless `autoComplete` is off.
 */
function fakeBrowser({ create, capture, get, update, autoComplete = true, origin = 'chrome-extension://abc/' } = {}) {
  const listeners = new Set();
  const log = [];
  const fireUpdated = (id, change) => [...listeners].forEach((fn) => fn(id, change, { id }));
  const browser = {
    runtime: { getURL: (p) => `${origin}${p}` },
    tabs: {
      create: create ?? vi.fn(async (props) => ({ id: 15, ...props })),
      captureVisibleTab: capture,
      get: get ?? vi.fn(async (id) => ({ id, active: true })),
      update: update ?? vi.fn(async (id, props) => {
        log.push(['update', id, props]);
        if (props.url && autoComplete) setTimeout(() => fireUpdated(id, { status: 'complete' }), 0);
        return { id };
      }),
      remove: vi.fn(async (id) => { log.push(['remove', id]); }),
      onUpdated: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
  };
  return { browser, log, fireUpdated, listeners };
}

/** The URL the scare tab was opened with. */
const openedUrl = (browser) => new URL(browser.tabs.create.mock.calls[0][0].url);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('openScareTab', () => {
  it('opens the scare right beside the page, in front of the user', async () => {
    const { browser } = fakeBrowser();

    expect(await openScareTab(browser, PAGE)).toBe(true);
    expect(browser.tabs.create).toHaveBeenCalledOnce();
    expect(browser.tabs.create.mock.calls[0][0]).toMatchObject({
      windowId: 2,
      index: 4,
      openerTabId: 9,
      active: true,
    });
    expect(openedUrl(browser).pathname).toBe('/overlay.html');
  });

  it('tells the page it is a scare tab, and what to call itself', async () => {
    // The title rides in the query, so it must survive characters that mean
    // something there.
    const { browser } = fakeBrowser();
    await openScareTab(browser, { ...PAGE, title: 'Q&A #2 = 50% off' });

    expect(openedUrl(browser).searchParams.has('scare')).toBe(true);
    expect(openedUrl(browser).searchParams.get('title')).toBe('Q&A #2 = 50% off');
  });

  it('carries a photo of the page, and how tall the page was, to paint behind Foxy', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1920, height: 900, close() {} }));
    const { browser } = fakeBrowser({ capture: vi.fn(async () => JPEG), origin: FIREFOX });

    await openScareTab(browser, PAGE);
    expect(openedUrl(browser).hash).toBe(`#foxy&iw=1920&ih=900&ch=599&bg=${JPEG}`);
  });

  it('leaves the photo out where the browser would write it into history', async () => {
    // The photo rides in the URL. Chrome records extension pages in history,
    // full URL and all - measured, a photo fragment landed there intact - so
    // there a picture of the page would outlive the scare by however long the
    // user keeps history. Firefox never records moz-extension: pages at all,
    // short URL or long. Measured too.
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1920, height: 900, close() {} }));
    const capture = vi.fn(async () => JPEG);
    const { browser } = fakeBrowser({ capture });

    expect(await openScareTab(browser, PAGE)).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect(openedUrl(browser).hash).toBe('');
  });

  it('photographs the page as a JPEG', async () => {
    // A PNG of a photographic page is several times larger, for something on
    // screen for under a second.
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1920, height: 900, close() {} }));
    const capture = vi.fn(async () => JPEG);
    const { browser } = fakeBrowser({ capture, origin: FIREFOX });

    await openScareTab(browser, PAGE);
    expect(capture).toHaveBeenCalledWith(2, { format: 'jpeg', quality: 60 });
  });

  it('still opens, on black, when the page cannot be photographed', async () => {
    // The photo improves the scare; it is never a reason to lose one.
    const { browser } = fakeBrowser({ capture: vi.fn(async () => { throw new Error('denied'); }), origin: FIREFOX });

    expect(await openScareTab(browser, PAGE)).toBe(true);
    expect(openedUrl(browser).hash).toBe('');
  });

  it('reports failure when the tab cannot be opened, so the roll is not spent', async () => {
    const { browser } = fakeBrowser({ create: vi.fn(async () => { throw new Error('no'); }) });

    expect(await openScareTab(browser, PAGE)).toBe(false);
  });

  it('closes the tab from outside if the page never manages to', async () => {
    // overlay.js has its own hard stop; this is for a page wedged badly enough
    // that even that never runs. A stuck tab is better than a stuck fullscreen
    // window, but it is still not allowed.
    vi.useFakeTimers();
    const { browser } = fakeBrowser();
    await openScareTab(browser, PAGE);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(browser.tabs.remove).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
    // ...and the user is handed back to their page, not left on a dead tab.
    expect(browser.tabs.update).toHaveBeenCalledWith(9, { active: true });
  });

  it('leaves things alone if the tab already closed itself', async () => {
    vi.useFakeTimers();
    const { browser } = fakeBrowser({ get: vi.fn(async () => { throw new Error('Invalid tab ID'); }) });
    await openScareTab(browser, PAGE);

    await vi.advanceTimersByTimeAsync(11_000);
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(browser.tabs.update).not.toHaveBeenCalled();
  });
});

describe('closeScareTab', () => {
  it('puts the user back on their page before the scare tab goes', async () => {
    const { browser, log } = fakeBrowser();

    await closeScareTab(browser, { tabId: 15, returnTo: 9, wasActive: true });
    const back = log.findIndex(([op, id, p]) => op === 'update' && id === 9 && p.active === true);
    const gone = log.findIndex(([op, id]) => op === 'remove' && id === 15);
    expect(back).toBeGreaterThan(-1);
    expect(gone).toBeGreaterThan(back);
  });

  it('does not drag the user back if they had already switched away', async () => {
    const { browser } = fakeBrowser();

    await closeScareTab(browser, { tabId: 15, returnTo: 9, wasActive: false });
    expect(browser.tabs.update).not.toHaveBeenCalledWith(9, expect.anything());
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
  });

  it('blanks the tab and lets the blank page land before closing it', async () => {
    // Firefox keeps no closed tab whose whole history is about:blank. Closing
    // it any earlier records the scare, and Ctrl+Shift+T plays it again.
    const { browser, log, fireUpdated } = fakeBrowser({ autoComplete: false });

    const closing = closeScareTab(browser, { tabId: 15, returnTo: 9, wasActive: true });
    await vi.waitFor(() => expect(log).toContainEqual(
      ['update', 15, { url: 'about:blank', loadReplace: true }]));
    expect(browser.tabs.remove).not.toHaveBeenCalled();

    fireUpdated(15, { status: 'complete' });
    await closing;
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
  });

  it('does not mistake another tab finishing a load for its own', async () => {
    vi.useFakeTimers();
    const { browser, fireUpdated } = fakeBrowser({ autoComplete: false });

    const closing = closeScareTab(browser, { tabId: 15, returnTo: 9, wasActive: true });
    await vi.advanceTimersByTimeAsync(0);
    fireUpdated(9, { status: 'complete' });
    await vi.advanceTimersByTimeAsync(0);
    expect(browser.tabs.remove).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await closing;
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
  });

  it('gives up waiting for the blank page after half a second', async () => {
    vi.useFakeTimers();
    const { browser, listeners } = fakeBrowser({ autoComplete: false });

    const closing = closeScareTab(browser, { tabId: 15, returnTo: 9, wasActive: true });
    await vi.advanceTimersByTimeAsync(499);
    expect(browser.tabs.remove).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
    expect(listeners.size).toBe(0);
  });

  it('closes straight away where the browser refuses loadReplace', async () => {
    // Chrome rejects the unknown property outright. The tab must still go,
    // and not after a pointless wait for a load that is never coming.
    vi.useFakeTimers();
    const update = vi.fn((id, props) => {
      if (props.loadReplace) throw new TypeError("Unexpected property: 'loadReplace'");
      return Promise.resolve({ id });
    });
    const { browser, listeners } = fakeBrowser({ update });

    await closeScareTab(browser, { tabId: 15, returnTo: 9, wasActive: true });
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
    expect(listeners.size).toBe(0);
  });
});

describe('onCloseRequest', () => {
  const asking = { type: CLOSE_SCARE_TAB };
  const scareTab = {
    tab: { id: 15, active: true, windowId: 2, openerTabId: 9 },
    frameId: 0,
    url: 'chrome-extension://abc/overlay.html',
  };

  it('closes the scare tab that asked, and hands the user back to the tab that opened it', async () => {
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, asking, scareTab);
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
    expect(browser.tabs.update).toHaveBeenCalledWith(9, { active: true });
  });

  it('ignores a copy of the overlay inside a web page', async () => {
    // Its sender.tab is the user's own page. Obeying it would close that.
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, asking, {
      tab: { id: 4, active: true }, frameId: 3, url: 'chrome-extension://abc/overlay.html?muted',
    });
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('ignores any other page of the extension', async () => {
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, asking, { ...scareTab, url: 'chrome-extension://abc/panel.html' });
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('ignores a sender that is not in a tab at all', async () => {
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, asking, { url: 'chrome-extension://abc/overlay.html' });
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('ignores every other message', async () => {
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, { type: 'foxy:test-fire' }, scareTab);
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('hands the user back only to the tab that opened the scare', async () => {
    // overlay.html is reachable from web pages, so a page could load it in a
    // tab of its own and name any tab it liked. The opener is recorded by the
    // browser, and nothing the page says can change it.
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, { type: CLOSE_SCARE_TAB, returnTo: 4 }, scareTab);
    expect(browser.tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(browser.tabs.update).not.toHaveBeenCalledWith(4, expect.anything());
  });

  it('closes a tab nobody opened without sending the user anywhere', async () => {
    // Session restore brings tabs back without their opener.
    const { browser } = fakeBrowser();

    await onCloseRequest(browser, asking, { ...scareTab, tab: { id: 15, active: true, windowId: 2 } });
    expect(browser.tabs.remove).toHaveBeenCalledWith(15);
    expect(browser.tabs.update).not.toHaveBeenCalledWith(expect.any(Number), { active: true });
  });
});
