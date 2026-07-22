# Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MV3 extension for Chrome and Firefox that fires a transparent full-viewport Foxy overlay at 1-in-100,000 per active browsing second.

**Architecture:** Policy is separated from browser APIs. The roll and the tick accounting are pure modules with no `chrome.*` references, so they are unit-tested in node. The service worker is a thin adapter that reads browser state, calls those pure functions, and injects. The overlay is an extension-origin iframe rather than injected elements, which is load-bearing for CSP, autoplay, and style isolation.

**Tech Stack:** MV3, ESM, vanilla JS (no framework, no bundler beyond a manifest-templating copy step), vitest for units, `@playwright/test` for Chromium end-to-end.

## Global Constraints

- ESM only (`.mjs` for node-side, `.js` with `"type": "module"` in the manifest for the worker).
- **No runtime dependencies.** vitest and `@playwright/test` are devDependencies.
- Default `oneInN` is **100000**. Presets: `ultra-rare` 1000000, `rare` 300000, `normal` 100000, `terraria-faithful` 10000.
- Tick period is **60 seconds** — `chrome.alarms` will not go below 1 minute on Chrome.
- Active means `chrome.idle.queryState(15) === 'active'` **and** a browser window has focus. Both, not either.
- **A failed fire must not consume the roll.** On injection failure, leave `remaining` at 0 and retry next tick.
- The overlay is an **extension-origin iframe** with `allow="autoplay"`. Never a raw injected `<video>`.
- Permissions exactly: `alarms`, `idle`, `storage`, `scripting`, host `<all_urls>`. No `offscreen`.
- Sentinel element id `foxy-jumpscare-overlay` guards against double injection.
- Overlay teardown is the video's `ended` event, plus an independent failsafe timer at video duration + 1500ms.

## Known coverage limit

Playwright can load MV3 extensions in **Chromium only**. Firefox requires `web-ext` plus remote-debugging plumbing that is disproportionate here. Task 7 therefore automates Chrome and leaves Firefox as a written manual checklist. This is a real gap, stated rather than papered over: the Firefox build's overlay, autoplay behavior, and VP9 alpha rendering are verified by hand before each release.

---

### Task 1: Roll core

**Files:**
- Create: `extension/src/lib/roll.mjs`
- Test: `tests/extension/roll.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `PRESETS: Record<string, number>`
  - `DEFAULT_ONE_IN_N: number`
  - `drawRemaining(oneInN, rand?) -> number` — integer `>= 1`

- [ ] **Step 1: Write the failing test**

Create `tests/extension/roll.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { PRESETS, DEFAULT_ONE_IN_N, drawRemaining } from '../../extension/src/lib/roll.mjs';

describe('PRESETS', () => {
  it('matches the values in the spec', () => {
    expect(PRESETS).toEqual({
      'ultra-rare': 1_000_000,
      'rare': 300_000,
      'normal': 100_000,
      'terraria-faithful': 10_000,
    });
  });

  it('defaults to the normal preset', () => {
    expect(DEFAULT_ONE_IN_N).toBe(100_000);
  });
});

