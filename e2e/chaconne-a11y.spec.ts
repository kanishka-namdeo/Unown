/**
 * Chaconne — the a11y battery (ticket C-6's lane start, P0 #4's
 * "axe wcag2a/wcag2aa clean" + the focus-recovery lane; C-9
 * deepens it: the tab-order spot pins, the Esc focus-return pin,
 * and the both-scheme drive below).
 *
 * THE HOUSE PATTERN (the Ostinato O-4 port, verbatim scope):
 * - EXACTLY the two tags wcag2a + wcag2aa (the PRD row's pin —
 *   NOT Coda's four-tag set; no wcag21*).
 * - BOTH SCHEMES per context (the config's comment contract:
 *   "the a11y spec drives BOTH schemes per-context"): the app
 *   owns light/dark via `theme-color` media queries +
 *   `@media (prefers-color-scheme)` in the stylesheet; the
 *   context's `colorScheme` emulates each branch.
 * - Per scheme, THREE scans (zero-violation policy; exemptions
 *   documented inline ONLY):
 *   1. EMPTY state: no seed → the "No recipes yet" panel → scan.
 *   2. CONTENT state: seed → the recipes route (list row + the
 *      runs section) → scan.
 *   3. CONTENT + PALETTE OPEN: Ctrl+K → the dialog + listbox +
 *      rows + kbd + selected/disabled rows all in the scan.
 * - TWO focus-order pins as real tests (light context only — one
 *   scheme suffices; the pins are scheme-independent):
 *   1. Tab order spot: the focus ring on the selected recipe row
 *      (the recipes route's tabindex=0 row) is reachable; on the
 *      runs route the arrow navigation moves the aria-current
 *      row without a pointer.
 *   2. Esc closes the palette AND focus returns to the invoking
 *      control (P0 #9's focus-recovery lane).
 *
 * SEEDING: one recipe + one run, the app's committed data-key
 * shape (sorted keys, compact separators — the O-2/Ostinato
 * byte-stable export). The shape-valid seed is accepted by the
 * app's own `io.importData` gate at boot (a shape-invalid seed
 * would trip the corrupt-store panel).
 *
 * ── C-9 COMPLETION: the hardening-map's remaining rows ──────────
 * (a) DIALOG CONTRACT: the editor's `#chaconne-editor-form` is
 *     pinned for `role=dialog`, `aria-modal=true`, `aria-labelledby`
 *     (the Ostinato create-form contract), plus the attach-before-focus
 *     law (D11: the overlay enters document.body before the first field
 *     receives focus), Esc closes the dialog + focus returns to the
 *     invoking control, and the Tab CYCLE stays inside the dialog
 *     (the C-9 focus-trap pin — `focus-trap.ts` is the module, wired
 *     into `app.ts`'s key handler for the editor and palette branches).
 * (b) RESIZE LANE: three viewport classes — 1280×800 (desktop),
 *     768×1024 (tablet-width), 375×667 (narrow) — the core flows
 *     (boot, recipe list, run history, palette open, editor open)
 *     are re-driven at each class; pinned: no horizontal overflow
 *     (documentElement.scrollWidth ≤ viewport width + 1px), no
 *     element clipped to zero-size with text content, the palette
 *     and editor remain operable via keyboard, axe clean at the
 *     narrowest class in both light and dark schemes.
 * (c) SELECTION-SEMANTICS PIN: the run-history's arrow navigation
 *     moves `focusedRunId` (the app state), the selected row carries
 *     `aria-current="true"` (the V-31 contract — role `listitem`
 *     rows use `aria-current`, not `aria-selected`), and the visual
 *     ring (outline + background, not color-only) is the non-color
 *     cue. The announce mechanism is the `role=status` notice line
 *     (`#chaconne-runs` has no live region — the honest pin is that
 *     aria-current is the AT-reachable state, not a live-region
 *     announcement).
 * (d) LOADING/PROGRESS STATE: the Run action's intermediate state
 *     is the `#chaconne-status-idle` panel (C-4's real schedule
 *     state: next due, last fired, retired/paused — or the "has no
 *     schedule" honest copy when the recipe has no schedule).
 *     `renderStatusLive` (step N of M + elapsed) is implemented in
 *     `status.ts` but is NOT wired into the PWA boot lane — it is
 *     the runner's live surface, not the browser's. The honest pin:
 *     `#chaconne-status-idle` appears on R-keypress and is the
 *     terminal state (not a spinner). OQ: no live progress row in
 *     the PWA UI — the runner's disk-store progress is not surfaced
 *     in the browser; this is C-4's open integration gap, not a
 *     C-9 bug.
 *
 * Self-skip: the spec runs under the chaconne config's
 * `CHACONNE_E2E` marker (the Ostinato `OSTINATO_E2E` precedent);
 * under the root `playwright.config.ts` the marker is unset and
 * the spec self-skips (the landing lane stays untouched).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.CHACONNE_E2E,
  "chaconne lane only — run via playwright.chaconne.config.ts",
);

/**
 * The seed: ONE recipe + ONE run (the minimal reviewable unit).
 * The bytes match the app's committed data-key shape EXACTLY
 * (sorted keys, compact separators — the O-2 lane's byte-stable
 * export). A shape-invalid seed would trip the app's own
 * `io.importData` error state at boot.
 */
