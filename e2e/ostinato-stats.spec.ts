/**
 * Ostinato — the e2e stats-heatmap spec (ticket R-1-e2e, closes R-1).
 *
 * The round log's R-1 row: "seeded reviews render the heatmap, the
 * cells carry accessible names." This spec seeds one deck + its
 * cards + three ReviewEvents across two recent dates through
 * `page.addInitScript` BEFORE the first navigation (the
 * ostinato-review.spec.ts seeding pattern), then opens the stats
 * overlay via BOTH keyboard paths — the palette (Ctrl+K → filter
 * `stats` → Enter) and the direct `t` key — and pins the dialog,
 * the summary line, the per-cell aria names, the Esc close lane
 * (focus returns to the invoking element), and the arrow-key cell
 * navigation.
 *
 * Zero pointer events: the spec drives the overlay with
 * `page.keyboard` only (the hardening law — `.click()` and mouse
 * events are banned).
 *
 * Seed dates are computed relative to the RUNTIME date (criterion 2:
 * the 84-day window ends at the UI seam's `new Date()` — a fixed
 * 2026-11-04 seed would drift out of the window and silently zero
 * the heatmap). `reviews` is ALWAYS present in the seed document
 * (criterion 1: the import path only back-fills `reviews: []` when
 * the key is absent; a seed without it would test the wrong path).
 *
 * LOCATION: the repo-root `e2e/` lane (the Coda C4 precedent). The
 * spec is battery #13 of the ostinato e2e set; run via
 * `bunx playwright test --config=playwright.ostinato.config.ts`
 * from the repo root. Self-skip guard: the spec runs only under
 * the ostinato config's `OSTINATO_E2E` marker (the Coda
 * `CODA_E2E` precedent); under the root lane it self-skips.
 */
import { expect, test, type Page } from "@playwright/test";

test.skip(
  !process.env.OSTINATO_E2E,
  "ostinato lane only — run via playwright.ostinato.config.ts",
);

/** ISO "yyyy-mm-dd" of N days before the runtime today (UTC math,
 * mirrors the domain's own day-key arithmetic). */
function daysAgo(n: number): string {
  const ms = Date.now() - n * 86_400_000;
  const d = new Date(ms);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/**
 * The seed data set: one deck, two cards, and three ReviewEvents —
 * two on one recent date, one on another (inside the 84-day window
 * ending at the UI's runtime today). The bytes match the app's
 * committed data-key shape (sorted keys, compact separators — the
 * canonical `io.exportData` form the storage adapter's
 * `load → io.importData` validation path accepts). Dates are
 * runtime-relative so the window can never drift out from under
 * the seed.
 */
function buildSeedData(): string {
  const d2 = daysAgo(2);
  const d7 = daysAgo(7);
  const stamp = new Date().toISOString();
  const doc = {
    cards: [
      {
        back: "The answer is **42**.",
        createdAt: stamp,
        deckId: "d1",
        front: "What is the answer to the ultimate question?",
        id: "c1",
        updatedAt: stamp,
      },
      {
        back: "Two * seven = fourteen.",
        createdAt: stamp,
        deckId: "d1",
        front: "What is 2 x 7?",
        id: "c2",
        updatedAt: stamp,
      },
    ],
    decks: [
      {
        cardOrder: ["c1", "c2"],
        createdAt: stamp,
        id: "d1",
        name: "R-1 seed deck",
        updatedAt: stamp,
      },
    ],
    reviews: [
      { cardId: "c1", deckId: "d1", grade: 3, id: "r1", reviewedAt: `${d2}T09:00:00Z` },
      { cardId: "c2", deckId: "d1", grade: 4, id: "r2", reviewedAt: `${d2}T14:00:00Z` },
      { cardId: "c1", deckId: "d1", grade: 2, id: "r3", reviewedAt: `${d7}T10:00:00Z` },
    ],
  };
  // Sort every key at every depth (the canonical form's sorted-keys
  // rule); JSON.stringify then produces the compact-separator bytes.
  const canonical = (o: unknown): unknown =>
    Array.isArray(o)
      ? o.map(canonical)
      : o && typeof o === "object"
        ? Object.fromEntries(
            Object.keys(o as Record<string, unknown>)
              .sort()
              .map((k) => [k, canonical((o as Record<string, unknown>)[k])]),
          )
        : o;
  return JSON.stringify(canonical(doc));
}

/** Seed localStorage (data key, canonical shape, reviews PRESENT)
 * BEFORE the app's module script boots. */
async function seedAndBoot(page: Page): Promise<{ d2: string; d7: string }> {
  const d2 = daysAgo(2);
  const d7 = daysAgo(7);
  await page.addInitScript(
    (json: string) => {
      window.localStorage.setItem("ostinato.data", json);
    },
    buildSeedData(),
  );
  await page.goto("/");
  // Boot ready-signal: the card face + the queue progress.
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".ostinato-progress")).toContainText("of 2");
  return { d2, d7 };
}

