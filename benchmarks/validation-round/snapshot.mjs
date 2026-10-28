#!/usr/bin/env bun
// The validation round's learning-state snapshot driver (schema
// validation-round/1 — the parley-round driver extended with the round's
// memory/learning/UX metric fields). The tooling behind the mission's
// baseline / midpoint / final receipts, made concrete so the lane is
// reproducible and resumable.
//
// Method (benchmarks/validation-round/README.md):
//   - reads the LIVE engine's REST API (:3030, bearer token) — tasks, cycles,
//     improvements, dreams, memory tiers, skills, runs, notes, jobs
//   - drain-before-snapshot (the ZCode --memory-bench pattern): refuses to
//     write while a cycle or dream is in flight, so counts are
//     completed-work counts
//   - zero LLM calls — collection is free, deterministic, re-runnable
//   - additionally pins the TERMINAL memory state (the tracked
//     .unown/memory/project.md provenance sidecar) so cross-session
//     continuity is receipted from the file-is-truth source, not just the
//     engine DB
//
// Usage:
//   bun snapshot.mjs --label baseline|midpoint|final [--out snapshots/<label>-<ts>.json]
//                    [--engine-url http://127.0.0.1:3030]
//                    [--token-file data/self-learning/engine.token]
//                    [--repo-root <repo>] (defaults to this repo)
//                    [--force]   (skip the drain check — receipts honestly
//                                 mark `drained: false` when used)
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
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
// The lane's receipt naming: <label>-YYYYMMDD-HHMMSS.json (the parley-round
// convention — committed receipts keep this shape).
const tsstamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
};
const engineUrl = flag("engine-url", "http://127.0.0.1:3030");
const repoRoot = flag("repo-root", join(import.meta.dir, "..", ".."));
const tokenFile = flag("token-file", join(repoRoot, "data", "self-learning", "engine.token"));
const force = args.includes("--force");
const out =
  flag("out") ??
  join(import.meta.dir, "snapshots", `${label}-${tsstamp()}` + ".json");

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
const [tasksRaw, improvementsRaw, memoryRaw, skillsRaw, runsRaw, notesRaw, overviewRaw] = await Promise.all([
  get("/api/tasks"),
  get("/api/improvements"),
  get("/api/memory"),
  get("/api/skills"),
  get("/api/runs"),
  get("/api/notes"),
  get("/api/overview"),
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

// The terminal (file-is-truth) memory state — the cross-session continuity
// receipt. The engine DB is per-install runtime state; project.md is the
// tracked artifact that carries learning across clones/installs/sessions.
const provenancePath = join(repoRoot, ".unown", "memory", "project.provenance.json");
const projectMemoryPath = join(repoRoot, ".unown", "memory", "project.md");
const skillsDir = join(repoRoot, ".unown", "skills");
const stagedDir = join(repoRoot, ".unown", "skills-staged");
const projectMemoryText = existsSync(projectMemoryPath) ? readFileSync(projectMemoryPath, "utf8") : "";
const terminalMemory = {
  provenance: existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, "utf8")) : null,
  contentChars: projectMemoryText.length,
  bulletCount: projectMemoryText
    .split("\n")
    .filter((l) => l.startsWith("- ")).length,
  sectionCount: projectMemoryText
    .split("\n")
    .filter((l) => l.startsWith("## ")).length,
  userSkills: existsSync(skillsDir) ? readdirSync(skillsDir) : [],
  stagedSkills: existsSync(stagedDir) ? readdirSync(stagedDir) : [],
};

const cycleStatusCounts = {};
for (const c of cycles) cycleStatusCounts[c.status] = (cycleStatusCounts[c.status] ?? 0) + 1;

const kpis = overviewRaw.kpis ?? {};
const snap = {
  label,
  capturedAt: new Date().toISOString().slice(0, 19),
  schema: "validation-round/1",
  drained,
  engine: {
    version: overviewRaw.agent?.layer ?? null,
    provider: overviewRaw.agent?.provider ?? null,
    bridgeUpstreamOk: overviewRaw.agent?.bridge?.upstream?.ok ?? null,
  },
  // --- the mission's MEMORY METRICS (from engine + terminal state) -----------
  memoryMetrics: {
    // entries created (engine-side): memory version rows per tier
    memoryVersions: overviewRaw.memoryVersions ?? null,
    // the tracked terminal artifact: cross-session continuity source of truth
    terminalMemory,
    // semantic recall surface (Mem0 platform): populated by the retrieval
    // probes, not by this driver — see ux-ledger.md / README.md
    retrievalProbeResults: null,
  },
  // --- the mission's LEARNING METRICS -----------------------------------------
  learningMetrics: {
    tasks,
    taskCount: tasks.length,
    tasksPassing: tasks.filter((t) => t.status === "regression" && t.fail_count === 0).length,
    suiteStats: kpis.suite ?? null,
    cycles,
    cycleCount: cycles.length,
    cycleStatusCounts,
    improvements: improvementsRaw.improvements ?? [],
    improvementCount: (improvementsRaw.improvements ?? []).length,
    improvementsShipped: kpis.improvementsShipped ?? null,
    dreams,
    dreamCount: dreams.length,
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
    notesPending: kpis.notes?.pending ?? null,
    hooks: kpis.hooks ?? null,
    governor: overviewRaw.governor ?? null,
  },
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snap, null, 1) + "\n");
console.log(
  `wrote ${out} — ${snap.learningMetrics.taskCount} tasks (${snap.learningMetrics.tasksPassing} passing), ` +
    `${snap.learningMetrics.cycleCount} cycles, ${snap.learningMetrics.improvementCount} improvements, ` +
    `${snap.learningMetrics.dreamCount} dreams, ${snap.learningMetrics.skillCount} skills, ` +
    `${snap.learningMetrics.runCount} runs (${passRate.runsPassed}/${passRate.runsTotal} passed), ` +
    `${snap.learningMetrics.noteCount} notes` +
    ` | terminal memory v${terminalMemory.provenance?.version ?? "?"} (${terminalMemory.bulletCount} bullets)` +
    (drained ? "" : "  [UNDRAINED — forced]"),
);
