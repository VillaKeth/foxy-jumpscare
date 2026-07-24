import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { manifestFor } from '../../tools/build-extension.mjs';

const BASE = JSON.parse(
  await readFile(new URL('../../extension/manifest.base.json', import.meta.url), 'utf8')
);

describe('manifestFor', () => {
  it('gives Chrome a service_worker background', () => {
    const m = manifestFor('chrome', BASE);
    expect(m.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(m.background.scripts).toBeUndefined();
  });

  it('builds Opera identically to Chrome (both Chromium)', () => {
    // Opera / Opera GX is Chromium: same MV3 service worker, and none of the
    // Firefox-only gecko block. If these two ever diverge the Opera build is
    // no longer just "the Chrome build", which is the whole point of the target.
    const opera = manifestFor('opera', BASE);
    expect(opera.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(opera.browser_specific_settings).toBeUndefined();
    expect(opera).toEqual(manifestFor('chrome', BASE));
  });

  it('gives Firefox a scripts background and a gecko id', () => {
    const m = manifestFor('firefox', BASE);
    expect(m.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(m.browser_specific_settings.gecko.id).toMatch(/^\{[0-9a-f-]{36}\}$/);
  });

  it('carries no attribution in the add-on id', () => {
    // The id ships in every copy of the manifest and is exposed by AMO's
    // public API, and it can never be changed once a listing exists. An
    // email-style id would make whatever domain it names permanently public.
    const id = manifestFor('firefox', BASE).browser_specific_settings.gecko.id;
    expect(id).not.toContain('@');
    expect(id).not.toMatch(/[a-z]+\.(com|org|net|io|co)/i);
  });

  it('declares no data collection to AMO', () => {
    // addons-linter warns without this, and it will become a hard requirement.
    // The extension reads nothing and sends nothing, so "none" is accurate.
    const gecko = manifestFor('firefox', BASE).browser_specific_settings.gecko;
    expect(gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });

  it('sets a minimum Firefox version that actually supports what it declares', () => {
    // data_collection_permissions only exists from 140 (142 on Android).
    // Claiming an older minimum makes addons-linter warn at submission.
    const bss = manifestFor('firefox', BASE).browser_specific_settings;
    expect(bss.gecko.strict_min_version).toBe('140.0');
    expect(bss.gecko_android.strict_min_version).toBe('142.0');
  });

  it('uses options_ui rather than the Chrome-legacy options_page', () => {
    // options_page is only supported from Firefox 126, below our declared
    // strict_min_version. options_ui works on both browsers.
    const m = manifestFor('chrome', BASE);
    expect(m.options_page).toBeUndefined();
    expect(m.options_ui).toEqual({ page: 'panel.html', open_in_tab: false });
  });

  it('puts the same panel behind the toolbar button', () => {
    // The toolbar popup is the primary UI - about:addons -> Preferences is
    // several clicks deep and most people never find it. Both entry points
    // load one page so the two cannot drift apart.
    for (const target of ['chrome', 'firefox', 'opera']) {
      const m = manifestFor(target, BASE);
      expect(m.action.default_popup).toBe('panel.html');
      expect(m.action.default_popup).toBe(m.options_ui.page);
      expect(m.action.default_icon['16']).toBe('icons/icon-16.png');
    }
  });

  it('does not leak the gecko block into the Chrome manifest', () => {
    expect(manifestFor('chrome', BASE).browser_specific_settings).toBeUndefined();
  });

  it('requests exactly the permissions the spec allows', () => {
    const m = manifestFor('chrome', BASE);
    expect([...m.permissions].sort()).toEqual(['alarms', 'idle', 'scripting', 'storage']);
    expect(m.permissions).not.toContain('offscreen');
    expect(m.host_permissions).toEqual(['<all_urls>']);
  });

  it('exposes the overlay page and video as web-accessible', () => {
    const res = manifestFor('chrome', BASE).web_accessible_resources[0].resources;
    expect(res).toContain('overlay.html');
    expect(res).toContain('foxy.webm');
  });

  it('does not mutate the base manifest', () => {
    const before = JSON.stringify(BASE);
    manifestFor('firefox', BASE);
    expect(JSON.stringify(BASE)).toBe(before);
  });

  it('rejects an unknown target', () => {
    expect(() => manifestFor('safari', BASE)).toThrow(/safari/);
  });
});
