#!/usr/bin/env bun
// The validation round's retrieval-probe runner (schema
// validation-round/probe/1). The mission's "memory entries retrieved /
// retrieval success" lane made concrete: for each pinned query it calls
// the live engine's semantic recall surface and receipts whether a
// ground-truth term came back at hit@5.
//
// Method (benchmarks/validation-round/README.md + the mission's probes):
//   - queries come from the pinned set in benchmarks/validation-round/queries.json
//     (an array of {id, query, expect_terms: string[]}) — the ground truth
//     is facts the tracked project memory carries
//   - each query is asked of the live engine's recall surface:
//     GET /api/memories?q=<query>&across=1&limit=5 on :3030 with the bearer token
//     (across=1: the cross-scope fan-out — engine scope AND every project scope
//     that has dreamed; without it the search covers the engine scope only and
//     project facts are invisible to the probe)
//   - hit@5 = at least one returned result whose combined text contains ANY
//     expect_term (case-insensitive substring)
//   - the top result's first 160 chars are stored as evidence
//   - receipts are committed, never regenerated; the driver makes zero
//     LLM calls — recall is a lexical surface, free and re-runnable
//
// Usage:
//   bun probe.mjs --label <label>
//   bun probe.mjs --label smoke [--engine-url http://127.0.0.1:3030]
//   writes benchmarks/validation-round/probes/<label>.json
//   bun probe.mjs --summary <label>
//   loads the two most recent probes/ receipts, prints a compact
//   per-query comparison table (id, previous hit, current hit, delta)
//   plus the overall hitRate delta; makes zero HTTP calls
import { writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};

const label = flag("label");
const summaryLabel = flag("summary");
if (summaryLabel) {
  printSummary(summaryLabel);
  process.exit(0);
}
if (!label) {
  console.error("usage: bun probe.mjs --label <label> [--engine-url <url>] | --summary <label>");
  process.exit(2);
}

function printSummary(label) {
  const probesDir = join(import.meta.dir, "probes");
  const receipts = readdirSync(probesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const r = JSON.parse(readFileSync(join(probesDir, f), "utf8"));
      return { file: f, capturedAt: r.capturedAt ?? "", ...r };
    })
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : a.capturedAt > b.capturedAt ? -1 : 0));
  if (receipts.length < 2) {
    console.error(`--summary ${label}: need at least 2 receipts in ${probesDir}, found ${receipts.length}`);
    process.exit(2);
  }
  const current = receipts[0];
  const previous = receipts[1];
  const prevByQuery = new Map(previous.queries.map((q) => [q.id, q.hit]));
  const rows = [];
  for (const q of current.queries) {
    const prevHit = prevByQuery.get(q.id);
    rows.push({ id: q.id, prevHit, curHit: q.hit, delta: prevHit === undefined ? null : q.hit === prevHit ? 0 : q.hit ? +1 : -1 });
  }
  const maxId = Math.max(...rows.map((r) => r.id.length));
  console.log(`summary: ${label} — ${previous.label} (${previous.capturedAt}) vs ${current.label} (${current.capturedAt})`);
  console.log(`  ${"id".padEnd(maxId)}  ${"prev".padStart(4)}  ${"now".padStart(4)}  delta`);
  for (const r of rows) {
    console.log(`  ${r.id.padEnd(maxId)}  ${String(r.prevHit).padStart(4)}  ${String(r.curHit).padStart(4)}  ${r.delta === null ? "new" : r.delta > 0 ? "+1" : r.delta < 0 ? "-1" : " 0"}`);
  }
  const rateDelta = Number(((current.summary.hitRate ?? 0) - (previous.summary.hitRate ?? 0)).toFixed(4));
  console.log(
    `hitRate: ${previous.summary.hitRate} → ${current.summary.hitRate} (Δ ${rateDelta > 0 ? "+" : ""}${rateDelta})`,
  );
}
const engineUrl = (flag("engine-url", "http://127.0.0.1:3030")).replace(/\/+$/, "");
const repoRoot = join(import.meta.dir, "..", "..");
const tokenFile = join(repoRoot, "data", "self-learning", "engine.token");
const queriesPath = join(import.meta.dir, "queries.json");
const outPath = join(import.meta.dir, "probes", `${label}.json`);

const token = readFileSync(tokenFile, "utf8").trim();
const queries = JSON.parse(readFileSync(queriesPath, "utf8"));
if (!Array.isArray(queries) || !queries.length) {
  console.error(`no queries in ${queriesPath}`);
  process.exit(2);
}

const combinedText = (m) => [m.text ?? "", m.metadata?.kind ?? "", m.id ?? ""].join(" ").toLowerCase();
const evidence = (m) => (m?.text ?? "").slice(0, 160);

const probeResults = [];
for (const q of queries) {
  const qs = `q=${encodeURIComponent(q.query)}&across=1&limit=5`;
  const res = await fetch(`${engineUrl}/api/memories?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`probe ${q.id} failed: GET /api/memories → ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  const memories = body.memories ?? [];
  const terms = (q.expect_terms ?? []).map((t) => String(t).toLowerCase());
  const hit = memories.some((m) => {
    const text = combinedText(m);
    return terms.some((t) => t && text.includes(t));
  });
  probeResults.push({
    id: q.id,
    query: q.query,
    expect_terms: q.expect_terms,
    hit,
    resultsCount: memories.length,
    evidence: memories.length ? evidence(memories[0]) : null,
  });
}

const hits = probeResults.filter((r) => r.hit).length;
const receipt = {
  label,
  capturedAt: new Date().toISOString().slice(0, 19),
  schema: "validation-round/probe/1",
  queries: probeResults,
  summary: {
    queries: probeResults.length,
    hits,
    hitRate: probeResults.length ? Number((hits / probeResults.length).toFixed(4)) : null,
  },
};

mkdirSync(join(import.meta.dir, "probes"), { recursive: true });
writeFileSync(outPath, JSON.stringify(receipt, null, 1) + "\n");
console.log(`wrote ${outPath}`);
console.log(
  `summary: ${receipt.summary.queries} queries, ${hits} hit@5, ` +
    `hitRate ${receipt.summary.hitRate} (engine ${engineUrl})`,
);
for (const r of probeResults) {
  console.log(`  [${r.hit ? "HIT " : "MISS"}] ${r.id}: ${r.query} (${r.resultsCount} results)`);
}
