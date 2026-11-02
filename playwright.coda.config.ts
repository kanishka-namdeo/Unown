import { defineConfig, devices } from "@playwright/test";

/**
 * Coda isolated e2e + a11y lane (ticket C4, plan step 6).
 *
 * Everything about the LANDING lane (playwright.config.ts) stays untouched:
 * this config selects ONLY the coda specs, boots Coda's own transpiling
 * dev/test server (bun apps/coda/scripts/serve.mjs — Bun.serve +
 * on-the-fly .ts transpile; bun-only, hence the `bun` command), and runs
 * against http://127.0.0.1:4012. Chromium-desktop-only by the round's
 * stated platform scope.
 *
 * No config-level colorScheme: Coda owns its own light/dark (coda.css
 * `:root` + `@media (prefers-color-scheme: dark)`). Emulating one scheme
 * here would only prove ONE branch of the app's own switch; the a11y
 * spec drives BOTH schemes per-context instead.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /coda-.*\.spec\.ts/,
  outputDir: "download/test-results-coda", // gitignored scratch
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "download/playwright-report-coda", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: "http://127.0.0.1:4012",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // bun-only: the server transpiles .ts with Bun.Transpiler.
      command: "bun apps/coda/scripts/serve.mjs",
      url: "http://127.0.0.1:4012/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { CODA_PORT: "4012" },
    },
  ],
});