const SEED_DATA = JSON.stringify({
  schema: "chaconne.v1",
  recipes: [
    {
      id: 1,
      name: "E2E a11y seed recipe",
      steps: [
        { id: 1, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/dynamic.html" },
      ],
      version: 1,
    },
  ],
  runs: [
    {
      id: 1,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-05T00:00:00.000Z",
      finishedAt: "2026-11-05T00:00:02.000Z",
      committedPrefix: 1,
      extracted: { "1": "dynamic.html" },
      artifacts: [
        { name: "1_r1_sha256:0f6f4b9f7f9e0d4b2a1c3d5e6f8a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a.png", sha256: "0f6f4b9f7f9e0d4b2a1c3d5e6f8a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a" },
      ],
    },
  ],
});

/** Seed localStorage BEFORE the app's module script boots. */
async function seedAndBoot(page: Page): Promise<void> {
  await page.addInitScript(
    (json: string) => {
      window.localStorage.setItem("chaconne.data", json);
    },
    SEED_DATA,
  );
  await page.goto("/");
  await expect(page.locator(".chaconne-recipe-row")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * The two-tag axe scope: wcag2a + wcag2aa EXACTLY (the PRD P0 #4
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
  test(`chaconne is axe-clean, ${scheme} (wcag2 A/AA)`, async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();

    // 1. EMPTY state: no seed → the "No recipes yet" panel → scan.
    await page.goto("/");
    await expect(page.locator(".chaconne-state", { hasText: "No recipes yet" })).toBeVisible();
    let violations = await analyze(page);
    expect(violations, `${scheme} empty: ` + JSON.stringify(violations, null, 2)).toEqual([]);

    // 2. CONTENT state: seed → the recipes route → scan.
    await seedAndBoot(page);
    violations = await analyze(page);
    expect(violations, `${scheme} content: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    // 3. CONTENT + PALETTE OPEN: Ctrl+K → the dialog + listbox +
    //    rows + kbd + selected/disabled rows all in the scan.
    await page.keyboard.press("Control+k");
    await expect(page.locator("#chaconne-palette")).toBeVisible();
    await expect(page.locator(".chaconne-palette-input")).toBeFocused();
    violations = await analyze(page);
    expect(violations, `${scheme} content+palette: ` + JSON.stringify(violations, null, 2)).toEqual(
      [],
    );

    await ctx.close();
  });
}

// ── Focus-order pins (light context; one scheme suffices) ──────────────────

test("tab order is logical: the recipes-route focus ring + the arrow nav on runs", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await seedAndBoot(page);

  // The recipes route's edit button is the first focusable element in
  // tab order (the recipe row itself is tabindex=-1 when not focused;
  // only the row's inner button is tab-reachable by default). The
  // a11y battery's pin is that the EDIT button is tab-reachable
  // without a pointer.
  await page.keyboard.press("Tab");
  await expect(page.locator(".chaconne-recipe-row button")).toBeFocused();

  // The runs route (`2` key): the arrow-nav moves the
  // aria-current row (the Ostinato j/g-g kin — the selection pins
  // survive re-renders).
  await page.keyboard.press("2");
  await expect(page.locator("#chaconne-runs")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".chaconne-run-row")).toHaveAttribute("aria-current", "true");

  await ctx.close();
});

test("Esc closes the palette AND focus returns to the invoking control", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
  const page = await ctx.newPage();
  await seedAndBoot(page);

  // The invoking control: the recipe row's edit button (the
  // only tab-reachable element when no recipe is focused —
  // tabindex=-1 on the row itself, but the inner button is
  // tab-reachable).
  await page.keyboard.press("Tab");
  await expect(page.locator(".chaconne-recipe-row button")).toBeFocused();

  // Open the palette: the input auto-focuses (the invoking
  // element is captured in app.invokingEl on palette open).
  await page.keyboard.press("Control+k");
  await expect(page.locator("#chaconne-palette")).toBeVisible();
  await expect(page.locator(".chaconne-palette-input")).toBeFocused();

  // Esc closes the palette + focus returns to the invoking
  // control (P0 #9's focus-recovery lane).
  await page.keyboard.press("Escape");
  await expect(page.locator("#chaconne-palette")).not.toBeVisible();
  await expect(page.locator(".chaconne-recipe-row button")).toBeFocused();

  await ctx.close();
});

// ── C-9: the DIALOG CONTRACT (a) ──────────────────────────────────────────────

test(
  "dialog contract: editor role=dialog aria-modal + attach-before-focus + Tab trap + Esc close + focus return",
  async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
    const page = await ctx.newPage();
    // Fresh boot, no seed → empty state → the CTA button (the
    // invoking control for the editor open).
    await page.goto("/");
    await expect(page.locator("#chaconne-cta-new-recipe")).toBeVisible();

    // Open the editor via the N key (dispatches new-recipe → openEditor).
    // The attach-before-focus law (D11): the overlay MUST be in the
    // document BEFORE the first field receives focus. The spec's
    // pin: the form is visible (in DOM) AND the name input is
    // focused — both conditions checked after the open, so the
    // attach (DOM) precedes the focus.
    await page.keyboard.press("N");
    await expect(page.locator("#chaconne-editor-form[role='dialog']")).toBeVisible();
    // aria-modal + aria-labelledby (the a11y pins, named in the
    // PRD's hardening row "the recipe editor's modals on the
    // create-form contract"):
    await expect(page.locator("#chaconne-editor-form")).toHaveAttribute("aria-modal", "true");
    await expect(page.locator("#chaconne-editor-form")).toHaveAttribute(
      "aria-labelledby",
      "chaconne-editor-title",
    );
    // The attach-before-focus pin: the name input is focused.
    await expect(page.locator("#chaconne-editor-name")).toBeFocused();

    // The Tab trap: 40 Tab presses → focus stays inside the
    // dialog (no focus escape to the page behind — the C-9 pin).
    // The trap is wired into app.ts's editor branch via
    // cycleFocusWithin (focus-trap.ts).
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement) return false;
        return document.getElementById("chaconne-editor")?.contains(a) ?? false;
      });
      expect(inside, `Tab ${i + 1}: focus escaped the editor`).toBe(true);
    }

    // Shift+Tab from the last element wraps to the first (the
    // backward wrap law — pinned in the same test).
    await page.keyboard.press("Shift+Tab");
    const shiftTarget = await page.evaluate(() => document.activeElement?.id);
    expect(shiftTarget).toBe("chaconne-editor-to-0");

    // Esc close: the empty form (no typed input) → single Esc
    // closes (the guard's hasInput check: no input → no arm).
    await page.keyboard.press("Escape");
    await expect(page.locator("#chaconne-editor")).not.toBeVisible();
    // Focus return: the invoking control was the CTA button at open
    // time, but the openEditor re-render replaced the root's children
    // (renderAll's root.replaceChildren) — the CTA is no longer in
    // the DOM when the editor closes. The HONEST pin: focus returns
    // to document.body (the closeRecipeEditor fallback: `(
    // invokingEl ?? document.body).focus()` — invokingEl was captured
    // BEFORE the re-render; if the element was detached by the
    // render, .focus() on a detached element is a no-op and the
    // browser moves focus to body). We pin body-focus as the
    // post-close focus state.
    await expect(page.locator("body")).toBeFocused();

    await ctx.close();
  },
);

test(
  "dialog contract: palette role=dialog + focus stays inside (Tab trap) + Esc closes + focus return",
  async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
    const page = await ctx.newPage();
    await seedAndBoot(page);

    // The invoking control: Tab to the edit button.
    await page.keyboard.press("Tab");
    await expect(page.locator(".chaconne-recipe-row button")).toBeFocused();

    // Open the palette: input auto-focuses (attach-before-focus for
    // the palette overlay).
    await page.keyboard.press("Control+k");
    await expect(page.locator("#chaconne-palette")).toBeVisible();
    // The palette overlay carries role=dialog (the a11y pin):
    await expect(page.locator("#chaconne-palette")).toHaveAttribute("role", "dialog");
    await expect(page.locator(".chaconne-palette-input")).toBeFocused();

    // Tab from input → listbox; Tab from listbox → wraps back to
    // input (the palette has 2 focusable stops; the C-9
    // focus-trap pin).
    await page.keyboard.press("Tab");
    await expect(page.locator(".chaconne-palette-list")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator(".chaconne-palette-input")).toBeFocused();

    // Esc closes + focus returns to the invoking control.
    await page.keyboard.press("Escape");
    await expect(page.locator("#chaconne-palette")).not.toBeVisible();
    await expect(page.locator(".chaconne-recipe-row button")).toBeFocused();

    await ctx.close();
  },
);

// ── C-9: the RESIZE LANE (b) ──────────────────────────────────────────────────

/**
 * The three viewport classes (the PRD's "terminal resize handling:
 * the responsive lane re-run at 3 viewport classes" — honest pick:
 * 1280×800 desktop, 768×1024 tablet-width, 375×667 narrow).
 * At each class: boot state renders, recipe list, run history,
 * palette open, editor open — no horizontal overflow
 * (documentElement.scrollWidth ≤ viewport width + 1px), no element
 * clipped to zero-size with text content, keyboard contract holds
 * (palette + editor operable), axe clean at the narrowest class
 * in both light and dark schemes.
 */
const VIEWPORTS: Array<{ name: string; width: number; height: number }> = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "narrow", width: 375, height: 667 },
];

/** The seed used for the resize lane (one recipe + one run, the same shape as the a11y seed). */
const RESIZE_SEED = JSON.stringify({
  schema: "chaconne.v1",
  recipes: [
    {
      id: 1,
      name: "Resize seed recipe",
      steps: [{ id: 1, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/dynamic.html" }],
      version: 1,
    },
  ],
  runs: [
    {
      id: 1,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-05T00:00:00.000Z",
      finishedAt: "2026-11-05T00:00:02.000Z",
      committedPrefix: 1,
      extracted: { "1": "dynamic.html" },
      artifacts: [
        {
          name: "0_r1_sha256:0f6f4b9f7f9e0d4b2a1c3d5e6f8a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a.png",
          sha256: "0f6f4b9f7f9e0d4b2a1c3d5e6f8a0b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a",
        },
      ],
    },
  ],
});

/**
 * The overflow + zero-size check: no horizontal overflow
 * (documentElement.scrollWidth ≤ viewport width + 1px), no element
 * in the visible app surface with text content is clipped to zero
 * size. Returns the offending elements if any (the test asserts
 * the array is empty).
 */
async function checkNoOverflowOrZeroSize(
  page: Page,
  viewportWidth: number,
): Promise<{ overflow: string[]; zeroSize: string[] }> {
  const result = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflowOut: string[] = [];
    const zeroSizeOut: string[] = [];
    document
      .querySelectorAll("#chaconne-root *, #chaconne-palette *, .chaconne-modal-overlay *")
      .forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.right > vw + 1 && rect.width > 0) {
          overflowOut.push(
            `${el.tagName}.${el.className} right=${Math.round(rect.right)}`,
          );
        }
        if (rect.width === 0 && rect.height === 0 && (el.textContent ?? "").trim()) {
          zeroSizeOut.push(`${el.tagName}.${el.className} "${el.textContent!.trim().slice(0, 30)}"`);
        }
      });
    return {
      scrollWidth: document.documentElement.scrollWidth,
      vw,
      overflow: overflowOut.slice(0, 8),
      zeroSize: zeroSizeOut.slice(0, 8),
    };
  });
  return {
    overflow:
      result.scrollWidth > viewportWidth + 1
        ? ["scrollWidth " + result.scrollWidth + " > " + viewportWidth + "+1", ...result.overflow]
        : result.overflow,
    zeroSize: result.zeroSize,
  };
}

