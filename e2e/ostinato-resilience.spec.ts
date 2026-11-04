/**
 * Ostinato — the R-1 crash-resume + resize lanes (ticket O-4).
 *
 * THE PRD HARDENING ROWS VERIFIED:
 * - "interrupted tasks | SIGKILL mid-review → resume restores
 *   queue + invariants" — proven here with `page.reload()` as the
 *   HONEST browser crash simulation: the page dies, but the
 *   localStorage (the app's storage seam) survives, exactly as a
 *   SIGKILL'd tab's storage would. The `page.reload()` is the
 *   only executable stand-in for a hard process kill in a browser
 *   e2e lane; the semantics it pins are startSession's.
 * - "resize handling | breakpoint layout tests (wide/narrow)" —
 *   the 375×667 (narrow, single-column stack) + 1280×800 (wide,
 *   two-pane grid at the ≥ 900 px breakpoint) lanes: the
 *   scrollWidth overflow discipline, the surfaces' visibility,
 *   and the stacking-vs-two-pane x-comparison.
 *
 * THE CRASH-RESUME SEMANTICS (pinned from startSession, D2's
 * design — assert EXACTLY this):
 * - At boot the queue RECOMPUTES from the data set (the due
 *   cards, the D1 due-queue law with the all-cards fallback).
 * - The persisted session's INDEX positions the cursor (clamped
 *   to 0 if it falls out of range of the shrunk queue).
 * - The persisted PHASE restores (a mid-reveal crash restores
 *   the reveal phase — nothing graded → the queue is unchanged).
 * - A graded card (interval ≥ 1 day) drops OUT of the
 *   recomputed due queue — so a crash AFTER grading resumes at
 *   the recomputed queue with the cursor advanced, which can
 *   SKIP an ungraded card (honest: it stays due for the next
 *   session). The residual-due receipt is asserted, not
 *   papered over.
 *
 * Seeding: THREE cards in one deck (the SEED_DATA pattern
 * extended — fronts "Crash one?" / "Crash two?" / "Crash
 * three?", never graded → all due; the ids c1/c2/c3 are the
 * byte-exact committed shape, dates identical — the toCanonical
 * sorted-keys/compact-separators format the app's own
 * `io.importData` lane accepts).
 *
 * Self-skip: the spec runs under the ostinato config's
 * `OSTINATO_E2E` marker (the Coda `CODA_E2E` precedent); under
 * the root `playwright.config.ts` the marker is unset and the
 * spec self-skips (the landing lane stays untouched).
 *
 * Execution honesty: this spec LANDS COMPLETE but is NOT
 * executed in this build sandbox (Playwright + Chromium are not
 * runnable here). The operator gate re-runs it via `bunx
 * playwright test --config=playwright.ostinato.config.ts` from
 * the repo root. No run is claimed in the receipt that was not
 * performed.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.OSTINATO_E2E,
  "ostinato lane only — run via playwright.ostinato.config.ts",
);

/**
 * The crash-resume seed: one deck, three cards (c1/c2/c3). The
 * bytes match the app's committed data-key shape exactly (sorted
 * keys, compact separators — the O-2 lane's byte-stable export).
 * No `sm2` field on any card → every card is ALWAYS due (a new
 * card's first review is its introduction, the isCardDue law).
 */
const SEED_THREE = JSON.stringify({
  cards: [
    {
      back: "First back.",
      createdAt: "2026-11-04T00:00:00Z",
      deckId: "d1",
      front: "Crash one?",
      id: "c1",
      updatedAt: "2026-11-04T00:00:00Z",
    },
    {
      back: "Second back.",
      createdAt: "2026-11-04T00:00:00Z",
      deckId: "d1",
      front: "Crash two?",
      id: "c2",
      updatedAt: "2026-11-04T00:00:00Z",
    },
    {
      back: "Third back.",
      createdAt: "2026-11-04T00:00:00Z",
      deckId: "d1",
      front: "Crash three?",
      id: "c3",
      updatedAt: "2026-11-04T00:00:00Z",
    },
  ],
  decks: [
    {
      cardOrder: ["c1", "c2", "c3"],
      createdAt: "2026-11-04T00:00:00Z",
      id: "d1",
      name: "E2E crash deck",
      updatedAt: "2026-11-04T00:00:00Z",
    },
  ],
});

