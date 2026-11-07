/**
 * Fugue — the e2e import/export battery (ticket F-8, the fixture lane).
 *
 * THE FIVE LANES:
 *  (a) [EXPORT] — trigger the export through the palette, intercept the
 *                 download (Playwright's download event), read the file,
 *                 assert it parses, re-export and assert BYTE-IDENTICAL
 *                 (the byte-stable golden — the stability pin, not a
 *                 frozen fixture blob).
 *  (b) [CANONICAL] — sortKeysDeep order + compact separators asserted
 *                 on the downloaded bytes.
 *  (c) [ROUND-TRIP] — set up the store (create a job through the compose
 *                 UI), export, wipe (cleared storage), import the file,
 *                 assert the job row returns byte-stable.
 *  (d) [REFUSAL] — a foreign-schema file (schema "fugue.v999" — crafted
 *                 in the spec) imports to the REFUSAL panel with the
 *                 schema literal + the 'no partial import' details, and
 *                 the store stays unchanged (the job lane byte-identical
 *                 before/after).
 *  (e) [NOT-JSON] — a garbage file refuses with the not-json reason.
 *
 * THE SELF-SKIP GUARD: module-scope `process.env.FUGUE_E2E = "1"` arms
 * the marker (the config's contract); when the marker is absent the spec
 * self-skips (the Coda/Chaconne precedent), so the fugue io battery
 * never runs under any other marker.
 *
 * LAWS honored: zero-dep (browser APIs only — no libraries); the
 * canonical bytes flow through exportFugue/parseFugue untouched; the
 * store never mutates on a refusal; every failure surfaces honestly.
 *
 * Operator gate: `FUGUE_E2E=1 bunx playwright test -c
 * playwright.fugue.config.ts` from the repo root.
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type BrowserContext,
  type FileChooser,
  type Page,
} from "@playwright/test";

test.skip(
  process.env.FUGUE_E2E !== "1",
  "fugue lane only — run via playwright.fugue.config.ts with FUGUE_E2E=1",
);

test.describe.configure({ mode: "serial" });

let dataDir: string;

test.beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fugue-io-e2e-"));
});

test.afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** Open the palette (Ctrl+K) and pick a command by its `data-cmd` id.
 *  The palette closes on pick. */
async function pickCommand(page: Page, cmd: string): Promise<void> {
  await page.keyboard.press("Control+k");
  const palette = page.locator(".fugue-palette");
  await expect(palette).toBeVisible({ timeout: 6_000 });
  await palette.locator(`li[data-cmd="${cmd}"]`).click();
  // The command dispatches; the palette closes on pick.
  await expect(palette).toHaveCount(0, { timeout: 6_000 });
}

/** The export: pick "export" through the palette, intercept the download
 *  via Playwright's download event, save it to disk, read the bytes back. */
let captureSeq = 0;
async function captureExport(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    pickCommand(page, "export"),
  ]);
  const savedPath = join(dataDir, `fugue-export-${++captureSeq}.json`);
  await download.saveAs(savedPath);
  return readFileSync(savedPath);
}

/** The import: pick "import" through the palette (the app's hidden
 *  `<input type=file>` + click opens a native file chooser), answer it
 *  with a file on disk via the `filechooser` event (an EVENT, not a
 *  pointer — the chaconne-io kin). The bounded retry handles the
 *  cold-boot chooser-open race (the chaconne triggerImport law). */
async function triggerImport(page: Page, filePath: string, lane: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (let attempt = 1; ; attempt++) {
    const chooserPromise = page.waitForEvent("filechooser");
    await pickCommand(page, "import");
    const race = await Promise.race([
      chooserPromise.then((c) => c as FileChooser),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), Math.min(3_000, deadline - Date.now())),
      ),
    ]);
    if (race !== null) {
      if (attempt > 1) {
        console.log(`  [${lane}] import chooser opened on attempt ${attempt} (cold-boot retry)`);
      }
      await race.setFiles([filePath]);
      // Settle: wait for the app to remove the hidden input so the next
      // triggerImport starts from a clean DOM.
      await page
        .locator("input[type=file]")
        .first()
        .waitFor({ state: "detached", timeout: 5_000 })
        .catch(() => {
          /* bounded: the handler is in-flight; the next lane handles the stale input */
        });
      return;
    }
    if (Date.now() >= deadline) {
      const state = await page.evaluate(() => ({
        fileInputs: document.querySelectorAll('input[type=file]').length,
        refusalPanel: !!document.querySelector('[data-panel="import-refusal"]'),
        appShell: !!document.querySelector('#fugue-app'),
      }));
      throw new Error(
        `import filechooser never opened after ${attempt} attempts in 15 s ` +
          `(lane ${lane}); app state: ${JSON.stringify(state)}`,
      );
    }
  }
}

