import { test as base, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve('dist/chrome');

export const test = base.extend({
  context: async ({}, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'foxy-e2e-'));
    // MV3 extensions require a persistent context, and Chromium only loads
    // them with a real browser UI - headless refuses.
    const context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  },

  worker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },

  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
