// Landing benchmark generator: the receipts under benchmarks/ ->
// src/components/landing/benchmarks-data.ts.
//
//   node scripts/landing_benchmarks.mjs                write the data file
//   node scripts/landing_benchmarks.mjs --check        CI gate: fail if it no longer matches
//   node scripts/landing_benchmarks.mjs --out <path>   write somewhere else (preview, tests)
//
// Why generated instead of authored: this is `landing_changelog.mjs` applied to
// the other number-heavy section of the landing page. `benchmarks.tsx` carries
// ~30 figures hand-copied from the receipts under `benchmarks/`, and those
// receipts move constantly while nothing checks the page against them — so a
// re-run that lands without the page being updated silently turns a measured
// claim into a stale one. The receipts are the only source; the page cannot
// invent a number, and the CI step cannot pass while the two disagree.
//
// Rules it encodes, in one place so the component stays dumb:
//   - **the canonical run, resolved PER MODEL.** Three tracks have both a
//     base receipt and `results/rerun-<date>/` verification runs, and they
//     DISAGREE (e.g. polyglot's base says qwen3.6 pass@2 100%, its rerun says
//     96%). The rule is one sentence per model: the newest `rerun-*`
//     directory THAT HOLDS A RECEIPT FOR THAT MODEL wins for that model,
//     falling back to the base receipt. Newest is decided by sorting the
//     directory NAMES — the receipts are dated `rerun-YYYY-MM-DD`, so
//     lexicographic order IS temporal order — never by filesystem order,
//     which differs per platform. (Until the 2026-10-21 agnes campaign the
//     rule was whole-track — a rerun only counted with receipts for EVERY
//     model — which silently discarded the agnes rerun dir because it holds
//     only the new model's receipts; per-model resolution keeps every
//     model's freshest receipt, which is what the page actually promises.)
//   - **field provenance is declared, not guessed.** Each track spec names the
//     receipt path and the JSON path per figure, so the mapping is readable in
//     the file it is used in. The receipts' own shapes differ per track
//     (`passRate` 0-1 for edit-bench, `pass1` 0-1 for evalplus, `passAt1Pct`
//     already a percentage for LiveCodeBench, `pass2Pct` for polyglot, and
//     selfimprove's deltas are DERIVED from cold/warm token counts), and the
//     transform is part of the spec.
//   - **a figure with no receipt field is `null`, never a guess.** It also
//     prints a loud `no receipt for X` line, and the emitted row type widens to
//     `number | null` so the file itself says an unbacked number reached the
//     page. Per the page's own contract, the fix is to cut the claim, not to
//     invent a replacement figure.
//   - **it fails instead of going quiet.** No track resolves, a 0-100 figure
//     that is NaN/negative/over 100, a count that is negative, and an
//     unparseable receipt are all hard failures. A generator that emits an empty
//     file is a decorative gate, which is the failure class this repository has
//     already been bitten by and documents.
//
// Dependency-free node builtins only, and the comparison is EOL-normalised
// because this checkout is CRLF under core.autocrlf while the blobs are LF.
// Paths are emitted with forward slashes on every OS.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(ROOT, "src/components/landing/benchmarks-data.ts");
const RERUN = /^rerun-/;

/** Thrown, not exited: the failure modes are the point of the unit test. */
class BenchmarksError extends Error {}
const fail = (msg) => {
  throw new BenchmarksError(`landing_benchmarks: ${msg}`);
};

/* ------------------------------------------------------------------ */
/* the tracks: what the page shows, and exactly where each figure lives */
/* ------------------------------------------------------------------ */

/**
 * `row` names mirror the consts in `src/components/landing/benchmarks.tsx` so
 * swapping literals for imports is mechanical; `models` is that const's own row
 * order, which the section's stagger delays depend on.
 *
 * kinds: `percent01` receipt holds a 0-1 ratio -> x100; `percent` receipt holds
 * 0-100 already; `fraction01` 0-1 ratio published as-is; `count` a non-negative
 * measurement; `deltaPercent` (b-a)/a x100 over two paths, sign-carrying.
 */
