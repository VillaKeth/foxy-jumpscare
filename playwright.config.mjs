import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 60_000,
  // MV3 extensions need a persistent context and a real browser window, so
  // these cannot share a browser or run concurrently.
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:8392' },
  webServer: {
    command: 'node tests/e2e/serve.mjs',
    url: 'http://localhost:8392/plain.html',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
