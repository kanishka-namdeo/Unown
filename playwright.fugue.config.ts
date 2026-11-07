import { defineConfig, devices } from "@playwright/test";

/**
 * Fugue isolated e2e lane (ticket F-4, PLAN §5/§6).
 *
 * The `playwright.ostinato.config.ts` pattern, ported: this config
 * selects ONLY the fugue spec (the `e2e/` testDir, testMatch
 * `fugue-.*\.spec\.ts`), boots Fugue's transpiling dev/test server
 * (`bun apps/fugue/serve.mjs` — Bun.serve + on-the-fly .ts transpile;
 * bun-only, hence the `bun` command), and runs against
 * http://127.0.0.1:4015 (serve.mjs's default FUGUE_PORT, the PLAN §5
 * ops contract). Chromium-desktop-only by the PRD's platform scope.
 *
 * No new dependency: the spec reuses the root `@playwright/test`
 * (the zero-dep law — the APP has zero deps; the test lane uses the
 * repo's existing Playwright setup, the Coda C4 precedent).
 *
 * Marker contract: this fugue config arms FUGUE_E2E; the root
 * `playwright.config.ts` never does, so the fugue specs self-skip
 * under the root lane (the landing lane stays green and untouched —
 * the Coda CODA_E2E / Ostinato OSTINATO_E2E precedent).
 *
 * LOCATION NOTE: the spec lives at the repo root's `e2e/` dir
 * (the Coda precedent — the app dir holds NO playwright files).
 * The webServer command + the outputDir are repo-root-relative.
 * Run from the repo root: `FUGUE_E2E=1 bunx playwright test
 * --config=playwright.fugue.config.ts`.
 */
// Marker contract: this fugue config arms FUGUE_E2E; the root config
// never does, so fugue specs self-skip under the root lane.
process.env.FUGUE_E2E = "1";

export default defineConfig({
  testDir: "e2e",
  testMatch: /fugue-.*\.spec\.ts/,
  outputDir: "download/test-results-fugue", // gitignored scratch
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "download/playwright-report-fugue", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: "http://127.0.0.1:4015",
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
      command: "bun apps/fugue/serve.mjs",
      url: "http://127.0.0.1:4015/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { FUGUE_PORT: "4015" },
    },
  ],
});