/** Open the stats overlay through the palette: Ctrl+K → filter
 * `stats` → Enter (keyboard only). */
async function openViaPalette(page: Page): Promise<void> {
  await page.keyboard.press("Control+k");
  await expect(page.locator("#ostinato-palette")).toBeVisible();
  await expect(page.locator(".ostinato-palette-input")).toBeFocused();
  await page.keyboard.type("stats");
  await expect(page.locator('#ostinato-palette li[data-cmd="stats"]')).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ostinato-palette")).not.toBeVisible();
}

/** Close the overlay via the Esc lane: the overlay is removed from
 * the DOM and focus returns to the invoking element. */
async function closeViaEsc(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator("#ostinato-stats")).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

test("seeded reviews render the heatmap: the palette path (Ctrl+K → stats → Enter)", async ({
  page,
}) => {
  const { d2, d7 } = await seedAndBoot(page);

  await openViaPalette(page);

  // The dialog is visible, labelled, and modal.
  const dialog = page.locator(".stats-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-label", "Review activity");

  // The summary line: 3 seeded reviews in the 84-day window.
  await expect(page.locator(".stats-summary")).toHaveText(
    "3 reviews in the last 84 days",
  );

  // The grid carries the data with accessible names.
  await expect(page.locator(".stats-grid")).toHaveAttribute(
    "aria-label",
    "Review activity heatmap, 12 weeks",
  );
  // Two reviews on the d2 date: the cell's data-count + aria-label.
  await expect(page.locator(`.stats-cell[data-count="2"][aria-label="2 reviews on ${d2}"]`)).toHaveCount(1);
  // One review on the d7 date.
  await expect(page.locator(`.stats-cell[data-count="1"][aria-label="1 review on ${d7}"]`)).toHaveCount(1);
  // A zero-count cell (today is not seeded): the aria name +
  // aria-disabled pin.
  await expect(page.locator(`.stats-cell[data-count="0"][aria-label="no reviews on ${daysAgo(0)}"]`)).toHaveCount(1);
  await expect(page.locator(`.stats-cell[aria-label="no reviews on ${daysAgo(0)}"]`)).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  // THE B-12 regression pin: after open, the DIALOG itself is
  // focused (the el() fix routes `tabindex` through the real
  // attribute, so `dialog.focus()` actually works — before it, the
  // junk-expando routing left document.activeElement on body and
  // the dialog's whole keyboard surface was dead).
  await expect(page.locator(".stats-dialog")).toBeFocused();

  // Esc closes the overlay. The close lane returns focus to the
  // invoking control if it still lives, else to body (the D8 lane).
  // On the PALETTE path the invoking control is the palette input,
  // which openStats REMOVES — so body is the correct fallback. The
  // honest contract: focus has LEFT the dialog and landed on the
  // app surface (never same-element identity — that is not the
  // contract, and on this path the invoking element is gone).
  await closeViaEsc(page);
  const af = await page.evaluate(() => document.activeElement?.className ?? "body");
  expect(af).not.toContain("stats-dialog");
});

test("the direct t key opens the heatmap; arrows move focus between cells", async ({
  page,
}) => {
  await seedAndBoot(page);

  // Open via the direct `t` key (the palette's 18th command's
  // dispatch key — reachable from the review screen).
  await page.keyboard.press("t");
  const dialog = page.locator(".stats-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(page.locator(".stats-summary")).toHaveText(
    "3 reviews in the last 84 days",
  );

  // THE B-12 regression pin (the direct-t path too): the dialog
  // received focus on open.
  await expect(dialog).toBeFocused();

  // The arrow-key cell navigation: seed focus on a known cell
  // honestly (the two-review cell — it carries tabindex="-1" so it
  // IS programmatically focusable; a plain div would not be), press
  // ONE arrow key, and document.activeElement relocates to a
  // DIFFERENT .stats-cell.
  await page.evaluate(() => {
    const c = document.querySelector('.stats-cell[data-count="2"]');
    (c as HTMLElement).focus();
  });
  await page.keyboard.press("ArrowRight");
  const moved = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !el.classList.contains("stats-cell")) return null;
    const cells = Array.from(document.querySelectorAll(".stats-cell"));
    return cells.indexOf(el);
  });
  // The focus moved: activeElement is a .stats-cell and NOT the
  // seeded one (its index differs by 1).
  expect(moved).not.toBeNull();
  const seeded = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll(".stats-cell"));
    return cells.indexOf(
      document.querySelector('.stats-cell[data-count="2"]') as HTMLElement,
    );
  });
  expect(moved).toBe(seeded + 1);

  // Close the overlay via the Esc lane. The close handler moves
  // focus back to the invoking element, and the global keydown
  // re-renders on the statsOpen flip — so the overlay node is
  // REPLACED in place, not removed: pin "not visible" (not
  // toHaveCount(0)).
  await page.keyboard.press("Escape");
  await expect(page.locator("#ostinato-stats")).not.toBeVisible();
});