/** Boot the app shell (the O-1 never-blank law). */
async function bootApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("#fugue-app")).toBeVisible();
}

/** Seed the store with a single job through the compose UI. */
async function createJobThroughCompose(
  page: Page,
  title: string,
  prompt: string,
): Promise<void> {
  await bootApp(page);
  await pickCommand(page, "new-job");
  const dialog = page.locator('[data-dialog="compose"]');
  await expect(dialog).toBeVisible();
  await page.locator('[data-input="title"]').fill(title);
  await page.locator('[data-input="prompt"]').fill(prompt);
  // The default draft has scheduleKind "every" + scheduleExpr "1d"
  // (valid); the model/timezone defaults are valid, so the form is
  // submittable once title + prompt are filled.
  await expect(dialog.locator('button[aria-label="submit"]')).toBeEnabled();
  await dialog.locator('button[aria-label="submit"]').click();
  // The shadow-lane job row now exists.
  await expect(
    page.locator(".fugue-job-row[data-lane='shadow']", { hasText: title }),
  ).toBeVisible({ timeout: 6_000 });
}

/** The store's committed bytes (the byte-identical assertions). */
async function readStoreBytes(page: Page): Promise<string> {
  return (await page.evaluate(() => localStorage.getItem("fugue.committed.v1"))) ?? "";
}

/** The rendered job lane's bytes (byte-identical before/after a refusal
 *  — only the job-row lane is read, so the appended refusal panel cannot
 *  pollute the comparison). */
async function readJobLaneBytes(page: Page): Promise<string> {
  return page.evaluate(() => {
    const rows = document.querySelectorAll(".fugue-job-row");
    return Array.from(rows)
      .map((r) => r.outerHTML)
      .join("\n");
  });
}

/* ================================================================== */
/* (a) [EXPORT] — the byte-stable download                             */
/* ================================================================== */

test("[EXPORT] the palette export downloads the canonical bytes; re-export is byte-identical", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const page: Page = await ctx.newPage();
  await createJobThroughCompose(page, "io-export-job", "export probe prompt");

  // The first export captures the download's bytes.
  const first = await captureExport(page);
  // The exported bytes parse as JSON (they are a valid document).
  const parsed = JSON.parse(first.toString("utf8"));
  expect(parsed.schema).toBe("fugue.v1");
  expect(Array.isArray(parsed.jobs)).toBe(true);
  expect(Array.isArray(parsed.runs)).toBe(true);

  // The RE-export is BYTE-IDENTICAL (the byte-stable golden — the
  // stability pin, NOT a frozen fixture blob re-serialized in the spec).
  const second = await captureExport(page);
  expect(second.equals(first)).toBe(true);

  // The export toast surfaced the honest summary (N jobs, M runs).
  await expect(page.locator('[data-io-toast="export"]').first()).toBeVisible();

  await ctx.close();
});

/* ================================================================== */
/* (b) [CANONICAL] — sortKeysDeep order + compact separators          */
/* ================================================================== */

test("[CANONICAL] the downloaded bytes carry the canonical shape (sorted keys + compact separators)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const page: Page = await ctx.newPage();
  await createJobThroughCompose(page, "io-canonical-job", "canonical probe prompt");

  const bytes = (await captureExport(page)).toString("utf8");

  // Compact separators: no space after ":" or "," (JSON.stringify's
  // compact form — the canonical serializer emits no separators).
  expect(bytes).not.toContain(": ");
  expect(bytes).not.toContain(", ");

  // sortKeysDeep order: at the TOP level the keys are jobs < nextId <
  // runs < schema (alphabetical). Assert their index order.
  const iJobs = bytes.indexOf('"jobs"');
  const iNext = bytes.indexOf('"nextId"');
  const iRuns = bytes.indexOf('"runs"');
  const iSchema = bytes.indexOf('"schema"');
  expect(iJobs).toBeGreaterThan(0);
  expect(iJobs).toBeLessThan(iNext);
  expect(iNext).toBeLessThan(iRuns);
  expect(iRuns).toBeLessThan(iSchema);

  await ctx.close();
});

/* ================================================================== */
/* (c) [ROUND-TRIP] — create, export, wipe, import -> row returns     */
/* ================================================================== */

