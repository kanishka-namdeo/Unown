import { defineConfig, devices } from "@playwright/test";

/**
 * E2E + a11y gate (docs/testing-strategy.md §6 gate 16).
 *
 * One server per run (webServer array): the PRODUCTION standalone Next
 * server on :3210 — the same artifact the CI `build` job boots for its
 * 200-smoke. The specs are the landing page's a11y + performance-budget
 * suites (the web dashboard is retired — D7; the TUI dashboard's suites
 * live in pi-repo/packages/self-learning/test/).
 *
 * Runner note: `bunx playwright test` (or `bun run test:e2e`) executes the
 * runner under node — running the runner under bun itself is not supported.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "download/test-results", // gitignored scratch
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "download/playwright-report", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: "http://127.0.0.1:3210",
    colorScheme: "dark",
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
      command: "node .next/standalone/server.js",
      url: "http://127.0.0.1:3210/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { PORT: "3210", NODE_ENV: "production", HOSTNAME: "127.0.0.1" },
    },
  ],
});