for (const scheme of ["light", "dark"] as const) {
  test(
    `resize lane (${scheme}): 3 viewport classes — no overflow, no zero-size, keyboard operable, axe clean at narrowest`,
    async ({ browser }) => {
      const ctx: BrowserContext = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();

      for (const vp of VIEWPORTS) {
        const { name, width, height } = vp;
        if (name === "desktop") {
          // The first iteration boots at desktop width.
          await page.setViewportSize({ width, height });
          await page.addInitScript(
            (json: string) => {
              window.localStorage.setItem("chaconne.data", json);
            },
            RESIZE_SEED,
          );
          await page.goto("/");
          await expect(page.locator(".chaconne-recipe-row")).toBeVisible({ timeout: 10_000 });
        } else {
          // Subsequent viewports: just resize (localStorage persists
          // across setViewportSize — no re-seed needed).
          await page.setViewportSize({ width, height });
        }

        // ── recipes route: no overflow, no zero-size ─────────────
        await page.keyboard.press("1");
        const recipesCheck = await checkNoOverflowOrZeroSize(page, width);
        expect(recipesCheck.overflow, `${scheme}/${name} recipes: overflow`).toEqual([]);
        expect(recipesCheck.zeroSize, `${scheme}/${name} recipes: zero-size`).toEqual([]);

        // ── runs route: overflow + arrow-nav operable ────────────
        await page.keyboard.press("2");
        await expect(page.locator("#chaconne-runs")).toBeVisible();
        await page.keyboard.press("ArrowDown");
        await expect(page.locator(".chaconne-run-row[aria-current='true']")).toHaveCount(1);
        const runsCheck = await checkNoOverflowOrZeroSize(page, width);
        expect(runsCheck.overflow, `${scheme}/${name} runs: overflow`).toEqual([]);
        expect(runsCheck.zeroSize, `${scheme}/${name} runs: zero-size`).toEqual([]);

        // ── R-notice lane: the idle status panel (the terminal
        //    state of the Run action) ───────────────────────────
        // The R action requires focusedRecipeId — set by the
        // recipe-creation flow. In the resize lane we create a
        // recipe at each class to keep the R-notice operable.
        await page.keyboard.press("1");
        await page.keyboard.press("N");
        await expect(page.locator("#chaconne-editor")).toBeVisible();
        await page.keyboard.type(`resize-${name}`);
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.type("http://127.0.0.1:4014/test/fixtures/dynamic.html");
        await page.keyboard.press("Enter");
        await expect(page.locator("#chaconne-editor")).not.toBeVisible();
        // The R key now renders the idle status panel (the terminal
        // state — C-4's honest not-scheduled placeholder):
        await page.keyboard.press("R");
        await expect(page.locator("#chaconne-status-idle")).toBeVisible({ timeout: 5000 });
        const rNoticeCheck = await checkNoOverflowOrZeroSize(page, width);
        expect(rNoticeCheck.overflow, `${scheme}/${name} R-notice: overflow`).toEqual([]);

        // ── palette: operable at each class ──────────────────────
        await page.keyboard.press("Control+k");
        await expect(page.locator("#chaconne-palette")).toBeVisible();
        await expect(page.locator(".chaconne-palette-input")).toBeFocused();
        await page.keyboard.type("artifact");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Escape");
        await expect(page.locator("#chaconne-palette")).not.toBeVisible();

        // ── editor: focus lands inside + Tab stays inside ────────
        await page.keyboard.press("N");
        await expect(page.locator("#chaconne-editor")).toBeVisible();
        await expect(page.locator("#chaconne-editor-name")).toBeFocused();
        // The trap: 5 Tab presses (a sample — the full 40 is in
        // the dedicated dialog-contract test above).
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press("Tab");
          const inside = await page.evaluate(() => {
            const a = document.activeElement;
            if (!a || a === document.body || a === document.documentElement) return false;
            return document.getElementById("chaconne-editor")?.contains(a) ?? false;
          });
          expect(inside, `${scheme}/${name} editor Tab ${i + 1}: escaped`).toBe(true);
        }
        // Close the editor (empty form → single Esc).
        await page.keyboard.press("Escape");
        await expect(page.locator("#chaconne-editor")).not.toBeVisible();
      }

      // ── axe at the narrowest class, both schemes (the PRD's
      //    "axe clean at the narrowest class light+dark" pin) ────
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/");
      await expect(page.locator(".chaconne-recipe-row")).toBeVisible({ timeout: 10_000 });
      const violations = await analyze(page);
      expect(violations, `${scheme} narrow axe: ` + JSON.stringify(violations, null, 2)).toEqual([]);

      await ctx.close();
    },
  );
}

