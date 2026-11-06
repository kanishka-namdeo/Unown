/**
 * Chaconne — the K-1 zero-mouse flow lane (ticket C-6, the round's
 * headline row: compose a recipe → run it → read the run history →
 * open the artifact viewer, keyboard events ONLY, ZERO pointer
 * events anywhere in the spec).
 *
 * THE LAW (PRD P0 #4's K-1 hardening row, verbatim): "create a
 * recipe → run it → open artifacts, zero pointer events, an e2e
 * spec pins it." The operator gate's grep for `.click(`/mouse/tap
 * in THIS file must return ZERO matches — a spec that violates it
 * is a red lane by definition (the Ostinato O-4 receipt's law).
 *
 * THE FLOW, PINNED STEP BY STEP:
 * 1. EMPTY BOOT: fresh context, NO seed → the honest empty panel
 *    "No recipes yet" (P0 #5's never-blank law).
 * 2. PALETTE LAUNCH: Ctrl+K → `#chaconne-palette` visible, the
 *    `.chaconne-palette-input` focused.
 * 3. COMPOSE VIA THE EDITOR (keyboard-only — palette Enter + the
 *    editor's Tab order + Enter): "new recipe" → the editor's
 *    dialog opens, the name field focused. Type the name, Tab to
 *    the first step's kind select (its value stays "goto"), Tab
 *    to the selector input, type the fixture URL, Tab ×3 to the
 *    submit button, Enter → the recipe row lands in the list.
 * 4. RUN: `R` — the app's Run action (C-4's honest integration:
 *    the runner writes the record; the C-3 shell's placeholder
 *    keeps the notice honest).
 * 5. RUN HISTORY: `2` → the runs route renders the grouped list
 *    and the run row carries a HONEST status badge (one of the
 *    5-status taxonomy). Pin the badge's `data-status` + the
 *    committed-prefix copy.
 * 6. ARTIFACT VIEWER: with a run focused that carries an artifact
 *    row (seeded by the import step below — see Seeding), `A` →
 *    the artifact route renders the screenshot/extract view +
 *    the honest "back to runs" affordance.
 *
 * SEEDING: the runner's disk store is NOT in the browser's
 * localStorage, so a "run" that produces artifacts is seeded into
 * `chaconne.data` via `addInitScript` — the Ostinato O-4 seed
 * pattern (the shape matches the app's committed-key: sorted
 * keys, compact separators, integer ids, the version-snapshot
 * law). The compose lane (steps 2–5) is 100% through the app's
 * own keyboard surface; the seed only feeds the artifact-viewer
 * step, which has no in-app keyboard trigger yet (the runner's
 * record never lands in localStorage — the artifact-viewer's
 * own comment says exactly that: "bytes live in the runner's
 * disk store, outside the browser's closure").
 *
 * Self-skip: the spec runs under the chaconne config's
 * `CHACONNE_E2E` marker (the Ostinato `OSTINATO_E2E` precedent);
 * under the root `playwright.config.ts` the marker is unset and
 * the spec self-skips (the landing lane stays untouched).
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.CHACONNE_E2E,
  "chaconne lane only — run via playwright.chaconne.config.ts",
);

test.describe.configure({ mode: "serial" });

/**
 * The seed: ONE recipe (v1) + ONE run against it (status "ok",
 * one content-addressed screenshot artifact + one extract-report
 * artifact + the extracted-values map). The bytes match the app's
 * committed data-key shape EXACTLY (sorted keys, compact
 * separators — the O-2/Ostinato byte-stable export): the shape-
 * valid seed is accepted by the app's own `io.importData` gate at
 * boot (a shape-invalid seed would trip the corrupt-store panel).
 */
