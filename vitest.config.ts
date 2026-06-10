import { defineConfig, configDefaults } from "vitest/config";

// `npm test` runs the pure-engine unit tests only.
// Playwright e2e (e2e/) and the stale .claude worktree copy are excluded.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", ".claude/**"],
  },
});
