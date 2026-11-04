/**
 * Ostinato — the offline lane (ticket O-4, P0 #5 offline-first +
 * the PRD hardening row "the app's PWA surface: offline reload
 * boots from the precache").
 *
 * The Coda offline precedent (e2e/coda-offline.spec.ts) ported:
 * SW controlled → offline reload → the review loop completes
 * offline → non-precached URL lands on the offline page.
 *
 * The O-1 chunk-1 design (chunk 1 + chunk 3):
 *
 * - `registerServiceWorker()` in app.ts (chunk 1, GAP 2) makes
 *   the FIRST load controlled: `clients.claim()` in sw.js's
 *   activate handler claims the current client immediately, so
 *   `navigator.serviceWorker.controller !== null` by the time
 *   the card front is visible.
 * - The 18-entry `PRECACHE_LIST` (chunk 3) covers the full
 *   module graph (the 5 shell assets + the entry + the 11
 *   `.js`-convention module forms), so an offline reload serves
 *   every subresource from cache — the review loop never touches
 *   the network.
 * - `localStorage` data survives the reload (the same-origin
 *   storage is per-context, not per-load), so the seeded deck +
 *   card + session survive an offline reload.
 *
 * Seeding: one deck + one card, the O-3 spec's committed
 * data-key shape (toCanonicalJson's sorted-keys/compact-
 * separators format). The card is never-graded → always due →
 * the queue is non-empty on boot.
 *
 * Self-skip: the spec runs under the ostinato config's
 * `OSTINATO_E2E` marker (the Coda `CODA_E2E` precedent); under
 * the root `playwright.config.ts` the marker is unset and the
 * spec self-skips (the landing lane stays untouched).
 *
 * Execution honesty: this spec LANDS COMPLETE but is NOT
 * executed in this build sandbox (Playwright + Chromium are not
 * runnable here). The operator gate re-runs it via
 * `bunx playwright test --config=playwright.ostinato.config.ts`
 * from the repo root. No run is claimed in the receipt that was
 * not performed.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.OSTINATO_E2E,
  "ostinato lane only — run via playwright.ostinato.config.ts",
);

/**
 * The seed data set: one deck, one card (the minimal reviewable
 * unit). The bytes match the app's committed data-key shape
 * exactly (sorted keys, compact separators — the O-2 lane's
 * byte-stable export).
 */
const SEED_DATA = JSON.stringify({
  cards: [
    {
      back: "The answer is **42**.",
      createdAt: "2026-11-04T00:00:00Z",
      deckId: "d1",
      front: "What is the answer to the ultimate question?",
      id: "c1",
      updatedAt: "2026-11-04T00:00:00Z",
    },
  ],
  decks: [
    {
      cardOrder: ["c1"],
      createdAt: "2026-11-04T00:00:00Z",
      id: "d1",
      name: "E2E seed deck",
      updatedAt: "2026-11-04T00:00:00Z",
    },
  ],
});

/**
 * Boot to a CONTROLLED page: seed localStorage before the app's
 * module script runs, navigate, wait for the card front + the
 * queue progress, then wait for the service worker to claim this
 * client. The chunk-1 registration + sw.js's `clients.claim()`
 * make the FIRST load controlled; the 18-entry install precache
 * covers the full module graph.
 */
async function bootControlled(page: Page): Promise<void> {
  await page.addInitScript(
    (json: string) => {
      window.localStorage.setItem("ostinato.data", json);
    },
    SEED_DATA,
  );
  await page.goto("/");
  // Boot: storage.recover → load → io.importData → startSession →
  // renderBoot. The card face + the queue progress are the ready
  // signal.
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 1");
  // The service worker's `clients.claim()` makes the first load
  // controlled. The controller being non-null is the ready
  // signal: from this point, every subresource is served through
  // the fetch handler (network-first + the runtime cache belt),
  // and an offline reload hits the install precache.
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );
}

test.describe.configure({ mode: "serial" });

test("boots controlled, offline reload boots from cache, the review loop completes offline", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // Fresh context: no SW, no localStorage. Boot to a controlled
  // page (the 18-entry precache installed at SW install).
  await bootControlled(page);

  // P0 installability inventory: the manifest must fetch (the
  // chunk-1 shell asset, in the precache).
  const manifestRes = await page.request.get("/public/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);

  // Offline reload #1: the app boots FROM THE PRECACHE. The
  // module graph is served from the install precache (the
  // fetch handler's runtime cache belt never saw the first
  // load's subresources — they were fetched pre-control — so
  // the precache is the only source). The localStorage data
  // survived (same-origin storage is per-context, not per-load),
  // so the queue + the card are intact.
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 1");

  // THE LOOP RUNS OFFLINE: the full review lane — Space reveal →
  // `3` grade → the done state — never touches the network (every
  // subresource is served from the precache).
  await page.keyboard.press(" ");
  await expect(page.locator(".ostinato-card-back")).toBeVisible();
  await page.keyboard.press("3");
  await expect(
    page.locator(".ostinato-state", { hasText: "Review complete" }),
  ).toBeVisible();

  await ctx.close();
});

test("offline navigation to a non-precached URL lands on the offline page", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();
  await bootControlled(page);
  await ctx.setOffline(true);
  // A same-origin URL NOT in PRECACHE_LIST: sw.js's navigation
  // fallback serves public/offline.html from cache (the offline
  // page's h1 is verified against apps/ostinato/public/offline.html).
  await page.goto("/public/offline-missing.html");
  await expect(page.locator("h1")).toContainText("Ostinato is offline");
  await ctx.close();
});
