import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup.integration.ts"],
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
