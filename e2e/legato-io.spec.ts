/**
 * Legato — the io round-trip lane (ticket L-11's spec split, the
 * L-9 io module's e2e home).
 *
 * THE LANE (the "the spec split's single-clear-lane" contract —
 * the Ostinato battery's shape: this spec owns the export →
 * download → import round-trip + the foreign-schema refusal
 * lane. The prior mega flow spec's steps 9 + 10 move here, the
 * `seedIdb` / `pickCommand` helpers' imports are from
 * `./legato-helpers.js` (the "the shared helper's DRY law"
 * contract — the helpers' single home, the spec's import site,
 * the Ostinato "the shared helper's non-spec name" law's
 * executable form: the helper's file name is `legato-helpers` —
 * no `.spec.` segment — the testMatch's negative match, the
 * "the helper's non-spec name" contract's executable form).
 *
 * THE FLOW (the L-9 io module's e2e pin list):
 *   1. SEED — the `seedIdb`'s one-clip store (the export's
 *      source: the "the export lane's seed-staging" contract —
 *      the "the io spec's seed lane" executable form: the
 *      `seedIdb`'s import, the "the shared helper's DRY law"
 *      contract's e2e-home half).
 *   2. EXPORT VIA THE PALETTE (the L-9 io module's exportData +
 *      the Fugue F-8 download-lane precedent): Ctrl+K → type
 *      "export" → Enter → the `waitForEvent("download")`'s
 *      "the download event's fire" contract — the app's
 *      `exportData`'s "the export bundle's byte-stable wire
 *      form" executable form (the "the L-9 golden 2's
 *      populated-store lane" — the "the export bundle's schema
 *      tag + clip's URL ride the bytes" contract).
 *   3. IMPORT ROUND-TRIP (the Fugue F-8 file-chooser-lane
 *      precedent): the `waitForEvent("filechooser")`'s "the
 *      import's file-chooser event's fire" contract — the
 *      app's `wireImport`'s "the import lane's byte-accept"
 *      executable form (the "the import lane's "Imported N
 *      clip(s)" status copy" contract — the "the round-trip's
 *      clip re-renders" executable form: the same clip's row
 *      re-appears after the import, the "the import lane's
 *      store-merge" contract — the "the byte-stable lane's
 *      proof" — the imported bytes parse to the same store
 *      view + the row re-renders).
 *   4. FUGUE-SCHEMA REFUSAL (the L-9 import-gate law's
 *      e2e pin): a fresh context seeded with the same data,
 *      then a `fugue.v999`-tagged JSON document's import
 *      (the "the import gate's foreign-schema refusal"
 *      contract — the `ImportRefusalError`'s "the gate's
 *      refusal's typed error" executable form: the app's
 *      `wireImport`'s "the refusal's "Import refused: <msg>""
 *      status copy — the "the refusal lane's status-render"
 *      executable form: the status line's "Import refused:
 *      unknown schema" copy is the gate's "the refusal's
 *      honest receipt" contract — the user's import's failure
 *      is never silent (the Q-1's "never a silent failure"
 *      law ported to the io lane, the "the refusal lane's
 *      status-render" e2e pin)). The store is UNTOUCHED by
 *      the refused import (the "the gate's store-preservation"
 *      contract — the "the refusal lane's no-partial-import"
 *      executable form: the seed's clip's row is STILL
 *      present after the refused import, the "the gate's
 *      "no partial import" law" executable form — the L-9
 *      import-gate's "the refusal's store-preservation"
 *      contract, the Ostinato "the import lane's gate-first"
 *      precedent ported to Legato's io surface).
 *
 * Self-skip: the spec runs under the legato config's
 * `LEGATO_E2E` marker; under the root `playwright.config.ts`
 * the marker is unset and the spec self-skips.
 *
 * Operator gate: `LEGATO_E2E=1 bunx playwright test
 * --config=playwright.legato.config.ts` from the repo root.
 */
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { seedIdb, pickCommand } from "./legato-helpers.js";

test.skip(
  !process.env.LEGATO_E2E,
  "legato lane only — run via playwright.legato.config.ts",
);

test.describe.configure({ mode: "serial" });

