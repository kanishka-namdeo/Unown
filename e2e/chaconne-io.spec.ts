/**
 * Chaconne — the import/export battery (ticket C-8, PLAN §5 C-8 row:
 * edge cases 9 + 10; P0 #1's canonical byte-stable export end-to-end
 * + P0 #4's keyboard-only export/import surface).
 *
 * THE LAW (the K-1 zero-mouse inheritance, the chaconne-flow.spec.ts
 * lane's ruling, verbatim for THIS file): no click / mouse / tap calls
 * in the spec. The app's own export anchor's click + the import
 * input's click + native file chooser are APP code (the Ostinato
 * B-7 receipt's kin); the spec drives them with `page.keyboard`
 * presses + the `page.on("filechooser")` event (an EVENT, not a
 * pointer) + `page.evaluate` reads of the localStorage document.
 *
 * THE FOUR LANES (the battery):
 * 1. [EXPORT]  — the keyboard-only export: seed the unicode fixture
 *                dataset into localStorage (the C-8 golden's source,
 *                edge case 9 — RAW UTF-8 recipe names, never
 *                \u-escaped), boot, Ctrl+E → the app's export action
 *                fires the download → capture the bytes via
 *                `page.waitForEvent("download")` → the BYTES ARE
 *                BYTE-EQUAL the committed `export.golden.json`
 *                (asserted against the actual bytes read from disk
 *                via `readFileSync`, never a re-serialization of the
 *                fixture in the spec — the golden is the pin). The
 *                golden's unicode bytes are asserted RAW (the
 *                spec checks the committed file's bytes contain the
 *                UTF-8 code points, not \u escapes).
 * 2. [ROUND-TRIP] — import the golden back through the UI's import
 *                lane (Ctrl+O → the filechooser event → the golden
 *                file as the chosen file) → the store's canonical
 *                re-export (a second Ctrl+E capture) is
 *                BYTE-IDENTICAL to the golden (the
 *                same-data-same-bytes law across the UI's import
 *                lane: import(parse) → persist(canonical) →
 *                export(canonical) is the identity map on bytes).
 * 3. [REFUSED] — import the `chaconne.v2` golden (edge case 10's
 *                input) → the dry-run report RENDERS in the notice
 *                line (the wouldImport counts + the refusal reasons,
 *                the app.ts's exact string, byte-asserted against
 *                `dry-run-refused.golden.json`'s report data) AND
 *                the localStorage store is BYTE-IDENTICAL to its
 *                pre-import bytes (asserted — never a partial
 *                import; the refusal path never touches
 *                persistAll).
 * 4. [CORRUPT] — import a malformed-JSON file (truncated bytes) →
 *                the honest error notice renders ("Import failed: …"),
 *                the store is unchanged (byte-identical to
 *                pre-import).
 *
 * GOLDEN FILES (C-8's committed bytes, under apps/chaconne/test/golden/):
 *   - export.golden.json            — the unicode fixture through
 *                                     toCanonicalJson (RAW UTF-8).
 *   - import-refused.golden.json    — the chaconne.v2 document
 *                                     (edge case 10's INPUT).
 *   - dry-run-refused.golden.json   — the expected dry-run report
 *                                     (canonical-serialized).
 * The regenerator + drift gate: apps/chaconne/scripts/regen-golden.ts
 * (--check asserts byte-equality, exit 1 on drift).
 *
 * Self-skip: under the root `playwright.config.ts` the `CHACONNE_E2E`
 * marker is unset and the spec self-skips (the landing lane stays
 * green and untouched — the C-6 config's own contract).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type BrowserContext, type FileChooser, type Page } from "@playwright/test";

test.skip(
  !process.env.CHACONNE_E2E,
  "chaconne lane only — run via playwright.chaconne.config.ts",
);

test.describe.configure({ mode: "serial" });

const APP_DIR = join(process.cwd(), "apps", "chaconne");
const GOLDEN_EXPORT = join(APP_DIR, "test", "golden", "export.golden.json");
const GOLDEN_REFUSED = join(APP_DIR, "test", "golden", "import-refused.golden.json");
const GOLDEN_DRYRUN = join(APP_DIR, "test", "golden", "dry-run-refused.golden.json");

/**
 * The byte-pins are read ONCE from the committed goldens (the golden
 * is the pin — the spec NEVER re-serializes the fixture through a
 * local copy of toCanonicalJson, which would make the golden
 * redundant and the drift undetectable).
 */
