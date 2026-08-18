import { test, expect } from './fixtures.mjs';

const SENTINEL = '#foxy-jumpscare-overlay';

const readState = (worker) =>
  worker.evaluate(() =>
    chrome.storage.local.get(['enabled', 'oneInN', 'remaining', 'fallbackWindow']));

/**
 * Seed storage, once the extension has finished seeding it itself.
 *
 * Each test gets a throwaway profile, so onInstalled fires and draws a fresh
 * countdown. Writing before that lands gets silently overwritten - which is
 * exactly the flake this waits out.
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

const openPanel = async (context, extensionId) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  return panel;
};

test('the panel reports the current odds and countdown', async ({ context, worker, extensionId }) => {
  await setState(worker, { oneInN: 100_000, remaining: 90_061, enabled: true });

  const panel = await openPanel(context, extensionId);

  // "chance" is load-bearing: without it this reads as "one every 100,000
  // seconds", which is a different claim from a per-second probability.
  await expect(panel.locator('#odds-note')).toHaveText(
    '1 in 100,000 chance every active second, so about once every 7 days.'
  );
  await expect(panel.locator('#remaining')).toHaveText('1d 1h');
  await expect(panel.locator('#enabled')).toBeChecked();
  await expect(panel.locator('#odds')).toHaveValue('normal');
});

test('changing the rarity redraws the countdown', async ({ context, worker, extensionId }) => {
  // A countdown drawn at the old odds keeps running against the new setting,
  // so without the redraw the control appears to do nothing for a week.
  await setState(worker, { oneInN: 100_000, remaining: 5_000_000 });

  const panel = await openPanel(context, extensionId);
  await panel.locator('#odds').selectOption('terraria-faithful');
  await expect(panel.locator('#status')).toHaveText('Saved. Countdown restarted.');

  const state = await readState(worker);
  expect(state.oneInN).toBe(10_000);
  expect(state.remaining).toBeLessThan(5_000_000);
});

test('custom odds are accepted and rejected on their merits', async ({ context, worker, extensionId }) => {
  await setState(worker, { oneInN: 100_000, remaining: 100_000 });

  const panel = await openPanel(context, extensionId);
  await panel.locator('#odds').selectOption('custom');
  await expect(panel.locator('#custom-field')).toBeVisible();

  await panel.locator('#custom').fill('250');
  await panel.locator('#custom').blur();
  await expect(panel.locator('#odds-note')).toContainText('1 in 250');
  expect((await readState(worker)).oneInN).toBe(250);

  await panel.locator('#custom').fill('0');
  await panel.locator('#custom').blur();
  await expect(panel.locator('#status')).toHaveText('Enter a whole number of 1 or more.');
  // Rejected input must not be written through.
  expect((await readState(worker)).oneInN).toBe(250);
});

// openPanel opens the panel in a tab of its own, so the panel IS the active
// tab for the whole of these two tests - there is no ordinary page in front of
// the user. That is the "nothing to draw on" case, which is exactly what the
// fallback setting governs. (In real use the panel is a popup and the page
// behind it stays active, which is the plain injected path the tests above
// already cover.)

test('"Test it now" fires without spending the real roll', async ({ context, worker, extensionId }) => {
  await setState(worker, { oneInN: 100_000, remaining: 42_000, fallbackWindow: true });

  const page = await context.newPage();
  await page.goto('/plain.html');

  const panel = await openPanel(context, extensionId);
  await panel.locator('#test').click();

  await expect(panel.locator('#status')).toHaveText('Fired. The real countdown was not spent.');
  await expect(page.locator(SENTINEL)).toBeAttached();

  // The invariant: a test - successful or not - leaves the countdown alone.
  expect((await readState(worker)).remaining).toBe(42_000);
});

test('"Test it now" says so rather than going black, with the fallback off', async ({ context, worker, extensionId }) => {
  await setState(worker, { oneInN: 100_000, remaining: 42_000, fallbackWindow: false });

  const page = await context.newPage();
  await page.goto('/plain.html');

  const panel = await openPanel(context, extensionId);
  await panel.locator('#test').click();

  await expect(panel.locator('#status'))
    .toHaveText('Could not fire — open an ordinary http(s) tab and try again.');

  // The background tab still took the overlay, so a tab switch mid-scream is
  // covered. It just does not count as the user having seen it.
  await expect(page.locator(SENTINEL)).toBeAttached();
  expect((await readState(worker)).remaining).toBe(42_000);
});

test('the fallback checkbox is off by default and persists when ticked', async ({ context, worker, extensionId }) => {
  await setState(worker, { oneInN: 100_000, remaining: 90_061 });

  const panel = await openPanel(context, extensionId);
  await expect(panel.locator('#fallback')).not.toBeChecked();

  await panel.locator('#fallback').check();
  await expect(panel.locator('#status'))
    .toHaveText('Will use a black fullscreen window when there is no page.');
  expect((await readState(worker)).fallbackWindow).toBe(true);
});
