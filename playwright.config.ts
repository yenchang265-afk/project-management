import { defineConfig, devices } from "@playwright/test";

/* E2E config for Cadence.
   Phase 1: state persists in MariaDB. Each test re-seeds via the e2e-only
   /api/test/reset endpoint and signs in as the seed PM (helpers.resetAndLogin),
   so tests MUST run serially — parallel workers would clobber the shared fixture. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  // Dedicated port (not the default 3000) so e2e never collides with a running dev server.
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // merge explicitly — Playwright replaces the child env when `env` is set
    env: { ...process.env as Record<string, string>, E2E_TEST: "1" },
  },
});
