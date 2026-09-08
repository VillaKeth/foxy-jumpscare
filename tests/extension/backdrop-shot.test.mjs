import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  backdropFragment, placeShot, MAX_SHOT_CHARS, SHOT_QUALITY,
} from '../../extension/src/lib/backdrop-shot.mjs';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';

function fakeBrowser({
  shot = JPEG,
  captureVisibleTab,
  win = { left: 0, top: 0, width: 1920, height: 1080 },
} = {}) {
  return {
    tabs: { captureVisibleTab: captureVisibleTab ?? vi.fn(async () => shot) },
    windows: { getLastFocused: vi.fn(async () => win) },
  };
}

const measuring = (width, height) => vi.fn(async () => ({ width, height }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('placeShot', () => {
  it('puts the viewport back where it was under the browser chrome', () => {
    // A maximised 1920x1080 window whose content area is 1920x950: the missing
    // 130px is the tab strip and toolbar, all of it above the page.
    expect(placeShot({
      win: { left: 0, top: 0, width: 1920, height: 1080 },
      shot: { width: 1920, height: 950 },
    })).toEqual({ x: 0, y: 130, width: 1920, height: 950 });
  });

  it('accounts for a window that is not at the origin', () => {
    expect(placeShot({
      win: { left: 200, top: 100, width: 1000, height: 800 },
      shot: { width: 1000, height: 700 },
    })).toEqual({ x: 200, y: 200, width: 1000, height: 700 });
  });

  it('divides a side border evenly and takes the same off the bottom', () => {
    // 16px narrower than the window means 8px each side, so 8px below too.
    expect(placeShot({
      win: { left: 0, top: 0, width: 1016, height: 800 },
      shot: { width: 1000, height: 700 },
    })).toEqual({ x: 8, y: 92, width: 1000, height: 700 });
  });

  it('converts device pixels to CSS pixels', () => {
    // captureVisibleTab returns device pixels; window bounds are CSS pixels.
    // Skipping this scales the photo by the display scaling factor and the
    // page lands visibly wrong on every HiDPI screen.
    expect(placeShot({
      win: { left: 0, top: 0, width: 1280, height: 720 },
      shot: { width: 2560, height: 1200 },
      dpr: 2,
    })).toEqual({ x: 0, y: 120, width: 1280, height: 600 });
  });

  it('refuses a zero-sized capture rather than dividing by it', () => {
    expect(placeShot({
      win: { left: 0, top: 0, width: 1920, height: 1080 },
      shot: { width: 0, height: 0 },
    })).toBeNull();
  });
});

describe('backdropFragment', () => {
  it('carries the geometry and the image, image last', () => {
    // Image last and raw: base64 contains no #, % or &, so nothing in the
    // payload can be mistaken for another field and nothing needs decoding.
    // Percent-encoding it would inflate every + / and = for no benefit.
    return backdropFragment(fakeBrowser(), { measure: measuring(1920, 950) })
      .then((fragment) => {
        expect(fragment.startsWith('#foxy&')).toBe(true);
        expect(fragment).toContain('x=0');
        expect(fragment).toContain('y=130');
        expect(fragment).toContain('w=1920');
        expect(fragment).toContain('h=950');
        expect(fragment.endsWith(`&bg=${JPEG}`)).toBe(true);
        expect(fragment.indexOf('&bg=')).toBe(fragment.lastIndexOf('&bg='));
      });
  });

  it('asks for a JPEG, not a PNG', async () => {
    // A PNG of a photographic page is several times larger for no visible
    // gain in something on screen for under a second.
    const browser = fakeBrowser();
    await backdropFragment(browser, { measure: measuring(1920, 950) });
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(null, {
      format: 'jpeg',
      quality: SHOT_QUALITY,
    });
  });

  // Every one of these must degrade to plain black rather than throw. The
  // window opening at all matters more than what is behind Foxy.

  it('gives up quietly when the capture is refused', async () => {
    const browser = fakeBrowser({
      captureVisibleTab: vi.fn(async () => { throw new Error('not allowed'); }),
    });
    expect(await backdropFragment(browser, { measure: measuring(1920, 950) })).toBe('');
  });

  it('gives up when the capture cannot be measured', async () => {
    const measure = vi.fn(async () => { throw new Error('decode failed'); });
    expect(await backdropFragment(fakeBrowser(), { measure })).toBe('');
  });

  it('gives up on anything that is not an image data URL', async () => {
    for (const bad of ['about:blank', '', 'data:text/html,<b>x', null, undefined, 42]) {
      const browser = fakeBrowser({ captureVisibleTab: vi.fn(async () => bad) });
      expect(await backdropFragment(browser, { measure: measuring(10, 10) })).toBe('');
    }
  });

  it('refuses a capture too large to trust in a URL', async () => {
    // A truncated data URL paints as garbage; black is better than garbage.
    const huge = `data:image/jpeg;base64,${'A'.repeat(MAX_SHOT_CHARS)}`;
    expect(await backdropFragment(fakeBrowser({ shot: huge }),
      { measure: measuring(1920, 950) })).toBe('');
  });

  it('gives up when the window bounds are unknown', async () => {
    expect(await backdropFragment(fakeBrowser({ win: {} }),
      { measure: measuring(1920, 950) })).toBe('');
  });

  it('gives up where captureVisibleTab does not exist at all', async () => {
    const browser = fakeBrowser();
    delete browser.tabs.captureVisibleTab;
    expect(await backdropFragment(browser, { measure: measuring(1920, 950) })).toBe('');
  });
});

describe('backdrop.js, the head script that consumes it', () => {
  const source = readFileSync(
    new URL('../../extension/src/backdrop.js', import.meta.url), 'utf8');

  it('agrees with the fragment this module writes', () => {
    expect(source).toMatch(/#foxy&/);
    expect(source).toMatch(/&bg=/);
  });

  it('paints black before it looks at the fragment', () => {
    // Order is the guarantee: if anything below is wrong the window is black,
    // never white and never a broken image.
    const black = source.indexOf("background = '#000'");
    const frag = source.indexOf('location.hash');
    expect(black).toBeGreaterThan(-1);
    expect(frag).toBeGreaterThan(black);
  });

  it('is still a classic script that only acts in a standalone window', () => {
    // The deferral of a module is the exact bug this file exists to avoid, and
    // an iframe must stay transparent.
    expect(source).toMatch(/window\.parent === window/);
    expect(source).not.toMatch(/\bimport\b|\bexport\b/);
  });
});
