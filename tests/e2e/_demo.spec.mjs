import { test } from './fixtures.mjs';
import { mkdir } from 'node:fs/promises';

/**
 * Not a test - a capture run. Fires the overlay over a realistic page and
 * screenshots the lunge, to show the thing actually working.
 *
 * Run with: npx playwright test _demo
 */
test('capture the overlay firing', async ({ context, worker }) => {
  test.skip(process.env.FOXY_CAPTURE !== '1', 'capture run only — set FOXY_CAPTURE=1');

  const dir = 'docs/screenshots';
  await mkdir(dir, { recursive: true });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/demo.html');

  await page.screenshot({ path: `${dir}/01-before.png` });

  const fired = await worker.evaluate(() => globalThis.__foxyTest.fireNow());
  if (!fired) throw new Error('overlay did not fire');

  // Grab the overlay's own frame so the video can be parked at chosen moments.
  // Left running it would be gone in under a second.
  await page.waitForSelector('#foxy-jumpscare-overlay');
  const frame = page.frames().find((f) => f.url().includes('overlay.html'));
  if (!frame) throw new Error('overlay frame not found');

  await frame.waitForFunction(() => {
    const v = document.getElementById('foxy');
    return v && v.readyState >= 2;
  });

  for (const [i, frac] of [0.35, 0.6, 0.9].entries()) {
    await frame.evaluate(async (f) => {
      const v = document.getElementById('foxy');
      v.pause();
      v.currentTime = v.duration * f;
      await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
    }, frac);

    await page.screenshot({ path: `${dir}/0${i + 2}-lunge-${Math.round(frac * 100)}.png` });
  }

  console.log(`captured to ${dir}`);
});