const TRACKS = [
  {
    constName: "EDIT_BENCH",
    track: "edit-bench",
    note: "oh-my-pi typescript-edit-benchmark: 106 fixtures, byte-exact scoring, full Unown agent in the loop.",
    resultsDir: "benchmarks/edit-bench/results",
    runReceipt: "<model>/summary.json",
    baseReceipt: "<model>.summary.json",
    models: ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus", "agnes-3.0-flash"],
    rows: [{ pct: { kind: "percent01", path: ["passRate"], dp: 1, doc: "Surgical edit accuracy: % of the 106 fixtures." } }],
    provenance: "pct = `passRate` (0-1) x 100, 1dp",
  },
  {
    constName: "HUMANEVAL_PLUS",
    track: "evalplus",
    note: "HumanEval+ on the official evalplus CLI: sanitize -> evaluate, pass@1, greedy, 164 problems.",
    resultsDir: "benchmarks/evalplus/results",
    runReceipt: "summary.json",
    baseReceipt: "summary.json",
    models: ["kimi-k2.5", "qwen3.6-plus", "qwen3.7-plus", "agnes-3.0-flash"],
    rows: [{ pct: { kind: "percent01", path: ["results", "<model>", "pass1"], dp: 1, doc: "HumanEval+ pass@1, %." } }],
    provenance: "pct = `results.<model>.pass1` (0-1) x 100, 1dp",
  },
  {
    constName: "LIVECODEBENCH",
    track: "livecodebench",
    note: "LiveCodeBench v6 increment, 50-problem stratified subset of post-cutoff problems; official prompt + grader, greedy pass@1. `noCode` counts the runs that spent the whole token budget without closing a code fence — reported as a fail, not filtered.",
    resultsDir: "benchmarks/livecodebench/results",
    runReceipt: "summary.json",
    baseReceipt: "summary.json",
    models: ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus", "agnes-3.0-flash"],
    rows: [
      {
        pct: { kind: "percent", path: ["results", "<model>", "passAt1Pct"], dp: 0, doc: "pass@1 over the 50-problem subset, %." },
        noCode: { kind: "count", path: ["results", "<model>", "byOutcome", "no_code"], doc: "Runs that spent the whole token budget without closing a code fence — counted as fails, not filtered." },
      },
    ],
    provenance: "pct = `results.<model>.passAt1Pct` (already 0-100); noCode = `results.<model>.byOutcome.no_code`",
  },
  {
    constName: "LONGHORIZON",
    track: "longhorizon",
    note: "Long-horizon refactor: one hard multi-file contract change under a wall-clock cap, n=1 per model, scored on the file diff against a committed reference.",
    resultsDir: "benchmarks/longhorizon/results",
    runReceipt: "summary.json",
    baseReceipt: "summary.json",
    models: ["kimi-k2.5", "qwen3.7-plus", "qwen3.6-plus", "agnes-3.0-flash"],
    rows: [
      {
        durS: { kind: "count", path: ["models", "<model>", "durationS"], doc: "Wall-clock seconds under the cap." },
        files: { kind: "count", path: ["models", "<model>", "diff", "filesChanged"], doc: "Files changed against the pristine workspace." },
        inTok: { kind: "count", path: ["models", "<model>", "session", "input"], doc: "Billed input tokens." },
        cacheRead: { kind: "count", path: ["models", "<model>", "session", "cacheRead"], doc: "Cache-read tokens — 0 means nothing was reused." },
        jaccard: { kind: "fraction01", path: ["models", "<model>", "similarity", "fileSetJaccard"], dp: 2, doc: "Changed-file-set Jaccard against the committed reference (0-1)." },
      },
    ],
    provenance: "durS = `durationS`; files = `diff.filesChanged`; inTok = `session.input`; cacheRead = `session.cacheRead`; jaccard = `similarity.fileSetJaccard` (0-1), 2dp",
  },
  {
    constName: "POLYGLOT",
    track: "polyglot",
    note: "Aider polyglot 50-exercise stratified subset, 6 languages, Aider's 2-attempt protocol. `pct` is the pass@2 figure the bar shows (the card says \"pass@2 shown\"); `pass1` is pass@1.",
    resultsDir: "benchmarks/polyglot/results",
    runReceipt: "summary.json",
    baseReceipt: "summary.json",
    models: ["qwen3.6-plus", "qwen3.7-plus", "kimi-k2.5", "agnes-3.0-flash"],
    rows: [
      {
        pct: { kind: "percent", path: ["models", "<model>", "pass2Pct"], dp: 0, doc: "pass@2 over the 50-exercise subset, % — the figure the bar shows." },
        pass1: { kind: "percent", path: ["models", "<model>", "pass1Pct"], dp: 0, doc: "pass@1 over the same subset, %." },
      },
    ],
    provenance: "pct = `models.<model>.pass2Pct`; pass1 = `models.<model>.pass1Pct` (both already 0-100)",
  },
  {
    constName: "SELFIMPROVE",
    track: "selfimprove",
    note: "Repeat-task efficiency, cold vs warm dreamed memory, v2 protocol (agent-authored notes; v1 is the negative control and is not published here), n=10 single run per phase. `input`/`time` are the published deltas, derived from the raw cold/warm counts beside them.",
    resultsDir: "benchmarks/selfimprove/results",
    runReceipt: "v2-notes/summary.<model>.json",
    baseReceipt: "v2-notes/summary.<model>.json",
    models: ["qwen3.6-plus", "kimi-k2.5", "qwen3.7-plus", "agnes-3.0-flash"],
    rows: [
      {
        input: { kind: "deltaPercent", paths: [["warm", "input"], ["cold", "input"]], dp: 1, doc: "Warm vs cold input tokens, % — negative means memory saved prompt budget." },
        time: { kind: "deltaPercent", paths: [["warm", "avgDurationS"], ["cold", "avgDurationS"]], dp: 1, doc: "Warm vs cold average task duration, %." },
        coldIn: { kind: "count", path: ["cold", "input"], doc: "Cold-pass total input tokens." },
        warmIn: { kind: "count", path: ["warm", "input"], doc: "Warm-pass total input tokens." },
        coldS: { kind: "count", path: ["cold", "avgDurationS"], doc: "Cold-pass average duration, s." },
        warmS: { kind: "count", path: ["warm", "avgDurationS"], doc: "Warm-pass average duration, s." },
        coldPass: { kind: "count", path: ["cold", "passed"], doc: "Cold-pass tasks passed." },
        warmPass: { kind: "count", path: ["warm", "passed"], doc: "Warm-pass tasks passed." },
        coldTasks: { kind: "count", path: ["cold", "tasks"], doc: "Cold-pass task count." },
        warmTasks: { kind: "count", path: ["warm", "tasks"], doc: "Warm-pass task count." },
      },
    ],
    provenance: "input = (`warm.input` - `cold.input`) / `cold.input` x 100, 1dp; time = same over `avgDurationS`; coldIn/warmIn = `cold.input`/`warm.input`; coldS/warmS = `cold.avgDurationS`/`warm.avgDurationS`; coldPass/warmPass/coldTasks/warmTasks = the pass and task counts",
  },
];

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

