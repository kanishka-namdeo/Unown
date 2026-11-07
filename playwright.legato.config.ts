import { defineConfig, devices } from "@playwright/test";

/**
 * Legato isolated e2e + offline lane (ticket L-10, the PWA
 * offline-first surface + PLAN §6.4's dual-server form).
 *
 * The `playwright.ostinato.config.ts` / `playwright.fugue.config.ts`
 * pattern, ported: this config selects ONLY the legato spec (the
 * `e2e/` testDir, testMatch `legato-.*\.spec\.ts`), boots Legato's
 * transpiling dev/test server (`bun apps/legato/serve.mjs` —
 * Bun.serve + on-the-fly .ts transpile; bun-only, hence the `bun`
 * command), and runs against http://127.0.0.1:4017 (serve.mjs's
 * default LEGATO_PORT, PLAN §5.1). Chromium-desktop-only by the
 * PRD's platform scope.
 *
 * THE DUAL-SERVER FORM (PLAN §6.4, L-10 deliverable #4): TWO
 * webServer entries —
 *   #1: `bun apps/legato/serve.mjs` (LEGATO_PORT=4017) — the app
 *       lane; its /health probe is the cheap liveness the lane
 *       waits on before launching specs (serve.mjs's L-1 contract).
 *   #2: `bun apps/legato/scripts/fixture-server.mjs`
 *       (LEGATO_FIXTURE_PORT=4018) — the hostile-fixture lane the
 *       L-11 battery drives; it lands NOW with L-10 so the port
 *       pin lives in exactly ONE file (PLAN §5.2 port-drift
 *       mitigation: both port pins live here + in the server
 *       headers — one file per port, no scattered literals).
 *
 * No config-level colorScheme: Legato owns its own light/dark (the
 * L-5 theme lane); the a11y battery (L-11) drives both schemes
 * per-context instead.
 *
 * No new dependency: the spec reuses the root `@playwright/test`
 * (the zero-dep law — the APP has zero deps; the test lane uses
 * the repo's existing Playwright setup, the Coda C4 / Ostinato
 * O-3 precedent).
 *
 * Marker contract: this legato config arms LEGATO_E2E; the root
 * `playwright.config.ts` never does, so the legato specs
 * self-skip under the root lane (the landing lane stays green
 * and untouched — the Coda CODA_E2E / Ostinato OSTINATO_E2E /
 * Fugue FUGUE_E2E precedent).
 *
 * LOCATION NOTE: the spec lives at the repo root's `e2e/` dir
 * (the Coda precedent — the app dir holds NO playwright files).
 * The webServer command + the outputDir are repo-root-relative.
 * Run from the repo root: `LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts`.
 */
// Marker contract: this legato config arms LEGATO_E2E; the root
// config never does, so legato specs self-skip under the root
// lane and the landing lane stays green and untouched.
process.env.LEGATO_E2E = "1";

export default defineConfig({
  testDir: "e2e",
  testMatch: /legato-.*\.spec\.ts/,
  outputDir: "download/test-results-legato", // gitignored scratch
  fullyParallel: false,
  workers: process.env.CI ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { outputFolder: "download/playwright-report-legato", open: "never" }]],
  timeout: 30_000,
  expect: { timeout: 6_000 },
  use: {
    baseURL: "http://127.0.0.1:4017",
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
      // #1 — the app lane: bun-only, the server transpiles .ts
      // with Bun.Transpiler. LEGATO_PORT=4017 (PLAN §5.1).
      command: "bun apps/legato/serve.mjs",
      url: "http://127.0.0.1:4017/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { LEGATO_PORT: "4017" },
    },
    {
      // #2 — the hostile-fixture lane (L-11 drives it; lands at
      // L-10 so the port pin is single-sourced). LEGATO_FIXTURE_PORT=4018.
      command: "bun apps/legato/scripts/fixture-server.mjs",
      url: "http://127.0.0.1:4018/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { LEGATO_FIXTURE_PORT: "4018" },
    },
  ],
});
