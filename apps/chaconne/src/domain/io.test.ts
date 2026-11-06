/**
 * io test — PRD edge cases 8/9/10 + acceptance (5) and (7):
 * canonical-JSON byte-stability (serialize twice → identical bytes;
 * round-trip equal) and foreign/future-schema rejection with the
 * dry-run report (never a partial import).
 */
import { test, expect } from "bun:test";
import { createImportExport, importExport, SCHEMA_VERSION, toCanonicalJson } from "./io.js";
import { addRecipe, addRun, emptyData } from "./model.js";
import type { ChaconneData, RunRecord } from "./types.js";
import { DomainInvariantError } from "./types.js";

const NOW = "2026-11-06T00:00:00Z";

function fixtureData(): ChaconneData {
  let d = emptyData();
  d = addRecipe(d, "night café ① ②", [
    { kind: "goto", selector: "https://café.example" },
    { kind: "fill", selector: "input#q", value: "héllo wörld" },
    { kind: "screenshot", selector: "body" },
  ]).data;
  const hex = "ab".repeat(32);
  const rec = d.recipes[0];
  d = addRun(d, rec.id, {
    status: "ok",
    startedAt: NOW,
    finishedAt: NOW,
    committedPrefix: 3,
    artifacts: [{ name: `2_r1_sha256:${hex}.png`, sha256: hex }],
    extracted: { "0": "héllo wörld" },
  }).data;
  return d;
}

test("canonical JSON: serialize twice → byte-identical", () => {
  const a = toCanonicalJson(fixtureData());
  const b = toCanonicalJson(fixtureData());
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
});

test("canonical JSON: key order is sorted deep, arrays keep index order", () => {
  const s = toCanonicalJson(fixtureData());
  // top-level keys: recipes before runs (r < s < …; "recipes" < "runs" < "schema")
  const idxR = s.indexOf('"recipes"');
  const idxRu = s.indexOf('"runs"');
  const idxS = s.indexOf('"schema"');
  expect(idxR).toBeLessThan(idxRu);
  expect(idxRu).toBeLessThan(idxS);
  // recipe object keys: id < name < steps < version (sorted)
  const recipeStart = s.indexOf('"recipes"');
  const recipeJson = s.slice(recipeStart);
  const kId = recipeJson.indexOf('"id"');
  const kName = recipeJson.indexOf('"name"');
  const kSteps = recipeJson.indexOf('"steps"');
  expect(kId).toBeLessThan(kName);
  expect(kName).toBeLessThan(kSteps);
  // step order is the array order (semantic): selectors in insertion order
  const selIdxGoto = s.indexOf('"https://café.example"');
  const selIdxFill = s.indexOf('"input#q"');
  expect(selIdxGoto).toBeLessThan(selIdxFill);
});

test("round-trip: import(export(d)) is deep-equal to d", () => {
  const d = fixtureData();
  const out = importExport.importData(importExport.exportData(d));
  expect(out.rejected).toBe(false);
  const back = (out as { data: ChaconneData }).data;
  expect(JSON.parse(JSON.stringify(back))).toEqual(JSON.parse(JSON.stringify(d)));
});

test("round-trip: unicode recipe names stay byte-stable (edge case 9)", () => {
  const d = fixtureData();
  const bytes1 = Buffer.from(importExport.exportData(d));
  const out = importExport.importData(bytes1.toString("utf8"));
  expect(out.rejected).toBe(false);
  const bytes2 = Buffer.from((out as { data: ChaconneData }).data ? importExport.exportData((out as { data: ChaconneData }).data) : "");
  expect(bytes2.equals(bytes1)).toBe(true);
  expect(d.recipes[0].name).toBe("night café ① ②");
});

test("import rejects non-chaconne.v1 schema with a dry-run report (edge case 10)", () => {
  const d = fixtureData();
  const doc = JSON.parse(importExport.exportData(d)) as Record<string, unknown>;
  doc.schema = "chaconne.v2"; // a FUTURE schema
  const out = importExport.importData(JSON.stringify(doc));
  expect(out.rejected).toBe(true);
  if (out.rejected) {
    expect(out.report.schema).toBe("chaconne.v2");
    expect(out.report.wouldImport.recipes).toBe(d.recipes.length);
    expect(out.report.wouldImport.runs).toBe(d.runs.length);
    expect(out.report.reasons.join(" ")).toContain("no partial import");
  }
  // and the same document with no schema key at all → also refused
  delete doc.schema;
  const out2 = importExport.importData(JSON.stringify(doc));
  expect(out2.rejected).toBe(true);
});

test("import rejects invariant breaches with DomainInvariantError", () => {
  const d = fixtureData();
  const doc = JSON.parse(importExport.exportData(d)) as ChaconneData;
  doc.runs.push({ ...doc.runs[0], id: 99, recipeId: 42 } as RunRecord); // orphan recipeId
  expect(() => importExport.importData(JSON.stringify(doc))).toThrow(DomainInvariantError);
});
test("import rejects non-JSON and non-object roots", () => {
  expect(() => importExport.importData("{not json")).toThrow(DomainInvariantError);
  expect(() => importExport.importData("[1,2]")).toThrow(DomainInvariantError);
});

test("the singleton port and factory agree", () => {
  const d = fixtureData();
  expect(createImportExport().exportData(d)).toBe(importExport.exportData(d));
  expect(SCHEMA_VERSION).toBe("chaconne.v1");
});
