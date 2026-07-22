import { describe, it, expect, vi } from 'vitest';
import { attemptFire } from '../../extension/src/lib/fire.mjs';

function fakeBrowser({
  tabs = [{ id: 7, url: 'https://example.com' }],
  executeScript,
  createWindow,
} = {}) {
  return {
    tabs: { query: vi.fn(async () => tabs) },
    scripting: { executeScript: executeScript ?? vi.fn(async () => [{ result: 'injected' }]) },
    windows: { create: createWindow ?? vi.fn(async () => ({ id: 1 })) },
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
        { id: 2, url: 'https://ok.example' },
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
      tabs: [{ id: 1, url: 'https://a.example' }, { id: 2, url: 'https://b.example' }],
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

  it('opens a standalone window when no tab will take the overlay', async () => {
    const browser = fakeBrowser({ tabs: [{ id: 1, url: 'about:config' }] });

    expect(await attemptFire(browser)).toBe(true);
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

    expect(await attemptFire(browser)).toBe(true);
    expect(browser.windows.create).toHaveBeenCalledOnce();
  });

  it('reports failure when there are no tabs at all and no window can open', async () => {
    const browser = fakeBrowser({
      tabs: [],
      createWindow: vi.fn(async () => { throw new Error('no window'); }),
    });

    expect(await attemptFire(browser)).toBe(false);
  });

  it('treats an already-present overlay as success', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => [{ result: 'already-present' }]),
    });
    expect(await attemptFire(browser)).toBe(true);
  });
});
