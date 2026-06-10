import { defineConfig, devices } from "@playwright/test";

/* E2E config for the Cadence prototype.
   The app is pure client-side and in-memory: every page load reseeds from buildSeed(),
   so each test starts from the same known fixture (PAY-412 selected, 5 work items). */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
  },
});
