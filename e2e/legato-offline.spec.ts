/**
 * Legato — the offline lane (ticket L-10, the PWA offline-first
 * surface + the PRD's "offline reload boots from the precache"
 * hardening row).
 *
 * The Ostinato offline precedent (e2e/ostinato-offline.spec.ts)
 * ported, reshaped for the IDB-storage seam:
 *
 * - `registerServiceWorker()` in app.ts (the Ostinato O-4 pattern)
 *   makes the FIRST load controlled: `clients.claim()` in sw.js's
 *   activate handler claims the current client immediately, so
 *   `navigator.serviceWorker.controller !== null` by the time the
 *   clip list is visible.
 * - The 28-entry `PRECACHE_LIST` (L-10) covers the full runtime
 *   closure (the 5 shell assets + the entry + the module graph +
 *   the dynamic-import forms), so an offline reload serves every
 *   subresource from cache — the app never touches the network.
 * - The Legato data set lives in IndexedDB (the Ostinato law's
 *   deliberate departure — clip bodies exceed localStorage quota),
 *   and IDB is per-origin and SURVIVES the reload, so the seeded
 *   clip survives the offline reload. The spec seeds it with a
 *   `window.indexedDB` open hook that writes the committed record
 *   + the meta record in ONE transaction before the app's
 *   `main()` loads.
 *
 * THE THREE LANES:
 *   1. boot online → the SW registers → wait for the controller
 *      claim → go offline → RELOAD → the app boots from the
 *      PRECACHE (the clip row renders, the detail pane opens via
 *      Enter — zero pointer events — no navigator error).
 *   2. offline navigation to a non-precached URL lands on
 *      `public/offline.html` (the honest offline panel).
 *   3. the boot-clip flow STILL WORKS OFFLINE: with the clip
 *      seeded into IDB before going offline, the offline reload
 *      loads it from the store + opens the detail — the IDB read
 *      path is the offline proof.
 *
 * THE HOUSE LAW: zero pointer events where a keyboard path exists
 * — the navigation uses Enter (the detail open) + the keyboard;
 * a click is used only where NO keyboard path exists. This spec
 * has NO clicks at all: the row open is the Enter key.
 *
 * Self-skip: the spec runs under the legato config's `LEGATO_E2E`
 * marker (the Coda CODA_E2E / Ostinato OSTINATO_E2E / Fugue
 * FUGUE_E2E precedent); under the root `playwright.config.ts` the
 * marker is unset and the spec self-skips (the landing lane stays
 * untouched by construction).
 *
 * No run is claimed that was not performed. The operator gate
 * re-runs it via `LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts` from the repo root.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

/**
 * The seed data set: one clip (the minimal readable unit). The
 * shape matches the app's committed `LegatoData` v1 exactly (the
 * byte-stable export wire form, L-9): schema tag, schemaVersion,
 * the clips array, the tag index (empty), the queue.
 */
const SEED_DATA: Record<string, unknown> = {
  schema: "legato.v1",
  schemaVersion: 1,
  clips: [
    {
      id: 1,
      url: "http://127.0.0.1:4018/fixtures/clean.html",
      finalUrl: "http://127.0.0.1:4018/fixtures/clean.html",
      title: "Offline seed clip",
      text: "The Legato offline lane: a clip that was seeded into the store before the network dropped. This text is what the detail pane renders on an offline reload — the read path proves the IDB store survives a reload inside a fresh context.",
      tags: [],
      state: "unread",
      highlights: [],
      createdAt: "2026-11-04T00:00:00Z",
      updatedAt: "2026-11-04T00:00:00Z",
    },
  ],
  tags: [],
  queue: [],
};

/**
 * The meta record the IDB adapter's `load()` consults FIRST
 * (apps/legato/src/storage/idb-storage.ts: `STORE_META` + `Meta =
 * { schemaVersion, migrating }`). A missing meta record is fine
 * (the `?.` null-safe read), but a PRESENT record with
 * `migrating: true` makes `load()` return `null` (the S-4 lane)
 * — so the seed writes the honest committed-state record.
 */
const SEED_META = { schemaVersion: 1, migrating: false };

