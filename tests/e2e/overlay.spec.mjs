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
