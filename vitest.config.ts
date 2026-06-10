import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";

// `npm test` runs the pure unit tests (engine + command layer).
// Playwright e2e (e2e/) and the stale .claude worktree copy are excluded.
// Integration tests (src/server/**/*.integration.test.ts) self-skip without DATABASE_URL.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
  },
});
