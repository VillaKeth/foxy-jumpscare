import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    // Integration tests shell out to ffmpeg, which blows past the 5s default.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
