import { defineConfig, devices } from "@playwright/test";

/**
 * Ostinato isolated e2e + keyboard-only lane (ticket O-3, P0
 * #3/#4/#5 + the PRD's "zero pointer events in the spec"
 * hardening row).
 *
 * The `playwright.coda.config.ts` pattern, ported: this config
 * selects ONLY the ostinato spec (the `e2e/` testDir,
 * testMatch `ostinato-.*\.spec\.ts`), boots Ostinato's
 * transpiling dev/test server (`bun apps/ostinato/serve.mjs` —
 * Bun.serve + on-the-fly .ts transpile; bun-only, hence the
 * `bun` command), and runs against http://127.0.0.1:4013
 * (serve.mjs's default OSTINATO_PORT). Chromium-desktop-only
 * by the round's stated platform scope.
 *
 * No config-level colorScheme: Ostinato owns its own light/dark;
 * emulating one scheme here would only prove ONE branch. O-4's
 * a11y battery drives both schemes per-context instead.
 *
 * No new dependency: the spec reuses the root `@playwright/test`
 * (the zero-dep law — the APP has zero deps; the test lane uses
 * the repo's existing Playwright setup, the Coda C4 precedent).
 *
 * Marker contract: this ostinato config arms OSTINATO_E2E; the
 * root `playwright.config.ts` never does, so the ostinato specs
 * self-skip under the root lane (the landing lane stays green
 * and untouched — the Coda CODA_E2E precedent).
 *
 * LOCATION NOTE: the spec lives at the repo root's `e2e/` dir
 * (the Coda precedent — the app dir holds NO playwright files).
 * The webServer command + the outputDir are repo-root-relative.
 * Run from the repo root: `bunx playwright test
 * --config=playwright.ostinato.config.ts`.
 */
// Marker contract: this ostinato config arms OSTINATO_E2E; the root
// config never does, so ostinato specs self-skip under the root
// lane and the landing lane stays green and untouched.
process.env.OSTINATO_E2E = "1";

export default defineConfig({
  testDir: "e2e",
  testMatch: /ostinato-.*\.spec\.ts/,
  outputDir: "download/test-results-ostinato", // gitignored scratch
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "download/playwright-report-ostinato", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: "http://127.0.0.1:4013",
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
      command: "bun apps/ostinato/serve.mjs",
      url: "http://127.0.0.1:4013/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { OSTINATO_PORT: "4013" },
    },
  ],
});
