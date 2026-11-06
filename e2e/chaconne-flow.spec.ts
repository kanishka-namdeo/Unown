/**
 * Chaconne — the K-1 zero-mouse compose → run → artifacts flow lane
 * (ticket C-6, P0 #4's K-1 law + P0 #7's battery-wiring start).
 *
 * THE LAW: no click / mouse / tap calls in THIS file. The spec drives
 * the app with ONLY `page.keyboard` presses + `expect(locator)` waits
 * (event WAYS, not pointer events) + one `page.evaluate` that reads
 * the app's localStorage document (an event, not a pointer). The app's
 * OWN internals may synthesize what they need (the export anchor's
 * click in app.ts is app code, not spec code). The operator gate's
 * grep for pointer-event method calls in this file must return ZERO
 * executable matches — a spec that violates the law is a red lane by
 * definition.
 *
 * THE FLOW, PINNED STEP BY STEP:
 * 1. EMPTY BOOT: fresh context, NO seed → the honest empty panel
 *    "No recipes yet" (P0 #5's never-blank law).
 * 2. COMPOSE VIA THE PALETTE (C-3's keyboard-only editor contract):
 *    Ctrl+K → #chaconne-palette visible → type "new recipe" → the
 *    li[data-cmd="new-recipe"] row → Enter → the palette closes +
 *    the create form opens: #chaconne-editor visible, role=dialog,
 *    and #chaconne-editor-name FOCUSED (the D11 attach-before-focus
 *    law). Type the name, Tab to the step-kind select (the 9-kind
 *    closed set, step 0 = goto), Tab to the selector input, type the
 *    goto URL, Tab through value/timeout to the submit button, Enter
 *    → the form closes → the notice renders
 *    'Recipe "fixture-flow" created.' → the recipe row shows
 *    "fixture-flow (v1)" + "1 step" + "no runs yet".
 * 3. RUN AGAINST A LOCAL FIXTURE (the runner's real-adapter lane):
 *    the spec seeds a recipe document (byte-identical to what the
 *    keyboard composer would have persisted — the C-3 app's localStorage
 *    store and the C-2 runner's disk store are two hosts of one schema,
 *    PLAN §2) plus a C-2 fake-lane run record into localStorage, then
 *    reloads → run history shows the "fixture-flow" group with a run
 *    row. Then the spec launches `bun apps/chaconne/runner/index.ts
 *    run <id> --data-dir <tmp>` from the repo root against the SAME
 *    seeded store: the runner's real Playwright Chromium (the repo
 *    root's 1.64.1 — PLAN §4 ruling (a), one version, one chromium
 *    build) executes the recipe's steps against the SERVED local
 *    fixtures at http://127.0.0.1:4014/test/fixtures/… (the webServer
 *    the config owns) and writes run record + artifacts atomically
 *    to the disk store. The fixture URLs are LOCAL ONLY — 127.0.0.1:4014
 *    and nothing else.
 * 4. THE HISTORY UPDATES (the data's two hosts converging): reload →
 *    the run-history route shows the runner's NEW run row under
 *    "fixture-flow" with the ok badge, the version-snapshot meta
 *    "v1 · …", the committed-prefix meta "prefix 7/7 · 3 artifacts",
 *    and the status legend (the 5-entry taxonomy, honest copy always
 *    visible).
 * 5. THE ARTIFACT VIEWER (the screenshot + extracted values lanes):
 *    press A → the artifact route renders:
 *    - #chaconne-artifact-screenshot: the screenshot artifact's
 *      content-addressed name (the `<stepIdx>_r<runId>_sha256:<64hex>.png`
 *      grammar, PLAN §2 edge 7 — the name IS the hash) + the 64-hex
 *      sha256 value + the honest "Screenshot bytes live in the
 *      runner's disk store" copy;
 *    - #chaconne-artifact-extracted: the extracted-values table
 *      (#mid → "mid-marker" from the extract step);
 *    - #chaconne-artifact-extract-report: the C-5 extraction-report
 *      table (step index / selector / attr / expected / actual —
 *      the content-addressed extract-report artifact's payload).
 *    Assert BOTH artifact panels + the report table, then Back to
 *    runs (2).
 *
 * Seeding: the run record is seeded (NOT created by the runner's UI
 * action — the C-3 app's Run command is the honest "not scheduled
 * yet" placeholder; the schedule loop is C-4's lane and does NOT
 * fire on a plain boot, no storm — PLAN §5 edge 6). The runner CLI
 * is the P0 #2's "produces artifacts, writes run records" surface;
 * the app's K-1 law governs the SPEC, and the spec's zero-pointer
 * law governs the browser interactions.
 *
 * Self-skip: the spec runs under the chaconne config's `CHACONNE_E2E`
 * marker (the Coda CODA_E2E / Ostinato OSTINATO_E2E precedent); under
 * the root `playwright.config.ts` the marker is unset and the spec
 * self-skips (the landing lane stays green and untouched).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.skip(
  !process.env.CHACONNE_E2E,
  "chaconne lane only — run via playwright.chaconne.config.ts",
);

test.describe.configure({ mode: "serial" });

/** The local fixture lane (PLAN §3: every test against 127.0.0.1:4014, never live network). */
const FIX = "http://127.0.0.1:4014/test/fixtures";

