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

  it('gives Firefox a scripts background and a gecko id', () => {
    const m = manifestFor('firefox', BASE);
    expect(m.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(m.browser_specific_settings.gecko.id).toMatch(/@/);
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
