/**
 * Ostinato — the a11y battery (ticket O-4, PRD P0 #9 "axe
 * wcag2a/wcag2aa clean" + the focus-recovery lane).
 *
 * The Coda a11y precedent (e2e/coda-a11y.spec.ts) ported to
 * Ostinato's pinned scope:
 *
 * - THE TAGS ARE EXACTLY wcag2a + wcag2aa — NOT Coda's four-tag
 *   set. The PRD row pins "axe wcag2a/wcag2aa clean"; no
 *   wcag21* tags are added.
 * - BOTH SCHEMES per context (the config comment's contract:
 *   "O-4's a11y battery drives both schemes per-context"): the
 *   app owns light/dark via `color-scheme: light dark` +
 *   `@media (prefers-color-scheme)` in the chunk-1 stylesheet;
 *   the context's `colorScheme` emulates each branch.
 * - Per scheme, THREE scans (zero-violation policy; exemptions
 *   documented inline ONLY, matching e2e/a11y.spec.ts's culture —
 *   aim for NONE):
 *   1. EMPTY state: no seed → the "No decks yet" panel → scan.
 *   2. CONTENT state: seed → the review screen (card front +
 *      grade row + list + search) → scan.
 *   3. CONTENT + PALETTE OPEN: Ctrl+K → the dialog + listbox +
 *      rows + kbd + selected/disabled rows all in the scan.
 * - TWO focus-order pins as real tests (light context only — one
 *   scheme suffices; the pins are scheme-independent):
 *   1. Tab order: card front → the four grade keys → the selected
 *      list row (when it carries tabindex) → the search input.
 *   2. Esc closes the palette and focus returns to the invoking
 *      control (P0 #9's focus-recovery lane).
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
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.OSTINATO_E2E,
  "ostinato lane only — run via playwright.ostinato.config.ts",
);

/**
 * The seed data set: one deck, one card (the minimal reviewable
 * unit). The bytes match the app's committed data-key shape
 * exactly (sorted keys, compact separators — the O-2 lane's
 * byte-stable export). A shape-invalid seed would trip the
 * app's own `io.importData` error state at boot.
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
      // The content boot must be FRESH: a prior boot in this page
      // (the empty-state scan) persisted a done session via the
      // every-transition rule — clear it or startSession restores
      // the stale phase over the re-seeded data.
      window.localStorage.removeItem("ostinato.session");
    },
    SEED_DATA,
  );
  await page.goto("/");
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".ostinato-progress")).toContainText("1 of 1");
}

/**
 * The two-tag axe scope: wcag2a + wcag2aa EXACTLY (the PRD P0 #9
 * pin — NOT Coda's four-tag set; no wcag21*).
 */
async function analyze(page: Page): Promise<unknown[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  return results.violations;
}

test.describe.configure({ mode: "serial" });

for (const scheme of ["light", "dark"] as const) {
  test(`ostinato is axe-clean, ${scheme} (wcag2 A/AA)`, async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();

    // 1. EMPTY state: no seed → the "No decks yet" panel → scan.
    await page.goto("/");
    await expect(page.locator(".ostinato-state")).toContainText("No decks yet");
    let violations = await analyze(page);
    expect(violations, `${scheme} empty: ` + JSON.stringify(violations, null, 2)).toEqual([]);

    // 2. CONTENT state: seed → the review screen → scan.
    await seedAndBoot(page);
    violations = await analyze(page);
    expect(violations, `${scheme} content: ` + JSON.stringify(violations, null, 2)).toEqual([]);

    // 3. CONTENT + PALETTE OPEN: Ctrl+K → the dialog + listbox +
    //    rows + kbd + selected/disabled rows all in the scan.
    await page.keyboard.press("Control+k");
    await expect(page.locator("#ostinato-palette")).toBeVisible();
    await expect(page.locator(".ostinato-palette-input")).toBeFocused();
    violations = await analyze(page);
    expect(violations, `${scheme} content+palette: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    await ctx.close();
  });
}

// ── Focus-order pins (light context; one scheme suffices) ─────

test("the tab order is logical: card front → the four grade keys → the selected list row → the search input", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await seedAndBoot(page);

  // Tab 1: the card front (tabindex=0, precedes the grade row).
  await page.keyboard.press("Tab");
  await expect(page.locator(".ostinato-card-front")).toBeFocused();

  // Tab 2–5: the four grade keys, IN LABEL ORDER (1·Again → 2·Hard
  // → 3·Good → 4·Easy).
  const gradeKeys = [
    "1 · Again",
    "2 · Hard",
    "3 · Good",
    "4 · Easy",
  ];
  for (const label of gradeKeys) {
    await page.keyboard.press("Tab");
    const focused = page.locator(".ostinato-grade-key", { hasText: label });
    await expect(focused).toBeFocused();
  }

  // Tab 6: the selected list row (tabindex=0 — the current card
  // carries aria-current + tabindex). The honest DOM order: the
  // card front precedes the grade row; the selected list row sits
  // between the grade row and the search input.
  await page.keyboard.press("Tab");
  const selectedRow = page.locator(".ostinato-card-row.ostinato-card-selected");
  await expect(selectedRow).toBeFocused();

  // Tab 7: the search input.
  await page.keyboard.press("Tab");
  await expect(page.locator(".ostinato-search")).toBeFocused();

  await ctx.close();
});

test("Esc closes the palette and focus returns to the invoking control", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await seedAndBoot(page);

  // Focus the card front (the invoking control).
  await page.keyboard.press("Tab");
  await expect(page.locator(".ostinato-card-front")).toBeFocused();

  // Open the palette: the input auto-focuses.
  await page.keyboard.press("Control+k");
  await expect(page.locator("#ostinato-palette")).toBeVisible();
  await expect(page.locator(".ostinato-palette-input")).toBeFocused();

  // Esc closes the palette + focus returns to the invoking control
  // (P0 #9's focus-recovery lane).
  await page.keyboard.press("Escape");
  await expect(page.locator("#ostinato-palette")).not.toBeVisible();
  await expect(page.locator(".ostinato-card-front")).toBeFocused();

  await ctx.close();
});