test("[ROUND-TRIP] export, wipe storage, re-import the file -> the job row returns byte-stable", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const page: Page = await ctx.newPage();

  // Phase 1: create the job + export it.
  await createJobThroughCompose(page, "io-roundtrip-job", "round-trip prompt");
  const exported = await captureExport(page);
  const stagedPath = join(dataDir, "fugue-roundtrip.json");
  writeFileSync(stagedPath, exported);
  const preWipeBytes = await readStoreBytes(page);
  expect(preWipeBytes.length).toBeGreaterThan(0);

  // Phase 2: WIPE the store (clear the committed + temp keys) + reload.
  await page.evaluate(() => {
    localStorage.removeItem("fugue.committed.v1");
    localStorage.removeItem("fugue.temp.v1");
  });
  await page.reload();
  await expect(page.locator("#fugue-app")).toBeVisible();
  // The store re-persists the EMPTY document on boot (the every-
  // transition persistAll law) — the committed key now carries the
  // canonical EMPTY form (schema + empty arrays, nextId 0). That IS
  // the honest wipe: the authored job is gone, replaced by the
  // schema's empty golden.
  expect(await readStoreBytes(page)).toBe(
    JSON.stringify({ jobs: [], nextId: 0, runs: [], schema: "fugue.v1" }),
  );

  // Phase 3: re-import the exported file through the UI's import lane.
  await triggerImport(page, stagedPath, "[ROUND-TRIP]");
  await expect(page.locator('[data-io-toast="import"]').first()).toBeVisible({
    timeout: 6_000,
  });

  // The job row RETURNS, byte-stable (the same title the compose created).
  await expect(
    page.locator(".fugue-job-row[data-lane='shadow']", { hasText: "io-roundtrip-job" }),
  ).toBeVisible({ timeout: 6_000 });

  // The re-imported store's canonical bytes re-export to the SAME
  // bytes as the original export (the import -> persist -> export
  // identity map on canonical bytes).
  const reExported = await captureExport(page);
  expect(reExported.equals(exported)).toBe(true);

  await ctx.close();
});

/* ================================================================== */
/* (d) [REFUSAL] — a foreign-schema file -> the dry-run panel        */
/* ================================================================== */

test("[REFUSAL] a foreign-schema (fugue.v999) file -> the REFUSAL panel, the store unchanged", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const page: Page = await ctx.newPage();

  // Seed the store with a job so there is something to stay unchanged.
  await createJobThroughCompose(page, "io-refusal-job", "refusal probe prompt");
  const before = await readJobLaneBytes(page);
  expect(before.length).toBeGreaterThan(0);

  // Craft the foreign-schema file in the spec (the F-8 ticket's pin).
  const foreignPath = join(dataDir, "fugue-v999.json");
  writeFileSync(
    foreignPath,
    JSON.stringify({
      schema: "fugue.v999",
      jobs: [{ title: "foreign", prompt: "x" }],
      runs: [],
      nextId: 1,
    }),
  );

  // Import it: the DRY-RUN REFUSAL panel renders with the schema literal
  // + the 'no partial import' details.
  await triggerImport(page, foreignPath, "[REFUSAL]");
  const panel = page.locator('[data-panel="import-refusal"]');
  await expect(panel).toBeVisible({ timeout: 6_000 });
  // The offending schema literal is carried verbatim.
  await expect(panel.locator('[data-io-schema="fugue.v999"]')).toBeVisible();
  // The 'no partial import' details are rendered verbatim.
  await expect(panel.locator('[data-io-details]')).toContainText("no partial import");
  // The reason line is present.
  await expect(panel.locator(".fugue-panel-reason")).toBeVisible();

  // The store STAYS byte-identical (the job lane is unchanged — a
  // refusal never touches persistAll).
  const after = await readJobLaneBytes(page);
  expect(after).toBe(before);

  await ctx.close();
});

/* ================================================================== */
/* (e) [NOT-JSON] — a garbage file refuses with the not-json reason   */
/* ================================================================== */

test("[NOT-JSON] a garbage (non-JSON) file refuses with the not-json reason", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext({ acceptDownloads: true });
  const page: Page = await ctx.newPage();

  // Seed the store with a job (so the not-json refusal leaves it intact).
  await createJobThroughCompose(page, "io-notjson-job", "not-json probe prompt");
  const before = await readJobLaneBytes(page);
  expect(before.length).toBeGreaterThan(0);

  // The garbage file (NOT valid JSON).
  const garbagePath = join(dataDir, "fugue-garbage.txt");
  writeFileSync(garbagePath, "{this is not json, it is garbage bytes");

  await triggerImport(page, garbagePath, "[NOT-JSON]");
  const panel = page.locator('[data-panel="import-refusal"]');
  await expect(panel).toBeVisible({ timeout: 6_000 });
  // The not-json reason is carried (the refusal is pre-schema, so the
  // schema lane shows 'absent' — the empty data-io-schema attribute).
  await expect(panel.locator(".fugue-panel-reason")).toContainText("not-json");
  await expect(panel.locator('[data-io-schema=""]')).toBeVisible();
  // The details carry the not-json report verbatim.
  await expect(panel.locator('[data-io-details]')).toContainText("not valid JSON");

  // The store stays unchanged.
  const after = await readJobLaneBytes(page);
  expect(after).toBe(before);

  await ctx.close();
});
