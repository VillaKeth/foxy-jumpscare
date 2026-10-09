import { describe, it, expect, vi } from 'vitest';
import { attemptFire } from '../../extension/src/lib/fire.mjs';

/** A tab of one window, with the fields the scare tab is placed by. */
const tab = (id, url, extra = {}) => ({ id, url, index: id - 1, windowId: 1, height: 600, ...extra });

function fakeBrowser({
  tabs = [tab(7, 'https://example.com', { active: true })],
  executeScript,
  createTab,
  focused = true,
} = {}) {
  return {
    tabs: {
      // The real query with { active: true, lastFocusedWindow: true } narrows to
      // the focused window's active tab; this fake models one window.
      query: vi.fn(async (q = {}) => (q.active ? tabs.filter((t) => t.active) : tabs)),
      create: createTab ?? vi.fn(async (props) => ({ id: 99, ...props })),
      get: vi.fn(async (id) => ({ id, active: true })),
      update: vi.fn(async (id) => ({ id })),
      remove: vi.fn(async () => {}),
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    scripting: { executeScript: executeScript ?? vi.fn(async () => [{ result: 'injected' }]) },
    windows: { getLastFocused: vi.fn(async () => ({ focused })) },
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
  };
}

/** The URL the scare tab was opened with, if one was. */
const scareTabUrl = (browser) => new URL(browser.tabs.create.mock.calls[0][0].url);

/** The overlay URL each tab was handed, keyed by tab id. */
const urlsByTab = (browser) => Object.fromEntries(
  browser.scripting.executeScript.mock.calls.map(([call]) => [call.target.tabId, call.args[0]])
);

describe('attemptFire', () => {
  it('injects into the tab and reports success', async () => {
    const browser = fakeBrowser();
    expect(await attemptFire(browser)).toBe(true);
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 7 });
  });

  it('injects into every injectable tab, not just the active one', async () => {
    // Scoping this to the active tab meant the scare did nothing whenever you
    // were sitting on a restricted page, and did not follow a tab switch.
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://a.example', { active: true }),
        tab(2, 'https://b.example'),
        tab(3, 'https://c.example'),
      ],
    });

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.scripting.executeScript).toHaveBeenCalledTimes(3);
    const ids = browser.scripting.executeScript.mock.calls.map((c) => c[0].target.tabId);
    expect(ids.sort()).toEqual([1, 2, 3]);
  });

  it('skips privileged tabs but still fires into the rest', async () => {
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'about:config'),
        tab(2, 'https://ok.example', { active: true }),
        tab(3, 'https://addons.mozilla.org/x'),
      ],
    });

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 2 });
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('succeeds when only some injections throw', async () => {
    // Keyed on the tab, not on call order: the active tab is injected first
    // now, so ordinal matching would be testing the schedule rather than the
    // behaviour. A background tab failing must not cost the visible scare.
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://a.example'),
        tab(2, 'https://b.example', { active: true }),
      ],
      executeScript: vi.fn(async ({ target }) => {
        if (target.tabId === 1) throw new Error('Cannot access contents');
        return [{ result: 'injected' }];
      }),
    });

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('does not make the scare tab wait for background tabs', async () => {
    // The fallback path's delay was this: one Promise.allSettled over every
    // injectable tab, awaited in full before the fallback could even start.
    // Measured 226-245ms against 101-170ms for the fallback alone.
    //
    // The background tab here never answers, which is the pathological version
    // of a tab that is navigating or slow to wake. Under the old code this test
    // hangs until the suite times out; the scare must not be hostage to it.
    let releaseBackground;
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'about:config', { active: true }),
        tab(2, 'https://slow.example'),
      ],
      executeScript: vi.fn(({ target }) =>
        target.tabId === 2
          ? new Promise((resolve) => { releaseBackground = resolve; })
          : Promise.resolve([{ result: 'injected' }])),
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(true);
    expect(browser.tabs.create).toHaveBeenCalledOnce();
    expect(browser.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 2 } }));

    releaseBackground?.([{ result: 'injected' }]);
  });

  it('passes the injector directly rather than through an eval wrapper', async () => {
    // MV3 runs injected code under the extension's CSP, which has no
    // 'unsafe-eval'. A new Function(...) wrapper evaluates to null instead of
    // throwing, so the failure is silent - guard against reintroducing it.
    const browser = fakeBrowser();
    await attemptFire(browser);
    const call = browser.scripting.executeScript.mock.calls[0][0];
    expect(call.func.toString()).toMatch(/createElement/);
    expect(call.func.toString()).not.toMatch(/new Function/);
  });

  it('passes the overlay URL through to the page', async () => {
    const browser = fakeBrowser();
    await attemptFire(browser);
    expect(browser.scripting.executeScript.mock.calls[0][0].args)
      .toContain('chrome-extension://abc/overlay.html');
  });

  // These cover the fallback itself. It is on by default, so passing the
  // option is redundant here - it is passed anyway to say out loud which
  // behaviour each test is pinning. Switching it off is covered by its own
  // describe block at the bottom of this file.

  it('opens the scare tab by default, with no options passed', async () => {
    // The shipped default. attemptFire's own default has to match the stored
    // one in state.mjs, or the running extension and a freshly seeded store
    // disagree about what happens on a restricted tab.
    const browser = fakeBrowser({ tabs: [tab(1, 'about:config', { active: true })] });

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.tabs.create).toHaveBeenCalledOnce();
  });

  it('opens the scare in a tab beside the page when the page will not take the overlay', async () => {
    // Not a fullscreen window: that blacked out the tab strip, the toolbar and
    // the taskbar for the length of the scare. A tab replaces only the page.
    const browser = fakeBrowser({
      tabs: [tab(1, 'https://a.example'), tab(2, 'about:config', { active: true })],
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(true);
    expect(browser.tabs.create.mock.calls[0][0]).toMatchObject({
      windowId: 1, index: 2, openerTabId: 2, active: true,
    });
    expect(scareTabUrl(browser).pathname).toBe('/overlay.html');
    expect(scareTabUrl(browser).searchParams.has('scare')).toBe(true);
  });

  it('falls back to a scare tab when injecting into the page fails', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => { throw new Error('nope'); }),
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(true);
    expect(browser.tabs.create).toHaveBeenCalledOnce();
  });

  it('reports failure when there is no tab to open the scare beside', async () => {
    const browser = fakeBrowser({ tabs: [] });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('reports failure when the scare tab cannot be opened', async () => {
    const browser = fakeBrowser({
      tabs: [tab(1, 'about:config', { active: true })],
      createTab: vi.fn(async () => { throw new Error('no tab'); }),
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(false);
  });

  it('treats an already-present overlay as success', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => [{ result: 'already-present' }]),
    });
    expect(await attemptFire(browser)).toBe(true);
  });

  // --- the scare must land where the user is looking ------------------------
  //
  // "Heard it, never saw it": a fire while the active tab is restricted put
  // the overlay only in background tabs, whose audio plays from tabs the user
  // cannot see. Background-tab injections alone must not count as fired.

  it('opens the scare tab when the ACTIVE tab is restricted, even though background tabs took the overlay', async () => {
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://addons.mozilla.org/x', { active: true }),
        tab(2, 'https://ok.example'),
      ],
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(true);
    // background tab still gets it, so the scare follows a tab switch
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 2 });
    expect(browser.tabs.create).toHaveBeenCalledOnce();
  });

  it('opens the scare tab when injection into the active tab fails', async () => {
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://a.example', { active: true }),
        tab(2, 'https://b.example'),
      ],
      executeScript: vi.fn(async ({ target }) => {
        if (target.tabId === 1) throw new Error('tab is navigating');
        return [{ result: 'injected' }];
      }),
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(true);
    expect(browser.tabs.create).toHaveBeenCalledOnce();
  });

  it('fires nothing at all when no browser window has focus', async () => {
    // The retry path can land on a tick while the whole browser sits in the
    // background, and until 0.1.10 it went ahead: it opened the fallback - a
    // fullscreen window then - on the reasoning that an overlay in a tab is
    // invisible then and only that window reaches the screen. It does reach the
    // screen - and the screen belongs to whatever the user actually switched
    // to. A fullscreen black rectangle and a scream over a game, a call or a
    // full-screen video is the single most intrusive thing this extension can
    // do.
    //
    // Injecting is not a safe consolation either, which is why this bails
    // before injecting rather than merely declining the fallback: injection goes
    // to EVERY injectable tab, so a minimised browser played the scream once
    // per open tab, simultaneously, from tabs nobody could see.
    //
    // Nothing is lost by waiting. false leaves the roll unspent, so the scare
    // arrives on the next tick after they come back.
    const browser = fakeBrowser({ focused: false });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not spend the roll when nothing user-visible happened', async () => {
    // Background tabs took the overlay but the active tab is restricted and
    // the scare tab would not open: the user saw nothing, so the roll must
    // survive for the next tick.
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'about:config', { active: true }),
        tab(2, 'https://ok.example'),
      ],
      createTab: vi.fn(async () => { throw new Error('no tab'); }),
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(false);
  });
});