const exportGoldenBytes: Buffer = readFileSync(GOLDEN_EXPORT);
const refusedGoldenBytes: Buffer = readFileSync(GOLDEN_REFUSED);
const dryRunGoldenBytes: Buffer = readFileSync(GOLDEN_DRYRUN);

/** The UTF-8 code points the edge-case-9 golden carries as RAW bytes. */
const UNICODE_PROBES: string[] = ["naïve-ünicode", "日本語-フロー", "emoji-🚀-check"];

/**
 * The dry-run report the REFUSED lane asserts against (parsed ONCE
 * from the golden; the notice string is built from THIS data + the
 * app.ts's exact template — the spec mirrors the app's string, the
 * golden pins the data).
 */
const dryRunReport = JSON.parse(dryRunGoldenBytes.toString("utf8")) as {
  reasons: string[];
  schema?: string;
  wouldImport: { recipes: number; runs: number };
};

/** The exact notice string app.ts's import action renders on refusal. */
const REFUSED_NOTICE = `Import refused: ${dryRunReport.reasons.join("; ")} (${dryRunReport.wouldImport.recipes} recipe(s), ${dryRunReport.wouldImport.runs} run(s) would have imported — none did).`;

/**
 * Seed the app's localStorage document with the canonical golden
 * bytes (the export golden IS the store's byte form — the
 * atomic-writes adapter stores exactly io.exportData's bytes),
 * then boot to a ready state.
 */
async function bootWithGolden(page: Page): Promise<void> {
  await page.addInitScript((bytes: string) => {
    localStorage.setItem("chaconne.data", bytes);
    localStorage.removeItem("chaconne.tmp");
  }, exportGoldenBytes.toString("utf8"));
  await page.goto("/");
  await expect(page.locator("#chaconne-recipe-list")).toBeVisible();
}

/** Read the store's committed bytes (the byte-identical assertions). */
async function readStoreBytes(page: Page): Promise<Buffer> {
  const raw = await page.evaluate(() => localStorage.getItem("chaconne.data"));
  return Buffer.from(raw ?? "", "utf8");
}

/**
 * Press Ctrl+E, capture the download's bytes via `saveAs` (the
 * spec-side read of the app-synthesized artifact from disk after
 * the download completed — not a pointer event). The file lands in
 * dataDir under a timestamped name (deduped across the three
 * export calls in the battery).
 */
let captureSeq = 0;
async function captureExport(page: Page, dataDir: string): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Control+e"),
  ]);
  const savedPath = join(dataDir, `capture-${++captureSeq}.json`);
  await download.saveAs(savedPath);
  return readFileSync(savedPath);
}