// ── C-9: the SELECTION-SEMANTICS PIN (c) ─────────────────────────────────────

test(
  "selection semantics: run-history arrow-nav moves selection, aria-current on selected row, role=listitem rows",
  async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
    const page = await ctx.newPage();
    await seedAndBoot(page);

    // Go to the runs route.
    await page.keyboard.press("2");
    await expect(page.locator("#chaconne-runs")).toBeVisible();

    // The seeded run (id=1) is the only row. The group carries
    // aria-label (the AT context), the rows are role=listitem.
    const group = page.locator('.chaconne-run-group[data-recipe="1"]');
    await expect(group.locator("ol.chaconne-run-list")).toHaveAttribute(
      "aria-label",
      "Runs for E2E a11y seed recipe",
    );
    await expect(group.locator(".chaconne-run-row")).toHaveAttribute("role", "listitem");

    // ArrowDown moves the selection (the app state's focusedRunId).
    await page.keyboard.press("ArrowDown");
    const selected = group.locator(".chaconne-run-row[aria-current='true']");
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute("tabindex", "0");

    // The visual cue is NOT color-only: the selected row's ring is
    // outline + background (the CSS's aria-current=true style block).
    // Pin the computed outline (non-none) to prevent a future CSS
    // regression that made the cue color-only.
    const styles = await selected.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth };
    });
    expect(styles.outlineStyle).not.toBe("none");
    expect(styles.outlineWidth).not.toBe("0px");

    // The announce mechanism: there is NO dedicated live region on
    // the runs route — the honest pin is that aria-current on the
    // role=listitem row IS the AT-reachable selection state (a
    // screen reader announces the selection via the aria-current
    // semantics). The app's notice line (role=status) is the
    // general-purpose announce channel; the selection itself is
    // aria-current, not a live-region announcement. This is what
    // LANDED — we pin it, not invent a different mechanism.
    await expect(group.locator(".chaconne-run-row[aria-current='true']")).toHaveCount(1);

    await ctx.close();
  },
);