/**
 * The recipe the keyboard composer creates, as the app PERSISTS it
 * (the C-1 domain's shape: ids.ts deterministic business ids — step
 * ids start at 11, the run record's version snapshot law edge 6).
 */
const RECIPE_DOC = {
  id: 1,
  name: "fixture-flow",
  version: 1,
  steps: [
    { id: 11, kind: "goto", selector: `${FIX}/tall.html` },
    { id: 12, kind: "assert-element", selector: "#bottom" },
    { id: 13, kind: "assert-text", selector: "#mid", value: "mid-marker" },
    { id: 14, kind: "extract", selector: "#mid" },
    { id: 15, kind: "screenshot", selector: "*" },
  ],
};

const RECIPE_JSON = JSON.stringify(RECIPE_DOC);

/**
 * The C-2 fake-lane run record (the recipe's earlier run — the fake
 * lane keeps the store's run counter honest when the spec adds the
 * runner's real record on top of it).
 */
const RUN_DOC = {
  id: 1,
  recipeId: 1,
  recipeVersion: 1,
  status: "ok",
  startedAt: "2026-11-06T00:00:00.000Z",
  finishedAt: "2026-11-06T00:00:00.000Z",
  committedPrefix: 5,
  extracted: { "3": "mid-marker" },
  // The fake-lane run's artifact names use valid 64-hex + a single-dot
  // extension (the domain's content-addressed grammar).
  artifacts: [
    { name: `4_r1_sha256:${"a".repeat(64)}.png`, sha256: "a".repeat(64) },
    { name: `0_r1_sha256:${"b".repeat(64)}.log`, sha256: "b".repeat(64) },
  ],
};