/**
 * Seed the real IDB store (the L-2 IDB adapter's on-disk shape:
 * DB name "legato", the "data" object store key "data" + the
 * "meta" store key "meta" — the exact stores the adapter's
 * upgrade handler creates). The seed writes the committed record
 * + the honest meta record in ONE transaction. The init script
 * runs BEFORE the page's module graph loads, so the app's
 * `main()` → `storage.recover()` + `storage.load()` finds the
 * committed record on the first boot. No delete: the origin-
 * scoped IDB persists across the offline reload (the offline
 * proof — the clip survives the reload without the seed
 * re-running, because an init script re-runs on every load
 * but the IDB record was already committed).
 */
async function seedIdb(page: Page): Promise<void> {
  await page.addInitScript(async ({ seed, meta }) => {
    const { indexedDB } = window;
    const open = (name: string, version: number) =>
      new Promise<IDBDatabase>((resolveP, rejectP) => {
        const r = indexedDB.open(name, version);
        // The spec's upgrade handler: create the stores the seed
        // transaction needs — the stores the app's own open would
        // create (the spec's seed path is INDEPENDENT of the app's
        // adapter, which runs AFTER the seed transaction).
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
          if (!db.objectStoreNames.contains("data.tmp")) db.createObjectStore("data.tmp");
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        r.onsuccess = () => resolveP(r.result);
        r.onerror = () => rejectP(r.error ?? new Error("idb open failed"));
      });
    try {
      const db = await open("legato", 1);
      const tx = db.transaction(["data", "meta"], "readwrite");
      tx.objectStore("data").put(seed, "data");
      tx.objectStore("meta").put(meta, "meta");
      await new Promise<void>((resolveP, rejectP) => {
        tx.oncomplete = () => resolveP();
        tx.onerror = () => rejectP(new Error("idb seed tx failed"));
      });
      db.close();
    } catch {
      return; // a seed failure is the lane's own to surface — never a blank
    }
  }, { seed: SEED_DATA, meta: SEED_META });
}

/**
 * Boot to a CONTROLLED page: seed IDB before the app's module
 * script runs, navigate, wait for the clip row + the status clear,
 * then wait for the service worker to claim this client. The
 * registration + sw.js's `clients.claim()` make the FIRST load
 * controlled; the install precache covers the full module graph.
 */
async function bootControlled(page: Page): Promise<void> {
  await seedIdb(page);
  await page.goto("/");
  // Boot: storage.recover → load → buildIndex → rerender. The
  // clip row (the seeded clip) is the ready signal; the status
  // line is empty on a clean boot.
  await expect(page.locator(".legato-clip-row")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.locator("#legato-status")).toHaveText("");
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

test("boots controlled, offline reload boots from cache, the read flow works offline", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // Fresh context: no SW, no IDB, no localStorage. Seed the store
  // + boot to a controlled page (the 28-entry precache installed
  // at SW install).
  await bootControlled(page);

  // P0 installability inventory: the manifest must fetch (the
  // shell asset, in the precache).
  const manifestRes = await page.request.get("/public/manifest.webmanifest");
  expect(manifestRes.status()).toBe(200);

  // Offline reload #1: the app boots FROM THE PRECACHE. The
  // module graph is served from the install precache (the fetch
  // handler's runtime cache belt never saw the first load's
  // subresources — they were fetched pre-control — so the
  // precache is the only source). The IDB data survived (the
  // same-origin IDB is per-context, not per-load), so the clip
  // + the queue are intact.
  await ctx.setOffline(true);
  await page.reload();
  await expect(page.locator(".legato-clip-row")).toHaveCount(1, {
    timeout: 15_000,
  });
  // THE READ LOOP RUNS OFFLINE: Enter opens the detail pane for
  // the seeded clip — the keyboard lane, zero pointer events. The
  // detail content comes from the IDB store (the offline proof);
  // the pane renders with no network.
  await page.keyboard.press("Enter");
  await expect(page.locator(".legato-detail-title")).toHaveText(
    "Offline seed clip",
  );
  await expect(page.locator(".legato-detail-body")).not.toBeEmpty();

  await ctx.close();
});

test("offline navigation to a non-precached URL lands on the offline page", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();
  await seedIdb(page);
  await page.goto("/");
  await expect(page.locator(".legato-clip-row")).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: 15_000 },
  );
  await ctx.setOffline(true);
  // A same-origin URL NOT in PRECACHE_LIST: sw.js's navigation
  // fallback serves public/offline.html from cache (the offline
  // page's h1 is verified against apps/legato/public/offline.html).
  await page.goto("/public/offline-missing.html");
  await expect(page.locator("h1")).toContainText("Legato is offline");
  await ctx.close();
});