/** The one-card seed for the resize lane (the O-3 spec's committed shape). */
const SEED_ONE = JSON.stringify({
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

/** Seed localStorage with the given document BEFORE the app's module script boots. */
async function seedAndBoot(page: Page, seed: string): Promise<void> {
  await page.addInitScript(
    (json: string) => {
      // GUARDED seed: addInitScript re-runs on EVERY navigation —
      // an unguarded setItem would clobber the app's own persisted
      // writes on every reload, and this spec's whole point is that
      // those writes SURVIVE the crash. Seed only the first boot.
      if (window.localStorage.getItem("ostinato.data") === null) {
        window.localStorage.setItem("ostinato.data", json);
      }
    },
    seed,
  );
  await page.goto("/");
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe.configure({ mode: "serial" });

test("crash-resume: the reveal phase survives, the graded card drops, the cursor advances, the loop completes", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // ─── Boot: the three-card due queue, cursor at c1, front view ─
  await seedAndBoot(page, SEED_THREE);
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 3");
  await expect(page.locator(".ostinato-card-front")).toContainText("Crash one?");

  // Space reveal → the phase is "revealed" (the back is showing,
  // nothing graded yet). The transition persists BOTH lanes
  // (data + session) on every advance (the P0 #6 rule).
  await page.keyboard.press(" ");
  await expect(page.locator(".ostinato-card-back")).toBeVisible();

  // ─── CRASH #1: the page dies, localStorage survives ─────────
  // The honest browser-crash simulation: `page.reload()` kills
  // the JS context (the in-memory session is lost) but the
  // localStorage seam persists (same-origin, per-context). At
  // boot, startSession RECOMPUTES the queue from the data set
  // (all three cards still ungraded → all still due → the queue
  // is unchanged at length 3), positions the persisted cursor
  // (index 0), and RESTORES the persisted phase ("revealed").
  await page.reload();
  // The reveal phase SURVIVED the crash: the back is STILL
  // showing (nothing was graded, so the queue is unchanged and
  // the cursor still points at c1).
  await expect(page.locator(".ostinato-card-back")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 3");

  // Grade c1 with `3` (Good, q=2): the SM-2 interval advances to
  // ≥ 1 day → c1 is no longer due on recompute. The cursor
  // advances to index 1 + the data set persists c1's graded SM-2
  // state (the P0 #6 rule: the grade rewrites the card +
  // advances the cursor in the same step, both persisted).
  await page.keyboard.press("3");
  await expect(page.locator(".ostinato-progress")).toContainText("2 of 3");
  await expect(page.locator(".ostinato-card-front")).toContainText("Crash two?");

  // ─── CRASH #2: the graded card drops, the cursor positions
  //     into the SHRUNK queue ─────────────────────────────────
  // Reload → boot recomputes the due queue: c1 is graded
  // (interval ≥ 1 day, not due), c2/c3 ungraded (due) → the
  // queue is [c2, c3] (length 2). The persisted session's index
  // was 1 (post-advance after grading c1 in a 3-card queue) →
  // clamped into the shrunk 2-card queue, it positions at index
  // 1 → c3 (the HONEST SKIP: c2 — ungraded, still due — is
  // skipped by the cursor's persisted position, not re-inserted
  // at index 0; the persisted lane written through at the grade
  // step is the truth, and it says "you were at position 1").
  await page.reload();
  await expect(page.locator(".ostinato-progress")).toContainText("2 of 2");
  // The front shows "Crash three?" (the recomputed-queue
  // semantics, honestly asserted) + the phase is "front" (the
  // grade transition always lands on the next card's front
  // view; the persisted phase was "front").
  await expect(page.locator(".ostinato-card-front")).toContainText("Crash three?");

  // Grade `4` (Easy, q=3) → the cursor advances to index 2,
  // which is past the end of the 2-card queue → the done state
  // renders (the loop completed ACROSS TWO CRASHES). The
  // residual-due receipt: c2 remains due (never graded) — it
  // will reappear in a FRESH session (the D1 due-queue law),
  // not this one (the loop is terminal).
  // Reveal first: the restored phase is "front", and applyEvent
  // no-ops a grade before the reveal (the total-function rule).
  await page.keyboard.press(" ");
  await expect(page.locator(".ostinato-card-back")).toBeVisible();
  await page.keyboard.press("4");
  await expect(
    page.locator(".ostinato-state", { hasText: "Review complete" }),
  ).toBeVisible();

  await ctx.close();
});

test("resize: no horizontal overflow at 375 and 1280, the surfaces hold, the two-pane layout at wide", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page = await ctx.newPage();

  // Boot with the one-card seed: the review screen (card + grade
  // row + list + search) renders.
  await seedAndBoot(page, SEED_ONE);

  // ─── NARROW: 375×667 — the single-column stack ──────────────
  await page.setViewportSize({ width: 375, height: 667 });
  // The overflow discipline: no horizontal scroll (the chunk-1
  // CSS lane's no-fixed-width > ~34rem law holds at 375 px —
  // the flex-wrap grade row + ellipsis-truncating card rows).
  const narrowScrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(narrowScrollWidth).toBeLessThanOrEqual(375);
  // The surfaces hold: the card face + all four grade keys + the
  // search input are all visible at narrow.
  await expect(page.locator(".ostinato-card-front")).toBeVisible();
  for (const label of ["1 · Again", "2 · Hard", "3 · Good", "4 · Easy"]) {
    await expect(page.locator(".ostinato-grade-key", { hasText: label })).toBeVisible();
  }
  await expect(page.locator(".ostinato-search")).toBeVisible();
  // The stacking law: the card list sits BELOW the card (single
  // column — the list's x ≈ the card's x, NOT to the right).
  const narrowCardBox = await page.locator(".ostinato-card").boundingBox();
  const narrowListBox = await page.locator("#ostinato-card-list").boundingBox();
  expect(narrowCardBox).toBeTruthy();
  expect(narrowListBox).toBeTruthy();
  // The two elements share a left edge within 1 px (the grid's
  // single column: both start at the container's left padding).
  expect(Math.abs((narrowListBox?.x ?? 0) - (narrowCardBox?.x ?? 0))).toBeLessThanOrEqual(1);

  // A keyboard action at narrow STILL WORKS after the resize
  // (the layout change does not break the surface): Space
  // reveal → the back is visible.
  await page.keyboard.press(" ");
  await expect(page.locator(".ostinato-card-back")).toBeVisible();

  // ─── WIDE: 1280×800 — the two-pane grid (the ≥ 900 px
  //     breakpoint) ────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 800 });
  const wideScrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(wideScrollWidth).toBeLessThanOrEqual(1280);
  // The same surfaces hold at wide.
  await expect(page.locator(".ostinato-card-front")).toBeVisible();
  await expect(page.locator(".ostinato-search")).toBeVisible();
  // The TWO-PANE law: the card list sits to the RIGHT of the
  // card article (the ≥ 900 px grid: card pane left, search +
  // list pane right — the list's x > the card's x).
  const wideCardBox = await page.locator(".ostinato-card").boundingBox();
  const wideListBox = await page.locator("#ostinato-card-list").boundingBox();
  expect(wideCardBox).toBeTruthy();
  expect(wideListBox).toBeTruthy();
  expect((wideListBox?.x ?? 0) > (wideCardBox?.x ?? 0)).toBe(true);

  await ctx.close();
});
