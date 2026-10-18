#!/usr/bin/env node
/**
 * export-fixtures.mjs — read-only fixture refresh for the nonllm testbench.
 *
 * Exports notes/runs/memory/dreams/tasks from the engine's SQLite (the live
 * stack, `bun run agent:start`) into benchmarks/nonllm/fixtures/. The DB is
 * opened mode=ro — the engine keeps running untouched; WAL readers are safe.
 *
 * Usage:  node benchmarks/nonllm/export-fixtures.mjs [path-to-selflearning.db]
 *         (default: <repo>/db/selflearning.db)
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const DB_PATH = process.argv[2] ?? path.join(REPO, "db", "selflearning.db");
const OUT = path.join(HERE, "fixtures");

mkdirSync(OUT, { recursive: true });
const db = new DatabaseSync(DB_PATH, { readOnly: true });

function all(sql) {
  const stmt = db.prepare(sql);
  return stmt.all();
}

const exportedAt = new Date().toISOString();

const notes = all("SELECT id, run_id, content, created_at, dream_id, kind, project_path, project_slug FROM notes ORDER BY created_at");
const runs = all("SELECT id, task_id, kind, status, started_at, ended_at, sandbox_id, cycle_id, improvement_id, verify_output FROM runs ORDER BY started_at");
const tasks = all("SELECT id, name, description, category, difficulty, prompt, files FROM tasks ORDER BY id");
const dreams = all("SELECT id, started_at, ended_at, status, notes_in, entries_merged, entries_pruned, entries_added, output, note FROM dreams ORDER BY started_at");
const memoryVersions = all("SELECT id, version, created_at, tier, content FROM memory_versions ORDER BY created_at");

writeFileSync(path.join(OUT, "notes.json"), JSON.stringify({ exportedAt, dbPath: path.basename(DB_PATH), notes }, null, 1));
writeFileSync(path.join(OUT, "runs.json"), JSON.stringify({ exportedAt, runs }, null, 1));
writeFileSync(path.join(OUT, "tasks.json"), JSON.stringify({ exportedAt, tasks }, null, 1));
writeFileSync(path.join(OUT, "dreams.json"), JSON.stringify({ exportedAt, dreams }, null, 1));

// memory tiers: latest version per tier
const latest = new Map();
for (const v of memoryVersions) if (!latest.has(v.tier) || v.created_at > latest.get(v.tier).created_at) latest.set(v.tier, v);
const tiers = {};
for (const [tier, v] of latest) tiers[tier] = { version: v.version, created_at: v.created_at, content: v.content, resolvedChars: String(v.content ?? "").length };
writeFileSync(path.join(OUT, "memory.json"), JSON.stringify({ exportedAt, tiers }, null, 1));

const counts = {
  notes: notes.length,
  notesByKind: notes.reduce((m, n) => ((m[n.kind] = (m[n.kind] ?? 0) + 1), m), {}),
  runs: runs.length,
  runsByStatus: runs.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}),
  tasks: tasks.length,
  dreams: dreams.length,
  memoryTiers: [...latest.keys()],
};
writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ exportedAt, ...counts }, null, 1));
console.log(JSON.stringify(counts, null, 1));
console.log(`[export] ${OUT}/`);