// --- the scare tab can be switched off --------------------------------------
//
// The scare tab is the only overlay that cannot be transparent: it has no page
// behind it, only a photo of one, or black when the photo cannot be taken. It
// is on by default, because a scare that silently does nothing reads as a
// broken extension - but anyone who would rather Foxy only ever appeared over a
// live page can turn it off in the panel.
//
// Turning it off costs nothing: attemptFire reports false, the caller leaves
// the roll unspent, and the next tick fires transparently over the first
// ordinary tab the user lands on.

describe('attemptFire, scare tab switched off by the user', () => {
  it('does not open the scare tab when the page will not take the overlay', async () => {
    const browser = fakeBrowser({ tabs: [tab(1, 'about:config', { active: true })] });

    expect(await attemptFire(browser, { allowFallback: false })).toBe(false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('does not open the scare tab when the active tab is restricted', async () => {
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://addons.mozilla.org/x', { active: true }),
        tab(2, 'https://ok.example'),
      ],
    });

    expect(await attemptFire(browser, { allowFallback: false })).toBe(false);
    // The background tab still gets the overlay, so a tab switch mid-scream is
    // still covered. It just does not count as the user having seen it.
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('does not open the scare tab when no browser window has focus', async () => {
    // Same answer with the setting off, for a different reason: an unfocused
    // browser declines before it gets this far. See the focus test above.
    const browser = fakeBrowser({ focused: false });

    expect(await attemptFire(browser, { allowFallback: false })).toBe(false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('still reports success when the overlay lands in the active tab', async () => {
    // The setting governs the fallback only. The ordinary transparent path is
    // untouched by it.
    const browser = fakeBrowser();

    expect(await attemptFire(browser, { allowFallback: false })).toBe(true);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('is the behaviour when the option is passed explicitly as false', async () => {
    const browser = fakeBrowser({ tabs: [tab(1, 'about:config', { active: true })] });

    expect(await attemptFire(browser, { allowFallback: false })).toBe(false);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });
});

// --- one scream, not one per tab --------------------------------------------
//
// Every injectable tab gets the overlay, so a tab switch mid-scream still lands
// on Foxy - but every copy used to carry its own soundtrack. Ten open tabs was
// ten screams a few milliseconds apart, from tabs nobody could see. Only the
// scare in front of the user plays sound now; the rest are silent copies that
// exist to be switched to. Anyone who wants the old chorus can switch it back
// on in the panel.

describe('attemptFire, sound', () => {
  const AUDIBLE = 'chrome-extension://abc/overlay.html';
  const MUTED = 'chrome-extension://abc/overlay.html?muted';

  it('plays the sound only in the tab you are looking at', async () => {
    // No options: attemptFire's own default must be the stored default in
    // state.mjs, or a fresh install and a running extension disagree.
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://a.example'),
        tab(2, 'https://b.example', { active: true }),
        tab(3, 'https://c.example'),
      ],
    });

    expect(await attemptFire(browser)).toBe(true);
    expect(urlsByTab(browser)).toEqual({ 1: MUTED, 2: AUDIBLE, 3: MUTED });
  });

  it('keeps the sound for the scare tab and mutes the tabs behind it', async () => {
    // The path where it was worst: the fallback screamed, and so did every
    // background tab, all at once.
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'about:config', { active: true }),
        tab(2, 'https://b.example'),
      ],
    });

    expect(await attemptFire(browser, { allowFallback: true })).toBe(true);
    expect(urlsByTab(browser)).toEqual({ 2: MUTED });
    expect(scareTabUrl(browser).pathname).toBe('/overlay.html');
    expect(scareTabUrl(browser).searchParams.has('muted')).toBe(false);
  });

  it('screams from every tab when the user asked for that', async () => {
    const browser = fakeBrowser({
      tabs: [
        tab(1, 'https://a.example'),
        tab(2, 'https://b.example', { active: true }),
      ],
    });

    expect(await attemptFire(browser, { soundEveryTab: true })).toBe(true);
    expect(urlsByTab(browser)).toEqual({ 1: AUDIBLE, 2: AUDIBLE });
  });
});