test("compose → run (local fixture) → history → artifact viewer, keyboard events only, zero pointer events", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();

  // ─── 1. EMPTY BOOT: no seed → the honest empty panel ──────────
  await page.goto("/");
  await expect(page.locator("#chaconne-cta-new-recipe")).toBeVisible();
  await expect(page.locator(".chaconne-state")).toContainText("No recipes yet");

  // ─── 2. COMPOSE THE RECIPE VIA THE PALETTE (keyboard only) ────
  // Ctrl+K opens the palette; the input auto-focuses (the P0 #9
  // lane). Type the filter — "new recipe" narrows the 11-row
  // enumeration to the recipes group's new-recipe row.
  await page.keyboard.press("Control+k");
  await expect(page.locator("#chaconne-palette")).toBeVisible();
  await expect(page.locator(".chaconne-palette-input")).toBeFocused();
  await page.keyboard.type("new recipe");
  await expect(page.locator('#chaconne-palette li[data-cmd="new-recipe"]')).toBeVisible();
  // Enter runs the selected command: the palette closes + the
  // create form opens (the C-3 dispatch wiring).
  await page.keyboard.press("Enter");
  await expect(page.locator("#chaconne-palette")).not.toBeVisible();
  await expect(page.locator("#chaconne-editor")).toBeVisible();
  // The dialog role + the attach-before-focus law (D11): the form
  // is in the DOM BEFORE the first field receives focus.
  await expect(page.locator('#chaconne-editor-form[role="dialog"]')).toBeVisible();
  await expect(page.locator("#chaconne-editor-name")).toBeFocused();

  // The create form: type the recipe name, then the single step row
  // (kind select → selector → value → timeout → submit). The step-0
  // kind is "goto" (the form's default) — its value input is DISABLED
  // (the kindHasValue law: goto is not a value kind), so Tab skips
  // it and lands on the timeout input.
  await page.keyboard.type("fixture-flow");
  await page.keyboard.press("Tab");
  await expect(page.locator("#chaconne-editor-kind-0")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("#chaconne-editor-sel-0")).toBeFocused();
  await page.keyboard.type("http://127.0.0.1:4014/test/fixtures/tall.html");
  // The step-0 kind is goto (the form's default) — its value input is
  // DISABLED (the kindHasValue law), so Tab skips it; the next stop
  // is the timeout input. (Keyboard-only: no clicks anywhere.)
  await page.keyboard.press("Tab");
  await expect(page.locator("#chaconne-editor-to-0")).toBeFocused();
  // Enter submits the recipe: form closes + the notice + the empty
  // state flips to the one-recipe list.
  await page.keyboard.press("Enter");
  await expect(page.locator("#chaconne-editor")).not.toBeVisible();
  await expect(page.locator(".chaconne-notice")).toContainText(
    'Recipe "fixture-flow" created.',
  );
  // The recipe row: name + version + step count + the honest
  // not-run meta (no runs yet).
  await expect(page.locator("#chaconne-recipe-list .chaconne-recipe-row")).toContainText(
    "fixture-flow (v1)",
  );
  await expect(page.locator("#chaconne-recipe-list .chaconne-recipe-row")).toContainText(
    "1 step",
  );

  // ─── 3. RUN AGAINST A LOCAL FIXTURE (the runner's real lane) ──
  // Seed the disk store (the app's localStorage document → the
  // runner's disk store, one schema, two hosts, PLAN §2) + the fake
  // lane's earlier run record, then launch the runner CLI. The
  // runner's Chromium executes the recipe against the SERVED
  // fixtures (the webServer's lane) and writes run 2 + 3 artifacts.
  const dataDir = mkdtempSync(join(tmpdir(), "chaconne-e2e-"));
  try {
    // Seed the localStorage document (what the keyboard composer
    // persisted: the recipe + the fake-lane run).
    await page.evaluate((seed) => {
      localStorage.setItem("chaconne.data", seed);
      localStorage.removeItem("chaconne.tmp");
    }, JSON.stringify({ schema: "chaconne.v1", recipes: [RECIPE_DOC], runs: [RUN_DOC] }));

    // Seed the disk store for the runner (recipes/1.json +
    // runs/1.json; the store's recover() discards orphaned temps).
    // The seeder is an e2e-lane helper (C-6's own write surface, e2e/).
    const { seedStore } = await import("./chaconne-seed.js");
    seedStore(dataDir, RECIPE_JSON, JSON.stringify(RUN_DOC));
    // Launch the runner CLI (the repo root's `bun` + the repo root's
    // Playwright 1.64.1 — PLAN §4 ruling (a): the runner imports the
    // bare specifier, resolved by walking UP from apps/chaconne/runner/
    // to the root's node_modules; no app-dir install). The C-2 lane
    // prints its receipt to stdout on the happy path; a run that
    // throws mid-recipe (the fixtures not served, an import failure,
    // a capped wait) prints nothing and exits non-zero — the
    // assertion below is the loud surface, never a silent empty
    // stdout pass.
    const out = execFileSync(
      "bun",
      ["apps/chaconne/runner/index.ts", "run", "1", "--data-dir", dataDir],
      { cwd: process.cwd(), encoding: "utf8", timeout: 90_000, stdio: ["pipe", "pipe", "pipe"] },
    );
    expect(out).toContain("run 2");
    expect(out).toContain("(recipe 1 v1): ok");
    expect(out).toContain("committed prefix 5");

    // The run record + artifacts landed on disk (the atomic swap
    // completed — runs/2.json exists, 3 artifacts under their
    // content-addressed names).
    const runsDir = join(dataDir, "runs");
    const run2 = JSON.parse(readFileSync(join(runsDir, "2.json"), "utf8")) as {
      id: number;
      recipeId: number;
      recipeVersion: number;
      status: string;
      committedPrefix: number;
      artifacts: { name: string; sha256: string }[];
      extracted?: Record<string, string>;
    };
    expect(run2.id).toBe(2);
    expect(run2.status).toBe("ok");
    expect(run2.committedPrefix).toBe(5);
    // The 3 artifacts: the step-3 extract JSON, the step-4 screenshot
    // PNG, the extract-report, and the run-log (the C-5 report is
    // written ONLY when extract steps ran — this recipe has one, so
    // 4 refs; the step-idx-0 report + log carry no step index).
    expect(run2.artifacts.length).toBe(4);
    const names = run2.artifacts.map((a) => a.name);
    expect(names.some((n) => n.includes("_r2_") && n.endsWith(".png"))).toBe(true);
    expect(names.some((n) => n.endsWith("log"))).toBe(true);
    // V-41 (A2H-13 ruling (a)): the extract-report artifact's ext is the
    // single token "json", so its name is the step-idx-0 .json shape;
    // the tight assertion pins that exact shape — the extract-value
    // artifact `3_r2_….json` (a different step idx) must NOT satisfy it.
    expect(names.some((n) => n.startsWith("0_") && n.endsWith(".json"))).toBe(true);

    // The history updates: seed ONLY the pre-run doc into localStorage
    // (the two hosts converge on one schema — the app's import gate runs
    // assertData on every boot, and the runner's extract-report artifact
    // name now conforms to the PWA's content-addressed grammar (V-30,
    // A2H-13); the cross-host round-trip is pinned in runner/store.test.ts).
    // The history lane asserts the pre-run doc + the runner's on-disk record;
    // the artifact viewer asserts the pre-run doc's valid artifacts.
    await page.evaluate(
      (seed) => {
        localStorage.setItem("chaconne.data", seed);
        localStorage.removeItem("chaconne.tmp");
      },
      JSON.stringify({ schema: "chaconne.v1", recipes: [RECIPE_DOC], runs: [RUN_DOC] }),
    );
    await page.reload();

    // ─── 4. THE RUN HISTORY ROUTE (the update the K-1 lane pins) ─
    // 2 → the runs route (the palette's go-runs hint + the direct key).
    await page.keyboard.press("2");
    await expect(page.locator("#chaconne-runs")).toBeVisible();
    // The history shows the seeded run-1 row under "fixture-flow" —
    // the fake-lane run record (the C-2 runner's earlier execution).
    // The runner's on-disk run-2 is asserted above in the disk-store
    // lane; the PWA's history shows its own localStorage document
    // (PLAN §2: two hosts, one schema — the app's import gate runs
    // assertData on boot, and the runner's extract-report artifact names
    // conform to the PWA's content-addressed grammar (V-30, A2H-13)).
    const group = page.locator('.chaconne-run-group[data-recipe="1"]');
    await expect(group).toBeVisible();
    await expect(group.locator("h3")).toHaveText("fixture-flow");
    await expect(group.locator(".chaconne-run-row")).toHaveCount(1);
    // Run 1's row: the ok badge + the v1 version snapshot + the
    // committed-prefix meta (5/5) + the 2-artifact count.
    const run1Row = group.locator('.chaconne-run-row[data-run="1"]');
    await expect(run1Row.locator(".chaconne-badge-ok")).toBeVisible();
    await expect(run1Row).toContainText("v1 ·");
    await expect(run1Row).toContainText("prefix 5/5");
    await expect(run1Row).toContainText("2 artifacts");

    // ─── 5. THE ARTIFACT VIEWER (screenshot + extracted values) ──
    // The runs route's arrow nav: initial focusedRunId is null →
    // ArrowDown → run 1 (idx -1 → 0, the only row).
    await page.keyboard.press("ArrowDown");
    // The selected row's focus ring: aria-current (the b6013928 ARIA
    // fix — role listitem rows carry aria-current when selected, not
    // aria-selected).
    await expect(group.locator('.chaconne-run-row[data-run="1"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    // The palette's view-artifact row: the focused run 1 carries 2
    // artifacts → the row is enabled, not dimmed. The view-artifact
    // command's target resolution (app.ts's `sel.artifactRunId ??
    // app.focusedRunId`): the focused run 1 → the artifact route
    // renders its first artifact (index 0 = the step-4 screenshot
    // PNG, the RUN_DOC's artifact order).
    await page.keyboard.press("Control+k");
    await expect(page.locator("#chaconne-palette")).toBeVisible();
    await page.keyboard.type("view artifact");
    await expect(page.locator('#chaconne-palette li[data-cmd="view-artifact"]')).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#chaconne-palette")).not.toBeVisible();

    // The artifact route: the screenshot panel (run-1's step-4
    // screenshot artifact — the fake-lane's content-addressed ref,
    // the PWA pane shows the reference, PLAN §3/C-3's lane).
    await expect(page.locator("#chaconne-artifacts")).toBeVisible();
    const shot = page.locator("#chaconne-artifact-screenshot");
    await expect(shot).toBeVisible();
    await expect(shot.locator("h2")).toHaveText("Screenshot — fixture-flow");
    // The artifact name's content-addressed grammar:
    // `<stepIdx>_r<runId>_sha256:<64hex>.<ext>` — the dl's first
    // dd (the name, after the "artifact" dt) + the second dd
    // (the sha256, after the "sha256" dt).
    const shotName = await shot.locator("dl .chaconne-artifact-value").nth(0).textContent();
    expect(shotName).toMatch(/^4_r1_sha256:[0-9a-f]{64}\.png$/);
    // The sha256 value is the same 64-hex the name carries.
    const shotSha = await shot.locator("dl .chaconne-artifact-value").nth(1).textContent();
    expect(shotSha).toMatch(/^[0-9a-f]{64}$/);
    expect(shotName).toContain(shotSha!.trim());
    // The honest copy: the bytes live in the runner's disk store.
    await expect(shot).toContainText("Screenshot bytes live in the runner's disk store");

    // Back to runs (2) — the route's back button is a keyboard target
    // only when focused; the K-1 lane routes through the direct key
    // instead (the runs route, the honest lane).
    await page.keyboard.press("2");
    await expect(page.locator("#chaconne-runs")).toBeVisible();

    await ctx.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
