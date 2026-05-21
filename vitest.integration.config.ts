import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Disable rate limiting for the integration tier — multi-test runs would
// share a single RateLimitBucket row per IP key and cause cross-test
// interference. The middleware honours this flag at request time.
process.env.DISABLE_RATE_LIMIT = '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['node_modules/**'],
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      DISABLE_RATE_LIMIT: '1',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
