import { defineConfig, devices } from "@playwright/test";

/**
 * Chaconne isolated e2e + keyboard-only lane (ticket C-6, P0 #4's K-1
 * law + P0 #7's battery-wiring start). The PLAN §4 config spec,
 * verbatim:
 *
 * - testDir "e2e", testMatch /chaconne-.*\.spec\.ts/ — selects ONLY
 *   the chaconne specs; the root landing lane (playwright.config.ts)
 *   and the Coda/Ostinato lanes never arm this marker, so the
 *   chaconne specs self-skip under every other lane (the Coda
 *   CODA_E2E / Ostinato OSTINATO_E2E self-skip-guard precedent).
 * - module-scope process.env.CHACONNE_E2E = "1" arms the marker.
 * - outputDir "download/test-results-chaconne" (gitignored scratch).
 * - baseURL http://127.0.0.1:4014; chromium-desktop-only project
 *   (devices["Desktop Chrome"] — the PRD's platform-scope statement).
 * - ONE webServer entry: bun apps/chaconne/serve.mjs (env
 *   CHACONNE_PORT 4014) — the PWA + fixtures lane; the runner's
 *   real adapter addresses the fixtures on the SAME server
 *   (http://127.0.0.1:4014/test/fixtures/…).
 * - reuseExistingServer: !process.env.CI, timeout 60_000 (Ostinato's
 *   values verbatim).
 *
 * No new dependency: the specs reuse the root `@playwright/test`
 * (the zero-dep law — the APP has zero deps; the test lane uses the
 * repo's existing Playwright setup, the Coda C4 / Ostinato O-3
 * precedent).
 *
 * LOCATION NOTE: the spec lives at the repo root's `e2e/` dir (the
 * Coda precedent — the app dir holds NO playwright files). The
 * webServer command + the outputDir are repo-root-relative. Run from
 * the repo root: `bunx playwright test -c
 * playwright.chaconne.config.ts` (C-11 lands the `chaconne:e2e`
 * script entry; until then the verifier runs this command directly).
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
  timeout: 60_000,
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
