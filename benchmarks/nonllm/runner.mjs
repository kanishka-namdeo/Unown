#!/usr/bin/env node
/**
 * runner.mjs — the NON-LLM testbench driver for Unown.
 *
 * Hypothesis-driven experiment bench for evaluating fully-local, NON-LLM
 * models (ONNX encoders via transformers.js: bge-small / MiniLM embeddings +
 * ms-marco cross-encoder reranking) and zero-model symbolic lanes (MinHash-LSH
 * dedup, LexRank extractive curation, Park/Hou activation scoring) on Unown's
 * real learning-layer workloads, against the remote production model via the
 * llm-bridge. Companion bench: ../local-llm (H1-H8, small-LLM lane).
 *
 * Usage (install once: `npm install` in this directory):
 *   node runner.mjs probe [models...]            # N0 runtime gate (keyless)
 *   node runner.mjs n1-triage [--notes N] [--no-remote]
 *   node runner.mjs n2-dedup  [--bases N] [--no-paraphrase]
 *   node runner.mjs n3-rerank [--candidates N]
 *   node runner.mjs n4-activation [--notes N]
 *   node runner.mjs n5-dream   [--notes N] [--skip-judge]
 *   node runner.mjs all
 *   node runner.mjs fixtures                     # re-export from the live engine DB
 *
 * Works under both Bun and Node >= 18 (N0 records which). Env: TEST_BRIDGE_URL
 * (default http://127.0.0.1:3031), TEST_REMOTE_MODEL (default kimi-k2.5),
 * TEST_JUDGE_MODEL. `probe` + `--no-remote` modes need NO API key.
 */
import { mkdirSync } from "node:fs";
import {
  newRunDir, saveJson, RESULTS_DIR, mdTable,
} from "./lib/report.mjs";
import {
  n0Probe, n1Triage, n2Dedup, n3Rerank, n4Activation, n5DreamCuration,
  n6EttinRerank, n7Fusion, n8GuardShadow, n0bProbe,
} from "./lib/experiments.mjs";
import {
  renderN0, renderN1, renderN2, renderN3, renderN4, renderN5,
  renderN6, renderN7, renderN8,
} from "./lib/renders.mjs";
import { hostInfo } from "../local-llm/lib/llama.mjs";

const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};

// ---------------------------------------------------------------- commands

async function cmdProbe(outDir) {
  // runtime-tagged label so a Bun run never overwrites the Node receipt (and vice versa)
  const dir = outDir ?? newRunDir(`probe-${process.versions.bun ? "bun" : "node"}`);
  const ids = args.slice(1).filter((a) => !a.startsWith("--"));
  const r = await n0Probe({ models: ids.length ? ids : undefined });
  saveJson(dir, "n0-probe.json", r);
  renderN0(r);
  console.log(`\n[probe] saved ${dir}/n0-probe.json`);
  return r;
}

async function cmdN1(outDir) {
  const dir = outDir ?? newRunDir("n1-triage");
  const r = await n1Triage({ noteLimit: Number(opt("notes", 0)), noRemote: flag("no-remote"), k: Number(opt("k", 5)) });
  saveJson(dir, "n1-triage.json", r);
  renderN1(r);
  return r;
}

async function cmdN2(outDir) {
  const dir = outDir ?? newRunDir("n2-dedup");
  const r = await n2Dedup({ bases: Number(opt("bases", 14)), useParaphrase: !flag("no-paraphrase") });
  saveJson(dir, "n2-dedup.json", r);
  renderN2(r);
  return r;
}

async function cmdN3(outDir) {
  const dir = outDir ?? newRunDir("n3-rerank");
  const r = await n3Rerank({ candidates: Number(opt("candidates", 20)) });
  saveJson(dir, "n3-rerank.json", r);
  renderN3(r);
  return r;
}

async function cmdN4(outDir) {
  const dir = outDir ?? newRunDir("n4-activation");
  const r = await n4Activation({ noteCount: Number(opt("notes", 40)) });
  saveJson(dir, "n4-activation.json", r);
  renderN4(r);
  return r;
}

async function cmdN5(outDir) {
  const dir = outDir ?? newRunDir("n5-dream");
  const r = await n5DreamCuration({ notesCount: Number(opt("notes", 12)), judge: !flag("skip-judge"), topK: Number(opt("topk", 2)), minRatio: Number(opt("min-ratio", 0.35)), mode: opt("mode", "compress") });
  saveJson(dir, "n5-dream.json", r);
  renderN5(r);
  return r;
}

async function cmdN6(outDir) {
  const dir = outDir ?? newRunDir("n6-ettin");
  const r = await n6EttinRerank({ candidates: Number(opt("candidates", 20)), noRemote: flag("no-remote") });
  saveJson(dir, "n6-ettin.json", r);
  renderN6(r);
  return r;
}

async function cmdN7(outDir) {
  const dir = outDir ?? newRunDir("n7-fusion");
  const r = await n7Fusion({ candidates: Number(opt("candidates", 20)), noRemote: flag("no-remote") });
  saveJson(dir, "n7-fusion.json", r);
  renderN7(r);
  return r;
}