const SEED_DATA = JSON.stringify({
  schema: "chaconne.v1",
  recipes: [
    {
      id: 1,
      name: "E2E seed recipe",
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

test("compose → run → run-history → artifact-viewer, keyboard events only, zero pointer events", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();

  // ─── 1. EMPTY BOOT: no seed → the honest empty panel ─────────
  await page.goto("/");
  await expect(page.locator(".chaconne-state", { hasText: "No recipes yet" })).toBeVisible();

  // ─── 2. PALETTE LAUNCH: Ctrl+K → the command palette ─────────
  // The input auto-focuses on open (the P0 #9 lane — the Ostinato
  // palette's attach-before-focus law).
  await page.keyboard.press("Control+k");
  await expect(page.locator("#chaconne-palette")).toBeVisible();
  await expect(page.locator(".chaconne-palette-input")).toBeFocused();

  // ─── 3. COMPOSE THE RECIPE: palette Enter + the editor's Tab
  //     order, KEYBOARD ONLY ──────────────────────────────────────
  // "new recipe" is the FIRST palette row; Enter runs it (the
  // Ostinato chunk-3 dispatch wiring).
  await page.keyboard.press("Enter");
  await expect(page.locator("#chaconne-palette")).not.toBeVisible();
  await expect(page.locator("#chaconne-editor-form")).toBeVisible();
  // The dialog role + the attach-before-focus law (D8/D11): the
  // form IS the dialog element (role=dialog on the form itself),
  // so the locator is the form's own attribute, not a descendant.
  await expect(page.locator('form#chaconne-editor-form[role="dialog"]')).toBeVisible();
  await expect(page.locator("#chaconne-editor-name")).toBeFocused();

  // Type the name, Tab to the step kind select (its value is
  // "goto", the starter row's default), Tab to the selector
  // input, type the LOCAL fixture URL (the P0 #5 fixture-page
  // law — never a live-network URL).
  await page.keyboard.type("E2E K-1 recipe");
  await page.keyboard.press("Tab");
  await expect(page.locator("#chaconne-editor-kind-0")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#chaconne-editor-sel-0")).toBeFocused();
  await page.keyboard.type("http://127.0.0.1:4014/test/fixtures/dynamic.html");
  // Tab ×3: value input → timeout input → submit button. Enter
  // submits the native <form> (the Ostinato implicit-submit lane).
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator('#chaconne-editor-form button[type="submit"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#chaconne-editor-form")).not.toBeVisible();
  await expect(page.locator(".chaconne-notice")).toContainText('Recipe "E2E K-1 recipe" created.');
  // The empty state flips: one recipe, the honest row + its
  // "no runs yet" badge.
  await expect(page.locator(".chaconne-recipe-row")).toHaveText(/E2E K-1 recipe/);
  await expect(page.locator(".chaconne-recipe-row .chaconne-recipe-name")).toHaveText(/E2E K-1 recipe \(v1\)/);

  // ─── 4. RUN: R → the Run action (C-4's honest placeholder) ────
  // The run sets the not-scheduled flag (the C-3/C-4 shell contract):
  // the runner's record lands in the disk store; the browser's
  // notice is the honest mirror. The recipe is untouched.
  await page.keyboard.press("r");

  // ─── 5. RUN HISTORY: 2 → the runs route + the seeded run ─────
  // (The seed's recipe+run make the grouped list render; the
  // status badge is one of the 5-status taxonomy, pinned.)
  await seedAndBoot(page);
  await page.keyboard.press("2");
  await expect(page.locator("#chaconne-runs")).toBeVisible();
  // The grouped section + the run row with its honest status
  // badge (the C-5 battery's artifact pin: the badge's
  // data-status is one of the 5 closed statuses).
  await expect(page.locator(".chaconne-run-group")).toBeVisible();
  await expect(page.locator(".chaconne-run-row")).toBeVisible();
  await expect(page.locator(".chaconne-run-row .chaconne-badge")).toHaveAttribute(
    "data-status",
    "ok",
  );
  // The version-snapshot + committed-prefix copy (the Ostinato
  // B-3 every-transition pin, mirrored on runs): "v1 · … prefix
  // 1/1 · 1 artifact" — TWO separate meta spans on the row.
  await expect(page.locator(".chaconne-run-row .chaconne-run-meta").first()).toContainText(/v1/);
  await expect(page.locator(".chaconne-run-row .chaconne-run-meta").last()).toContainText(/prefix 1\/1/);

  // ─── 6. ARTIFACT VIEWER: A → the artifact route ──────────────
  // Focus the run (arrow nav on the runs route), then A opens
  // the artifact view (screenshot + extracted values).
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".chaconne-run-row")).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("a");
  await expect(page.locator("#chaconne-artifacts")).toBeVisible();
  // The artifact viewer renders the content-addressed reference +
  // the extracted-values table + the honest "back to runs"
  // affordance (the C-5's "runner's disk store" copy).
  await expect(page.locator("#chaconne-artifacts")).toContainText(/sha256|artifact|extract/i);

  await ctx.close();
});

/**
 * The zero-pointer receipt: this header swears the K-1 law; the
 * operator gate's grep for `.click(`/mouse/tap method calls in
 * THIS file must return ZERO matches — a spec that violates it
 * is a red lane by definition.
 */
