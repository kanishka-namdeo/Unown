// Tests for the landing benchmark extractor (scripts/landing_benchmarks.mjs).
//
//   node --test scripts/landing_benchmarks.test.mjs
//
// Why these exist, in the repo's own words: `--check` compares the generated
// file against the same derivation, so it cannot catch a derivation bug — a spec
// that quietly reads the wrong JSON path changes BOTH sides and the gate stays
// green while the page lies. These pin the canonical-run rule, the percentage
// validation, the null-for-missing-receipt path and the fail-loud paths against
// fixture receipts, then re-derive the real ones from the JSON independently.
//
// Deliberately absent: no test asserts that `--check` passes on this checkout.
// The committed data file is allowed to lag the receipts while this work is in
// flight; coupling the unit suite to that would make it a second gate instead of
// a test of the rules.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { build, buildTrack, checkFigure, chooseRun, emit, pickAt, rerunDirs, roundTo } from "./landing_benchmarks.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const r1 = (v) => Number(v.toFixed(1));
const r2 = (v) => Number(v.toFixed(2));

/** A scratch repo containing a `benchmarks/x/results` tree built from `files`. */
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "unown-bench-"));
  for (const [relPath, text] of Object.entries(files)) {
    const abs = join(root, "benchmarks", "x", "results", ...relPath.split("/"));
    mkdirSync(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    writeFileSync(abs, typeof text === "string" ? text : JSON.stringify(text));
  }
  return {
    root,
    dir: join(root, "benchmarks", "x", "results"),
    has: (relPath) => {
      try {
        return readFileSync(join(root, "benchmarks", "x", "results", ...relPath.split("/")), "utf8") !== "";
      } catch {
        return false;
      }
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const track = (over = {}) => ({
  constName: "DEMO",
  track: "x",
  note: "demo track",
  resultsDir: "benchmarks/x/results",
  runReceipt: "<model>/summary.json",
  baseReceipt: "<model>.summary.json",
  models: ["kimi-k2.5"],
  rows: [{ pct: { kind: "percent01", path: ["passRate"], dp: 1, doc: "pass rate" } }],
  provenance: "pct = `passRate` x 100",
  ...over,
});

/* ------------------------------------------------------------------ */
/* the canonical-run rule                                              */
/* ------------------------------------------------------------------ */

test("the newest rerun-* directory wins, by NAME not by filesystem order", () => {
  const f = fixture({
    "kimi-k2.5.summary.json": { passRate: 0.5 },
    "rerun-2026-01-01/kimi-k2.5/summary.json": { passRate: 0.7 },
    "rerun-2026-10-17/kimi-k2.5/summary.json": { passRate: 0.9 },
    "rerun-2026-03-09/kimi-k2.5/summary.json": { passRate: 0.8 },
  });
  try {
    // Created out of date order on purpose: the rule must not depend on it.
    assert.deepEqual(rerunDirs(f.dir), ["rerun-2026-10-17", "rerun-2026-03-09", "rerun-2026-01-01"]);
    const t = buildTrack(track(), f.root);
    assert.equal(t.rows[0].pct, 90, "0.9 from the newest rerun, not 0.7 or 0.8");
    assert.equal(t.run, "benchmarks/x/results/rerun-2026-10-17");
    assert.equal(t.beaten, 2, "it reports the two older reruns it skipped");
    assert.equal(t.source, "benchmarks/x/results/rerun-2026-10-17/<model>/summary.json");
  } finally {
    f.cleanup();
  }
});

test("a rerun only qualifies when it holds a receipt for EVERY model", () => {
  const f = fixture({
    "kimi-k2.5.summary.json": { passRate: 0.5 },
    "qwen3.6-plus.summary.json": { passRate: 0.4 },
    "rerun-2026-10-17/kimi-k2.5/summary.json": { passRate: 0.9 },
    "rerun-2026-09-02/kimi-k2.5/summary.json": { passRate: 0.8 },
    "rerun-2026-09-02/qwen3.6-plus/summary.json": { passRate: 0.6 },
  });
  try {
    const t = buildTrack(track({ models: ["kimi-k2.5", "qwen3.6-plus"] }), f.root);
    // Half a track from two runs is not a run: the incomplete newest rerun is
    // skipped whole, and the older complete one is used for both models.
    assert.equal(t.run, "benchmarks/x/results/rerun-2026-09-02");
    assert.deepEqual(t.rows.map((r) => r.pct), [80, 60]);
  } finally {
    f.cleanup();
  }
});

test("no rerun directory falls back to the base receipt", () => {
  const f = fixture({ "kimi-k2.5.summary.json": { passRate: 0.42 } });
  try {
    const t = buildTrack(track(), f.root);
    assert.equal(t.run, "benchmarks/x/results");
    assert.equal(t.reruns, 0);
    assert.equal(t.rows[0].pct, 42);
    assert.equal(t.source, "benchmarks/x/results/<model>.summary.json");
  } finally {
    f.cleanup();
  }
});

test("chooseRun is pure: dirs sorted newest-first, base last, no fs reads", () => {
  const spec = { dirs: ["rerun-2026-05-05", "rerun-2026-01-01"], runReceipt: "summary.json", baseReceipt: "base.json", models: ["m"] };
  assert.deepEqual(chooseRun({ ...spec, fileExists: () => true }), { run: "rerun-2026-05-05", receipt: "summary.json", reruns: 2, beaten: 1 });
  assert.deepEqual(chooseRun({ ...spec, fileExists: (r) => r === "base.json" }), { run: null, receipt: "base.json", reruns: 2, beaten: 0 });
  assert.deepEqual(chooseRun({ ...spec, fileExists: (r) => r === "rerun-2026-01-01/summary.json" }).run, "rerun-2026-01-01");
});

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

test("percentage figures outside their declared range are a hard failure", () => {
  assert.equal(checkFigure("percent01", 0.939, "w", 1), 93.9);
  assert.equal(checkFigure("percent", 98, "w", 0), 98);
  assert.equal(checkFigure("fraction01", 0.9285, "w", 2), 0.93);
  assert.equal(checkFigure("count", 43520, "w"), 43520);
  assert.equal(checkFigure("deltaPercent", -35.135, "w", 1), -35.1);
  assert.throws(() => checkFigure("percent01", 1.4, "edit passRate"), /outside 0\.\.1/);
  assert.throws(() => checkFigure("percent", 140, "polyglot pass@2"), /outside 0-100/);
  assert.throws(() => checkFigure("percent", -4, "livecodebench pass@1"), /outside 0-100/);
  assert.throws(() => checkFigure("percent01", "0.94", "passRate"), /not a number/);
  assert.throws(() => checkFigure("percent01", Number.NaN, "passRate"), /not a number/);
  assert.throws(() => checkFigure("count", -1, "input tokens"), /negative/);
  assert.throws(() => checkFigure("wat", 1, "x"), /unknown figure kind/);
  assert.equal(roundTo(93.29, 1), 93.3);
});

test("a track with no resolvable figure at all fails instead of emitting nothing", () => {
  const f = fixture({}); // no receipts whatsoever
  try {
    assert.throws(() => build([track()], f.root), /no track resolved a single figure/);
  } finally {
    f.cleanup();
  }
});

test("an unparseable receipt fails and names the file", () => {
  const f = fixture({ "rerun-2026-10-17/kimi-k2.5/summary.json": "{ passRate: 0.9,,,}" });
  try {
    assert.throws(() => buildTrack(track(), f.root), /is not valid JSON/);
    assert.throws(() => buildTrack(track(), f.root), /kimi-k2\.5\/summary\.json/);
    assert.throws(() => build([track()], f.root), /landing_benchmarks: /);
  } finally {
    f.cleanup();
  }
});

test("a missing receipt file yields null figures and a loud no-receipt line", () => {
  const f = fixture({ "qwen3.6-plus.summary.json": { passRate: 0.5 } });
  try {
    const t = buildTrack(track({ models: ["kimi-k2.5", "qwen3.6-plus"] }), f.root);
    assert.equal(t.rows[0].pct, null);
    assert.equal(t.rows[1].pct, 50);
    assert.equal(t.complete, false);
    assert.match(t.missing.join("\n"), /^no receipt for DEMO\/kimi-k2\.5 — benchmarks\/x\/results\/kimi-k2\.5\.summary\.json does not exist$/);
    const text = emit({ tracks: [t], resolved: 1, total: 1, missing: t.missing });
    assert.match(text, /pct: number \| null;/, "an unbacked figure must widen the emitted type, not hide");
    assert.doesNotMatch(text, /undefined/);
  } finally {
    f.cleanup();
  }
});

test("a receipt field that has moved yields null, never a guessed number", () => {
  const f = fixture({ "kimi-k2.5.summary.json": { passRateV2: 0.9 } });
  try {
    const t = buildTrack(track(), f.root);
    assert.equal(t.rows[0].pct, null);
    assert.match(t.missing.join("\n"), /no receipt for DEMO\.pct \[kimi-k2\.5\][\s\S]*has no such field/);
  } finally {
    f.cleanup();
  }
});

test("pickAt resolves <model> segments and stops at a missing key", () => {
  const doc = { results: { "kimi-k2.5": { byOutcome: { no_code: 15 } } } };
  assert.equal(pickAt(doc, ["results", "<model>", "byOutcome", "no_code"], "kimi-k2.5"), 15);
  assert.equal(pickAt(doc, ["results", "<model>", "byOutcome", "tle"], "kimi-k2.5"), undefined);
  assert.equal(pickAt(doc, ["results", "nope", "byOutcome", "no_code"], "nope"), undefined);
});

/* ------------------------------------------------------------------ */
/* the real receipts                                                   */
/* ------------------------------------------------------------------ */

/**
 * Independent re-derivation: these readers touch the receipt JSON directly with
 * their own paths and arithmetic, so a wrong spec path in the script cannot make
 * this pass by coincidence — which is exactly the bug class `--check` cannot see.
 */
const READERS = {
  EDIT_BENCH: {
    file: (m) => `benchmarks/edit-bench/results/rerun-2026-10-17/${m}/summary.json`,
    row: (d) => ({ pct: r1(d.passRate * 100) }),
  },
  HUMANEVAL_PLUS: {
    file: () => "benchmarks/evalplus/results/rerun-2026-10-17/summary.json",
    row: (d, m) => ({ pct: r1(d.results[m].pass1 * 100) }),
  },
  LIVECODEBENCH: {
    file: () => "benchmarks/livecodebench/results/summary.json",
    row: (d, m) => ({ pct: d.results[m].passAt1Pct, noCode: d.results[m].byOutcome.no_code }),
  },
  LONGHORIZON: {
    file: () => "benchmarks/longhorizon/results/summary.json",
    row: (d, m) => ({
      durS: d.models[m].durationS,
      files: d.models[m].diff.filesChanged,
      inTok: d.models[m].session.input,
      cacheRead: d.models[m].session.cacheRead,
      jaccard: r2(d.models[m].similarity.fileSetJaccard),
    }),
  },
  POLYGLOT: {
    file: () => "benchmarks/polyglot/results/rerun-2026-10-17/summary.json",
    row: (d, m) => ({ pct: d.models[m].pass2Pct, pass1: d.models[m].pass1Pct }),
  },
  SELFIMPROVE: {
    file: (m) => `benchmarks/selfimprove/results/v2-notes/summary.${m}.json`,
    row: (d) => ({
      input: r1(((d.warm.input - d.cold.input) / d.cold.input) * 100),
      time: r1(((d.warm.avgDurationS - d.cold.avgDurationS) / d.cold.avgDurationS) * 100),
      coldIn: d.cold.input,
      warmIn: d.warm.input,
      coldS: d.cold.avgDurationS,
      warmS: d.warm.avgDurationS,
    }),
  },
};

/**
 * The literals currently in `src/components/landing/benchmarks.tsx`. A new run
 * moves both sides together — this is the mapping proof, not a snapshot of the
 * receipts: it asserts the generated consts are exactly what the page shows, so
 * swapping the literals for imports changes nothing observable.
 */
const PAGE = {
  EDIT_BENCH: [98.1, 96.2, 94.3],
  HUMANEVAL_PLUS: [93.9, 93.3, 92.7],
  LIVECODEBENCH: [[52, 15], [38, 26], [36, 27]],
  LONGHORIZON: [
    [245, 13, 43520, 474112, 0.93],
    [299, 14, 62617, 840704, 0.87],
    [291, 15, 1205337, 0, 0.81],
  ],
  POLYGLOT: [[96, 96], [96, 96], [94, 94]],
  SELFIMPROVE: [
    [-23.7, -8, 401445, 306218, 25, 23],
    [21.8, -35.1, 34553, 42075, 37, 24],
    [23.2, 4.2, 64853, 79886, 24, 25],
  ],
};

test("every real figure resolves — no page number is unbacked today", () => {
  const data = build();
  assert.equal(data.total, 6);
  assert.equal(data.resolved, 6);
  assert.deepEqual(data.missing, [], "a missing receipt field would print a no-receipt line");
  for (const t of data.tracks) {
    assert.equal(t.complete, true, `${t.constName}: every row's every figure has a receipt field`);
    assert.equal(t.rows.length, 3, `${t.constName}: three models per track`);
  }
});

test("the emitted figures equal what the receipts say, re-derived independently", () => {
  const data = build();
  for (const t of data.tracks) {
    const reader = READERS[t.constName];
    assert.ok(reader, `${t.constName} has no independent reader — add one, do not skip the check`);
    for (let i = 0; i < t.rows.length; i++) {
      const model = t.rows[i].model;
      const abs = join(ROOT, ...reader.file(model).split("/"));
      assert.equal(t.source.replaceAll("<model>", model), reader.file(model), `${t.constName}: named receipt is the one read`);
      const doc = JSON.parse(readFileSync(abs, "utf8"));
      assert.deepEqual(t.rows[i], { model, ...reader.row(doc, model) }, `${t.constName}/${model}`);
      const onPage = PAGE[t.constName][i];
      assert.deepEqual(
        Object.values(t.rows[i]).slice(1),
        Array.isArray(onPage) ? onPage : [onPage],
        `${t.constName}/${model} vs the page literals`,
      );
    }
  }
});

test("the canonical-run rule is the one the page's numbers actually came from", () => {
  // These three tracks have BOTH receipts and they disagree; the page carries
  // the rerun, so a gate that picked the base file would be red on a true page.
  const read = (p) => JSON.parse(readFileSync(join(ROOT, ...p.split("/")), "utf8"));
  const base = read("benchmarks/evalplus/results/summary.json");
  const rerun = read("benchmarks/evalplus/results/rerun-2026-10-17/summary.json");
  assert.notEqual(base.results["kimi-k2.5"].pass1, rerun.results["kimi-k2.5"].pass1, "evalplus base and rerun must disagree");
  const pg = read("benchmarks/polyglot/results/summary.json");
  assert.notEqual(pg.models["qwen3.6-plus"].pass2Pct, 96, "polyglot base pass@2 disagrees with the rerun the page shows");
  const ebBase = read("benchmarks/edit-bench/results/qwen3.7-plus.summary.json");
  const ebRerun = read("benchmarks/edit-bench/results/rerun-2026-10-17/qwen3.7-plus/summary.json");
  assert.notEqual(ebBase.passRate, ebRerun.passRate, "edit-bench base qwen3.7 disagrees with its rerun");
  assert.equal(r1(ebBase.passRate * 100), 99.1, "…the base says 99.1, which is NOT the 96.2 the page shows");
  assert.equal(r1(ebRerun.passRate * 100), 96.2, "…the rerun is the page's number, so the rule must pick it");

  const byName = Object.fromEntries(build().tracks.map((t) => [t.constName, t.run]));
  assert.equal(byName.EDIT_BENCH, "benchmarks/edit-bench/results/rerun-2026-10-17");
  assert.equal(byName.HUMANEVAL_PLUS, "benchmarks/evalplus/results/rerun-2026-10-17");
  assert.equal(byName.POLYGLOT, "benchmarks/polyglot/results/rerun-2026-10-17");
  assert.equal(byName.LIVECODEBENCH, "benchmarks/livecodebench/results", "no rerun dir exists, so the base is the record");
});

test("the emitted file is the shape the component swaps in", () => {
  const text = emit(build());
  for (const name of ["EDIT_BENCH", "HUMANEVAL_PLUS", "LIVECODEBENCH", "LONGHORIZON", "POLYGLOT", "SELFIMPROVE"]) {
    assert.match(text, new RegExp(`export const ${name}: \\w+\\[\\] = \\[`));
  }
  assert.match(text, /^\/\/ GENERATED by scripts\/landing_benchmarks\.mjs from the receipts under benchmarks\//);
  assert.match(text, /export const BENCH_SOURCES: Record<BenchTrackName, BenchTrackSource>/);
  assert.doesNotMatch(text, /undefined|NaN|null,/, "no unbacked value and no hole in the template");
  assert.equal(text.split("\n").length > 100, true);
});

/* ------------------------------------------------------------------ */
/* the CLI                                                             */
/* ------------------------------------------------------------------ */

test("the CLI generates out loud — a silent guard is a decorative gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "unown-bench-cli-"));
  const out = join(dir, "benchmarks-data.ts");
  try {
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "landing_benchmarks.mjs"), "--out", out], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.equal(r.status, 0, `generation failed: ${r.stderr}`);
    assert.match(r.stdout, /^ {6}EDIT_BENCH\s+benchmarks\/edit-bench\/results\/rerun-2026-10-17\/<model>\/summary\.json/m,
      "it must name the receipt file it chose, per track");
    assert.match(r.stdout, /^wrote .*benchmarks-data\.ts: 6 tracks, 18 rows$/m);
    assert.match(readFileSync(out, "utf8"), /export const POLYGLOT/);

    // `--check` must SPEAK whether or not the committed file is in sync — this
    // suite never asserts that it passes, only that it is not a no-op.
    const c = spawnSync(process.execPath, [join(ROOT, "scripts", "landing_benchmarks.mjs"), "--check"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    assert.ok(c.status === 0 || c.status === 1, `--check crashed: ${c.stderr}`);
    assert.match(`${c.stdout}${c.stderr}`, /^ok {2}page matches receipts|^landing_benchmarks: /m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
