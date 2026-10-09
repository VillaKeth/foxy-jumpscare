import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Run as the browser runs it: a classic script, top to bottom, against the
// page's globals. A module (import/export) would fail to even parse here -
// which is the point, since module deferral is the bug the file exists for.
const SOURCE = readFileSync(new URL('../../extension/src/backdrop.js', import.meta.url), 'utf8');

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
const BASE = 'chrome-extension://abc/overlay.html';

/** Load backdrop.js the way overlay.html does, at `href`. */
function load(href, { framed = false, dpr = 1.5 } = {}) {
  let url = new URL(href);
  const location = {
    get href() { return url.href; },
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get hash() { return url.hash; },
  };
  const document = { title: 'foxy', documentElement: { style: {} } };
  const window = {
    location,
    document,
    devicePixelRatio: dpr,
    history: { replaceState: (_state, _unused, to) => { url = new URL(to, url); } },
  };
  window.parent = framed ? { parentPage: true } : window;
  runInNewContext(SOURCE, { window, document, URLSearchParams });
  return { window, document, background: document.documentElement.style.background, url: () => url.href };
}

const scareTab = (fragment = '', query = '?scare&title=report.pdf') => `${BASE}${query}${fragment}`;

describe('backdrop.js', () => {
  it('leaves a copy inside a web page alone, so it stays transparent', () => {
    const page = load(`${BASE}?muted`, { framed: true });

    expect(page.background).toBeUndefined();
    expect(page.url()).toBe(`${BASE}?muted`);
  });

  it('paints the scare tab black when there is no photo', () => {
    // Never the browser's blank canvas: that is a fullscreen white flash.
    expect(load(scareTab()).background).toBe('#000');
  });

  it('draws the photo 1:1, with the page bottom on the tab bottom', () => {
    // 1920x900 device pixels at 1.5x is 1280x600 CSS pixels. Bottom-aligned on
    // the page's own height: the new tab page shows a bookmarks bar the scare
    // tab does not, so this viewport is taller and grew upwards.
    const page = load(scareTab(`#foxy&iw=1920&ih=900&ch=599&bg=${PHOTO}`));

    expect(page.background).toBe(
      `#000 url("${PHOTO}") no-repeat 0 calc(100vh - 599px) / 1280px 600px`);
  });

  it('places a window-sized photo by the page height, not its own', () => {
    // Firefox photographs privileged about: pages onto a canvas the size of
    // the whole window, page at the top-left and black past it. Bottom-aligning
    // the PHOTO would draw that page ~80px too high.
    const page = load(scareTab(`#foxy&iw=1942&ih=1030&ch=450&bg=${PHOTO}`), { dpr: 2 });

    expect(page.background).toBe(
      `#000 url("${PHOTO}") no-repeat 0 calc(100vh - 450px) / 971px 515px`);
  });

  it('wears the title of the page it covers', () => {
    expect(load(scareTab()).document.title).toBe('report.pdf');
  });

  it('keeps its own title when the page title is unknown', () => {
    // Privileged pages hide their title from the extension.
    expect(load(scareTab('', '?scare&title=')).document.title).toBe('foxy');
  });

  it('tells overlay.js it is a scare tab', () => {
    expect(load(scareTab()).window.foxyScareTab).toBe(true);
  });

  it('takes the photo out of the address bar once it is painted', () => {
    // Out of the URL bar, the session history, and anything that would bring
    // the scare back from them.
    const page = load(scareTab(`#foxy&iw=1920&ih=900&ch=599&bg=${PHOTO}`));

    expect(page.url()).toBe(BASE);
    expect(page.background).toContain(PHOTO);
  });

  it('stays black when the fragment is damaged', () => {
    for (const fragment of [
      `#foxy&iw=1920&ih=900&bg=${PHOTO}`,              // no page height
      `#foxy&iw=1920&ih=900&ch=0&bg=${PHOTO}`,
      `#foxy&iw=x&ih=900&ch=599&bg=${PHOTO}`,
      '#foxy&iw=1920&ih=900&ch=599&bg=javascript:alert(1)',
      `#foxy&iw=1920&ih=900&ch=599`,                    // no photo
      `#nope&iw=1920&ih=900&ch=599&bg=${PHOTO}`,
    ]) {
      const page = load(scareTab(fragment));
      expect(page.background, fragment).toBe('#000');
      expect(page.url(), fragment).toBe(BASE);
    }
  });

  it('treats a top-level copy that was never opened as a scare as a stray', () => {
    // Session restore, a reload after the URL was stripped, or a typed URL.
    // overlay.js keeps a stray silent; this just keeps it black and unnamed.
    for (const href of [BASE, `${BASE}?title=x`, `${BASE}#foxy&iw=1920&ih=900&ch=599&bg=${PHOTO}`]) {
      const page = load(href);
      expect(page.background, href).toBe('#000');
      expect(page.document.title, href).toBe('foxy');
      expect(page.window.foxyScareTab, href).toBeUndefined();
    }
  });
});
