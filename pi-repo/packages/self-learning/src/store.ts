/**
 * store.ts — SQLite persistence for the self-learning layer (bun:sqlite, WAL).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// Repository root. Resolves correctly whether this module runs from src/ (bun
// dev) or dist/ (compiled): both sit four levels below the repository root at
// <repo>/pi-repo/packages/self-learning/{src,dist}.
const REPO_ROOT = resolve(import.meta.dir, "../../../..");

export const DATA_DIR = process.env.PI_SELFLEARNING_DATA || join(REPO_ROOT, "data", "self-learning");
export const DB_PATH = process.env.PI_SELFLEARNING_DB || join(REPO_ROOT, "db", "selflearning.db");
export const BRIDGE_URL = process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031";

mkdirSync(dirname(DB_PATH), { recursive: true });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  kind TEXT NOT NULL,               -- baseline | candidate | regression | interactive
  status TEXT NOT NULL,             -- running | passed | failed | error
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  sandbox_id TEXT,
  cycle_id TEXT,
  improvement_id TEXT,
  prompt TEXT,
  transcript TEXT,                  -- JSON array
  verify_output TEXT,               -- JSON {passed, log, summary}
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  turns INTEGER DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  difficulty INTEGER DEFAULT 1,
  prompt TEXT NOT NULL,
  files TEXT NOT NULL,              -- JSON {path: content}
  verify TEXT NOT NULL,             -- verify script (mjs)
  created_at INTEGER NOT NULL,
  active INTEGER DEFAULT 1,
  pass_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- running | improved | no-fix | already-passing
  iteration INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  summary TEXT
);
CREATE TABLE IF NOT EXISTS improvements (
  id TEXT PRIMARY KEY,
  cycle_id TEXT,
  task_id TEXT,
  iteration INTEGER DEFAULT 1,
  diagnosis TEXT,
  proposal TEXT,
  patch TEXT,                       -- markdown rule lines
  target_tier TEXT DEFAULT 'project',
  status TEXT NOT NULL,             -- proposed | validated | shipped | rejected
  baseline_run_id TEXT,
  candidate_run_id TEXT,
  score_before TEXT,
  score_after TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE IF NOT EXISTS memory_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tier TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  changed_by TEXT NOT NULL,         -- seed | harness | autodream | manual | rollback
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,             -- running | done | no-notes | error
  notes_in INTEGER DEFAULT 0,
  entries_merged INTEGER DEFAULT 0,
  entries_pruned INTEGER DEFAULT 0,
  entries_added INTEGER DEFAULT 0,
  output TEXT,
  note TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  dream_id TEXT
);
CREATE TABLE IF NOT EXISTS hook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  run_id TEXT,
  hook TEXT NOT NULL,               -- SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop | SubagentStop
  tool TEXT,
  decision TEXT,                    -- allow | deny | augment | log
  reason TEXT,
  details TEXT
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  project_path TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,               -- full SKILL.md content (current version)
  status TEXT NOT NULL DEFAULT 'shipped',  -- shipped | retired
  version INTEGER DEFAULT 1,
  dream_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skill_versions (
  skill_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  changed_by TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (skill_id, version)
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,               -- interval | event
  schedule_ms INTEGER,
  event TEXT,
  enabled INTEGER DEFAULT 1,
  last_run INTEGER,
  next_run INTEGER,
  run_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'idle',       -- idle | running
  description TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_cycle ON runs(cycle_id);
CREATE INDEX IF NOT EXISTS idx_notes_dream ON notes(dream_id);
CREATE INDEX IF NOT EXISTS idx_hook_ts ON hook_log(ts);
`;

export class Store {
        private db: Database;
        constructor(path: string = DB_PATH) {
                this.db = new Database(path, { create: true });
                this.db.exec("PRAGMA journal_mode = WAL;");
                this.db.exec("PRAGMA busy_timeout = 5000;");
                this.db.exec(SCHEMA);
                this.migrate();
        }
        /** Idempotent column additions for schema evolution on existing installs. */
        private migrate() {
                const columns: Array<[string, string, string]> = [
                        // notes: distinguish benchmark run notes from terminal-session notes
                        ["notes", "kind", "ALTER TABLE notes ADD COLUMN kind TEXT DEFAULT 'benchmark'"],
                        ["notes", "project_path", "ALTER TABLE notes ADD COLUMN project_path TEXT"],
                        ["notes", "project_slug", "ALTER TABLE notes ADD COLUMN project_slug TEXT"],
                        // improvements: remember the memory version a shipped patch produced
                        // (enables auto-unship via rollback when the task later regresses)
                        ["improvements", "memory_version", "ALTER TABLE improvements ADD COLUMN memory_version INTEGER"],
                        // tasks: minted-task provenance (mint.ts) — origin/status/source_run_id;
                        // 'status' defaults to 'regression' so seeded tasks behave as before
                        ["tasks", "origin", "ALTER TABLE tasks ADD COLUMN origin TEXT DEFAULT 'seed'"],
                        ["tasks", "status", "ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'regression'"],
                        ["tasks", "source_run_id", "ALTER TABLE tasks ADD COLUMN source_run_id TEXT"],
                ];
                for (const [table, col, ddl] of columns) {
                        const existing = this.query<any>(`PRAGMA table_info(${table})`).some((c: any) => c.name === col);
                        if (!existing) {
                                try {
                                        this.db.exec(ddl);
                                } catch (err: any) {
                                        // Only SQLite's concurrent-migration marker is ignorable (LOW-1);
                                        // anything else (read-only DB, corruption, permissions) must surface
                                        // here — swallowing it deferred the failure to every later query as a
                                        // confusing "no such column" far from the cause.
                                        if (!/duplicate column name/i.test(String(err?.message ?? err))) throw err;
                                }
                        }
                }
                // MEDIUM-3: memory_versions(tier, version) had no UNIQUE constraint and
                // runProjectDream allocated versions outside a transaction — concurrent
                // dreams could insert the same (tier, version) with different content,
                // making history/rollback ambiguous. Dedupe legacy duplicates (keeping
                // the newest row of each pair), then enforce the index. Best-effort on
                // read-only legacy DBs: allocation is ALSO serialized by the BEGIN
                // IMMEDIATE transactions in writeTier and runProjectDream.
                try {
                        this.db.exec(`DELETE FROM memory_versions WHERE id NOT IN (SELECT MAX(id) FROM memory_versions GROUP BY tier, version)`);
                        this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_versions_tier_version ON memory_versions(tier, version)`);
                } catch (err: any) {
                        console.warn(`[store] memory_versions unique index: ${err?.message ?? err}`);
                }

        }
        query<T = any>(sql: string, params: any[] = []): T[] {
                const stmt = this.db.prepare(sql);
                return stmt.all(...params) as T[];
        }
        get<T = any>(sql: string, params: any[] = []): T | undefined {
                return this.db.prepare(sql).get(...params) as T | undefined;
        }
        run(sql: string, params: any[] = []) {
                return this.db.prepare(sql).run(...params);
        }
        close() {
                this.db.close();
        }
}

export const store = new Store();