describe('drawRemaining', () => {
  it('has a mean of about N over many draws', () => {
    const N = 1000;
    const trials = 200_000;
    let total = 0;
    for (let i = 0; i < trials; i += 1) total += drawRemaining(N);
    const mean = total / trials;
    // Geometric(p=1/N) has mean N and sd ~N, so the sample mean's standard
    // error is N/sqrt(trials) ~ 2.24. A 5% band is ~22x that — loose enough
    // never to flake, tight enough to catch an off-by-one-order mistake.
    expect(mean).toBeGreaterThan(N * 0.95);
    expect(mean).toBeLessThan(N * 1.05);
  });

  it('never returns less than 1', () => {
    for (let i = 0; i < 10_000; i += 1) {
      expect(drawRemaining(10)).toBeGreaterThanOrEqual(1);
    }
  });

  it('returns 1 at the U=1 boundary', () => {
    // rand() === 0 gives u = 1 - 0 = 1, and ln(1) = 0.
    expect(drawRemaining(100_000, () => 0)).toBe(1);
  });

  it('returns a large finite value as U approaches 0', () => {
    const draw = drawRemaining(100_000, () => 1 - 1e-12);
    expect(Number.isFinite(draw)).toBe(true);
    expect(draw).toBeGreaterThan(1_000_000);
  });

  it('always returns an integer', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(Number.isInteger(drawRemaining(500))).toBe(true);
    }
  });

  it('rejects a nonsensical N', () => {
    expect(() => drawRemaining(0)).toThrow(/oneInN/);
    expect(() => drawRemaining(-5)).toThrow(/oneInN/);
    expect(() => drawRemaining(Number.NaN)).toThrow(/oneInN/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- roll`
Expected: FAIL — `Failed to load ../../extension/src/lib/roll.mjs`

- [ ] **Step 3: Write the implementation**

Create `extension/src/lib/roll.mjs`:

```javascript
/**
 * The roll. Pure — no browser APIs, so it unit-tests in node.
 *
 * The original Terraria mod rolls 1-in-N once per wall-clock second. Doing
 * that literally is wrong in a browser: background timers are throttled and
 * MV3 service workers are killed, so dropped ticks would silently bias the
 * odds. Instead we sample the wait once from the equivalent geometric
 * distribution and count it down against measured active time. Same
 * distribution, no dependence on a reliable 1 Hz timer.
 */

export const PRESETS = {
  'ultra-rare': 1_000_000,
  'rare': 300_000,
  'normal': 100_000,
  'terraria-faithful': 10_000,
};

export const DEFAULT_ONE_IN_N = PRESETS.normal;

/**
 * Inverse-transform sample of X ~ Geometric(p), p = 1/oneInN, support {1,2,...}.
 * E[X] = oneInN.
 */
export function drawRemaining(oneInN, rand = Math.random) {
  if (!Number.isFinite(oneInN) || oneInN < 1) {
    throw new Error(`oneInN must be a finite number >= 1, got ${oneInN}`);
  }

  const p = 1 / oneInN;
  // rand() returns [0,1); 1 - rand() gives (0,1], keeping ln() finite.
  const u = 1 - rand();
  const draw = Math.log(u) / Math.log(1 - p);

  // ln(1) === 0 yields -0, and oneInN === 1 yields -Infinity in the
  // denominator; both floor to 1, which is the correct minimum.
  return Math.max(1, Math.ceil(draw));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- roll`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/roll.mjs tests/extension/roll.test.mjs
git commit -m "feat(ext): add geometric roll core"
```

---

### Task 2: Tick accounting and injectability

**Files:**
- Create: `extension/src/lib/ticker.mjs`
- Test: `tests/extension/ticker.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `TICK_SECONDS: 60`
  - `creditTick(state, activeSeconds) -> { remaining, shouldFire }`
  - `isInjectableUrl(url) -> boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/extension/ticker.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { TICK_SECONDS, creditTick, isInjectableUrl } from '../../extension/src/lib/ticker.mjs';

describe('TICK_SECONDS', () => {
  it('is 60, the chrome.alarms floor', () => {
    expect(TICK_SECONDS).toBe(60);
  });
});

describe('creditTick', () => {
  it('subtracts credited seconds', () => {
    expect(creditTick({ remaining: 500 }, 60)).toEqual({ remaining: 440, shouldFire: false });
  });

  it('fires when the countdown reaches zero', () => {
    expect(creditTick({ remaining: 60 }, 60)).toEqual({ remaining: 0, shouldFire: true });
  });

  it('fires when the countdown would go negative, and clamps at zero', () => {
    expect(creditTick({ remaining: 10 }, 60)).toEqual({ remaining: 0, shouldFire: true });
  });

  it('keeps firing while remaining is zero', () => {
    // A failed injection leaves remaining at 0; the next tick must retry
    // rather than treating the roll as spent.
    expect(creditTick({ remaining: 0 }, 60)).toEqual({ remaining: 0, shouldFire: true });
  });

  it('does not advance when no active seconds are credited', () => {
    expect(creditTick({ remaining: 500 }, 0)).toEqual({ remaining: 500, shouldFire: false });
  });
});

describe('isInjectableUrl', () => {
  it('accepts ordinary web pages', () => {
    expect(isInjectableUrl('https://example.com/x')).toBe(true);
    expect(isInjectableUrl('http://example.com')).toBe(true);
  });

  it('rejects privileged schemes', () => {
    for (const url of [
      'chrome://extensions',
      'about:config',
      'edge://settings',
      'devtools://devtools/bundled/x.html',
      'view-source:https://example.com',
      'chrome-extension://abc/page.html',
      'moz-extension://abc/page.html',
    ]) {
      expect(isInjectableUrl(url), url).toBe(false);
    }
  });

  it('rejects the extension stores, which block injection', () => {
    expect(isInjectableUrl('https://chromewebstore.google.com/detail/x')).toBe(false);
    expect(isInjectableUrl('https://chrome.google.com/webstore/detail/x')).toBe(false);
    expect(isInjectableUrl('https://addons.mozilla.org/en-US/firefox/')).toBe(false);
  });

  it('rejects empty and missing urls', () => {
    expect(isInjectableUrl('')).toBe(false);
    expect(isInjectableUrl(undefined)).toBe(false);
    expect(isInjectableUrl(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ticker`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `extension/src/lib/ticker.mjs`:

```javascript
/** Pure tick accounting and URL policy. No browser APIs. */

/** chrome.alarms will not schedule below one minute. */
export const TICK_SECONDS = 60;

const BLOCKED_SCHEME = /^(chrome|about|edge|devtools|view-source|chrome-extension|moz-extension|resource|data|blob):/i;

const BLOCKED_HOST = [
  /^https:\/\/chromewebstore\.google\.com/i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
  /^https:\/\/addons\.mozilla\.org/i,
];

/**
 * Credit elapsed active time against the countdown.
 *
 * remaining clamps at 0 rather than going negative, and shouldFire stays true
 * while it sits at 0. That is what lets a failed injection retry next tick
 * instead of silently spending the roll.
 */
export function creditTick(state, activeSeconds) {
  const remaining = Math.max(0, state.remaining - activeSeconds);
  return { remaining, shouldFire: remaining <= 0 };
}

/** Whether a content script can be injected into this URL at all. */
export function isInjectableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (BLOCKED_SCHEME.test(url)) return false;
  if (BLOCKED_HOST.some((re) => re.test(url))) return false;
  return /^https?:/i.test(url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ticker`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add extension/src/lib/ticker.mjs tests/extension/ticker.test.mjs
git commit -m "feat(ext): add tick accounting and URL policy"
```

---

### Task 3: Manifest, build script, loadable skeleton

Produces an extension that installs and ticks but never fires. Verifiable by loading it unpacked.

**Files:**
- Create: `extension/manifest.base.json`
- Create: `extension/src/background.js`
- Create: `tools/build-extension.mjs`
- Test: `tests/extension/build-extension.test.mjs`
- Modify: `package.json` (add `build` script)

**Interfaces:**
- Consumes: `TICK_SECONDS` (Task 2)
- Produces:
  - `manifestFor(target, base) -> object` — `target` is `'chrome' | 'firefox'`
  - `buildExtension({ target, outDir, srcDir, assetsDir }) -> Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `tests/extension/build-extension.test.mjs`:

```javascript
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
    expect(m.permissions.sort()).toEqual(['alarms', 'idle', 'scripting', 'storage']);
    expect(m.permissions).not.toContain('offscreen');
    expect(m.host_permissions).toEqual(['<all_urls>']);
  });

  it('exposes the overlay page and video as web-accessible', () => {
    const res = manifestFor('chrome', BASE).web_accessible_resources[0].resources;
    expect(res).toContain('overlay.html');
    expect(res).toContain('foxy.webm');
  });

  it('rejects an unknown target', () => {
    expect(() => manifestFor('safari', BASE)).toThrow(/safari/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- build-extension`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the base manifest**

Create `extension/manifest.base.json`:

```json
{
  "manifest_version": 3,
  "name": "Foxy Jumpscare",
  "version": "0.1.0",
  "description": "A rare jumpscare while you browse. 1 in 100,000 every active second.",
  "permissions": ["alarms", "idle", "storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "options_page": "options.html",
  "web_accessible_resources": [
    {
      "resources": ["overlay.html", "overlay.js", "foxy.webm"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 4: Write the build script**

Create `tools/build-extension.mjs`:

```javascript
#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['chrome', 'firefox'];
const GECKO_ID = '{47d51fee-cbcf-4204-b2b6-a2b72c965b26}';

/**
 * Chrome and Firefox disagree on how an MV3 background is declared, and
 * Firefox additionally requires an explicit add-on id. Everything else is
 * shared, so the difference lives here rather than in two whole manifests.
 */
export function manifestFor(target, base) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}" — expected one of ${TARGETS.join(', ')}`);
  }

  const manifest = structuredClone(base);

  if (target === 'chrome') {
    manifest.background = { service_worker: 'background.js', type: 'module' };
  } else {
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = {
      gecko: { id: GECKO_ID, strict_min_version: '115.0' },
    };
  }

  return manifest;
}

export async function buildExtension({
  target,
  outDir = join(REPO_ROOT, 'dist', target),
  srcDir = join(REPO_ROOT, 'extension', 'src'),
  assetsDir = join(REPO_ROOT, 'assets'),
} = {}) {
  const base = JSON.parse(
    await readFile(join(REPO_ROOT, 'extension', 'manifest.base.json'), 'utf8')
  );

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await cp(srcDir, outDir, { recursive: true });
  await writeFile(
    join(outDir, 'manifest.json'),
    `${JSON.stringify(manifestFor(target, base), null, 2)}\n`
  );

  // The video is optional at build time so the extension can be built and
  // loaded before the asset pack exists. It simply will not play.
  try {
    await cp(join(assetsDir, 'foxy.webm'), join(outDir, 'foxy.webm'));
  } catch {
    console.warn(`  warning: assets/foxy.webm missing — run "npm run assets" first`);
  }

  return outDir;
}

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    for (const target of TARGETS) {
      console.log(`  ${target}  ${await buildExtension({ target })}`);
    }
  } catch (err) {
    console.error(`\nExtension build failed:\n${err.message}\n`);
    process.exit(1);
  }
}
```

- [ ] **Step 5: Write the minimal background worker**

Create `extension/src/background.js`. This ticks and logs but does not yet fire; Task 5 wires the overlay in.

```javascript
import { drawRemaining, DEFAULT_ONE_IN_N } from './lib/roll.mjs';
import { TICK_SECONDS, creditTick } from './lib/ticker.mjs';

const ALARM = 'foxy-tick';
const IDLE_THRESHOLD_SECONDS = 15;

async function getState() {
  const stored = await chrome.storage.local.get(['remaining', 'oneInN', 'enabled']);
  const oneInN = stored.oneInN ?? DEFAULT_ONE_IN_N;
  return {
    enabled: stored.enabled ?? true,
    oneInN,
    remaining: stored.remaining ?? drawRemaining(oneInN),
  };
}

/**
 * chrome.idle reports *system* idle, so it stays 'active' while the user works
 * in another application entirely. The focus check is what makes this mean
 * "actively browsing" rather than "awake and at the computer".
 */
async function isActiveBrowsing() {
  const idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
  if (idleState !== 'active') return false;
  const win = await chrome.windows.getLastFocused().catch(() => null);
  return Boolean(win?.focused);
}

async function tick() {
  const state = await getState();
  if (!state.enabled) return;

  const active = await isActiveBrowsing();
  const credited = active ? TICK_SECONDS : 0;
  const { remaining, shouldFire } = creditTick(state, credited);

  await chrome.storage.local.set({ remaining, oneInN: state.oneInN, enabled: state.enabled });

  if (shouldFire) {
    console.log('[foxy] would fire (overlay not wired yet)');
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const { oneInN = DEFAULT_ONE_IN_N } = await chrome.storage.local.get('oneInN');
  await chrome.storage.local.set({ oneInN, remaining: drawRemaining(oneInN), enabled: true });
  chrome.alarms.create(ALARM, { periodInMinutes: TICK_SECONDS / 60 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: TICK_SECONDS / 60 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick();
});
```

- [ ] **Step 6: Add the build script to package.json**

Add to `scripts`:

```json
"build": "node tools/build-extension.mjs"
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- build-extension`
Expected: PASS, 6 tests.

- [ ] **Step 8: Build and verify output shape**

Run: `npm run build`
Expected: prints `chrome  ...dist/chrome` and `firefox  ...dist/firefox`, plus the missing-asset warning until the pack is built.

Run: `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('dist/chrome/manifest.json'))))"`
Expected: includes `background`, `permissions`, `web_accessible_resources`.

- [ ] **Step 9: Load it unpacked in Chrome**

Open `chrome://extensions`, enable Developer mode, "Load unpacked", select `dist/chrome`.
Expected: loads with no manifest errors. Click "service worker" to open its console; no exceptions.

- [ ] **Step 10: Commit**

```bash
git add extension/manifest.base.json extension/src/background.js tools/build-extension.mjs tests/extension/build-extension.test.mjs package.json
git commit -m "feat(ext): add manifest templating and loadable skeleton"
```

---

### Task 4: The overlay

**Files:**
- Create: `extension/src/overlay.html`
- Create: `extension/src/overlay.js`
- Create: `extension/src/lib/inject.mjs`
- Test: `tests/extension/inject.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SENTINEL_ID: 'foxy-jumpscare-overlay'`
  - `OVERLAY_MESSAGE: 'foxy:overlay-done'`
  - `injectOverlayFn(iframeUrl, sentinelId, messageName, failsafeMs) -> string` — the function body serialised into the page by `chrome.scripting.executeScript`

- [ ] **Step 1: Write the failing test**

`injectOverlayFn` runs in a page, so it is tested against a fake DOM built by hand rather than a real browser — the browser path is covered end-to-end in Task 7.

Create `tests/extension/inject.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SENTINEL_ID, OVERLAY_MESSAGE, injectOverlayFn } from '../../extension/src/lib/inject.mjs';

function fakeDom() {
  const listeners = {};
  const created = [];
  const appended = [];
  const byId = {};

  const doc = {
    getElementById: (id) => byId[id] ?? null,
    createElement: (tag) => {
      const el = {
        tag, id: '', src: '', style: {}, attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        remove() { delete byId[this.id]; this.removed = true; },
      };
      created.push(el);
      return el;
    },
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

  return { doc, win, created, appended, byId, listeners };
}

let dom;
beforeEach(() => { dom = fakeDom(); });

describe('injectOverlayFn', () => {
  it('appends an extension-origin iframe covering the viewport', () => {
    const result = injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    expect(result).toBe('injected');

    const [iframe] = dom.appended;
    expect(iframe.tag).toBe('iframe');
    expect(iframe.id).toBe(SENTINEL_ID);
    expect(iframe.src).toBe('chrome-extension://abc/overlay.html');
    expect(iframe.style.position).toBe('fixed');
    expect(iframe.style.inset).toBe('0px');
    expect(iframe.style.zIndex).toBe('2147483647');
    expect(iframe.style.pointerEvents).toBe('none');
    expect(iframe.style.border).toBe('0');
  });

  it('delegates autoplay permission to the iframe', () => {
    injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    // Without this the cross-origin iframe inherits the page's autoplay
    // restriction and the scream is silently dropped.
    expect(dom.appended[0].attrs.allow).toBe('autoplay');
  });

  it('refuses to inject twice', () => {
    injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    const result = injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    expect(result).toBe('already-present');
    expect(dom.appended).toHaveLength(1);
  });

  it('removes the iframe when the overlay reports it is done', () => {
    injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    const iframe = dom.appended[0];
    dom.win.emit('message', { data: { type: OVERLAY_MESSAGE } });
    expect(iframe.removed).toBe(true);
  });

  it('ignores unrelated postMessage traffic', () => {
    injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    const iframe = dom.appended[0];
    dom.win.emit('message', { data: { type: 'something-else' } });
    dom.win.emit('message', { data: null });
    expect(iframe.removed).toBeUndefined();
  });

  it('arms a failsafe teardown timer', () => {
    injectOverlayFn(dom.doc, dom.win, 'chrome-extension://abc/overlay.html', 3000);
    expect(dom.win.setTimeout).toHaveBeenCalledWith(expect.any(Function), 3000);

    // Firing the failsafe must remove the iframe even with no 'done' message.
    const [fn] = dom.win.setTimeout.mock.calls[0];
    fn();
    expect(dom.appended[0].removed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- inject`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the injection module**

Create `extension/src/lib/inject.mjs`:

```javascript
export const SENTINEL_ID = 'foxy-jumpscare-overlay';
export const OVERLAY_MESSAGE = 'foxy:overlay-done';

/**
 * Runs inside the page. Takes doc/win explicitly so it is testable in node;
 * the service worker passes `document` and `window` when it injects this.
 *
 * An extension-origin iframe rather than a raw <video>, for three reasons that
 * each break injected elements on real sites:
 *   1. Strict page CSP blocks injected media outright.
 *   2. Content-script media inherits the page's autoplay policy, so audio is
 *      silently dropped on any page the user has not clicked.
 *   3. Host stylesheets reach injected nodes.
 * The iframe has its own origin and CSP, and is immune to all three.
 */
export function injectOverlayFn(doc, win, iframeUrl, failsafeMs) {
  const SENTINEL = 'foxy-jumpscare-overlay';
  const DONE = 'foxy:overlay-done';

  if (doc.getElementById(SENTINEL)) return 'already-present';

  const iframe = doc.createElement('iframe');
  iframe.id = SENTINEL;
  iframe.src = iframeUrl;
  // Delegates autoplay to the cross-origin frame; without it, no audio.
  iframe.setAttribute('allow', 'autoplay');

  Object.assign(iframe.style, {
    position: 'fixed',
    inset: '0px',
    width: '100%',
    height: '100%',
    border: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    background: 'transparent',
    colorScheme: 'normal',
  });

  let timer = null;

  const teardown = () => {
    win.removeEventListener('message', onMessage);
    if (timer !== null) win.clearTimeout(timer);
    iframe.remove();
  };

  function onMessage(event) {
    if (event?.data?.type === DONE) teardown();
  }

  win.addEventListener('message', onMessage);
  // Independent of the video: if it fails to decode, 'ended' never fires and
  // the user would be left with a permanent invisible overlay.
  timer = win.setTimeout(teardown, failsafeMs);

  doc.documentElement.appendChild(iframe);
  return 'injected';
}
```

- [ ] **Step 4: Write the overlay page**

Create `extension/src/overlay.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>foxy</title>
<style>
  html, body {
    margin: 0;
    height: 100%;
    background: transparent;
    overflow: hidden;
  }
  video {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
<video id="foxy" src="foxy.webm" autoplay playsinline></video>
<script src="overlay.js" type="module"></script>
```

- [ ] **Step 5: Write the overlay script**

Create `extension/src/overlay.js`:

```javascript
const DONE = 'foxy:overlay-done';
const video = document.getElementById('foxy');

function done() {
  // The parent content script owns the iframe and does the removal.
  parent.postMessage({ type: DONE }, '*');
}

video.addEventListener('ended', done);
video.addEventListener('error', done);

// Autoplay can still be refused (no user gesture, extreme settings). Play
// muted rather than showing nothing — a silent Foxy beats no Foxy.
video.play().catch(() => {
  video.muted = true;
  video.play().catch(done);
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- inject`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add extension/src/overlay.html extension/src/overlay.js extension/src/lib/inject.mjs tests/extension/inject.test.mjs
git commit -m "feat(ext): add extension-origin iframe overlay"
```

---

### Task 5: Wire firing into the background worker

**Files:**
- Modify: `extension/src/background.js`
- Test: `tests/extension/fire.test.mjs`
- Create: `extension/src/lib/fire.mjs`

**Interfaces:**
- Consumes: `isInjectableUrl` (Task 2), `SENTINEL_ID`/`injectOverlayFn` (Task 4), `drawRemaining` (Task 1)
- Produces: `attemptFire(browser, deps) -> Promise<boolean>` — true only if the overlay was actually injected

- [ ] **Step 1: Write the failing test**

Create `tests/extension/fire.test.mjs`:

```javascript
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

  it('treats an already-present overlay as success', async () => {
    const browser = fakeBrowser({
      executeScript: vi.fn(async () => [{ result: 'already-present' }]),
    });
    expect(await attemptFire(browser)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fire`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the fire module**

Create `extension/src/lib/fire.mjs`:

```javascript
import { isInjectableUrl } from './ticker.mjs';
import { injectOverlayFn } from './inject.mjs';

const FAILSAFE_MS = 8000;

/**
 * Try to put the overlay on screen. Returns whether it actually happened —
 * the caller uses this to decide whether the roll was spent. A refused
 * injection must not consume it.
 */
export async function attemptFire(browser) {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !isInjectableUrl(tab.url)) return false;

  const iframeUrl = browser.runtime.getURL('overlay.html');

  try {
    const [{ result } = {}] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectOverlayFn,
      args: [null, null, iframeUrl, FAILSAFE_MS],
    });
    return result === 'injected' || result === 'already-present';
  } catch {
    // Restricted page, tab closed mid-flight, or a host that refuses
    // injection. Not exceptional — just retry on the next tick.
    return false;
  }
}
```

Note: `injectOverlayFn` takes `doc`/`win` as its first two parameters for testability, but when serialised into the page by `executeScript` those cannot cross the boundary. Change the signature so the page-side wrapper supplies them:

Replace the `func`/`args` above with a wrapper that closes over nothing:

```javascript
    const [{ result } = {}] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: (fnSource, url, failsafeMs) => {
        // eslint-disable-next-line no-new-func
        const fn = new Function(`return (${fnSource})`)();
        return fn(document, window, url, failsafeMs);
      },
      args: [injectOverlayFn.toString(), iframeUrl, FAILSAFE_MS],
    });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fire`
Expected: PASS, 5 tests. Update the test's `call.args` expectations if you adjusted the wrapper shape.

- [ ] **Step 5: Wire it into the tick**

In `extension/src/background.js`, replace the `if (shouldFire)` block:

```javascript
  if (shouldFire) {
    const fired = await attemptFire(chrome);
    if (fired) {
      await chrome.storage.local.set({ remaining: drawRemaining(state.oneInN) });
    }
    // If it did not fire, remaining stays 0 and the next tick retries.
  }
```

And add the import at the top:

```javascript
import { attemptFire } from './lib/fire.mjs';
```

- [ ] **Step 6: Add the test hook**

Append to `extension/src/background.js`:

```javascript
// Reachable only from the service-worker context (devtools or Playwright),
// never from a web page. Used by the end-to-end tests to fire on demand
// instead of waiting out the countdown.
globalThis.__foxyTest = {
  fireNow: () => attemptFire(chrome),
  setRemaining: (remaining) => chrome.storage.local.set({ remaining }),
};
```

- [ ] **Step 7: Rebuild and smoke-test by hand**

Run: `npm run build`

Reload the extension at `chrome://extensions`, open the service worker console, and run:

```javascript
await __foxyTest.fireNow()
```

Expected: `true`, and Foxy appears over the active tab. (Silent until `assets/foxy.webm` exists — that is Plan 1 Task 4.)

- [ ] **Step 8: Commit**

```bash
git add extension/src/lib/fire.mjs extension/src/background.js tests/extension/fire.test.mjs
git commit -m "feat(ext): fire the overlay, preserving the roll on failure"
```

---

### Task 6: Options page

**Files:**
- Create: `extension/src/options.html`
- Create: `extension/src/options.js`

**Interfaces:**
- Consumes: `PRESETS`, `drawRemaining` (Task 1)
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Write the options page**

Create `extension/src/options.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Foxy Jumpscare</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem; max-width: 32rem; }
  label { display: block; margin: 1rem 0; }
  select { font: inherit; padding: 0.25rem; }
  .warn { color: #b00; }
</style>
<h1>Foxy Jumpscare</h1>

<label>
  <input type="checkbox" id="enabled"> Enabled
</label>

<label>
  Rarity
  <select id="odds">
    <option value="ultra-rare">Ultra-rare — about once every 10 weeks</option>
    <option value="rare">Rare — about once every 3 weeks</option>
    <option value="normal">Normal — about once a week</option>
    <option value="terraria-faithful">Terraria-faithful — about once a day</option>
  </select>
</label>

<p id="status"></p>
<p class="warn">Sudden loud video and audio. Not suitable if you are photosensitive.</p>

<script src="options.js" type="module"></script>
```

- [ ] **Step 2: Write the options script**

Create `extension/src/options.js`:

```javascript
import { PRESETS, DEFAULT_ONE_IN_N, drawRemaining } from './lib/roll.mjs';

const enabledEl = document.getElementById('enabled');
const oddsEl = document.getElementById('odds');
const statusEl = document.getElementById('status');

function presetNameFor(oneInN) {
  return Object.keys(PRESETS).find((k) => PRESETS[k] === oneInN) ?? 'normal';
}

async function load() {
  const { enabled = true, oneInN = DEFAULT_ONE_IN_N } =
    await chrome.storage.local.get(['enabled', 'oneInN']);
  enabledEl.checked = enabled;
  oddsEl.value = presetNameFor(oneInN);
}

enabledEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabledEl.checked });
  statusEl.textContent = 'Saved.';
});

oddsEl.addEventListener('change', async () => {
  const oneInN = PRESETS[oddsEl.value];
  // Re-draw, otherwise a countdown started at the old odds keeps running and
  // the change appears to do nothing for weeks.
  await chrome.storage.local.set({ oneInN, remaining: drawRemaining(oneInN) });
  statusEl.textContent = 'Saved. Countdown restarted at the new odds.';
});

load();
```

- [ ] **Step 3: Verify by hand**

Run: `npm run build`, reload the extension, open its options page.
Expected: toggling and changing rarity both persist across a page reload.

- [ ] **Step 4: Commit**

```bash
git add extension/src/options.html extension/src/options.js
git commit -m "feat(ext): add options page"
```

---

### Task 7: Chromium end-to-end tests

**Files:**
- Create: `playwright.config.mjs`
- Create: `tests/e2e/fixtures.mjs`
- Create: `tests/e2e/pages/plain.html`
- Create: `tests/e2e/pages/strict-csp.html`
- Create: `tests/e2e/overlay.spec.mjs`
- Modify: `package.json` (add `test:e2e`), `.gitignore` (playwright artifacts)

**Interfaces:**
- Consumes: the built `dist/chrome`
- Produces: nothing consumed elsewhere

- [ ] **Step 1: Install Playwright**

Run: `npm i -D @playwright/test`
Run: `npx playwright install chromium`
Expected: chromium downloaded. This is a few hundred MB on first run.

- [ ] **Step 2: Ignore Playwright artifacts**

Add to `.gitignore` under the tooling scratch section:

```
test-results/
playwright-report/
```

- [ ] **Step 3: Write the config**

Create `playwright.config.mjs`:

```javascript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:8392' },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: 'http://localhost:8392/plain.html',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 4: Write the static server**

Create `tests/e2e/serve.mjs`:

```javascript
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = join(dirname(fileURLToPath(import.meta.url)), 'pages');
const TYPES = { '.html': 'text/html; charset=utf-8' };

createServer(async (req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'plain.html';
  try {
    const body = await readFile(join(PAGES, name));
    const headers = { 'content-type': TYPES[extname(name)] ?? 'text/plain' };
    // The point of this page is that its CSP is hostile to injection.
    if (name === 'strict-csp.html') {
      headers['content-security-policy'] =
        "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'";
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(8392);
```

- [ ] **Step 5: Write the test pages**

Create `tests/e2e/pages/plain.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>plain</title>
<body style="background:#fff"><h1>plain page</h1></body>
```

Create `tests/e2e/pages/strict-csp.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>strict csp</title>
<body style="background:#fff"><h1>strict csp page</h1></body>
```

- [ ] **Step 6: Write the extension fixture**

Create `tests/e2e/fixtures.mjs`:

```javascript
import { test as base, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve('dist/chrome');

export const test = base.extend({
  context: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'foxy-e2e-'));
    // MV3 extensions require a persistent context, and Chromium only loads
    // them with a real browser UI — headless refuses.
    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },

  worker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
});

export const expect = test.expect;
```

- [ ] **Step 7: Write the end-to-end spec**

Create `tests/e2e/overlay.spec.mjs`:

```javascript
import { test, expect } from './fixtures.mjs';

const SENTINEL = '#foxy-jumpscare-overlay';

test('injects the overlay into an ordinary page', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/plain.html');

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(true);

  const iframe = page.locator(SENTINEL);
  await expect(iframe).toBeAttached();
  await expect(iframe).toHaveAttribute('allow', 'autoplay');
});

test('injects into a page with a strict CSP', async ({ context, worker }) => {
  // The whole reason the overlay is an extension-origin iframe: a raw
  // injected <video> is blocked outright by this page's CSP.
  const page = await context.newPage();
  await page.goto('/strict-csp.html');

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(true);
  await expect(page.locator(SENTINEL)).toBeAttached();
});

test('does not double-inject', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/plain.html');

  await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  await worker.evaluate(() => globalThis.__foxyTest.fireNow());

  await expect(page.locator(SENTINEL)).toHaveCount(1);
});

test('refuses to fire on a privileged page and keeps the roll', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('chrome://version');

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(false);
});

test('removes the overlay once the video ends', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/plain.html');
  await worker.evaluate(() => globalThis.__foxyTest.fireNow());

  await expect(page.locator(SENTINEL)).toBeAttached();
  // Video is ~2s; the failsafe is 8s. Either path must clear it.
  await expect(page.locator(SENTINEL)).toHaveCount(0, { timeout: 15_000 });
});

test('the shipped video actually carries alpha', async ({ context }) => {
  // ffmpeg cannot decode VP9 alpha, so this is the only automated place the
  // transparency of the shipped asset is verifiable. See assets/PACK.md.
  const page = await context.newPage();
  const extensionId = context.serviceWorkers()[0].url().split('/')[2];
  await page.goto(`chrome-extension://${extensionId}/overlay.html`);

  const sample = await page.evaluate(async () => {
    const v = document.getElementById('foxy');
    await new Promise((r) => {
      if (v.readyState >= 2) r();
      else v.addEventListener('loadeddata', r, { once: true });
    });
    v.pause();
    v.currentTime = Math.min(0.4, v.duration / 2);
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));

    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(v, 0, 0);

    // The very corner of a keyed clip should be fully transparent.
    const [r, g, b, a] = ctx.getImageData(2, 2, 1, 1).data;
    return { r, g, b, a };
  });

  expect(sample.a).toBe(0);
});
```

- [ ] **Step 8: Add the script**

Add to `package.json` scripts:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 9: Run the end-to-end suite**

Run: `npm run build && npm run test:e2e`
Expected: 6 passed. The alpha test requires `assets/foxy.webm`, so it fails until Plan 1 Task 4 is done — that is correct and expected, not a bug to work around.

- [ ] **Step 10: Commit**

```bash
git add playwright.config.mjs tests/e2e package.json package-lock.json .gitignore
git commit -m "test(ext): add Chromium end-to-end coverage"
```

---

### Task 8: Firefox manual verification checklist

Playwright cannot drive a Firefox MV3 extension, so this is written down rather than automated. Run it before every AMO submission.

**Files:**
- Create: `docs/firefox-checklist.md`

- [ ] **Step 1: Write the checklist**

Create `docs/firefox-checklist.md`:

```markdown
# Firefox release checklist

Playwright cannot load MV3 extensions in Firefox, so these are verified by hand.

Load `dist/firefox` via `about:debugging` → This Firefox → Load Temporary Add-on →
select `manifest.json`.

- [ ] Loads with no manifest warnings in `about:debugging`
- [ ] Background script console shows no exceptions
- [ ] `__foxyTest.fireNow()` from the background console injects the overlay
- [ ] Overlay appears on an ordinary page (e.g. example.com)
- [ ] Overlay appears on a strict-CSP page (github.com)
- [ ] **Audio is audible** — the biggest Chrome/Firefox divergence
- [ ] Foxy renders with transparency; the page is visible behind him
- [ ] No green fringe against a light page and against a dark page
- [ ] Overlay disappears on its own; the page is interactive afterwards
- [ ] Options page saves and reloads correctly
```

- [ ] **Step 2: Commit**

```bash
git add docs/firefox-checklist.md
git commit -m "docs: add Firefox manual verification checklist"
```

---

## Self-Review

**Spec coverage.** `chrome.alarms` at 60s (Task 3), idle + focus gating (Task 3), extension-origin iframe with the three-reason justification (Task 4), failed fire not consuming the roll (Tasks 2, 5, 7), sentinel guard (Tasks 4, 7), failsafe teardown (Tasks 4, 7), exact permission list with no `offscreen` (Task 3), `web_accessible_resources` for overlay and video (Task 3), options page with the four presets and re-draw on change (Task 6), non-injectable URL policy (Task 2), Chrome/Firefox manifest divergence (Task 3), alpha verification in a browser (Task 7).

**Not covered, deliberately.** Store submission itself (listing copy, privacy policy, permission justification) is release work, not implementation, and belongs in its own pass. The first-run photosensitivity page from the spec is folded into the options page warning rather than a separate onboarding page — if a dedicated first-run page is wanted, it is a small addition to Task 6.

**Type consistency.** `oneInN` is a number everywhere. `remaining` is a number in storage, in `creditTick`, and in `drawRemaining`'s return. `attemptFire` returns boolean; `injectOverlayFn` returns the string `'injected' | 'already-present'` and `attemptFire` maps both to true.

**Known rough edge, flagged not hidden.** Task 5 Step 3 shows `func: injectOverlayFn` and then immediately corrects it to a `new Function` wrapper, because `executeScript` serialises the function and cannot pass `document`/`window` as arguments. Implement the wrapper version. The first form is shown only because the correction is the point — a plain `func: injectOverlayFn` silently receives `undefined` for `doc` and throws inside the page where it is awkward to see.

## Next

Plan 3 (desktop WPF app) is not yet written. It shares no code with this plan — only the asset pack and the roll algorithm's definition.
