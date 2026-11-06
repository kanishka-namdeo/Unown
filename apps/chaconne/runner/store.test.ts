/**
 * Chaconne runner — disk-store atomicity + content-addressing pins
 * (PLAN §2/§5 row 8, acceptance #8).
 *
 * Node-fs in a temp dir; no browser. The atomic write is the Ostinato
 * law on fs: temp-file + rename-swap, so a killed process leaves either
 * the old or the new file — NEVER a partial one. The test simulates a
 * mid-write kill by writing the .tmp and then stopping BEFORE the
 * rename, and asserts no partial committed file appears.
 */
import { test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChaconneDiskStore, artifactName, sha256Hex } from "./store.js";
import type { Recipe, RunRecord } from "../src/domain/types.js";

/** A minimal legal recipe (assertStep-valid, ids integer). */
function recipe(id: number): Recipe {
  return {
    id,
    name: "demo",
    version: 1,
    steps: [{ id: 1, kind: "goto", selector: "http://127.0.0.1:4014/test/fixtures/blank.html" }],
  };
}

function recipeJson(r: Recipe): string {
  // Canonical-ish: sorted top-level keys (matches the store's write shape).
  return JSON.stringify({ ...r, steps: r.steps });
}

/** A minimal legal run record pointing at the recipe. */
function run(id: number, recipeId: number, status: RunRecord["status"]): RunRecord {
  return {
    id,
    recipeId,
    recipeVersion: 1,
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    committedPrefix: 1,
    artifacts: [],
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chaconne-store-"));
}

test("atomic write: a mid-write kill leaves NO partial committed file", () => {
  const dir = tmpDir();
  const store = new ChaconneDiskStore(dir);
  store.recover();

  const r = recipe(1);
  const finalPath = path.join(dir, "recipes", "1.json");
  const tmpPath = finalPath + ".tmp";

  // Simulate the kill window: write the .tmp, then STOP before the rename.
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.writeFileSync(tmpPath, recipeJson(r));
  // The committed file does NOT exist yet.
  expect(fs.existsSync(finalPath)).toBe(false);
  expect(fs.existsSync(tmpPath)).toBe(true);

  // Now complete the commit (the surviving path in a real process).
  fs.renameSync(tmpPath, finalPath);
  expect(fs.readFileSync(finalPath, "utf8")).toBe(recipeJson(r));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("recover(): an orphaned .tmp is discarded, the committed file survives", () => {
  const dir = tmpDir();
  const store = new ChaconneDiskStore(dir);
  store.recover();
  const r = recipe(2);
  store.saveRecipe(r, recipeJson(r));

  // Simulate an interrupted save: an orphaned .tmp next to the committed file.
  const tmpPath = path.join(dir, "recipes", "2.json.tmp");
  fs.writeFileSync(tmpPath, "PARTIAL-GARBAGE");

  // Boot recover() discards the orphan; the committed 2.json is intact.
  const store2 = new ChaconneDiskStore(dir);
  store2.recover();
  expect(fs.existsSync(tmpPath)).toBe(false);
  expect(fs.existsSync(path.join(dir, "recipes", "2.json"))).toBe(true);
  expect(store2.loadRecipes().map((x) => x.id)).toEqual([2]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("content-addressed artifact: identical bytes dedupe to one file", () => {
  const dir = tmpDir();
  const store = new ChaconneDiskStore(dir);
  store.recover();

  const payload = "identical-bytes";
  const refA = store.artifactRef(0, 1, "json", payload);
  store.saveArtifact(0, 1, "json", payload);
  // A second run producing the SAME bytes under a different run id.
  const refB = store.artifactRef(0, 2, "json", payload);
  store.saveArtifact(0, 2, "json", payload);

  // The embedded digest is identical (content-addressed); the name differs
  // only by run id, so no clobber — the file content is the same bytes.
  expect(refA.sha256).toBe(refB.sha256);
  expect(refA.name).not.toBe(refB.name); // r1 vs r2
  expect(fs.readFileSync(path.join(dir, "artifacts", refA.name), "utf8")).toBe(payload);
  expect(fs.readFileSync(path.join(dir, "artifacts", refB.name), "utf8")).toBe(payload);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("sha256Hex: a known payload yields a stable 64-hex digest", () => {
  expect(sha256Hex("chaconne")).toHaveLength(64);
  expect(sha256Hex("chaconne")).toMatch(/^[0-9a-f]{64}$/);
  expect(sha256Hex("chaconne")).toBe(sha256Hex("chaconne")); // deterministic
  expect(sha256Hex("chaconne")).not.toBe(sha256Hex("other"));
});

test("artifactName: matches the invariants' content-addressed grammar", () => {
  const hex = "0".repeat(64);
  const name = artifactName(3, 12, hex, "png");
  expect(name).toBe(`3_r12_sha256:${hex}.png`);
  // The domain's grammar: <stepIdx>_r<runId>_sha256:<64hex>.<ext>
  expect(name).toMatch(/^\d+_r\d+_sha256:[0-9a-f]{64}\.[A-Za-z0-9]+$/);
});

/* — V-30 cross-host seam pin (A2H-13, ruling (a)) — */
// The runner's on-disk artifact record must round-trip through the PWA
// domain's validation: a name built under the single-token ext grammar
// satisfies invariants.ts' ARTIFACT_NAME_RE (the canonical-export
// contract, C-8's lane). The pre-A2H-13 dotted shape ("extract-report.json")
// FAILS domain validation — RED on the old grammar. assertData is the
// domain's boundary lane; the runner lane imports it so the seam is
// pinned in ONE place.
import { assertData } from "../src/domain/invariants.js";
import type { ChaconneData } from "../src/domain/types.js";

function dataWithArtifact(name: string, hex: string): ChaconneData {
  return {
    schema: "chaconne.v1",
    recipes: [recipe(1)],
    runs: [{ ...run(1, 1, "ok"), artifacts: [{ name, sha256: hex }] }],
  };
}

test("cross-host: a single-token ext artifact record validates through the domain (V-30 seam)", () => {
  const hex = sha256Hex("cross-host");
  // ext = "json" → one dot in the name: `0_r9_sha256:<64hex>.json` — the
  // PWA domain's ARTIFACT_NAME_RE (the canonical-export contract) accepts it.
  const name = artifactName(0, 9, hex, "json");
  expect(() => assertData(dataWithArtifact(name, hex))).not.toThrow();
});

test("cross-host: a dotted ext artifact record FAILS domain validation (RED on the old grammar)", () => {
  const hex = sha256Hex("cross-host");
  // The pre-A2H-13 shape: ext "extract-report.json" → TWO dots in the name.
  const name = artifactName(0, 9, hex, "extract-report.json");
  expect(() => assertData(dataWithArtifact(name, hex))).toThrow();
});

test("loadRuns/loadRecipes: empty on a fresh store", () => {
  const dir = tmpDir();
  const store = new ChaconneDiskStore(dir);
  store.recover();
  expect(store.loadRecipes()).toEqual([]);
  expect(store.loadRuns()).toEqual([]);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* — C-5 extraction-report artifact: content-addressed step-indexed JSON — */

test("extract-report artifact: step-keyed JSON through the same content-addressed store", () => {
  const dir = tmpDir();
  const store = new ChaconneDiskStore(dir);
  store.recover();

  // The runner's extract-report payload: step index → expected-vs-actual.
  const report: Record<string, { selector: string; attr: string; expected?: string; actual: string }[]> = {
    "1": [{ selector: "#bottom", attr: "text", actual: "bottom-marker" }],
    "2": [{ selector: "#mid", attr: "data-attr", expected: "mid", actual: "mid" }],
  };
  const payload = JSON.stringify(report, null, 2);
  // V-41: the runner's own call path now writes the ruled ext "json"
  // (the A2H-13 ruling (a)); the name ends ".json", never
  // ".extract-report" (the hyphen FAILS the PWA domain's ARTIFACT_NAME_RE).
  const ref = store.artifactRef(0, 1, "json", payload);
  store.saveArtifact(0, 1, "json", payload);

  // The ref matches the domain's content-addressed grammar (invariants.ts).
  expect(ref.name).toMatch(/^0_r1_sha256:[0-9a-f]{64}\.json$/);
  expect(ref.sha256).toBe(sha256Hex(payload));
  // Read back: byte-identical (the same file, not a second slot).
  expect(store.readArtifact(ref.name)).toBe(payload);
  // A second run with the SAME report dedupes to the same bytes — a
  // different run id still produces the same digest (the name differs
  // only by run id; the hash is content-addressed, not run-scoped).
  const ref2 = store.artifactRef(0, 2, "json", payload);
  store.saveArtifact(0, 2, "json", payload);
  expect(ref2.sha256).toBe(ref.sha256);
  expect(ref2.name).not.toBe(ref.name); // r2 ≠ r1
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cross-host V-41: the runner's report ref round-trips through the PWA domain", () => {
  const dir = tmpDir();
  const store = new ChaconneDiskStore(dir);
  store.recover();
  const payload = JSON.stringify({ "1": [{ selector: "#x", attr: "text", actual: "x" }] }, null, 2);
  // Build the ref via the runner's OWN call path (index.ts's report lane).
  const ref = store.artifactRef(0, 1, "json", payload);
  // Feed a document carrying it through the PWA domain's assertData —
  // it VALIDATES (the .json name satisfies ARTIFACT_NAME_RE).
  expect(() => assertData(dataWithArtifact(ref.name, ref.sha256))).not.toThrow();
  // The two wrong shapes THROW through the same lane:
  // the dotted ext (two dots) and the hyphenated ext (no dot, hyphen).
  const hex = ref.sha256;
  expect(() => assertData(dataWithArtifact(`0_r1_sha256:${hex}.extract-report.json`, hex))).toThrow();
  expect(() => assertData(dataWithArtifact(`0_r1_sha256:${hex}.extract-report`, hex))).toThrow();
  fs.rmSync(dir, { recursive: true, force: true });
});
