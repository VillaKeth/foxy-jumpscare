import { describe, it, expect, vi } from 'vitest';
import { attemptFire } from '../../extension/src/lib/fire.mjs';

function fakeBrowser({ tabs = [{ id: 7, url: 'https://example.com' }], executeScript } = {}) {
  return {
    tabs: { query: vi.fn(async () => tabs) },
    scripting: { executeScript: executeScript ?? vi.fn(async () => [{ result: 'injected' }]) },
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
  };
}

describe('attemptFire', () => {
  it('injects into the active tab and reports success', async () => {
    const browser = fakeBrowser();
    expect(await attemptFire(browser)).toBe(true);
    expect(browser.scripting.executeScript).toHaveBeenCalledOnce();

    const call = browser.scripting.executeScript.mock.calls[0][0];
    expect(call.target).toEqual({ tabId: 7 });
    expect(typeof call.func).toBe('function');
  });

  it('passes the overlay URL through to the page', async () => {
    const browser = fakeBrowser();
    await attemptFire(browser);
    const call = browser.scripting.executeScript.mock.calls[0][0];
    expect(call.args).toContain('chrome-extension://abc/overlay.html');
  });

  it('sends the injector as source text, not as a closure', async () => {
    // executeScript serialises func and re-creates it in the page, where module
    // scope does not exist. The injector has to travel as source.
    const browser = fakeBrowser();
    await attemptFire(browser);
    const call = browser.scripting.executeScript.mock.calls[0][0];
    const source = call.args.find((a) => typeof a === 'string' && a.includes('function'));
    expect(source).toMatch(/createElement/);
  });

  it('does not inject into a privileged page, and reports failure', async () => {
    const browser = fakeBrowser({ tabs: [{ id: 7, url: 'chrome://extensions' }] });
    expect(await attemptFire(browser)).toBe(false);
    expect(browser.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('reports failure when there is no active tab', async () => {
    const browser = fakeBrowser({ tabs: [] });
    expect(await attemptFire(browser)).toBe(false);
  });

  it('reports failure when injection throws', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => { throw new Error('Cannot access contents'); }),
    });
    expect(await attemptFire(browser)).toBe(false);
  });

  it('reports failure when executeScript returns nothing usable', async () => {
    const browser = fakeBrowser({ executeScript: vi.fn(async () => []) });
    expect(await attemptFire(browser)).toBe(false);
  });

  it('treats an already-present overlay as success', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => [{ result: 'already-present' }]),
    });
    expect(await attemptFire(browser)).toBe(true);
  });
});
