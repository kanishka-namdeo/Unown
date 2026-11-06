import { defineConfig, devices } from "@playwright/test";

/**
 * Chaconne isolated e2e + keyboard-only lane (ticket C-6, P0 #4's
 * K-1 law + P0 #5's fixture lane + the a11y battery start).
 *
 * The `playwright.ostinato.config.ts` pattern, ported verbatim in
 * shape: this config selects ONLY the chaconne specs (the `e2e/`
 * testDir, testMatch `chaconne-.*\.spec\.ts`), boots Chaconne's
 * transpiling dev/test server (`bun apps/chaconne/serve.mjs` —
 * Bun.serve + on-the-fly .ts transpile; bun-only, hence the `bun`
 * command), and runs against http://127.0.0.1:4014 (serve.mjs's
 * default CHACONNE_PORT, the PLAN §4 naming ruling: the next free
 * port after Ostinato's 4013; Coda is 4012). Chromium-desktop-only
 * by the round's stated platform scope.
 *
 * ONE webServer entry covers BOTH the PWA lane and the fixture
 * lane (PLAN §3): serve.mjs serves `apps/chaconne/` as the document
 * root, and the fixture pages under `apps/chaconne/test/fixtures/`
 * ride the SAME server at `/test/fixtures/…` — so the e2e specs
 * AND the runner's real-adapter smoke address them identically.
 *
 * No config-level colorScheme: Chaconne owns its own light/dark via
 * `theme-color` media queries + `@media (prefers-color-scheme)` in
 * the stylesheet; the a11y spec drives BOTH schemes per-context
 * instead (the O-4 precedent).
 *
 * No new dependency: the specs reuse the root `@playwright/test`
 * (the zero-dep law — the APP has zero deps; the test lane uses
 * the repo's existing Playwright setup, the Ostinato O-3 precedent).
 *
 * Marker contract: this chaconne config arms CHACONNE_E2E; the
 * root `playwright.config.ts` never does, so the chaconne specs
 * self-skip under the root lane (the landing lane stays green and
 * untouched — the Coda CODA_E2E / Ostinato OSTINATO_E2E precedent).
 *
 * LOCATION NOTE: the specs live at the repo root's `e2e/` dir
 * (the Coda precedent — the app dir holds NO playwright files).
 * The webServer command + the outputDir are repo-root-relative.
 * Run from the repo root: `bunx playwright test
 * --config=playwright.chaconne.config.ts` (the C-11 script `chaconne:e2e`).
 */
// Marker contract: this chaconne config arms CHACONNE_E2E; the root
// config never does, so chaconne specs self-skip under the root
// lane and the landing lane stays green and untouched.
process.env.CHACONNE_E2E = "1";

export default defineConfig({
  testDir: "e2e",
  testMatch: /chaconne-.*\.spec\.ts/,
  outputDir: "download/test-results-chaconne", // gitignored scratch
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "download/playwright-report-chaconne", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: "http://127.0.0.1:4014",
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
      command: "bun apps/chaconne/serve.mjs",
      url: "http://127.0.0.1:4014/",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { CHACONNE_PORT: "4014" },
    },
  ],
});
