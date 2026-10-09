import { test, expect } from './fixtures.mjs';
import { existsSync } from 'node:fs';

const SENTINEL = '#foxy-jumpscare-overlay';

/**
 * Seed storage, once the extension has finished seeding it itself. Each test
 * gets a throwaway profile, so onInstalled fires and writes defaults; writing
 * before that lands gets silently overwritten.
 */
async function setState(worker, state) {
  await worker.evaluate(async () => {
    for (let i = 0; i < 200; i += 1) {
      if ((await chrome.storage.local.get('remaining')).remaining !== undefined) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('extension never initialised its countdown');
  });
  await worker.evaluate((s) => chrome.storage.local.set(s), state);
}

/**
 * Leave the browser with nowhere the overlay can be injected.
 *
 * Navigate rather than close: closing the last page tears down the persistent
 * context the extension is loaded into.
 */
async function makeEveryTabPrivileged(context) {
  if (context.pages().length === 0) await context.newPage();
  for (const page of context.pages()) {
    await page.goto('chrome://version').catch(() => {});
  }
}

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
  // The whole reason the overlay is an extension-origin iframe: a raw injected
  // <video> is blocked outright by this page's CSP.
  const page = await context.newPage();
  await page.goto('/strict-csp.html');

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(true);
  await expect(page.locator(SENTINEL)).toBeAttached();
});

test('fires across every tab, not just the active one', async ({ context, worker }) => {
  // Scoped to the active tab, the scare silently did nothing whenever you were
  // on a restricted page, and did not follow you if you switched tabs.
  const a = await context.newPage();
  await a.goto('/plain.html');
  const b = await context.newPage();
  await b.goto('/demo.html');
  const c = await context.newPage();
  await c.goto('/strict-csp.html');

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(true);

  await expect(a.locator(SENTINEL)).toBeAttached();
  await expect(b.locator(SENTINEL)).toBeAttached();
  await expect(c.locator(SENTINEL)).toBeAttached();
});

/** The overlay's own <video>, reached through the extension-origin iframe. */
const overlayVideo = (page) => page.frameLocator(SENTINEL).locator('#foxy');

test('only the tab you are on makes a sound', async ({ context, worker }) => {
  // Every tab still gets Foxy, so he is there if you switch mid-scream - but
  // every copy used to scream too, and ten open tabs was a ten-part chorus
  // from tabs nobody could see.
  const background = await context.newPage();
  await background.goto('/plain.html');
  const front = await context.newPage();
  await front.goto('/demo.html');
  await front.bringToFront();

  expect(await worker.evaluate(() => globalThis.__foxyTest.fireNow())).toBe(true);

  await expect.poll(() => overlayVideo(background).evaluate((v) => v.muted)).toBe(true);
  await expect.poll(() => overlayVideo(front).evaluate((v) => v.muted)).toBe(false);
  // And it actually plays. The <video> has no autoplay attribute - overlay.js
  // must decide muted-or-not before anything starts - so play() is all there is.
  await expect.poll(() => overlayVideo(front).evaluate((v) => v.currentTime)).toBeGreaterThan(0);
});

test('every tab screams when the user asked for that', async ({ context, worker }) => {
  await setState(worker, { soundEveryTab: true });
  const background = await context.newPage();
  await background.goto('/plain.html');
  const front = await context.newPage();
  await front.goto('/demo.html');
  await front.bringToFront();

  expect(await worker.evaluate(() => globalThis.__foxyTest.fireNow())).toBe(true);

  await expect.poll(() => overlayVideo(background).evaluate((v) => v.muted)).toBe(false);
});

test('does not double-inject', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/plain.html');

  await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  await worker.evaluate(() => globalThis.__foxyTest.fireNow());

  await expect(page.locator(SENTINEL)).toHaveCount(1);
});

test('declines to fire when every tab is privileged and the fallback is off', async ({ context, worker }) => {
  // Not the shipped default any more - 0.1.9 turned the fallback on - but what
  // a user who unticks the box gets. The scare tab is the one overlay that
  // cannot be transparent - it has a photo of the page behind it at best - so
  // with nowhere to draw it draws nothing.
  //
  // Nothing is lost by declining: reporting false leaves the roll unspent, so
  // the next tick lands transparently on the first ordinary tab opened.
  //
  // fallbackChosen marks this as the user's own choice. Without it seedState
  // treats the stored false as a default this extension wrote and replaces it
  // with the current one, which is exactly the migration this test must not
  // trip over.
  await setState(worker, { fallbackWindow: false, fallbackChosen: true });
  await makeEveryTabPrivileged(context);

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(false);

  const scareTab = await context
    .waitForEvent('page', {
      predicate: (p) => p.url().includes('overlay.html'),
      timeout: 3_000,
    })
    .catch(() => null);
  expect(scareTab).toBeNull();
});

/** The tab in front of the user, as the extension sees it. */
const activeTab = (worker) => worker.evaluate(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return { id: tab.id, index: tab.index, windowId: tab.windowId };
});

