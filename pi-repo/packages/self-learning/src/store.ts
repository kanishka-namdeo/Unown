/**
 * store.ts — SQLite persistence for the self-learning layer (bun:sqlite, WAL).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { stateRoot } from "./packaging.ts";

// Repository root. Resolves correctly whether this module runs from src/ (bun
// dev) or dist/ (compiled): both sit four levels below the repository root at
// <repo>/pi-repo/packages/self-learning/{src,dist}. In a STANDALONE compiled
// binary there is no repository root — `import.meta.dir` is Bun's virtual
// filesystem — so stateRoot() routes state to UNOWN_HOME instead. Without that,
// the mkdir below resolves to a drive root and the binary dies at import
// evaluation (EPERM) before printing anything.
const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const STATE_ROOT = stateRoot(REPO_ROOT);

export const DATA_DIR = process.env.PI_SELFLEARNING_DATA || join(STATE_ROOT, "data", "self-learning");
export const DB_PATH = process.env.PI_SELFLEARNING_DB || join(STATE_ROOT, "db", "selflearning.db");
export const BRIDGE_URL = process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031";

// M2 (docs/detached-engine-architecture.md): the DB directory is created by
// the Store CONSTRUCTOR, not at module load — importing this module (which
// the terminal agent does transitively, for the consts above) must stay
// side-effect free.

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
  changed_by TEXT NOT NULL,         -- seed | harness | autodream | manual | rollback | mem0 (dream renders/imports, incl. every project:<slug> version) | autodream-hoist (cross-project user-tier promotion)
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
  description TEXT,
  last_ok INTEGER,                  -- M11 outcome: 1 pass | 0 error | NULL never
  last_error TEXT,                  -- M11: the error text of the failed run
  last_duration_ms INTEGER          -- M11: how long the last completed run took
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
CREATE INDEX IF NOT EXISTS idx_runs_cycle ON runs(cycle_id);
CREATE INDEX IF NOT EXISTS idx_notes_dream ON notes(dream_id);
CREATE INDEX IF NOT EXISTS idx_hook_ts ON hook_log(ts);

-- governor.ts: rolling LLM spend ledger (engine-side calls only; agent-run
-- tokens are summed from the runs table). Pruned to 24h+margin.
CREATE TABLE IF NOT EXISTS llm_ledger (
  ts INTEGER,
  ok INTEGER,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  model TEXT
);
CREATE INDEX IF NOT EXISTS idx_llm_ledger_ts ON llm_ledger(ts);

-- memzero.ts: the memory platform's engine-side bookkeeping (active embedder
-- backend, migration markers). Key/value so future rows need no migration.
CREATE TABLE IF NOT EXISTS memory_platform (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- hoist.ts: the cross-project promotion ledger. A rule abstracted out of a
-- project dream is OBSERVED here (rule_hash + observing project set); it
-- promotes into the user tier only after PI_HOIST_MIN_PROJECTS distinct
-- projects have produced it (the multi-repo gate — amnesia's PROMOTE
-- pattern: a rule the agent derives in ONE project is project-suspicious,
-- the same rule arriving from two projects is a user-level habit).
-- rows are deleted on promotion; the table stays small (cap 500, LRU by
-- last_seen_at in hoist.ts).
CREATE TABLE IF NOT EXISTS hoist_candidates (
  rule_hash TEXT PRIMARY KEY,
  rule_text TEXT NOT NULL,
  projects TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
-- The delegation round (2026-10-30): the cross-session delegation audit
-- ledger. Every terminal subagent spawn — both lanes — reported by the
-- terminal agent (delegation.ts reportDelegations → POST /api/delegations).
-- The fleet journal is the per-repo local truth; this table is the
-- aggregate the dashboard reads (why / cost / outcome per spawn).
CREATE TABLE IF NOT EXISTS delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lane TEXT NOT NULL,                 -- sync | fleet
  agent TEXT NOT NULL,
  name TEXT,
  task TEXT NOT NULL,
  why TEXT,
  status TEXT NOT NULL,               -- done | failed | blocked | stopped | timeout | aborted | spawn_error | guard-failed
  turns INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  elapsed_ms INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  project_path TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delegations_ts ON delegations(ts);
`;

export class Store {
	private db: Database;
	constructor(path: string = DB_PATH) {
		mkdirSync(dirname(path), { recursive: true });
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
			// runs: the OS isolation the agent bash tool actually ran under
			// (M6-3, audit M4-c D2) — 'bwrap' | 'seatbelt' | 'process'; NULL =
			// pre-M6 rows, when the level was not recorded.
			["runs", "sandbox_isolation", "ALTER TABLE runs ADD COLUMN sandbox_isolation TEXT"],
			["jobs", "last_ok", "ALTER TABLE jobs ADD COLUMN last_ok INTEGER"],
			["jobs", "last_error", "ALTER TABLE jobs ADD COLUMN last_error TEXT"],
			["jobs", "last_duration_ms", "ALTER TABLE jobs ADD COLUMN last_duration_ms INTEGER"],
			// improvements: the mem0 memory ids a shipped patch produced (the
			// mem0-backed learning core) — retention's auto-unship deletes them
			// from the platform and re-renders the tier. NULL = legacy ships.
			["improvements", "memory_ids", "ALTER TABLE improvements ADD COLUMN memory_ids TEXT"],
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
					if (!/duplicate column name/i.test(err instanceof Error ? err.message : String(err))) throw err;
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
			this.db.exec(
				`DELETE FROM memory_versions WHERE id NOT IN (SELECT MAX(id) FROM memory_versions GROUP BY tier, version)`,
			);
			this.db.exec(
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_versions_tier_version ON memory_versions(tier, version)`,
			);
		} catch (err: any) {
			console.warn(`[store] memory_versions unique index: ${err instanceof Error ? err.message : String(err)}`);
		}

		// M9: the governor's budgetStatus() sums run tokens by ended_at
		// and the retention pass (retention.ts) prunes old runs by
		// ended_at — the column had no index, so both were full table
		// scans that get slower as history grows. (The automation_runs
		// started_at index lives in AUTOMATIONS_SCHEMA instead: a fresh
		// install constructs this Store before that schema installs the
		// table — server.ts's quickCheck precedes ensureAutomationsSchema.)
		this.db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_ended_at ON runs(ended_at)`);
	}
	query<T = any>(sql: string, params: any[] = []): T[] {
		const stmt = this.db.prepare(sql);
		return stmt.all(...params) as T[];
	}
	/**
	 * PRAGMA quick_check (M6): the fast O(N) integrity pass (skips the
	 * index↔table cross-checks of full integrity_check — sqlite.org/pragma
	 * recommends it for routine boot-time validation). Returns "ok" or the
	 * first failure line. The engine runs it at boot (server.ts startServer)
	 * so a damaged DB fails FAST with the repair hint instead of corrupting
	 * writes mid-dream.
	 */
	quickCheck(): string {
		try {
			const rows = this.query<{ quick_check?: string }>("PRAGMA quick_check");
			return String(rows[0]?.quick_check ?? "unknown");
		} catch (err: any) {
			return `error: ${err instanceof Error ? err.message : String(err)}`;
		}
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

/**
 * The lazy, engine-owned store singleton (M2).
 *
 * HISTORY: this used to be `export const store = new Store()` at module
 * scope — every process that imported ANY src module transitively (the
 * terminal agent via termhooks→hooks and tools→llm) OPENED THE ENGINE'S
 * SQLITE DB (3 fds: db + -wal + -shm) and ran a schema DDL exec + a
 * memory_versions dedup DELETE on every CLI boot. On Windows, cross-process
 * BEGIN IMMEDIATE exclusion is broken in Bun (oven-sh/bun#40659), so a
 * terminal session contending with a writing engine was a real hazard.
 *
 * Now: the proxy defers construction to the first store METHOD call. The
 * terminal agent's import graph (post bash-policy split) never calls a store
 * method, so it never opens the DB — pinned by test/detachment.test.ts.
 * The engine opens it exactly once, at first use, on its own data root.
 */
let _store: Store | null = null;

export function getStore(): Store {
	if (_store === null) {
		_store = new Store();
		// Keep a strong global reference: bun:sqlite Databases can be
		// GC-closed mid-transaction when no JS reference remains (verified
		// against Bun 1.3 — see docs/detached-engine-research.md §1).
		(globalThis as any).__unown_engine_store = _store;
	}
	return _store;
}

/** Test/doctor probe: has the DB been opened in this process? */
export function storeOpened(): boolean {
	return _store !== null;
}

export const store: Store = new Proxy({} as Store, {
	get(_target, prop, receiver) {
		const s = getStore() as any;
		const value = s[prop];
		return typeof value === "function" ? value.bind(s) : value;
	},
});