async function cmdN8(outDir) {
  const dir = outDir ?? newRunDir("n8-guard");
  const r = await n8GuardShadow({});
  saveJson(dir, "n8-guard.json", r);
  renderN8(r);
  return r;
}

async function cmdProbe2(outDir) {
  const dir = outDir ?? newRunDir(`probe2-${process.versions.bun ? "bun" : "node"}`);
  const r = await n0bProbe();
  saveJson(dir, "n0b-probe.json", r);
  console.log("\n== N0b campaign-2 lane probe (H16/H18 runtime gate) ==");
  console.log(mdTable(r.summary.results.map((x) => ({
    model: x.model, loadOk: x.loadOk, loadMs: x.loadMs ?? "—",
    pairLatencyMs: x.pairLatencyMs ?? x.latencyPerCaseMs ?? "—",
    rssDeltaMB: x.rssDeltaMB ?? "—", error: (x.error ?? "").slice(0, 80),
  }))));
  console.log(`runtime: ${r.summary.runtime.runtime} on ${r.summary.runtime.platform} | rss peak ${r.summary.rssPeakMB}MB`);
  console.log(`\n[probe2] saved ${dir}/n0b-probe.json`);
  return r;
}

async function cmdAll() {
  const dir = newRunDir(opt("label", undefined));
  console.log(`[all] results -> ${dir}`);
  console.log(`[all] host: ${JSON.stringify(hostInfo())}`);
  const summary = { run: dir, startedAt: new Date().toISOString(), experiments: {} };
  const steps = [
    ["n0", cmdProbe, (r) => ({ models: (r.summary.results ?? []).filter((x) => x.loadOk).length, embedP50: r.summary.results?.find((x) => x.model === "bge-small")?.embedP50ms ?? null })],
    ["n1", cmdN1, (r) => r.summary.lanes],
    ["n2", cmdN2, (r) => ({ minhash: r.summary.minhash, embedding: r.summary.embedding, twoStage: { f1: r.summary.twoStage?.f1 ?? null } })],
    ["n3", cmdN3, (r) => r.summary],
    ["n4", cmdN4, (r) => r.summary],
    ["n5", cmdN5, (r) => r.summary],
    ["n6", cmdN6, (r) => r.summary],
    ["n7", cmdN7, (r) => r.summary],
    ["n8", cmdN8, (r) => r.summary],
  ];
  for (const [name, fn, pick] of steps) {
    try {
      console.log(`\n########## ${name} ##########`);
      const r = await fn(dir);
      summary.experiments[name] = pick(r);
    } catch (e) {
      console.error(`[${name}]`, e?.message ?? e);
      summary.experiments[name] = { error: String(e?.message ?? e) };
    }
  }
  summary.endedAt = new Date().toISOString();
  saveJson(dir, "summary.json", summary);
  console.log(`\n[all] complete -> ${dir}/summary.json`);
}

async function cmdFixtures() {
  const { execFileSync } = await import("node:child_process");
  const path = await import("node:path");
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "export-fixtures.mjs");
  execFileSync(process.execPath, [script], { stdio: "inherit" });
}

// ---------------------------------------------------------------- main

const COMMANDS = {
  probe: cmdProbe, probe2: cmdProbe2, fixtures: cmdFixtures,
  "n1-triage": cmdN1, "n2-dedup": cmdN2, "n3-rerank": cmdN3,
  "n4-activation": cmdN4, "n5-dream": cmdN5,
  "n6-ettin": cmdN6, "n7-fusion": cmdN7, "n8-guard": cmdN8,
  all: cmdAll,
};

if (cmd === "help" || !COMMANDS[cmd]) {
  console.log(`Usage: node runner.mjs <command> [options]

Commands:
  probe [models...]                  N0 runtime gate: load + embed/rerank, keyless
  fixtures                            re-export fixtures from the live engine DB
  n1-triage [--notes N] [--no-remote] [--k 5]     embedding kNN triage vs remote
  n2-dedup  [--bases N] [--no-paraphrase]         MinHash vs cosine near-dup F1
  n3-rerank [--candidates N]                     cross-encoder vs remote ranking
  n4-activation [--notes N]                       activation score vs remote importance
  n5-dream  [--notes N] [--skip-judge]            LexRank dream-input curation + judge
  n6-ettin  [--candidates N] [--no-remote]        Ettin-17m reranker A/B vs ms-marco
  n7-fusion [--candidates N] [--no-remote]        BM25+cosine RRF fusion vs remote
  n8-guard                                         injection-classifier shadow (keyless)
  all                                              full suite -> results/<run>/

Models (probe): bge-small, minilm, rerank
Results: ${RESULTS_DIR}
Requires: npm install (once) in this directory — except \`probe --help\`-free unit tests:
  node --test "lib/**/*.test.mjs" (no install needed)`);
} else {
  COMMANDS[cmd]().catch((err) => {
    console.error(`\n[${cmd}] FATAL:`, err?.stack ?? err);
    process.exit(1);
  });
}
