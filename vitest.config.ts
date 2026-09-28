import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace libs to their TypeScript sources, so tests never need a build.
  resolve: { conditions: ["@restatedev/source"] },
  ssr: { resolve: { conditions: ["@restatedev/source"] } },
  test: {
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Testcontainers needs time to pull/start the Restate image.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
