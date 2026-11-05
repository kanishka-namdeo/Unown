/**
 * Ostinato — the deck-settings e2e spec (ticket R-2).
 *
 * The settings modal's full keyboard contract, driven with ZERO
 * pointer events (the battery's law — `page.keyboard` only):
 *
 *  1. Seed a store with ONE deck + SIX new cards (never-graded,
 *     always due), no cap → the session card shows "of 6" (the progress
 *     surface reads "N of M · K remaining" — cursor position).
 *  2. Open the modal via the PALETTE (Ctrl+K → filter "deck
 *     settings" → Enter) — the 19th palette row's dispatch path.
 *  3. The cap input is empty (no cap on the deck). Type "3"
 *     into it. Submit (Enter).
 *  4. The modal closes. Restart the session (R).
 *  5. The queue respected the cap: "of 3".
 *
 * A second test drives the DIRECT-KEY path (the `d` key) to open
 * the modal, then pins the Esc-focus contract: reopen the modal,
 * press Esc with the empty input → the modal closes AND focus
 * returns to the pre-open anchor (P0 #9's focus-recovery lane).
 *
 * A third test pins the a11y contract on the OPEN modal state:
 * axe wcag2a + wcag2aa clean (the ostinato-a11y.spec.ts pattern —
 * the open state only, not the full three-scan battery).
 *
 * LOCATION: the repo-root `e2e/` lane (the Coda C4 precedent).
 * Battery #15 of the ostinato e2e set; run via
 * `bunx playwright test --config=playwright.ostinato.config.ts`
 * from the repo root. Self-skip guard: runs only under the
 * ostinato config's `OSTINATO_E2E` marker.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.skip(
  !process.env.OSTINATO_E2E,
  "ostinato lane only — run via playwright.ostinato.config.ts",
);

/** Six new cards (never-graded → always due) on one deck. No cap.
 * The bytes match the app's committed data-key shape (sorted keys,
 * compact separators — the canonical `io.exportData` form). */
function buildSeedData(): string {
  const stamp = "2026-11-04T00:00:00Z";
  const card = (n: number, front: string, back: string) => ({
    back,
    createdAt: stamp,
    deckId: "d1",
    front,
    id: `c${n}`,
    updatedAt: stamp,
  });
  const doc = {
    cards: [
      card(1, "Q1", "A1"),
      card(2, "Q2", "A2"),
      card(3, "Q3", "A3"),
      card(4, "Q4", "A4"),
      card(5, "Q5", "A5"),
      card(6, "Q6", "A6"),
    ],
    decks: [
      {
        cardOrder: ["c1", "c2", "c3", "c4", "c5", "c6"],
        createdAt: stamp,
        id: "d1",
        name: "R-2 seed deck",
        updatedAt: stamp,
      },
    ],
  };
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

async function seedAndBoot(page: Page): Promise<void> {
  await page.addInitScript(
    (json: string) => {
      window.localStorage.setItem("ostinato.data", json);
      window.localStorage.removeItem("ostinato.session");
    },
    buildSeedData(),
  );
  await page.goto("/");
  await expect(page.locator(".ostinato-card-front")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator(".ostinato-progress")).toContainText("of 6");
}

/** Open the settings modal via the PALETTE path: Ctrl+K → filter
 * "deck settings" → Enter (keyboard only). */
async function openSettingsViaPalette(page: Page): Promise<void> {
  await page.keyboard.press("Control+k");
  await expect(page.locator("#ostinato-palette")).toBeVisible();
  await expect(page.locator(".ostinato-palette-input")).toBeFocused();
  await page.keyboard.type("deck settings");
  await expect(
    page.locator('#ostinato-palette li[data-cmd="deck-settings"]'),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#ostinato-palette")).not.toBeVisible();
  await expect(page.locator("#ostinato-settings-form")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

// ── Test 1: the full cap flow via the palette path ──────────────────────

test("the palette path: seed 6 cards → open settings (Ctrl+K → deck settings → Enter) → cap 3 → R restart → 3 of 3", async ({
  page,
}) => {
  await seedAndBoot(page);

  // Boot: the session queue holds 6 (all 6 cards are due).
  await expect(page.locator(".ostinato-progress")).toContainText("of 6");

  // Open the settings modal via the palette.
  await openSettingsViaPalette(page);

  // The modal is visible with the correct ARIA attributes.
  const form = page.locator("#ostinato-settings-form");
  await expect(form).toBeVisible();
  await expect(form).toHaveAttribute("role", "dialog");
  await expect(form).toHaveAttribute("aria-modal", "true");

  // The cap input is empty (no cap on the seed deck).
  const capInput = page.locator("#ostinato-settings-cap");
  await expect(capInput).toHaveValue("");

  // Type "3" into the cap input.
  await capInput.focus();
  await page.keyboard.type("3");
  await expect(capInput).toHaveValue("3");

  // Submit (Enter — the form's submit button is the type=submit
  // button, so Enter in the focused input triggers form submit).
  await page.keyboard.press("Enter");

  // The modal closed (the overlay is gone).
  await expect(page.locator("#ostinato-settings-overlay")).toHaveCount(0);

  // Restart the session (R).
  await page.keyboard.press("R");

  // The queue respected the cap: of 3, not of 6.
  await expect(page.locator(".ostinato-progress")).toContainText("of 3");
});

// ── Test 2: the direct-key path + the Esc-focus contract ────────────────

test("the direct d key opens the modal; Esc with empty input closes and focus returns to the pre-open anchor", async ({
  page,
}) => {
  await seedAndBoot(page);

  // Focus a known element as the invoking anchor (Tab to the card
  // front — the same anchor the a11y spec uses for the P0 #9 pin).
  await page.keyboard.press("Tab");
  await expect(page.locator(".ostinato-card-front")).toBeFocused();

  // Open the modal via the DIRECT KEY (d) — the 19th palette row's
  // dispatch key.
  await page.keyboard.press("d");
  const form = page.locator("#ostinato-settings-form");
  await expect(form).toBeVisible();
  await expect(form).toHaveAttribute("role", "dialog");

  // The cap input is empty (no cap on the seed deck) — no unsaved
  // input → the Esc-close is immediate (no arming guard).
  await expect(page.locator("#ostinato-settings-cap")).toHaveValue("");

  // Press Esc → the modal closes AND focus returns to the pre-open
  // anchor (the card front, P0 #9's focus-recovery lane).
  await page.keyboard.press("Escape");
  await expect(page.locator("#ostinato-settings-overlay")).toHaveCount(0);
  await expect(page.locator(".ostinato-card-front")).toBeFocused();
});

// ── Test 3: the open-modal a11y scan (axe wcag2a + wcag2aa) ────────────

test("the open settings modal passes axe wcag2a + wcag2aa", async ({
  page,
}) => {
  await seedAndBoot(page);

  // Open the modal via the palette path (the full keyboard lane).
  await openSettingsViaPalette(page);
  await expect(page.locator("#ostinato-settings-form")).toBeVisible();

  // Scan the OPEN modal state only (not the full three-scan battery).
  const violations = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze()
    .then((r) => r.violations);

  expect(
    violations,
    "open settings modal: " + JSON.stringify(violations, null, 2),
  ).toEqual([]);
});