/**
 * Press Ctrl+O and answer the app's native file chooser with a
 * chosen file (the filechooser event is the spec-side read of the
 * app's dialog — the Ostinato B-7 kin, the spec-side read of an
 * app-synthesized artifact, not a pointer event).
 *
 * THE DETERMINISTIC FIX (the flake-fix chunk):
 *
 * Root cause — the operator's 12/14, 13/14 cluster (1 failed out of
 * 14 in interleaved runs) is a cross-lane INPUT LINGERING race:
 *
 * The app's `actions.import()` (app.ts) creates a hidden
 * `<input type=file>`, appends it to `document.body`, and calls
 * `input.click()` synchronously. The `onchange` handler (the
 * async `importData` + `rerender()` + `input.remove()`) runs to
 * completion AFTER the `setFiles` callback. The `input.remove()`
 * is the LAST line of that handler.
 *
 * Each `triggerImport` call in the battery's serial lanes creates
 * a FRESH context (a new page), so within a single lane there is
 * no cross-lane interference. The failure the operator saw was:
 * within a lane, the FIRST `Control+o` press's `input.click()`
 * opens a filechooser. The spec's `setFiles` fires `onchange` →
 * the async handler runs → `input.remove()` executes. The 50 ms
 * `waitForTimeout` was a GUESS. On a cold boot (the SW's
 * first-install precache fetches are in-flight, the main-thread
 * event loop is briefly starved by the CDP network-interception
 * overhead of the 17 precache entries), the `onchange` handler's
 * `await file.text()` microtask takes longer than 50 ms. The
 * input is STILL in the DOM when the NEXT lane's first
 * `triggerImport` runs (a new context, but the same browser
 * process's CDP filechooser channel may have a pending chooser
 * from the previous page that was not yet fully closed). The
 * new input's `.click()` opens a SECOND filechooser on the same
 * CDP channel — Playwright's `waitForEvent("filechooser")` then
 * receives the FIRST (stale) chooser, whose `setFiles` targets
 * the OLD page (already closed), and the event loop hangs.
 *
 * THE FIX: (1) wait for the DOM condition (`input[type=file]`
 * count = 0) rather than a wall-clock guess; (2) register the
 * `waitForEvent` BEFORE the keypress (the race-free order);
 * (3) on a cold-boot miss, RETRY the press within a bounded
 * window rather than hanging the 60 s spec timeout; (4) dump
 * the app's state (input count, notice, SW controller) on
 * final expiry so the failure is honest and bounded.
 */
async function triggerImport(page: Page, filePath: string, lane: string): Promise<void> {
  // (1) Before any press: ensure the app's previous hidden input
  //     (if any) was fully removed from the DOM. The app's own
  //     cleanup is the source of truth — wait for it, don't guess.
  //     A fresh context starts with 0 inputs, so this is a no-op
  //     on first use and a bounded settle on re-use.
  const inputGone = await page.locator("input[type=file]").count();
  if (inputGone > 0) {
    // The app's import action's `input.remove()` runs after the
    // async `onchange` handler settles; await the DOM condition
    // (bounded: the handler completes in well under 5 s on a
    // warm thread; 5 s is the honest upper bound for a cold CDP
    // channel that is still draining the previous lane's
    // precache responses).
    await page
      .locator("input[type=file]")
      .first()
      .waitFor({ state: "detached", timeout: 5_000 })
      .catch(() => {
        // The input is still attached after 5 s — the handler is
        // still in-flight. The NEXT press's input.click() will
        // create a fresh input; the stale one is removed when the
        // handler finally completes. This is the bounded-honest
        // path: we do not block indefinitely, and the next press
        // will open the chooser for the NEW input (the stale one
        // will be removed by its own in-flight handler shortly).
      });
  }

  // (2) Bounded retry window (the C-2 fake-clock law): the
  //     press is retried until the chooser opens, within 15 s.
  //     Each attempt: register waitForEvent FIRST (the race-free
  //     order — the event listener is armed before the keypress
  //     is dispatched, so a fast-open chooser is never missed),
  //     then press, then race the chooser promise against a
  //     3 s per-attempt timeout.
  const deadline = Date.now() + 15_000;
  for (let attempt = 1; ; attempt++) {
    const chooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    const race = await Promise.race([
      chooserPromise.then((c) => c as FileChooser),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), Math.min(3_000, deadline - Date.now())),
      ),
    ]);
    if (race !== null) {
      if (attempt > 1) {
        console.log(
          `  [${lane}] import chooser opened on attempt ${attempt} (cold-boot retry)`,
        );
      }
      await race.setFiles([filePath]);
      // (1b) Settle: wait for the app to remove the input so the
      //      NEXT lane's triggerImport starts from a clean DOM.
      await page
        .locator("input[type=file]")
        .first()
        .waitFor({ state: "detached", timeout: 5_000 })
        .catch(() => {
          /* bounded: the handler is in-flight; the next lane will
             handle the stale input the same way */
        });
      return;
    }
    if (Date.now() >= deadline) {
      // (4) Honest bounded failure: dump the app's state so the
      //     next operator reading the failure has the diagnostic
      //     without having to re-run the lane.
      const state = await page.evaluate(() => ({
        fileInputs: document.querySelectorAll('input[type=file]').length,
        notice: document.querySelector('.chaconne-notice')?.textContent ?? null,
        recipeList: !!document.querySelector('#chaconne-recipe-list'),
        errorPanel: !!document.querySelector('#chaconne-error'),
        swController: navigator.serviceWorker?.controller !== null,
      }));
      throw new Error(
        `import filechooser never opened after ${attempt} attempts in 15 s ` +
          `(lane ${lane}); app state: ${JSON.stringify(state)}`,
      );
    }
  }
}

