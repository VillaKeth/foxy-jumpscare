import { describe, it, expect, vi } from 'vitest';
import {
  backdropFragment, MAX_SHOT_CHARS,
} from '../../extension/src/lib/backdrop-shot.mjs';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';

/** The restricted tab being photographed. */
const PAGE = { id: 9, windowId: 2, height: 599 };

function fakeBrowser({ shot = JPEG, captureVisibleTab } = {}) {
  return { tabs: { captureVisibleTab: captureVisibleTab ?? vi.fn(async () => shot) } };
}

const measuring = (width, height) => vi.fn(async () => ({ width, height }));

describe('backdropFragment', () => {
  it('carries the photo, its size, and how tall the page was, photo last', async () => {
    // Image last and raw: base64 contains no #, % or &, so nothing in the
    // payload can be mistaken for another field and nothing needs decoding.
    expect(await backdropFragment(fakeBrowser(), PAGE, { measure: measuring(1920, 900) }))
      .toBe(`#foxy&iw=1920&ih=900&ch=599&bg=${JPEG}`);
  });

  it('photographs the window the page is in, as a JPEG', async () => {
    // A PNG of a photographic page is several times larger for no visible gain
    // in something on screen for under a second.
    const browser = fakeBrowser();
    await backdropFragment(browser, PAGE, { measure: measuring(1920, 900) });
    expect(browser.tabs.captureVisibleTab).toHaveBeenCalledWith(2, { format: 'jpeg', quality: 60 });
  });

  // Every one of these must degrade to plain black rather than throw. The scare
  // opening at all matters more than what is behind Foxy.

  it('gives up quietly when the capture is refused', async () => {
    const browser = fakeBrowser({
      captureVisibleTab: vi.fn(async () => { throw new Error('not allowed'); }),
    });
    expect(await backdropFragment(browser, PAGE, { measure: measuring(1920, 900) })).toBe('');
  });

  it('gives up when the capture cannot be measured', async () => {
    const measure = vi.fn(async () => { throw new Error('decode failed'); });
    expect(await backdropFragment(fakeBrowser(), PAGE, { measure })).toBe('');
  });

  it('gives up on anything that is not an image data URL', async () => {
    for (const bad of ['about:blank', '', 'data:text/html,<b>x', null, undefined, 42]) {
      const browser = fakeBrowser({ captureVisibleTab: vi.fn(async () => bad) });
      expect(await backdropFragment(browser, PAGE, { measure: measuring(10, 10) })).toBe('');
    }
  });

  it('refuses a capture too large to trust in a URL', async () => {
    // A truncated data URL paints as garbage; black is better than garbage.
    const huge = `data:image/jpeg;base64,${'A'.repeat(MAX_SHOT_CHARS)}`;
    expect(await backdropFragment(fakeBrowser({ shot: huge }), PAGE,
      { measure: measuring(1920, 900) })).toBe('');
  });

  it('gives up when the page height is unknown', async () => {
    // Without it there is no saying where the page sat, and a photo in the
    // wrong place is worse than none.
    for (const height of [undefined, 0, Number.NaN]) {
      expect(await backdropFragment(fakeBrowser(), { ...PAGE, height },
        { measure: measuring(1920, 900) })).toBe('');
    }
  });

  it('gives up where captureVisibleTab does not exist at all', async () => {
    const browser = fakeBrowser();
    delete browser.tabs.captureVisibleTab;
    expect(await backdropFragment(browser, PAGE, { measure: measuring(1920, 900) })).toBe('');
  });
});
