#!/usr/bin/env bun
// The Parley round's learning-state snapshot driver (schema parley-round/1 —
// the same shape as the committed baseline; the ad-hoc tooling behind
// `baseline-20261028-160718.json`, made concrete so the round's midpoint and
// final receipts are reproducible and the lane is resumable).
//
// Method (benchmarks/parley-round/README.md):
//   - reads the LIVE engine's REST API (:3030, bearer token) — tasks, cycles,
//     improvements, dreams, memory tiers, skills, runs, notes
//   - drain-before-snapshot (the ZCode --memory-bench pattern): refuses to
//     write while a cycle or dream is in flight, so counts are
//     completed-work counts
//   - zero LLM calls — collection is free, deterministic, re-runnable
//
// Usage:
//   bun snapshot.mjs --label midpoint [--out snapshots/<label>-<ts>.json]
//                    [--engine-url http://127.0.0.1:3030]
//                    [--token-file data/self-learning/engine.token]
//                    [--force]   (skip the drain check — receipts honestly
//                                 mark `drained: false` when used)
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};

const label = flag("label");
if (!label) {
  console.error("usage: bun snapshot.mjs --label <baseline|midpoint|final> [--force]");
  process.exit(2);
}
const engineUrl = flag("engine-url", "http://127.0.0.1:3030");
const tokenFile = flag("token-file", join(import.meta.dir, "..", "..", "data", "self-learning", "engine.token"));
const force = args.includes("--force");
const out =
  flag("out") ??
  join(import.meta.dir, "snapshots", `${label}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.json`);

const token = readFileSync(tokenFile, "utf8").trim();
const get = async (path) => {
  const res = await fetch(`${engineUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

// ---- drain check ---------------------------------------------------------------
const [cyclesRaw, dreamsRaw] = await Promise.all([get("/api/cycles"), get("/api/dreams")]);
const liveCycles = (cyclesRaw.cycles ?? []).filter((c) => !c.ended_at);
const liveDreams = (dreamsRaw.dreams ?? []).filter((d) => d.status === "running");
const drained = liveCycles.length === 0 && liveDreams.length === 0;
if (!drained && !force) {
  console.error(
    `refusing: ${liveCycles.length} live cycle(s), ${liveDreams.length} running dream(s) — ` +
      `wait for the drain (or --force to record an undrained snapshot, honestly marked)`,
  );
  process.exit(1);
}

// ---- collect -------------------------------------------------------------------
const [tasksRaw, improvementsRaw, memoryRaw, skillsRaw, runsRaw, notesRaw] = await Promise.all([
  get("/api/tasks"),
  get("/api/improvements"),
  get("/api/memory"),
  get("/api/skills"),
  get("/api/runs"),
  get("/api/notes"),
]);

const tasks = (tasksRaw.tasks ?? []).map((t) => ({
  id: t.id,
  name: t.name,
  category: t.category,
  difficulty: t.difficulty,
  status: t.status,
  origin: t.origin,
  pass_count: t.pass_count,
  fail_count: t.fail_count,
  created_at: t.created_at,
}));
const cycles = (cyclesRaw.cycles ?? []).map((c) => ({
  task_id: c.task_id,
  status: c.status,
  iteration: c.iteration,
  summary: c.summary,
  shipped: c.shipped,
  created_at: c.created_at,
  ended_at: c.ended_at,
}));
const dreams = (dreamsRaw.dreams ?? []).map((d) => ({
  id: d.id,
  status: d.status,
  notes: d.notes_in ?? null, // notes consumed by the dream (the API's notes_in)
  created_at: d.started_at ?? null,
  // the consolidation deltas the round's report renders at close:
  entries_merged: d.entries_merged ?? null,
  entries_pruned: d.entries_pruned ?? null,
  entries_added: d.entries_added ?? null,
}));
const runs = runsRaw.runs ?? [];
const passRate = {
  runsPassed: runs.filter((r) => r.status === "passed").length,
  runsTotal: runs.length,
};

const cycleStatusCounts = {};
for (const c of cycles) cycleStatusCounts[c.status] = (cycleStatusCounts[c.status] ?? 0) + 1;

const snap = {
  label,
  capturedAt: new Date().toISOString().slice(0, 19),
  schema: "parley-round/1",
  drained,
  tasks,
  taskCount: tasks.length,
  tasksPassing: tasks.filter((t) => t.status === "regression" && t.fail_count === 0).length,
  cycles,
  cycleCount: cycles.length,
  cycleStatusCounts,
  improvements: improvementsRaw.improvements ?? [],
  improvementCount: (improvementsRaw.improvements ?? []).length,
  dreams,
  dreamCount: dreams.length,
  memoryTiers: (memoryRaw.tiers ?? []).map((t) => ({ tier: t.tier, version: t.version, content: t.content })),
  skills: skillsRaw.skills ?? [],
  skillCount: (skillsRaw.skills ?? []).length,
  runCount: runs.length,
  runStats: {
    tokensIn: runs.reduce((a, r) => a + (r.tokens_in ?? 0), 0),
    tokensOut: runs.reduce((a, r) => a + (r.tokens_out ?? 0), 0),
    toolCalls: runs.reduce((a, r) => a + (r.tool_calls ?? 0), 0),
  },
  passRate,
  noteCount: (notesRaw.notes ?? []).length,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snap, null, 1) + "\n");
console.log(
  `wrote ${out} — ${snap.taskCount} tasks (${snap.tasksPassing} passing), ${snap.cycleCount} cycles, ` +
    `${snap.improvementCount} improvements, ${snap.dreamCount} dreams, ${snap.skillCount} skills, ` +
    `${snap.runCount} runs (${passRate.runsPassed}/${passRate.runsTotal} passed), ${snap.noteCount} notes` +
    (drained ? "" : "  [UNDRAINED — forced]"),
);