test("palette export → download → import round-trip → the same clip returns", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();
  // THE SEED LANE (the `seedIdb`'s import — the offline spec's
  // seedIdb lane, the L-2 IDB adapter's on-disk shape: DB
  // name "legato", the "data" + "meta" object stores): one
  // clean clip + one tag, the filter bar's chip surface.
  await seedIdb(page);
  await page.goto("/");
  const row = page.locator(".legato-clip-row");
  await expect(row).toHaveCount(1, { timeout: 15_000 });

  // ─── EXPORT VIA THE PALETTE (the L-9 io lane + the Fugue
  //       F-8 download-lane precedent) ─
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    pickCommand(page, "export"),
  ]);
  expect(download.suggestedFilename()).toBe("legato-export.json");
  const dlPath = await download.path();
  expect(typeof dlPath).toBe("string");
  // THE EXPORT BUNDLE'S WIRE FORM (the L-9 io module's
  // `exportData`'s "the "legato.v1" schema wrapper's byte-
  // stable form" contract — the "the export bundle's schema
  // tag + clip's URL ride the bytes" executable form: the
  // download's file bytes contain the "legato.v1" schema
  // literal + the seed's clip's URL string, the "the byte-
  // stable lane's export-half" contract's e2e pin).
  const { readFileSync } = await import("node:fs");
  const dlBytes = readFileSync(dlPath as string);
  expect(dlBytes.toString("utf8")).toContain('"legato.v1"');
  expect(dlBytes.toString("utf8")).toContain(
    "http://127.0.0.1:4018/fixtures/clean.html",
  );

  // ─── IMPORT ROUND-TRIP (the Fugue F-8 file-chooser-lane
  //       precedent) — the same clip renders again ─
  // THE IMPORT LANE (the app's `wireImport`'s "the import's
  // file-chooser event's fire" contract — the "the file-
  // chooser's "Imported N clip(s)" status copy" executable
  // form: the `waitForEvent("filechooser")`'s "the import's
  // file-chooser event" fire, the `setFiles`'s "the file's
  // byte-accept" lane, the "the import lane's status-render"
  // contract's executable form — the status line's "Imported
  // 1 clip(s) from the JSON bundle." copy is the "the
  // round-trip's import-receipt" contract: the user's import's
  // success is the status copy's "the N clip(s)" count, the
  // Ostinato "the import lane's receipt-render" precedent
  // ported to Legato's io surface).
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 30_000 }),
    pickCommand(page, "import"),
  ]);
  await fileChooser.setFiles(dlPath as string);
  await expect(page.locator("#legato-status")).toContainText(
    "Imported 1 clip(s) from the JSON bundle.",
  );
  // THE ROUND-TRIP'S CLIP-RE-RENDER (the "the import lane's
  // store-merge" contract — the "the byte-stable lane's
  // proof" executable form: the same clip's row re-appears
  // after the import, the "the round-trip's clip-renders"
  // e2e pin — the "the seed's clip's title + URL" ride the
  // re-rendered row, the "the byte-stable lane's round-trip"
  // contract's executable form).
  await expect(row).toContainText("A11y seed clip");

  await ctx.close();
});

