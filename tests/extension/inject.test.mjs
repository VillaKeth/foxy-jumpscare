import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SENTINEL_ID, OVERLAY_MESSAGE, injectOverlayFn } from '../../extension/src/lib/inject.mjs';

const URL_ = 'chrome-extension://abc/overlay.html';

/**
 * injectOverlayFn reads `document` and `window` as globals rather than taking
 * them as parameters, because MV3's isolated world forbids the eval-based
 * wrapper that passing them would require. So the test swaps the globals.
 */
const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Enough of CSSStyleDeclaration to tell an ordinary inline value from an
 * inline !important one - the distinction the overlay now depends on.
 */
function fakeStyle() {
  const priority = {};
  const style = {
    setProperty(name, value, prio) {
      style[camel(name)] = value;
      priority[name] = prio ?? '';
    },
    getPropertyValue: (name) => style[camel(name)] ?? '',
    getPropertyPriority: (name) => priority[name] ?? '',
  };
  return style;
}

function fakeDom() {
  const listeners = {};
  const appended = [];
  const byId = {};

  const doc = {
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => ({
      tag, id: '', src: '', style: fakeStyle(), attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      remove() { delete byId[this.id]; this.removed = true; },
    }),
    documentElement: {
      appendChild: (el) => { appended.push(el); byId[el.id] = el; },
    },
  };

  const win = {
    addEventListener: (name, fn) => { (listeners[name] ??= []).push(fn); },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] ?? []).filter((f) => f !== fn);
    },
    setTimeout: vi.fn(() => 123),
    clearTimeout: vi.fn(),
    emit: (name, ev) => (listeners[name] ?? []).forEach((f) => f(ev)),
  };

  return { doc, win, appended, byId, listeners };
}

let dom;

beforeEach(() => {
  dom = fakeDom();
  globalThis.document = dom.doc;
  globalThis.window = dom.win;
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
});

describe('injectOverlayFn', () => {
  it('appends an extension-origin iframe covering the viewport', () => {
    expect(injectOverlayFn(URL_, 3000)).toBe('injected');

    const [iframe] = dom.appended;
    expect(iframe.tag).toBe('iframe');
    expect(iframe.id).toBe(SENTINEL_ID);
    expect(iframe.src).toBe(URL_);
    expect(iframe.style.position).toBe('fixed');
    expect(iframe.style.inset).toBe('0px');
    expect(iframe.style.zIndex).toBe('2147483647');
    expect(iframe.style.pointerEvents).toBe('none');
    expect(iframe.style.border).toBe('0');
  });

  it('leaves the iframe transparent so the page shows through', () => {
    // The effect is Foxy keyed over whatever you were reading. An opaque
    // backdrop here makes it a video player instead - 0.1.3 shipped that by
    // mistake and 0.1.4 took it back out.
    injectOverlayFn(URL_, 3000);
    expect(dom.appended[0].style.getPropertyValue('background-color')).toBe('transparent');
  });

  it('pins colour-scheme and background as inline !important', () => {
    // Measured against Dark Reader on a real page: it publishes
    // `color-scheme: dark !important`, which beats an ordinary inline value.
    // The frame's used scheme then became `dark` while overlay.html itself
    // never opts into dark, so Firefox painted an opaque light canvas behind
    // the frame - a fullscreen WHITE backdrop instead of the page.
    //
    // An inline !important declaration outranks an author !important rule, so
    // this is what survives a page-recolouring extension.
    injectOverlayFn(URL_, 3000);
    const { style } = dom.appended[0];

    expect(style.getPropertyValue('color-scheme')).toBe('normal');
    expect(style.getPropertyPriority('color-scheme')).toBe('important');

    expect(style.getPropertyValue('background-color')).toBe('transparent');
    expect(style.getPropertyPriority('background-color')).toBe('important');
  });

  it('delegates autoplay permission to the iframe', () => {
    injectOverlayFn(URL_, 3000);
    // Without this the cross-origin iframe inherits the page's autoplay
    // restriction and the scream is silently dropped.
    expect(dom.appended[0].attrs.allow).toBe('autoplay');
  });

  it('refuses to inject twice', () => {
    injectOverlayFn(URL_, 3000);
    expect(injectOverlayFn(URL_, 3000)).toBe('already-present');
    expect(dom.appended).toHaveLength(1);
  });

  it('removes the iframe when the overlay reports it is done', () => {
    injectOverlayFn(URL_, 3000);
    dom.win.emit('message', { data: { type: OVERLAY_MESSAGE } });
    expect(dom.appended[0].removed).toBe(true);
  });

  it('ignores unrelated postMessage traffic', () => {
    injectOverlayFn(URL_, 3000);
    dom.win.emit('message', { data: { type: 'something-else' } });
    dom.win.emit('message', { data: null });
    dom.win.emit('message', {});
    expect(dom.appended[0].removed).toBeUndefined();
  });

  it('arms a failsafe teardown timer', () => {
    injectOverlayFn(URL_, 3000);
    expect(dom.win.setTimeout).toHaveBeenCalledWith(expect.any(Function), 3000);

    // Firing the failsafe must remove the iframe even with no 'done' message.
    const [fn] = dom.win.setTimeout.mock.calls[0];
    fn();
    expect(dom.appended[0].removed).toBe(true);
  });

  it('stops listening once torn down', () => {
    injectOverlayFn(URL_, 3000);
    dom.win.emit('message', { data: { type: OVERLAY_MESSAGE } });
    expect(dom.listeners.message).toHaveLength(0);
    expect(dom.win.clearTimeout).toHaveBeenCalledWith(123);
  });

  it('is self-contained enough to survive serialisation', () => {
    // executeScript sends this as source text. If it ever closes over a
    // module-scope identifier, it will throw a ReferenceError in the page
    // instead of failing here.
    const source = injectOverlayFn.toString();
    expect(source).not.toMatch(/\bSENTINEL_ID\b/);
    expect(source).not.toMatch(/\bOVERLAY_MESSAGE\b/);
  });
});
