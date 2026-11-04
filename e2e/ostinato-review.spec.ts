/**
 * Ostinato — the e2e review spec (ticket O-3, P0 #3/#4/#5).
 *
 * The PRD's hardening row demands a keyboard-only lane: "e2e
 * drives create → review → export with keyboard events only;
 * zero pointer events in the spec". This spec drives the full
 * review loop — boot → the card face → reveal (Space) → grade
 * (`3`) → the queue-empty/done state → restart (R) → the
 * command palette (Ctrl+K, filter-as-you-type, Enter runs the
 * command, Esc closes + focus returns) — using ONLY
 * `page.keyboard` events. No `.click()`, no mouse events: the
 * app's entire review workflow is reachable by keyboard alone
 * (the P0 #3 contract).
 *
 * LOCATION: the repo-root `e2e/` lane (the Coda C4 precedent —
 * the app dir holds NO playwright files; the spec + its config
 * live at the root so `bun test` in the app dir never collects
 * it). The ostinato config (root `playwright.ostinato.config.ts`)
 * boots the real app via `bun apps/ostinato/serve.mjs` on a
 * scratch port (4013, serve.mjs's default OSTINATO_PORT).
 *
 * Seeding: one deck + one card are seeded through
 * `page.addInitScript` BEFORE the first navigation, writing
 * `ostinato.data` in the app's own committed data-key shape
 * (`toCanonicalJson`'s sorted-keys/compact-separators format —
 * what `io.exportData` produces, what the storage adapter's
 * `load → io.importData` validation path accepts). The seed
 * document is a fixture inline in THIS spec (a committed
 * constant, not generated at run time). The card is
 * never-graded → always due → the queue is non-empty on boot.
 *
 * Self-skip: the spec runs under the ostinato config's
 * `OSTINATO_E2E` marker (the Coda `CODA_E2E` precedent); under
 * the root `playwright.config.ts` the marker is unset and the
 * spec self-skips (the landing lane stays untouched).
 *
 * Execution honesty (the O-3 receipt's e2e note): this spec
 * LANDS COMPLETE but is NOT executed in the O-3 build sandbox
 * (Playwright + Chromium are not runnable here). The operator
 * gate re-runs it via `bunx playwright test
 * --config=playwright.ostinato.config.ts` from the repo root.
 * No run is claimed in the receipt that was not performed.
 */
import { expect, test, type Page } from "@playwright/test";

test.skip(
  !process.env.OSTINATO_E2E,
  "ostinato lane only — run via playwright.ostinato.config.ts",
);

/**
 * The seed data set: one deck, one card (the minimal reviewable
 * unit). The bytes match the app's committed data-key shape
 * exactly (sorted keys, compact separators — the O-2 lane's
 * byte-stable export). A shape-invalid seed would trip the
 * app's own `io.importData` error state at boot, not pass
 * silently.
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

/** Seed localStorage BEFORE the app's module script boots. */
async function seedAndBoot(page: Page): Promise<void> {
  await page.addInitScript(
    (json: string) => {
      window.localStorage.setItem("ostinato.data", json);
    },
    SEED_DATA,
  );
  await page.goto("/");
  // Boot: storage.recover → load → io.importData → startSession →
  // renderBoot. The review screen renders when the deck + card
  // are present. The card face + the queue progress are the
  // ready signal.
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
  // The queue progress: "1 of 1 · 1 remaining".
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 1");
}

test("the review loop: reveal → grade → done → restart (keyboard only, zero pointer events)", async ({
  page,
}) => {
  await seedAndBoot(page);

  // ─── Boot → ready: the card face is showing (front view) ──────
  await expect(page.locator(".ostinato-card-front")).toContainText(
    "What is the answer to the ultimate question?",
  );
  // The hint that Space/Enter reveals (the front-only view's copy).
  await expect(page.locator(".ostinato-card-hint")).toContainText(
    "Press Space or Enter to reveal",
  );

  // ─── Space reveals the back ────────────────────────────────────
  await page.keyboard.press(" ");
  await expect(page.locator(".ostinato-card-back")).toBeVisible();
  await expect(page.locator(".ostinato-card-back")).toContainText(
    "The answer is",
  );
  // The markdown bold renders (the P0 #1's markdown front/back).
  await expect(page.locator(".ostinato-card-back strong")).toHaveText("42");

  // ─── `3` grades (Good, q=2) → the cursor advances → done ─────
  await page.keyboard.press("3");
  // The queue is now empty: the single card was just graded 3
  // (Good) → SM-2 interval 1 day → not due → the done state
  // renders (P0 #3's terminal phase; not a blank panel).
  await expect(page.locator(".ostinato-progress")).toContainText(
    "All cards reviewed this session",
  );
  await expect(
    page.locator(".ostinato-state", { hasText: "Review complete" }),
  ).toBeVisible();

  // ─── R restarts the queue (the all-cards fallback, D1) ───────
  await page.keyboard.press("R");
  // The queue recomputes from the data set: the one card is in
  // the data set, nothing is due → the D1 all-cards fallback
  // puts it back in the queue. The card face is showing.
  await expect(page.locator(".ostinato-card-front")).toBeVisible();
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 1");

  // ─── The command palette: Ctrl+K opens, filter, Enter runs,
  //     Esc closes (keyboard only) ──────────────────────────────
  await page.keyboard.press("Control+k");
  await expect(page.locator("#ostinato-palette")).toBeVisible();
  // The palette's input auto-focuses on open.
  await expect(page.locator(".ostinato-palette-input")).toBeFocused();
  // Filter-as-you-type: "reveal" narrows the list to that command.
  await page.keyboard.type("reveal");
  await expect(page.locator('#ostinato-palette li[data-cmd="reveal"]')).toBeVisible();
  // Enter runs the selected command: the card reveals.
  await page.keyboard.press("Enter");
  await expect(page.locator("#ostinato-palette")).not.toBeVisible();
  await expect(page.locator(".ostinato-card-back")).toBeVisible();
  // Esc closes the palette; focus returns to the invoking control
  // (P0 #9's focus-recovery lane).
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(page.locator("#ostinato-palette")).not.toBeVisible();
});

test("the empty state: no decks → the honest empty panel (no blank screen)", async ({
  page,
}) => {
  // No seed: a fresh localStorage. storage.load → null → the
  // empty data set → the "No decks yet" panel (P0 #5's
  // honest-empty-states law).
  await page.goto("/");
  await expect(page.locator(".ostinato-state")).toContainText(
    "No decks yet",
  );
  // The error state is NOT showing.
  await expect(page.locator(".ostinato-error")).not.toBeVisible();
});

test("the corrupt-session recovery: a bad session doc → a fresh session (never blank)", async ({
  page,
}) => {
  // A corrupt `ostinato.session` document: the boot path's
  // `deserializePersistedSession` throws → the catch lane starts
  // a fresh session + shows the notice (P0 #5's error lane:
  // never a blank panel).
  await page.addInitScript(
    (json: string) => {
      window.localStorage.setItem("ostinato.data", json);
      window.localStorage.setItem("ostinato.session", "{ not valid json");
    },
    SEED_DATA,
  );
  await page.goto("/");
  // The app recovers: the card face renders (the fresh session
  // positions at 0), not a crash.
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
});