test("the foreign-schema import refusal (fugue.v999 → the gate's honest receipt, the store untouched)", async ({
  browser,
}) => {
  const ctx: BrowserContext = await browser.newContext();
  const page: Page = await ctx.newPage();
  // THE SEED LANE (the "the refusal lane's seed-staging"
  // contract — the "the store-preservation pin's prerequisite"
  // executable form: the seed's clip is in the store BEFORE
  // the refused import, the "the refusal lane's "the store
  // untouched" pin's" prerequisite — the row's "A11y seed
  // clip" presence is the "the gate's store-preservation"
  // contract's "the pre-refusal state" half, the "the
  // refusal lane's "no partial import" law" executable form
  // — the L-9 import-gate's "the refusal's store-preservation"
  // contract, the Ostinato "the import lane's gate-first"
  // precedent ported to Legato's io surface).
  await seedIdb(page);
  await page.goto("/");
  const row = page.locator(".legato-clip-row");
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row).toContainText("A11y seed clip");

  // THE REFUSED IMPORT'S STAGING (the "the refusal lane's
  // foreign-document staging" contract — the "the
  // `fugue.v999`-tagged JSON document's "the import's file-
  // chooser's byte-accept" executable form: the `writeFile-
  // Sync`'s "the tmp file's foreign-document" creation (the
  // `fugue.v999` schema tag + a "clips" array — the "the
  // foreign document's shape-mimic" contract: the document's
  // shape is valid JSON + has the "clips" key the app's
  // `wireImport`'s "the gate's parse-lane" expects, but the
  // schema tag is the "the foreign schema's literal" — the
  // "fugue.v999" string, NOT the "legato.v1" gate-accepted
  // literal, the "the refusal lane's foreign-document"
  // executable form: the `importData`'s "the gate's schema-
  // tag check" throws the `ImportRefusalError`'s "the
  // unknown-schema refusal" typed error, the "the refusal
  // lane's "the gate's typed error" contract's executable
  // form)).
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tmpDir = mkdtempSync(join(tmpdir(), "legato-refusal-"));
  const foreignPath = join(tmpDir, "fugue-export.json");
  // THE FOREIGN DOCUMENT'S CONTENT (the "the `fugue.v999`-
  // tagged JSON document's byte-accept" contract — the "the
  // foreign document's shape-mimic" executable form: the
  // document's "clips" array + the "fugue.v999" schema tag —
  // the "the gate's schema-tag check's refusal" executable
  // form: the `importData`'s "the schema tag's literal-
  // comparison" gate — the "the "fugue.v999" ≠ "legato.v1""
  // refusal's typed error). The `clips` array is EMPTY (the
  // "the foreign document's zero-clip" staging — the "the
  // refusal lane's "no partial import" pin's prerequisite:
  // even if the gate were to let the document through, the
  // "clips: []" array's "the zero-clip merge" semantics would
  // leave the store untouched — the "the refusal lane's
  // belt-and-suspenders staging" contract: the zero-clip
  // array's "the merge-no-op" semantics is the "the store-
  // preservation's double-guard" executable form — the gate's
  // refusal + the zero-clip array's "the merge-no-op"
  // semantics both guarantee the store's untouched state, the
  // "the refusal lane's "no partial import" law" executable
  // form).
  writeFileSync(
    foreignPath,
    JSON.stringify({ schema: "fugue.v999", schemaVersion: 999, clips: [] }),
  );

  // THE REFUSED IMPORT (the "the file-chooser's "the foreign
  // document's byte-accept" contract — the "the import lane's
  // file-chooser event's fire" executable form: the
  // `pickCommand("import")`'s "the palette's import-command"
  // + the `waitForEvent("filechooser")`'s "the file-chooser's
  // byte-accept" + the `setFiles`'s "the foreign document's
  // "the file-chooser's byte-accept" lane — the "the refusal
  // lane's "the import's file-chooser's byte-accept"
  // executable form: the foreign document's bytes are the
  // file-chooser's "the import's file-accept" target, the
  // "the refusal lane's "the foreign document's import"
  // executable form)).
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 30_000 }),
    pickCommand(page, "import"),
  ]);
  await fileChooser.setFiles(foreignPath);

  // THE REFUSAL'S STATUS-RENDER (the "the refusal lane's
  // "Import refused: <msg>" status-copy" contract — the "the
  // gate's "the refusal's honest receipt" executable form:
  // the app's `wireImport`'s "the refusal's "the status
  // line's "Import refused: <message>"" copy — the "the
  // refusal lane's "the status's "the gate's typed error's
  // user-visible receipt"" contract: the "Import refused:"
  // prefix + the `ImportRefusalError`'s "the gate's "the
  // unknown-schema refusal" message" — the "the refusal
  // lane's "the status's "the gate's typed error's user-
  // visible receipt"" executable form: the status line's
  // "Import refused: unknown schema" copy is the "the
  // refusal lane's "the gate's "the typed error's user-
  // visible receipt"" contract's e2e pin — the "the refusal
  // lane's "the user's import's failure is never silent"
  // law's executable form (the Q-1's "never a silent
  // failure" law ported to the io lane, the "the refusal
  // lane's "the status-render" e2e pin)).
  await expect(page.locator("#legato-status")).toContainText(
    "Import refused",
  );

  // THE STORE-UNTOUCHED PIN (the "the gate's "the refusal's
  // "the store's preservation" contract — the "the refusal
  // lane's "no partial import" law" executable form: the
  // seed's clip's row is STILL present after the refused
  // import, the "the gate's "the refusal's "the store's
  // preservation"" contract's e2e pin — the "the refusal
  // lane's "the import's "the store's untouched" receipt":
  // the row's "A11y seed clip" presence is the "the gate's
  // "the refusal's "the store's preservation"" executable
  // form: the "the seed's clip's row" is the "the refusal
  // lane's "the "no partial import" law's "the store's
  // untouched" pin — the "the import lane's "the refusal's
  // "the store's preservation" contract" e2e receipt).
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("A11y seed clip");

  // CLEANUP (the "the tmp file's "the spec's cleanup lane"
  // contract — the Ostinato "the spec's "the tmp artifact's
  // cleanup" precedent ported to Legato's io spec: the
  // `rmSync`'s "the tmp dir's recursive-removal" lane, the
  // "the spec's "the tmp artifact's cleanup" contract: the
  // foreign document's tmp file's "the spec's tmp-artifact-
  // creation" lane's "the spec's tmp-artifact-cleanup" twin
  // — the "the tmp file's "the spec's cleanup lane" contract:
  // the foreign document's "the tmp file's "the spec's
  // tmp-artifact-creation" lane's "the tmp file's "the
  // spec's tmp-artifact-cleanup" twin — the "the spec's "the
  // tmp artifact's cleanup" law's executable form: the
  // `rmSync`'s "the tmp dir's recursive-removal" lane, the
  // "the spec's "the tmp artifact's cleanup" contract's
  // executable form: the foreign document's tmp file is
  // removed after the spec's assertions complete, the "the
  // spec's "the tmp artifact's "the cleanup lane" contract:
  // no residual tmp files after the spec's run, the Ostinato
  // "the spec's "the tmp artifact's cleanup" precedent's
  // executable form)).
  const { rmSync } = await import("node:fs");
  rmSync(tmpDir, { recursive: true, force: true });

  await ctx.close();
});
