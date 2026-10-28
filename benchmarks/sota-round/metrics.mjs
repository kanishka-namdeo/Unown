#!/usr/bin/env bun
// The SOTA round's metrics collector — evidence-based snapshots of the three
// metric groups (SDLC / agent / learning) from primary artifacts only:
//
//   1. the live engine DB (runs, cycles, tasks, improvements, dreams, notes,
//      memory_versions, skills, hook_log) — read-only sqlite
//   2. the build repo's .unown/receipts/*.jsonl (sessions, tool calls, tool
//      results, checkpoints) — the same ledgers the previous rounds' receipts
//      cite
//   3. explicit hand-entered facts (flags below) for what no ledger carries:
//      phases, tests, E2E verdicts, human interventions
//
// Output: results/snapshot-<label>.json — a point-in-time snapshot. The
// comparison (baseline/midpoint/final) is rendered by report.mjs from
// snapshots; nothing here compares anything. Zero LLM calls: collection is
// free, deterministic and re-runnable.
//
// Usage:
//   bun metrics.mjs --label baseline \
//     [--db <path>] [--receipts <dir>] [--notes <path>] \
//     [--phase <name>] [--tests "unit:24,e2e:2,passing"] \
//     [--e2e-verdict <string>] [--interventions <n>] [--editbench <path>]
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const label = flag("label", `snap-${Date.now()}`);
const dbPath = flag("db", join(import.meta.dir, "..", "..", "db", "selflearning.db"));
const receiptsDir = flag("receipts");
const notesPath = flag("notes");
const editbenchPath = flag("editbench");
const testsArg = flag("tests", "");
const e2eVerdict = flag("e2e-verdict", "");
const interventions = Number(flag("interventions", "0"));
const phase = flag("phase", "");

const now = Date.now();
const snap = {
  label,
  takenAt: now,
  takenAtIso: new Date(now).toISOString(),
  phase,
  source: { dbPath: existsSync(dbPath) ? dbPath : null, receiptsDir: receiptsDir ?? null },
  sdlc: { tests: {}, e2e: e2eVerdict || null, editBench: null },
  agent: { sessions: 0, inputs: 0, toolCalls: 0, toolResults: 0, toolErrorResults: 0, checkpoints: 0, resumeChains: 0, humanInterventions: interventions },
  learning: {
    runs: 0, tasksTotal: 0, tasksMinted: 0, tasksByOrigin: {},
    cyclesTotal: 0, cyclesByStatus: {}, improvementsShipped: 0,
    dreamsTotal: 0, dreamsMerged: 0, dreamsAdded: 0, dreamsPruned: 0,
    notesTotal: 0, memoryVersions: 0, skillsStaged: 0, hookDecisions: 0,
    failuresLogged: 0,
  },
};

// ---- 1. engine DB (read-only) -------------------------------------------------
if (existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true });
  const count = (t) => db.query(`SELECT COUNT(*) n FROM ${t}`).get().n;
  snap.learning.runs = count("runs");
  snap.learning.tasksTotal = count("tasks");
  snap.learning.cyclesTotal = count("cycles");
  snap.learning.improvementsShipped = db
    .query("SELECT COUNT(*) n FROM improvements WHERE status = 'shipped'")
    .get().n;
  snap.learning.dreamsTotal = count("dreams");
  snap.learning.notesTotal = count("notes");
  snap.learning.memoryVersions = count("memory_versions");
  snap.learning.skillsStaged = count("skills");
  snap.learning.hookDecisions = count("hook_log");
  const agg = (sql) => db.query(sql).all();
  snap.learning.tasksByOrigin = Object.fromEntries(
    agg("SELECT origin, COUNT(*) n FROM tasks GROUP BY origin").map((r) => [r.origin ?? "unknown", r.n]),
  );
  snap.learning.tasksMinted = (snap.learning.tasksByOrigin["mined"] ?? 0) + (snap.learning.tasksByOrigin["minted"] ?? 0);
  snap.learning.cyclesByStatus = Object.fromEntries(
    agg("SELECT status, COUNT(*) n FROM cycles GROUP BY status").map((r) => [r.status, r.n]),
  );
  const d = agg("SELECT COALESCE(SUM(entries_merged),0) m, COALESCE(SUM(entries_added),0) a, COALESCE(SUM(entries_pruned),0) p FROM dreams").at(0) ?? { m: 0, a: 0, p: 0 };
  snap.learning.dreamsMerged = d.m;
  snap.learning.dreamsAdded = d.a;
  snap.learning.dreamsPruned = d.p;
  db.close();
}

// ---- 2. receipts ledger --------------------------------------------------------
if (receiptsDir && existsSync(receiptsDir)) {
  let resumeChains = 0;
  for (const f of readdirSync(receiptsDir).filter((x) => x.endsWith(".jsonl"))) {
    snap.agent.sessions += 1;
    let sawInput = false;
    for (const line of readFileSync(join(receiptsDir, f), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.kind === "input") {
        snap.agent.inputs += 1;
        if (sawInput && /\b(continue|resume|next phase|next:)/i.test(String(e.preview ?? ""))) resumeChains += 1;
        sawInput = true;
      } else if (e.kind === "tool_call") snap.agent.toolCalls += 1;
      else if (e.kind === "tool_result") {
        snap.agent.toolResults += 1;
        if (/^\s*(error|failed|enoent|denied|refused|timeout)/i.test(String(e.preview ?? ""))) snap.agent.toolErrorResults += 1;
      } else if (e.kind === "checkpoint") snap.agent.checkpoints += 1;
    }
  }
  snap.agent.resumeChains = resumeChains;
}

// ---- 3. hand-entered facts -----------------------------------------------------
for (const part of testsArg.split(",").map((s) => s.trim()).filter(Boolean)) {
  const [k, ...rest] = part.split(":");
  snap.sdlc.tests[k] = rest.join(":").trim();
}
if (editbenchPath && existsSync(editbenchPath)) {
  const s = JSON.parse(readFileSync(editbenchPath, "utf8"));
  snap.sdlc.editBench = {
    benchmark: s.benchmark ?? "edit-bench",
    model: s.model,
    passRate: s.passRate,
    passed: s.passed,
    totalTasks: s.totalTasks,
    source: editbenchPath,
    generatedAt: s.generatedAt,
  };
}
if (notesPath && existsSync(notesPath)) {
  const t = readFileSync(notesPath, "utf8");
  snap.learning.failuresLogged = (t.match(/^### F/gm) ?? []).length;
}

snap.agent.toolSuccessRate = snap.agent.toolResults > 0 ? Number((1 - snap.agent.toolErrorResults / snap.agent.toolResults).toFixed(4)) : null;

// ---- write ---------------------------------------------------------------------
const outDir = join(import.meta.dir, "results");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const out = join(outDir, `snapshot-${label}.json`);
writeFileSync(out, JSON.stringify(snap, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log(JSON.stringify({ label, sessions: snap.agent.sessions, toolCalls: snap.agent.toolCalls, runs: snap.learning.runs, cycles: snap.learning.cyclesTotal, dreams: snap.learning.dreamsTotal, improvements: snap.learning.improvementsShipped }));
