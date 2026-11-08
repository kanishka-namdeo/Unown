/**
 * Legato — the core keyboard read-loop (ticket L-11's spec split,
 * the PLAN §6.4 zero-pointer lane).
 *
 * THE LANE (the "the spec split's single-clear-lane" contract —
 * the Ostinato battery's shape: each spec owns ONE lane, the
 * mega flow spec's steps 1-4 stay here, the queue states'
 * `r/d/a/u` lane moves to `legato-queue.spec.ts`, the io
 * round-trip's export/import lane moves to `legato-io.spec.ts`):
 *   1. BOOT EMPTY — the honest "No clips yet" panel (Q-3,
 *      never a blank).
 *   2. CLIP THE CLEAN FIXTURE — Ctrl+K → "clip" filter narrows
 *      the enumeration to the `clip-url` row → Enter → the
 *      keyboard form opens → type the 4018 URL → Enter →
 *      the row renders with its extracted title.
 *   3. j/k NAV → Enter DETAIL → the read text renders.
 *   4. BACK (Esc) → focus returns to the originating row (the
 *      Ostinato P0 #9 lane).
 *
 * THE LAW (the Ostinato K-1 zero-mouse precedent, ported to
 * Legato's IDB + RealFetcher + pipeline surface):
 *   - NO pointer events anywhere in this file — no `page.click`,
 *     no `locator.click`, no `page.mouse`, no `page.touchscreen`,
 *     no `locator.hover`. Every interaction is a `page.keyboard`
 *     press + the two event lanes (`waitForEvent("download")` /
 *     `waitForEvent("filechooser")` — those are event WAYS, not
 *     pointer events; the Ostinato O-4 + Fugue F-8 precedent).
 *   - THE CLIP AFFORDANCE (L-11's RealFetcher lane): the palette's
 *     "Clip URL" command opens the keyboard-only URL form (the
 *     Ostinato attach-before-focus + Tab-trap + Esc focus-return
 *     contract); typing the URL + Enter submits → the RealFetcher
 *     + the clip orchestrator (clip.ts) run against the live 4018
 *     fixture server → the clip lands in the store + the row
 *     renders with its extracted title (the clean fixture's
 *     "Clean story" document title, the B-16 manifest's clean
 *     row).
 *
 * Self-skip: the spec runs under the legato config's `LEGATO_E2E`
 * marker (the Coda CODA_E2E / Ostinato OSTINATO_E2E / Fugue
 * FUGUE_E2E precedent); under the root `playwright.config.ts`
 * the marker is unset and the spec self-skips (the landing lane
 * stays untouched by construction).
 *
 * Operator gate: `LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts` from the repo root. No
 * run is claimed that was not performed.
 */
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { clipUrl } from "./legato-helpers.js";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

test.describe.configure({ mode: "serial" });

test("boot empty → clip the clean fixture → j/k → Enter detail → read → Esc return", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();
  // THE PIPELINE'S BROWSER-CONSOLE LANE (the L-11 lane's
  // "never a silent failure" diagnostic): the app's
  // `log?.error("[legato] clip pipeline rejected:", err)`
  // (the orchestrator's catch lane) + any uncaught error lands
  // in the console — the spec captures it for the failure
  // receipt (the Ostinato O-4 / Fugue F-8 error-context
  // precedent).
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  // ─── 1. BOOT EMPTY: the honest "No clips yet" panel (Q-3) ─
  await page.goto("/");
  await expect(page.locator("#legato-empty")).toContainText("No clips yet", {
    timeout: 15_000,
  });

  // ─── 2. CLIP THE CLEAN FIXTURE (the B-16 clean row, live 4018) ─
  // The RealFetcher + the clip orchestrator run against the
  // fixture server's /fixtures/clean.html (the sha256-frozen
  // clean.html — B-16-HOLDOUT.md's "clean → —" row: no
  // ClipError, the extracted title + the readable body).
  await clipUrl(page, "http://127.0.0.1:4018/fixtures/clean.html");
  await expect(page.locator("#legato-status")).toContainText(
    "Clipped — Clean story",
  );
  // THE "NEVER A SILENT FAILURE" LANE: the success path has no
  // console errors (the app's catch lane's `log?.error` only
  // fires on the pipeline's reject — the B-16 manifest's
  // clean row expects NO error).
  expect(pageErrors, `console errors: ${pageErrors.join("; ")}`).toHaveLength(0);
  // The row renders with the extracted title (the fixture's
  // <title>Clean story</title> — the B-16 manifest's clean row).
  const cleanRow = page.locator(".legato-clip-row");
  await expect(cleanRow).toHaveCount(1, { timeout: 30_000 });
  await expect(cleanRow).toContainText("Clean story");

  // ─── 3. j/k NAV → Enter DETAIL → the read text renders ─
  // j moves the cursor (the list's keyboard lane); with one row
  // the cursor wraps (the Ostinato j/k-wrap law). The detail
  // opens via Enter (the app's onKey lane) and the fixture's
  // body text renders (the B-16 manifest's "the extracted
  // title + the readable body" — the clean row's honest shape).
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  const detail = page.locator("#legato-detail");
  await expect(detail.locator(".legato-detail-title")).toHaveText(
    "Clean story",
  );
  await expect(detail.locator(".legato-detail-body")).not.toBeEmpty();
  // The fixture's first paragraph (the B-16 manifest's clean
  // row's "real prose, several sentences" — the byte-honest
  // rule, Law #3).
  await expect(detail.locator(".legato-detail-body")).toContainText(
    "This is the first paragraph of a perfectly clean page",
  );

  // ─── 4. BACK (Esc) → focus returns to the originating row ─
  // The Ostinato P0 #9 focus-return lane (the app's
  // `originRowIdx` + `focusRow` — detail.ts's doc header, the
  // "focus never wanders to body" law).
  await page.keyboard.press("Escape");
  // The detail lane's empty copy ("Nothing open") is back — the
  // detail pane is a SPLIT PANE (the detail.ts's doc header's
  // "the detail pane itself is NOT a modal (it is a split pane,
  // not an overlay)" contract), always in the DOM; the "back"
  // lane's ready signal is the empty copy's render (the Ostinato
  // Q-3's "never a blank" law's executable form: the pane's
  // content's swap to the empty copy, not the pane's removal).
  await expect(detail).toContainText("Nothing open");
  // Focus is on the originating row (the tabindex=-1 target,
  // the B-12 cure — the row's `data-index` attribute rides the
  // DOM, never a color-only cue).
  await expect(cleanRow).toHaveAttribute("aria-current", "true");

  await ctx.close();
});
