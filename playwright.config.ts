import { defineConfig, devices } from "@playwright/test";

/**
 * E2E + a11y gate (docs/testing-strategy.md §6 gate 16).
 *
 * Two servers per run (webServer array):
 *   1. the mock engine (e2e/mock-engine.mjs) on :3030 — the full REST + SSE
 *      contract the dashboard consumes, CORS-open, zero deps;
 *   2. the PRODUCTION standalone Next server on :3210 — the same artifact the
 *      CI `build` job boots for its 200-smoke.
 *
 * DIRECT api mode: the build must inline NEXT_PUBLIC_AGENT_API_BASE=http://
 * 127.0.0.1:3030 (Next inlines NEXT_PUBLIC_* at BUILD time, so the e2e build
 * is a distinct artifact from the default gateway-mode build — hence a
 * dedicated CI job rather than piggybacking on the build job's artifact).
 *   NEXT_PUBLIC_AGENT_API_BASE=http://127.0.0.1:3030 bun run build
 *   bunx playwright test
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
      command: "node e2e/mock-engine.mjs 3030",
      url: "http://127.0.0.1:3030/api/overview",
      reuseExistingServer: false, // fresh mock state per run
      timeout: 20_000,
    },
    {
      command: "node .next/standalone/server.js",
      url: "http://127.0.0.1:3210/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { PORT: "3210", NODE_ENV: "production", HOSTNAME: "127.0.0.1" },
    },
  ],
});
