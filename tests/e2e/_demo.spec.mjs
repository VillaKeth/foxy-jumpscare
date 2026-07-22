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

/** The settings panel, which a store listing should show alongside the scare. */
test('capture the panel', async ({ context, worker, extensionId }) => {
  test.skip(process.env.FOXY_CAPTURE !== '1', 'capture run only — set FOXY_CAPTURE=1');

  await mkdir('docs/screenshots', { recursive: true });

  const panel = await context.newPage();
  // Render at the width Firefox actually gives a popup. In a 1280px viewport
  // the body sits at its 32rem max instead, and the odds line gets clipped.
  await panel.setViewportSize({ width: 360, height: 400 });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.waitForFunction(() => document.getElementById('odds-note').textContent.includes('1 in'));

  // Seed *after* the panel is open, so onInstalled's own draw cannot land on
  // top of it. The panel picks this up through its storage.onChanged listener,
  // which keeps the screenshot from showing whatever random number came up.
  await worker.evaluate(() =>
    chrome.storage.local.set({ oneInN: 100_000, remaining: 320_400, enabled: true })
  );
  await panel.waitForFunction(
    () => document.getElementById('remaining').textContent === '3d 17h'
  );

  await panel.screenshot({ path: 'docs/screenshots/05-panel.png', fullPage: true });
});