const rel = (...parts) => parts.filter(Boolean).join("/");
const fill = (template, model) => template.replaceAll("<model>", model);
const roundTo = (v, dp) => (dp === undefined ? v : Number(v.toFixed(dp)));

/** Directory names of `rerun-*` under `resultsAbs`, newest FIRST by NAME. */
function rerunDirs(resultsAbs) {
  let names;
  try {
    names = readdirSync(resultsAbs);
  } catch {
    return [];
  }
  return names
    .filter((n) => RERUN.test(n))
    .filter((n) => {
      try {
        return statSync(join(resultsAbs, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .reverse();
}

/**
 * The canonical-run rule, in one place, resolved PER MODEL: for each model,
 * the newest `rerun-*` directory THAT HOLDS A RECEIPT FOR THAT MODEL wins for
 * that model, else the model's base receipt. `fileExists` takes a path relative
 * to the results directory, so the rule can be pinned by a fixture without
 * touching this repo's receipts; `receiptModels` (shared receipts only) is the
 * coverage check — a rerun's summary.json must actually CONTAIN the model's
 * key, not merely exist. (The 2026-10-21 agnes campaign added a model whose
 * receipts exist only in its own rerun dir — the pre-campaign whole-track rule
 * silently discarded the entire dir because it lacks the other three models.)
 */
function chooseRuns({ dirs, runReceipt, models, baseReceipt, fileExists, receiptModels }) {
  const perModel = {};
  for (const model of models) {
    let hit = null;
    let skipped = 0;
    for (const [i, dir] of dirs.entries()) {
      if (!fileExists(rel(dir, fill(runReceipt, model)))) {
        continue;
      }
      if (receiptModels) {
        const covered = new Set(receiptModels(dir));
        if (!covered.has(model)) {
          skipped++;
          continue;
        }
      }
      hit = { run: dir, receipt: runReceipt, beaten: dirs.length - 1 - i, skipped };
      break;
    }
    perModel[model] = hit ?? { run: null, receipt: baseReceipt, beaten: 0, skipped: dirs.length };
  }
  return perModel;
}

/**
 * The whole-track view over the per-model resolution, kept for the uniform
 * case and the back-compat pins: the run every model resolved to, else a
 * `mixed` marker (the emitted doc + BENCH_SOURCES then point at `perModel`).
 */
function chooseRun({ dirs, runReceipt, models, baseReceipt, fileExists, receiptModels }) {
  const perModel = chooseRuns({ dirs, runReceipt, models, baseReceipt, fileExists, receiptModels });
  const runs = new Set(models.map((m) => perModel[m].run));
  const reruns = dirs.length;
  if (runs.size === 1) {
    const first = perModel[models[0]];
    return {
      run: first.run,
      receipt: first.run === null ? baseReceipt : runReceipt,
      reruns,
      beaten: Math.max(...models.map((m) => perModel[m].beaten)),
      skipped: Math.min(...models.map((m) => perModel[m].skipped)),
    };
  }
  return { run: null, receipt: "mixed", reruns, beaten: 0, skipped: 0, mixed: true };
}

/** Model keys a shared receipt actually contains. The two receipt shapes in
 *  this repo key their rows under `results` or `models`; an unknown shape is
 *  empty, so the rerun is skipped rather than trusted. */
function receiptModelKeys(doc) {
  for (const key of ["results", "models"]) {
    const value = doc?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return Object.keys(value);
  }
  return [];
}

/** Walk a receipt's JSON path; `<model>` segments resolve to the row's model. */
function pickAt(doc, path, model) {
  let cur = doc;
  for (const raw of path) {
    const key = fill(raw, model);
    if (cur === null || typeof cur !== "object" || !(key in cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function readJson(abs, shownPath) {
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    fail(`${shownPath} cannot be read — the receipt named by a track spec must exist`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`${shownPath} is not valid JSON (${err.message}) — fix or remove the receipt, do not gate on a guess`);
  }
}

/**
 * Validate + normalise one figure. `null` means "this figure has no receipt
 * field" and is reported loudly by the caller; anything present but unusable is
 * a hard failure, because a percentage that is NaN or 140 is a broken receipt
 * or a broken spec, and either way the page must not publish it.
 */
function checkFigure(kind, value, where, dp) {
  if (value === null) return null;
  const num = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(num))
    fail(`${where} is not a number (${JSON.stringify(value)}) — a receipt field moved or changed type`);
  if (kind === "percent01") {
    if (num < 0 || num > 1) fail(`${where} = ${num} is outside 0..1, so it is not a pass-rate ratio`);
    return roundTo(num * 100, dp ?? 1);
  }
  if (kind === "percent") {
    if (num < 0 || num > 100) fail(`${where} = ${num} is outside 0-100, so it is not a percentage`);
    return roundTo(num, dp ?? 0);
  }
  if (kind === "fraction01") {
    if (num < 0 || num > 1) fail(`${where} = ${num} is outside 0..1, so it is not a fraction`);
    return roundTo(num, dp ?? 2);
  }
  if (kind === "count") {
    if (num < 0) fail(`${where} = ${num} is negative — a token/duration/count receipt cannot be`);
    return roundTo(num, dp ?? 0);
  }
  if (kind === "deltaPercent") return roundTo(num, dp ?? 1);
  fail(`${where}: unknown figure kind "${kind}"`);
}

/* ------------------------------------------------------------------ */
/* building                                                            */
/* ------------------------------------------------------------------ */

function buildTrack(track, root = ROOT) {
  const resultsAbs = join(root, ...track.resultsDir.split("/"));
  const shownResults = track.resultsDir;
  const missing = [];
  const dirs = rerunDirs(resultsAbs);
  const resolver = {
    dirs,
    runReceipt: track.runReceipt,
    baseReceipt: track.baseReceipt,
    models: track.models,
    fileExists: (r) => existsSync(join(resultsAbs, ...r.split("/"))),
    // A per-model receipt is already model-specific; only a shared receipt
    // needs its own key list inspected.
    receiptModels: track.runReceipt.includes("<model>")
      ? undefined
      : (dir) => {
          const relPath = rel(dir, track.runReceipt);
          const abs = join(resultsAbs, ...relPath.split("/"));
          return receiptModelKeys(readJson(abs, rel(shownResults, relPath)));
        },
  };
  const perModel = chooseRuns(resolver);
  const chosen = chooseRun(resolver);

  // Per-model receipt path relative to the results dir, run directory
  // included: each model's own freshest receipt.
  const receiptRel = (model) => rel(perModel[model].run ?? "", fill(perModel[model].receipt, model));

  const docs = new Map();
  for (const model of track.models) {
    const r = receiptRel(model);
    const abs = join(resultsAbs, ...r.split("/"));
    if (!existsSync(abs)) {
      missing.push(`no receipt for ${track.constName}/${model} — ${rel(shownResults, r)} does not exist`);
      docs.set(model, null);
      continue;
    }
    docs.set(model, readJson(abs, rel(shownResults, r)));
  }

  const spec = track.rows[0];
  const rows = track.models.map((model) => {
    const doc = docs.get(model);
    const row = { model };
    for (const [field, f] of Object.entries(spec)) {
      const where = `${rel(shownResults, receiptRel(model))} :: ${track.constName}.${field}[${model}]`;
      if (doc === null || doc === undefined) {
        row[field] = null;
        continue;
      }
      let value;
      if (f.kind === "deltaPercent") {
        const [now, base] = f.paths.map((p) => pickAt(doc, p, model));
        if (now === undefined || base === undefined) value = null;
        else if (base === 0) fail(`${where}: the cold baseline is 0, so a percentage delta is undefined`);
        else if (typeof now !== "number" || typeof base !== "number") value = now;
        else value = ((now - base) / base) * 100;
      } else {
        value = pickAt(doc, f.path, model);
        if (value === undefined) value = null;
      }
      const checked = checkFigure(f.kind, value, where, f.dp);
      if (checked === null) missing.push(`no receipt for ${track.constName}.${field} [${model}] — ${where} has no such field`);
      row[field] = checked;
    }
    return row;
  });

  const figures = rows.flatMap((r) => Object.entries(r).filter(([k]) => k !== "model"));
  const complete = figures.length > 0 && figures.every(([, v]) => v !== null);

  return {
    constName: track.constName,
    track: track.track,
    note: track.note,
    provenance: track.provenance,
    docs: Object.fromEntries(Object.entries(spec).map(([name, f]) => [name, f.doc ?? name])),
    models: track.models,
    rows,
    complete,
    run: chosen.mixed ? `${rel(shownResults, dirs[0] ?? "")} (mixed — see perModel)` : rel(shownResults, chosen.run ?? ""),
    perModel: Object.fromEntries(track.models.map((m) => [m, rel(shownResults, receiptRel(m))])),
    source: chosen.mixed ? "mixed — see perModel" : rel(shownResults, rel(chosen.run ?? "", fill(chosen.receipt, "<model>"))),
    baseSource: rel(shownResults, fill(track.baseReceipt, "<model>")),
    reruns: chosen.reruns,
    beaten: chosen.beaten,
    skipped: chosen.skipped,
    mixed: Boolean(chosen.mixed),
    missing,
  };
}

function build(tracks = TRACKS, root = ROOT) {
  const built = tracks.map((t) => buildTrack(t, root));
  const resolved = built.filter((t) => t.rows.length && t.rows.some((r) => Object.entries(r).some(([k, v]) => k !== "model" && v !== null)));
  if (!resolved.length)
    fail(
      "no track resolved a single figure from benchmarks/ — the receipts moved or the specs are wrong; " +
        "an empty data file would make this gate decorative",
    );
  const missing = built.flatMap((t) => t.missing);
  return { tracks: built, resolved: resolved.length, total: built.length, missing };
}

/* ------------------------------------------------------------------ */
/* emitting                                                            */
/* ------------------------------------------------------------------ */

const typeName = (constName) =>
  constName
    .toLowerCase()
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("") + "Row";

const numType = (t) => (t.complete ? "number" : "number | null");

function emitTrackType(t, fields) {
  return `export interface ${typeName(t.constName)} {
  /** Model id as routed by llm-bridge; the row order matches the section's bars. */
  model: BenchModel;
${fields.map(([name, doc]) => `  /** ${doc} */\n  ${name}: ${numType(t)};`).join("\n")}
}`;
}

function emitTrackDoc(t) {
  if (t.mixed) {
    const perRun = {};
    for (const [model, receipt] of Object.entries(t.perModel)) {
      const run = receipt.split("/").slice(0, -1).join("/") || "(base)";
      perRun[run] = [...(perRun[run] ?? []), model];
    }
    const lines = Object.entries(perRun).map(([run, ms]) => ` *   - \`${run}\` → ${ms.join(", ")}`);
    return `/**
 * ${t.note}
 * Receipt: per model — every model's row points at its own freshest receipt
 * (BENCH_SOURCES.perModel):
${lines.join("\n")}
 * Fields: ${t.provenance}
 */`;
  }
  const notes = [];
  if (t.skipped) notes.push(`${t.skipped} newer incomplete rerun(s) skipped — they do not cover every model`);
  if (t.beaten) notes.push(`chosen over ${t.beaten} older complete one(s)`);
  const run = t.reruns
    ? ` * Canonical run: \`${t.run}\` — the newest complete \`rerun-*\` of ${t.reruns}${
        notes.length ? ` (${notes.join("; ")})` : ""
      }, and so over the base receipt \`${t.baseSource}\`.`
    : ` * Canonical run: \`${t.run}\` — no \`rerun-*\` directory exists for this track, so the base receipt is the record.`;
  return `/**
 * ${t.note}
 * Receipt: \`${t.source}\`
${run}
 * Fields: ${t.provenance}
 */`;
}

function emit(data) {
  const blocks = data.tracks.map((t) => {
    const fields = Object.entries(t.rows[0])
      .filter(([k]) => k !== "model")
      .map(([name]) => [name, t.docs[name]]);
    return `${emitTrackDoc(t)}
${emitTrackType(t, fields)}

export const ${t.constName}: ${typeName(t.constName)}[] = ${JSON.stringify(t.rows, null, 2)};
`;
  });

  const trackNames = data.tracks.map((t) => `"${t.constName}"`).join(" | ");
  const sources = Object.fromEntries(
    data.tracks.map((t) => [
      t.constName,
      {
        track: t.track,
        run: t.run,
        /** Every model's own receipt (repo-relative) — the authoritative provenance. */
        perModel: t.perModel,
        source: t.source,
      },
    ]),
  );

  return `// GENERATED by scripts/landing_benchmarks.mjs from the receipts under benchmarks/ — do not hand-edit.
// Regenerate after any run lands:  bun scripts/landing_benchmarks.mjs
// CI gate (the page must equal the receipts):  bun scripts/landing_benchmarks.mjs --check
//
// The landing page's benchmark section renders these consts. Every figure is
// read from a committed receipt JSON, resolved PER MODEL: where a track has
// both a base receipt and \`rerun-<date>\` verification runs, each model's row
// points at its own freshest receipt (BENCH_SOURCES.perModel) — a model added
// mid-campaign lands from its rerun dir without discarding the other models'
// freshest receipts. A figure with no receipt field is \`null\` and the
// generator says so out loud; the page never keeps a number it cannot point at.

export type BenchModel = ${[...new Set(data.tracks.flatMap((t) => t.models))].map((m) => `"${m}"`).sort().join(" | ")};

export type BenchTrackName = ${trackNames};

export interface BenchTrackSource {
  /** The track's directory name under \`benchmarks/\`. */
  track: string;
  /** The run directory the figures were read from (repo-relative); \`… (mixed…)\` when models resolved to different runs. */
  run: string;
  /** Per-model receipt path (repo-relative) — each model's freshest receipt; the authoritative provenance. */
  perModel: Record<string, string>;
  /** The \`<model>\` receipt template when the run is uniform, else \`mixed\`. */
  source: string;
}

export const BENCH_SOURCES: Record<BenchTrackName, BenchTrackSource> = ${JSON.stringify(sources, null, 2)};

${blocks.join("\n")}`;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

function report(data, outPath) {
  for (const t of data.tracks) {
    const src = t.mixed ? `${t.models.length} models via perModel (mixed runs)` : t.source;
    console.log(
      `      ${t.constName.padEnd(15)} ${src}` +
        (t.reruns ? `   [${t.run} wins over ${t.baseSource}]` : `   [${t.run}]`),
    );
  }
  for (const line of data.missing) console.warn(`landing_benchmarks: ${line}`);
  if (outPath) console.log(`wrote ${outPath}: ${data.tracks.length} tracks, ${data.tracks.reduce((n, t) => n + t.rows.length, 0)} rows`);
}

function run(check, out) {
  const data = build();
  const text = emit(data);
  const target = out ? resolve(ROOT, out) : TARGET;
  // Repo-relative when it is inside the repo, absolute otherwise (`--out` to a
  // scratch dir), and always forward-slated so the log reads the same on 3 OS.
  const shownRel = (target.startsWith(ROOT + "\\") || target.startsWith(ROOT + "/")
    ? target.slice(ROOT.length + 1)
    : target
  ).replaceAll("\\", "/");

  if (check) {
    let current;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      fail(`${shownRel} is missing — run \`bun scripts/landing_benchmarks.mjs\``);
    }
    // EOL-normalised, split on /\r?\n/: this checkout is CRLF under
    // core.autocrlf while the blobs are LF, and the gate must not fail purely
    // over line endings. The receipts are JSON, so they have no lines to split —
    // this comparison is the only place EOL semantics can bite.
    const norm = (s) => s.split(/\r?\n/).join("\n");
    if (norm(current) !== norm(text)) {
      report(data);
      fail(
        `the landing page's benchmark figures no longer match the receipts under benchmarks/ (${shownRel}).\n` +
          "                 A receipt (or this script) changed without the generated data being\n" +
          "                 regenerated. Run: bun scripts/landing_benchmarks.mjs",
      );
    }
    console.log(`ok  page matches receipts: ${data.tracks.length} tracks, ${data.resolved} resolved`);
    return data;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  report(data, shownRel);
  return data;
}

export {
  TRACKS,
  TARGET,
  BenchmarksError,
  chooseRun,
  chooseRuns,
  rerunDirs,
  pickAt,
  roundTo,
  checkFigure,
  buildTrack,
  build,
  emit,
  run,
};

// Importable so its rules can be pinned by scripts/landing_benchmarks.test.mjs:
// `--check` compares the committed file against the same derivation, so it
// cannot see a derivation bug — a spec that quietly reads the wrong JSON path
// changes BOTH sides and the gate stays green while the page lies.
//
// The comparison is separator- and case-insensitive because this runs on all
// three OS. A guard that never matches turns `--check` into a command that does
// nothing and exits 0, which is precisely how a gate becomes decorative.
const self = fileURLToPath(import.meta.url).replace(/\\/g, "/").toLowerCase();
const invoked = process.argv[1] ? resolve(process.argv[1]).replace(/\\/g, "/").toLowerCase() : "";
if (invoked === self) {
  try {
    const at = process.argv.indexOf("--out");
    run(process.argv.includes("--check"), at > 0 ? process.argv[at + 1] : undefined);
  } catch (err) {
    console.error(err instanceof BenchmarksError ? err.message : err);
    process.exit(1);
  }
}
