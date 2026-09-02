import { describe, it, expect, vi } from 'vitest';
import { attemptFire } from '../../extension/src/lib/fire.mjs';

function fakeBrowser({
  tabs = [{ id: 7, url: 'https://example.com', active: true }],
  executeScript,
  createWindow,
  focused = true,
} = {}) {
  return {
    // The real query with { active: true, lastFocusedWindow: true } narrows to
    // the focused window's active tab; this fake models one window.
    tabs: { query: vi.fn(async (q = {}) => (q.active ? tabs.filter((t) => t.active) : tabs)) },
    scripting: { executeScript: executeScript ?? vi.fn(async () => [{ result: 'injected' }]) },
    windows: {
      create: createWindow ?? vi.fn(async () => ({ id: 1 })),
      getLastFocused: vi.fn(async () => ({ focused })),
    },
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
  };
}

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
        { id: 1, url: 'https://a.example', active: true },
        { id: 2, url: 'https://b.example' },
        { id: 3, url: 'https://c.example' },
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
        { id: 1, url: 'about:config' },
        { id: 2, url: 'https://ok.example', active: true },
        { id: 3, url: 'https://addons.mozilla.org/x' },
      ],
    });

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 2 });
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it('succeeds when only some injections throw', async () => {
    let call = 0;
    const browser = fakeBrowser({
      tabs: [
        { id: 1, url: 'https://a.example' },
        { id: 2, url: 'https://b.example', active: true },
      ],
      executeScript: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error('Cannot access contents');
        return [{ result: 'injected' }];
      }),
    });

    expect(await attemptFire(browser)).toBe(true);
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

  it('opens the standalone window by default, with no options passed', async () => {
    // The shipped default. attemptFire's own default has to match the stored
    // one in state.mjs, or the running extension and a freshly seeded store
    // disagree about what happens on a restricted tab.
    const browser = fakeBrowser({ tabs: [{ id: 1, url: 'about:config' }] });

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.windows.create).toHaveBeenCalledOnce();
  });

  it('opens a standalone window when no tab will take the overlay', async () => {
    const browser = fakeBrowser({ tabs: [{ id: 1, url: 'about:config' }] });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(true);
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
    expect(browser.windows.create).toHaveBeenCalledWith({
      url: 'chrome-extension://abc/overlay.html',
      type: 'popup',
      state: 'fullscreen',
    });
  });

  it('falls back to a window when every injection fails', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => { throw new Error('nope'); }),
    });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(true);
    expect(browser.windows.create).toHaveBeenCalledOnce();
  });

  it('reports failure when there are no tabs at all and no window can open', async () => {
    const browser = fakeBrowser({
      tabs: [],
      createWindow: vi.fn(async () => { throw new Error('no window'); }),
    });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(false);
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

  it('opens the standalone window when the ACTIVE tab is restricted, even though background tabs took the overlay', async () => {
    const browser = fakeBrowser({
      tabs: [
        { id: 1, url: 'https://addons.mozilla.org/x', active: true },
        { id: 2, url: 'https://ok.example' },
      ],
    });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(true);
    // background tab still gets it, so the scare follows a tab switch
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 2 });
    expect(browser.windows.create).toHaveBeenCalledOnce();
  });

  it('opens the standalone window when injection into the active tab fails', async () => {
    const browser = fakeBrowser({
      tabs: [
        { id: 1, url: 'https://a.example', active: true },
        { id: 2, url: 'https://b.example' },
      ],
      executeScript: vi.fn(async ({ target }) => {
        if (target.tabId === 1) throw new Error('tab is navigating');
        return [{ result: 'injected' }];
      }),
    });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(true);
    expect(browser.windows.create).toHaveBeenCalledOnce();
  });

  it('fires nothing at all when no browser window has focus', async () => {
    // The retry path can land on a tick while the whole browser sits in the
    // background, and until 0.1.11 it went ahead: it opened the standalone
    // window, on the reasoning that an overlay in a tab is invisible then and
    // only that window reaches the screen. It does reach the screen - and the
    // screen belongs to whatever the user actually switched to. A fullscreen
    // black rectangle and a scream over a game, a call or a full-screen video
    // is the single most intrusive thing this extension can do.
    //
    // The tab path is not a safe consolation either, which is why this bails
    // before injecting rather than merely declining the window: injection goes
    // to EVERY injectable tab, so a minimised browser played the scream once
    // per open tab, simultaneously, from tabs nobody could see.
    //
    // Nothing is lost by waiting. false leaves the roll unspent, so the scare
    // arrives on the next tick after they come back.
    const browser = fakeBrowser({ focused: false });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(false);
    expect(browser.windows.create).not.toHaveBeenCalled();
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not spend the roll when nothing user-visible happened', async () => {
    // Background tabs took the overlay but the active tab is restricted and
    // the window would not open: the user saw nothing, so the roll must
    // survive for the next tick.
    const browser = fakeBrowser({
      tabs: [
        { id: 1, url: 'about:config', active: true },
        { id: 2, url: 'https://ok.example' },
      ],
      createWindow: vi.fn(async () => { throw new Error('no window'); }),
    });

    expect(await attemptFire(browser, { allowStandaloneWindow: true })).toBe(false);
  });
});

// --- the standalone window can be switched off ----------------------------
//
// The standalone window is the only overlay that cannot be transparent: it has
// no page behind it, so it is painted black. It is on by default, because a
// scare that silently does nothing reads as a broken extension - but anyone
// who would rather never see a black screen can turn it off in the panel.
//
// Turning it off costs nothing: attemptFire reports false, the caller leaves
// the roll unspent, and the next tick fires transparently over the first
// ordinary tab the user lands on.

describe('attemptFire, standalone window switched off by the user', () => {
  it('does not open the standalone window when no tab will take the overlay', async () => {
    const browser = fakeBrowser({ tabs: [{ id: 1, url: 'about:config' }] });

    expect(await attemptFire(browser, { allowStandaloneWindow: false })).toBe(false);
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it('does not open the standalone window when the active tab is restricted', async () => {
    const browser = fakeBrowser({
      tabs: [
        { id: 1, url: 'https://addons.mozilla.org/x', active: true },
        { id: 2, url: 'https://ok.example' },
      ],
    });

    expect(await attemptFire(browser, { allowStandaloneWindow: false })).toBe(false);
    // The background tab still gets the overlay, so a tab switch mid-scream is
    // still covered. It just does not count as the user having seen it.
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it('does not open the standalone window when no browser window has focus', async () => {
    // Same answer with the setting off, for a different reason: an unfocused
    // browser declines before it gets this far. See the focus test above.
    const browser = fakeBrowser({ focused: false });

    expect(await attemptFire(browser, { allowStandaloneWindow: false })).toBe(false);
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it('still reports success when the overlay lands in the active tab', async () => {
    // The setting governs the fallback only. The ordinary transparent path is
    // untouched by it.
    const browser = fakeBrowser();

    expect(await attemptFire(browser, { allowStandaloneWindow: false })).toBe(true);
    expect(browser.windows.create).not.toHaveBeenCalled();
  });

  it('is the behaviour when the option is passed explicitly as false', async () => {
    const browser = fakeBrowser({ tabs: [{ id: 1, url: 'about:config' }] });

    expect(await attemptFire(browser, { allowStandaloneWindow: false })).toBe(false);
    expect(browser.windows.create).not.toHaveBeenCalled();
  });
});