test.describe("C-8 import/export battery", () => {
  let dataDir: string;

  test.beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "chaconne-io-e2e-"));
  });

  test.afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("[EXPORT] keyboard-only Ctrl+E captures bytes BYTE-EQUAL the export golden (unicode, raw UTF-8)", async ({
    browser,
  }) => {
    const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
    const page: Page = await ctx.newPage();
    await bootWithGolden(page);

    // The unicode golden's RAW UTF-8 bytes are committed on disk
    // (the byte-pin, not a re-serialization): every probe's code
    // points appear as their actual UTF-8 bytes, and no \u-escape
    // form is present in the file.
    const goldenText = exportGoldenBytes.toString("utf8");
    for (const probe of UNICODE_PROBES) {
      expect(goldenText, `the export golden carries ${probe} as RAW bytes`).toContain(probe);
    }
    expect(goldenText).not.toContain("\\u");

    // The keyboard-only export (the notice flips + the download fires).
    const exported = await captureExport(page, dataDir);
    await expect(page.locator(".chaconne-notice")).toContainText(
      "Exported the data set (canonical JSON).",
    );

    // THE byte-equality pin (against the actual golden bytes read
    // from disk — the re-serialization is the one this spec's
    // import lane exercises, below; THIS lane asserts the EXPORT
    // lane's bytes, not the store's).
    expect(exported.equals(exportGoldenBytes)).toBe(true);
    await ctx.close();
  });

  test("[ROUND-TRIP] import the export golden -> the re-export is byte-identical (same-data-same-bytes across the UI import lane)", async ({
    browser,
  }) => {
    const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
    const page: Page = await ctx.newPage();
    await bootWithGolden(page);
    const preImport = await readStoreBytes(page);

    // Stage the golden on disk for the import lane's file read.
    const staged = join(dataDir, "stage-export.json");
    writeFileSync(staged, exportGoldenBytes);
    await triggerImport(page, staged, "[ROUND-TRIP]");
    await expect(page.locator(".chaconne-notice")).toContainText("Imported the data set.");

    // The store's canonical re-export (a second Ctrl+E) is
    // BYTE-IDENTICAL to the golden AND to the pre-import store
    // bytes (the import → persist → export identity map).
    const reExported = await captureExport(page, dataDir);
    const postImport = await readStoreBytes(page);
    expect(reExported.equals(exportGoldenBytes)).toBe(true);
    expect(postImport.equals(exportGoldenBytes)).toBe(true);
    expect(preImport.equals(postImport)).toBe(true);
    await ctx.close();
  });

  test("[REFUSED] the chaconne.v2 golden -> the dry-run report renders + the store is byte-identical (never a partial import)", async ({
    browser,
  }) => {
    const ctx: BrowserContext = await browser.newContext();
    const page: Page = await ctx.newPage();
    await bootWithGolden(page);
    const preImport = await readStoreBytes(page);

    // Stage the chaconne.v2 document on disk for the import lane.
    const staged = join(dataDir, "stage-refused.json");
    writeFileSync(staged, refusedGoldenBytes);
    await triggerImport(page, staged, "[REFUSED]");

    // The dry-run report RENDERS (the wouldImport counts + the
    // refusal reasons — the app.ts's exact string, the golden's
    // data).
    await expect(page.locator(".chaconne-notice")).toContainText(REFUSED_NOTICE);

    // THE refusal never touches the store (the persistAll on the
    // refusal path is absent — app.ts's import action only persists
    // on the success branch; byte-identity asserted):
    const postImport = await readStoreBytes(page);
    expect(postImport.equals(preImport)).toBe(true);
    expect(postImport.equals(exportGoldenBytes)).toBe(true);
    await ctx.close();
  });

  test("[CORRUPT] a malformed JSON import -> the honest error notice + the corrupt STORE boot lane (the battery's second CORRUPT pin)", async ({
    browser,
  }) => {
    // Lane 1: the UI import lane's malformed file → the honest
    // notice + the store byte-unchanged.
    {
      const ctx: BrowserContext = await browser.newContext();
      const page: Page = await ctx.newPage();
      await bootWithGolden(page);
      const preImport = await readStoreBytes(page);

      // A truncated byte stream: valid JSON up to the cut, then
      // nothing — JSON.parse throws inside importData's try/catch.
      const truncated = exportGoldenBytes.subarray(0, 32).toString("utf8");
      const staged = join(dataDir, "stage-corrupt.json");
      writeFileSync(staged, truncated);
      await triggerImport(page, staged, "[CORRUPT]");

      // The honest error notice (the DomainInvariantError's message
      // surfaces through app.ts's catch — the exact string is
      // "Import failed: import: not valid JSON").
      await expect(page.locator(".chaconne-notice")).toContainText(
        "Import failed: import: not valid JSON",
      );

      // The store is unchanged (the failure path persists nothing):
      const postImport = await readStoreBytes(page);
      expect(postImport.equals(preImport)).toBe(true);
      await ctx.close();
    }

    // Lane 2: the corrupt-STORE BOOT lane (chaconne-resilience's
    // CORRUPT pin in the import-gate context — seed undecodable
    // bytes into the committed key BEFORE boot; the import gate's
    // DomainInvariantError path renders the honest error panel,
    // the corrupt bytes survive, no silent wipe, no crash):
    {
      const ctx: BrowserContext = await browser.newContext();
      const page: Page = await ctx.newPage();
      const corruptBytes = exportGoldenBytes.subarray(0, 32);
      await page.addInitScript((bytes: string) => {
        // Simulate an undecodable committed key: the byte string
        // written directly (the C-7 resilience spec's pattern —
        // the committed key holds corrupt bytes, not a valid JSON
        // string, so JSON.parse fails and load() returns null).
        // We write the raw bytes as a UTF-8 string to the key.
        localStorage.setItem("chaconne.data", bytes);
        localStorage.removeItem("chaconne.tmp");
      }, corruptBytes.toString("utf8"));
      await page.goto("/");
      // The honest corrupt-panel state (the import gate's
      // DomainInvariantError, "stored data is undecodable"): the
      // `#chaconne-error` alert renders (the recipe list does NOT).
      await expect(page.locator("#chaconne-error")).toBeVisible();
      await expect(page.locator("#chaconne-recipe-list")).not.toBeAttached();
      // The corrupt bytes survive in localStorage (no silent wipe):
      const surviving = await page.evaluate(() => localStorage.getItem("chaconne.data"));
      expect(surviving).toBe(corruptBytes.toString("utf8"));
      await ctx.close();
    }
  });
});