test('opens Foxy in a tab beside a page he cannot draw on, then hands the page back', async ({ context, worker, extensionId }) => {
  // On by default since 0.1.9. Before the setting existed it was unconditional,
  // which is how a user sitting on about:addons got a fullscreen black screen
  // instead of the scare they expected; 0.1.7 made it opt-in, and that turned
  // out to mean the scare silently did nothing on PDFs, on about: pages, and on
  // any new tab page supplied by another extension.
  //
  // It was a fullscreen popup window until 0.1.11. That blacked out the tab
  // strip, the toolbar and the taskbar for the length of the scare, took twice
  // as long to appear, and drew privileged about: pages ~80px too high. A tab
  // in the same window replaces the page area and nothing else.
  await setState(worker, { fallbackWindow: true, fallbackChosen: true });
  await makeEveryTabPrivileged(context);
  await context.pages()[0].bringToFront();
  const page = await activeTab(worker);

  const opened = context.waitForEvent('page', {
    predicate: (p) => p.url().includes('overlay.html'),
    timeout: 10_000,
  });
  expect(await worker.evaluate(() => globalThis.__foxyTest.fireNow())).toBe(true);
  const scare = await opened;

  // Right beside the page, in front of the user, and owned by it - the owner
  // is who the user is handed back to.
  const beside = await worker.evaluate(async ({ windowId, index }) => {
    const [tab] = await chrome.tabs.query({ windowId, index });
    return tab && { active: tab.active, openerTabId: tab.openerTabId };
  }, { windowId: page.windowId, index: page.index + 1 });
  expect(beside).toEqual({ active: true, openerTabId: page.id });

  // One look while it plays: the clip is under a second long, and the tab is
  // gone soon after.
  const seen = await scare.evaluate(() => new Promise((resolve) => {
    const video = document.getElementById('foxy');
    const look = () => resolve({
      muted: video.muted,
      playing: !video.paused && video.currentTime > 0,
      // Black underneath, never the browser's white canvas - a white flash
      // before a jumpscare is what the photosensitivity warning is for.
      background: getComputedStyle(document.documentElement).backgroundColor,
      // Whatever photo it carried has left the address bar.
      href: location.href,
    });
    if (!video.paused && video.currentTime > 0) look();
    else video.addEventListener('timeupdate', look, { once: true });
  }));
  expect(seen).toEqual({
    muted: false,
    playing: true,
    background: 'rgb(0, 0, 0)',
    href: `chrome-extension://${extensionId}/overlay.html`,
  });

  // Done: the tab goes, and the user is back on the page they were on. Well
  // inside the background's 10s backstop, which would otherwise hide a close
  // request the background ignored.
  if (!scare.isClosed()) await scare.waitForEvent('close', { timeout: 5_000 });
  await expect.poll(async () => (await activeTab(worker)).id).toBe(page.id);
});

test('a scare tab that comes back stays silent and closes itself', async ({ context, extensionId }) => {
  // Chrome cannot keep the closed scare tab out of Recently Closed, so
  // Ctrl+Shift+T brings it back - with the URL already stripped of everything
  // that made it a scare. A reload mid-scare and session restore after a crash
  // land the same way. A replay screaming out of nowhere, minutes later, is
  // the one scare nobody should get.
  const stray = await context.newPage();
  const logs = [];
  stray.on('console', (message) => logs.push(message.text()));
  const closed = stray.waitForEvent('close', { timeout: 10_000 });

  await stray.goto(`chrome-extension://${extensionId}/overlay.html`).catch(() => {});
  await closed;
  expect(logs.filter((text) => text.startsWith('[foxy] playing'))).toEqual([]);
});

test('the overlay tears itself down', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/plain.html');
  await worker.evaluate(() => globalThis.__foxyTest.fireNow());

  await expect(page.locator(SENTINEL)).toBeAttached();
  // Either path must clear it: the video's own 'ended', or - if the asset is
  // missing and it never plays - the 8s failsafe.
  await expect(page.locator(SENTINEL)).toHaveCount(0, { timeout: 20_000 });
});

test('the shipped video actually carries alpha', async ({ context, extensionId }) => {
  // ffmpeg cannot decode VP9 alpha, so this is the only automated place the
  // transparency of the shipped asset is verifiable. See assets/PACK.md.
  test.skip(
    !existsSync('dist/chrome/foxy.webm'),
    'assets/foxy.webm not built yet - run npm run assets (needs the source clip)'
  );

  // The file itself, not overlay.html: opened on its own, that is a stray and
  // closes itself (see above).
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/foxy.webm`);

  const sample = await page.evaluate(async () => {
    const v = document.querySelector('video');
    await new Promise((resolve, reject) => {
      if (v.readyState >= 2) return resolve();
      v.addEventListener('loadeddata', resolve, { once: true });
      v.addEventListener('error', () => reject(new Error('video failed to load')), { once: true });
    });

    v.pause();
    // Mid-clip: Foxy is large enough to be a real subject, but has not yet
    // grown to fill the frame, so there is both something opaque to find and
    // plenty of background that should have keyed out.
    v.currentTime = v.duration * 0.5;
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));

    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(v, 0, 0);

    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let clear = 0;
    let solid = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a <= 2) clear += 1;
      else if (a === 255) solid += 1;
      // Surviving key colour: strong green, low red and blue, still visible.
      if (a > 128 && data[i + 1] > 200 && data[i] < 80 && data[i + 2] < 80) green += 1;
    }

    const total = data.length / 4;
    return {
      clearPct: (100 * clear) / total,
      solidPct: (100 * solid) / total,
      greenPct: (100 * green) / total,
      corner: [...ctx.getImageData(2, 2, 1, 1).data],
      centre: [...ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data],
    };
  });

  // Most of the frame keyed out. Asserting a single corner pixel is exactly 0
  // was the original test and it was wrong twice over: chromakey leaves a 1/255
  // residue (0.4% opacity, invisible), and one pixel proves nothing about the
  // key anyway.
  expect(sample.clearPct).toBeGreaterThan(60);
  expect(sample.corner[3]).toBeLessThanOrEqual(2);

  // Foxy himself survived, fully opaque.
  expect(sample.solidPct).toBeGreaterThan(5);
  expect(sample.centre[3]).toBe(255);

  // No meaningful green fringe left behind - the thing that looks worst
  // against a dark page.
  expect(sample.greenPct).toBeLessThan(0.5);
});