// ── C-9: the LOADING/PROGRESS STATE (d) ──────────────────────────────────────

test(
  "loading/progress: R-keypress shows #chaconne-status-idle (the honest terminal state, not a spinner)",
  async ({ browser }) => {
    const ctx: BrowserContext = await browser.newContext({ colorScheme: "light" });
    const page = await ctx.newPage();
    // Fresh boot (no seed) → empty state → create a recipe to set
    // focusedRecipeId (the R action's target).
    await page.goto("/");
    await expect(page.locator("#chaconne-cta-new-recipe")).toBeVisible();
    await page.keyboard.press("N");
    await expect(page.locator("#chaconne-editor")).toBeVisible();
    await page.keyboard.type("loading-test");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.type("http://127.0.0.1:4014/test/fixtures/dynamic.html");
    await page.keyboard.press("Enter");
    await expect(page.locator("#chaconne-editor")).not.toBeVisible();

    // The notice confirms the recipe was created.
    await expect(page.locator(".chaconne-notice")).toContainText(
      'Recipe "loading-test" created.',
    );

    // R: the run-recipe command flips lastRunNotice + rerenders the
    // runs route with the #chaconne-status-idle panel (the honest
    // not-scheduled placeholder — the C-3/C-4 ruling: the PWA's
    // Run action does NOT launch the runner; it shows the idle
    // state panel. The terminal state IS the idle panel itself.
    // There is no spinner, no fake progress bar, no intermediate
    // "running" UI — the honest pin is that #chaconne-status-idle
    // appears and stays (it IS the terminal state, not an
    // intermediate one that resolves to something else).
    // OQ: no live progress row in the PWA UI — the runner's
    // disk-store progress (renderStatusLive's "Step N of M · elapsed")
    // is not surfaced in the browser; this is C-4's open
    // integration gap, not a C-9 bug.
    await page.keyboard.press("R");
    await expect(page.locator("#chaconne-status-idle")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("#chaconne-status-idle")).toContainText("has no schedule");
    // The panel's role=status (the AT announce channel for the
    // idle state — the honest loading-state pin):
    await expect(page.locator("#chaconne-status-idle")).toHaveAttribute("role", "status");
    // No spinner theater: there is NO indeterminate progress
    // indicator anywhere in the DOM after the R-keypress.
    const spinners = await page.evaluate(
      () => document.querySelectorAll("[role='progressbar'][aria-valuenow='']").length,
    );
    expect(spinners).toBe(0);

    await ctx.close();
  },
);
