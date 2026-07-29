import { test, expect } from './fixtures.mjs';
import { existsSync } from 'node:fs';

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

test('does not double-inject', async ({ context, worker }) => {
  const page = await context.newPage();
  await page.goto('/plain.html');

  await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  await worker.evaluate(() => globalThis.__foxyTest.fireNow());

  await expect(page.locator(SENTINEL)).toHaveCount(1);
});

test('still fires when every tab is privileged, via a standalone window', async ({ context, worker }) => {
  // Previously this refused and kept the roll. That meant sitting on
  // about:config or a PDF made the extension silently do nothing. It now falls
  // back to its own window so the scare still lands - it just cannot be
  // transparent there.
  // Navigate rather than close: closing the last page tears down the
  // persistent context the extension is loaded into.
  const existing = context.pages();
  if (existing.length === 0) await context.newPage();
  for (const page of context.pages()) {
    await page.goto('chrome://version').catch(() => {});
  }

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  expect(fired).toBe(true);

  const overlayWindow = await context.waitForEvent('page', {
    predicate: (p) => p.url().includes('overlay.html'),
    timeout: 10_000,
  });
  expect(overlayWindow.url()).toContain('overlay.html');

  // Black, because there is no page behind this one. The stylesheet says
  // transparent for the injected-iframe case, and in a window of its own
  // "transparent" resolves to the browser's blank canvas - a fullscreen white
  // flash with a fox in it. That shipped from 0.1.1 to 0.1.4.
  const background = await overlayWindow.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor
  );
  expect(background).toBe('rgb(0, 0, 0)');
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

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/overlay.html`);

  const sample = await page.evaluate(async () => {
    const v = document.getElementById('foxy');
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
