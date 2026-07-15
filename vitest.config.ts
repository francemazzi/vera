import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/cli.ts", "**/generated/**"],
    },
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
