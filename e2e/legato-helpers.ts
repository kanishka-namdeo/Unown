/**
 * Legato — the shared e2e helpers (ticket L-11's closing move: the
 * spec-split lane).
 *
 * THE HOUSE CONVENTION (the `e2e/chaconne-seed.js` precedent, the
 * "the plain helper file the spec imports" lane — a NON-spec file
 * the testMatch `legato-.*\.spec\.ts` glob does NOT pick up as a
 * test, so its exports are helper-only, the test-graph stays
 * spec-registered, the Ostinato "the shared helper's non-spec
 * name" law's executable form: the file's name is `legato-helpers`
 * (no `.spec.` segment — the testMatch's negative match, the
 * "the helper's non-spec name" contract's executable form). The
 * three split specs (the `legato-flow` / `legato-queue` /
 * `legato-io` lanes) import their shared helpers from here — the
 * "the spec split's shared-helper extraction" contract: the
 * mega flow spec's `pickCommand` / `clipUrl` / `seedIdb` /
 * `SEED_DATA` move to this module (the "the Ostinato battery's
 * shape" precedent — each spec is self-contained but the shared
 * helpers' DRY law's executable form: the helpers' single home,
 * the three specs' import site, the "never duplicate the seed
 * lane across specs" contract).
 *
 * THE ZERO-POINTER LAW (the Ostinato K-1 precedent, ported to
 * Legato's IDB + RealFetcher + pipeline surface): NO pointer
 * events anywhere in this module — no `page.click`, no
 * `locator.click`, no `page.mouse`, no `page.touchscreen`, no
 * `locator.hover`. Every interaction is a `page.keyboard` press +
 * the two event lanes (`waitForEvent("download")` /
 * `waitForEvent("filechooser")` — those are event WAYS, not
 * pointer events; the Ostinato O-4 + Fugue F-8 precedent).
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * THE SEED DATA SET (the a11y spec's seed, promoted to the shared
 * lane — one clean clip + one tag, the filter bar's chip surface):
 * the shape matches the app's committed LegatoData v1 exactly
 * (the byte-stable export wire form, L-9). The queue spec's seed
 * lane re-uses this document (the "the spec split's shared-seed
 * DRY law" contract — the seed's single home, the specs' import
 * site). The `tags: ["a11y"]` + `queue: [1]` are the a11y
 * battery's pins; the queue spec's state-flip lane does NOT
 * depend on the seed's tag (its `r`/`d`/`a`/`u` flips are
 * state-only, the filter bar's chip surface is the a11y spec's
 * concern, not the queue spec's).
 */
export const SEED_DATA: Record<string, unknown> = {
  schema: "legato.v1",
  schemaVersion: 1,
  clips: [
    {
      id: 1,
      url: "http://127.0.0.1:4018/fixtures/clean.html",
      finalUrl: "http://127.0.0.1:4018/fixtures/clean.html",
      title: "A11y seed clip",
      text:
        "The Legato a11y lane: a seeded clip that renders the list row, the detail pane, and the filter bar's tag chip for the axe battery. This text is what the detail pane renders when the battery opens the reading view.",
      tags: ["a11y"],
      state: "unread",
      highlights: [],
      createdAt: "2026-11-07T00:00:00Z",
      updatedAt: "2026-11-07T00:00:00Z",
    },
  ],
  tags: ["a11y"],
  queue: [1],
};

const SEED_META = { schemaVersion: 1, migrating: false };

/**
 * Seed the real IDB store before the app's module script runs
 * (the offline spec's seedIdb lane, ported verbatim — the L-2
 * IDB adapter's on-disk shape: DB name "legato", the "data" +
 * "meta" object stores). The spec's import of this helper is the
 * "the seed lane's single home" contract (the three split specs'
 * shared seeding, the Ostinato "the shared helper's DRY law"
 * executable form).
 */
export async function seedIdb(page: Page): Promise<void> {
  await page.addInitScript(async ({ seed, meta }) => {
    const { indexedDB } = window;
    const open = (name: string, version: number) =>
      new Promise<IDBDatabase>((resolveP, rejectP) => {
        const r = indexedDB.open(name, version);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
          if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        };
        r.onsuccess = () => resolveP(r.result);
        r.onerror = () => rejectP(r.error);
      });
    const put = (db: IDBDatabase, store: string, key: string, value: unknown) =>
      new Promise<void>((resolveP, rejectP) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(value, key);
        tx.oncomplete = () => resolveP();
        tx.onerror = () => rejectP(tx.error);
      });
    const db = await open("legato", 1);
    await put(db, "data", "data", seed);
    await put(db, "meta", "meta", meta);
    db.close();
  }, { seed: SEED_DATA, meta: SEED_META });
}

/** Open the palette + pick a command by its `data-cmd` id
 *  (keyboard-only: type the filter, Enter on the narrowed row —
 *  the "the palette's command-pick lane" contract, the Ostinato
 *  K-1's "Ctrl+K → type → Enter" precedent ported to Legato's
 *  surface). The `label` map's substring narrow is the
 *  `filterPaletteCommands`' case-insensitive substring law's
 *  executable form: type the command's label substring → the
 *  enumeration narrows to the target row → Enter dispatches it.
 */
export async function pickCommand(page: Page, cmd: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const palette = page.locator("#legato-palette");
  await expect(palette).toBeVisible({ timeout: 6_000 });
  const label: Record<string, string> = {
    "clip-url": "clip",
    "export": "export",
    "import": "import",
  };
  const q = label[cmd] ?? cmd;
  await page.keyboard.type(q);
  // The selected row (the first match, selection=0 after the
  // filter reset) is the target — Enter dispatches it.
  await page.keyboard.press("Enter");
  await expect(palette).not.toBeVisible({ timeout: 6_000 });
}

/** The clip affordance: type the URL into the form's input,
 *  Enter submits. The form is the L-11 keyboard-only upgrade
 *  (attach-before-focus + Tab-trap + Esc focus-return — the
 *  Ostinato P0 #9 lane). The RealFetcher + the clip orchestrator
 *  (clip.ts) run against the live 4018 fixture server → the clip
 *  lands in the store + the row renders with its extracted title
 *  (the clean fixture's "Clean story" document title, the B-16
 *  manifest's clean row).
 */
export async function clipUrl(page: Page, url: string): Promise<void> {
  await pickCommand(page, "clip-url");
  const input = page.locator(".legato-clip-input");
  await expect(input).toBeVisible({ timeout: 6_000 });
  await expect(input).toBeFocused({ timeout: 6_000 });
  await page.keyboard.type(url);
  await page.keyboard.press("Enter");
  // The form removes itself on submit; the clip pipeline runs
  // (RealFetcher → clip orchestrator → storage.save → rerender).
  await expect(input).not.toBeVisible({ timeout: 30_000 });
}
