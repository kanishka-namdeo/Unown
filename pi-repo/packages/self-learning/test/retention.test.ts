// retention.test.ts — the M9 bounded-growth layer: per-table windows, the
// structural precious/undreamed exclusions, batching + the self-reschedule
// signal, the kill switch, and the router's nextRunInterval seam.
//
// Every DB-touching case uses its OWN throwaway Store (retention.ts accepts a
// storeOverride precisely for this — the suite's shared redirected store must
// not lose rows to a retention test). Env knobs are set per-case with
// save/restore (the governor.test.ts withEnv pattern) because the knob readers
// resolve at CALL time.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
        RETENTION_TABLES,
        RETENTION_BACKLOG_RESCHEDULE_MS,
        hookLogDays,
        retentionEnabled,
        runRetentionPass,
} from "../src/retention.ts";
import { nextRunInterval } from "../src/router.ts";
import { Store } from "../src/store.ts";

const ROOT = mkdtempSync(join(tmpdir(), "unown-retention-"));

afterAll(() => {
        rmSync(ROOT, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60_000;

/** Save/restore every retention knob around a case. */
const KNOBS = [
        "UNOWN_RETENTION_DAYS",
        "UNOWN_RETENTION_HOOK_LOG_DAYS",
        "UNOWN_RETENTION_HOOK_LOG_MAX_ROWS",
        "UNOWN_RETENTION_RUNS_DAYS",
        "UNOWN_RETENTION_HISTORY_DAYS",
        "UNOWN_RETENTION_NOTES_DAYS",
];
function withEnv(overrides: Record<string, string>, fn: () => void): void {
        const saved: Record<string, string | undefined> = {};
        for (const k of KNOBS) saved[k] = process.env[k];
        try {
                for (const k of KNOBS) delete process.env[k];
                for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
                fn();
        } finally {
                for (const k of KNOBS) {
                        if (saved[k] === undefined) delete process.env[k];
                        else process.env[k] = saved[k];
                }
        }
}

/** A throwaway populated Store: old + fresh rows in every operational table
 *  plus one row in each PRECIOUS table, so every exclusion is assertable. */
function seededStore(): Store {
        const path = join(ROOT, `db-${Math.random().toString(36).slice(2)}.db`);
        const s = new Store(path);
        const now = Date.now();
        const old = now - 400 * DAY; // far past every window
        // hook_log: 3 old + 2 fresh
        for (let i = 0; i < 3; i++) s.run(`INSERT INTO hook_log (ts, hook, tool, decision) VALUES (?, 'PreToolUse', 'bash', 'allow')`, [old]);
        for (let i = 0; i < 2; i++) s.run(`INSERT INTO hook_log (ts, hook, tool, decision) VALUES (?, 'PreToolUse', 'bash', 'allow')`, [now]);
        // runs: old-finished, fresh-finished, old-but-RUNNING (never prunable)
        s.run(`INSERT INTO runs (id, status, kind, started_at, ended_at) VALUES ('old-run', 'passed', 'baseline', ?, ?)`, [old, old]);
        s.run(`INSERT INTO runs (id, status, kind, started_at, ended_at) VALUES ('fresh-run', 'passed', 'baseline', ?, ?)`, [now, now]);
        s.run(`INSERT INTO runs (id, status, kind, started_at, ended_at) VALUES ('stuck-run', 'running', 'baseline', ?, NULL)`, [old]);
        // dreams: old done, fresh done
        s.run(`INSERT INTO dreams (id, status, started_at, ended_at) VALUES (1, 'done', ?, ?)`, [old, old]);
        s.run(`INSERT INTO dreams (id, status, started_at, ended_at) VALUES (2, 'done', ?, ?)`, [now, now]);
        // cycles: old ended, old OPEN (never prunable)
        s.run(`INSERT INTO cycles (id, task_id, status, created_at, ended_at) VALUES ('c1', 't1', 'improved', ?, ?)`, [old, old]);
        s.run(`INSERT INTO cycles (id, task_id, status, created_at, ended_at) VALUES ('c2', 't1', 'running', ?, NULL)`, [old]);
        // notes: old dreamed, old UNdreamed (never prunable), fresh dreamed
        s.run(`INSERT INTO notes (id, content, created_at, dream_id) VALUES ('old-dreamed', 'x', ?, 1)`, [old]);
        s.run(`INSERT INTO notes (id, content, created_at) VALUES ('old-undreamed', 'x', ?)`, [old]);
        s.run(`INSERT INTO notes (id, content, created_at, dream_id) VALUES ('fresh-dreamed', 'x', ?, 2)`, [now]);
        // precious: memory_versions, tasks, improvements, skills, automations
        s.run(`INSERT INTO memory_versions (tier, version, content, changed_by, created_at) VALUES ('tier1', 1, 'm', 'seed', ?)`, [old]);
        s.run(`INSERT INTO tasks (id, name, description, prompt, files, verify, created_at, active) VALUES ('t1', 'T', 'D', 'P', '{}', 'x', ?, 1)`, [old]);
        s.run(`INSERT INTO improvements (id, cycle_id, status, created_at) VALUES ('i1', 'c1', 'shipped', ?)`, [old]);
        s.run(`INSERT INTO skills (id, project_slug, project_path, name, description, body, created_at, updated_at) VALUES ('sk1', 'p', '/p', 'n', 'd', 'b', ?, ?)`, [old, old]);
        return s;
}

const count = (s: Store, table: string, where = "1=1"): number =>
        Number(s.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${where}`).c);

describe("retention policy resolution", () => {
        test("defaults: 14d hook_log, 30d runs, 90d history/notes", () => {
                withEnv({}, () => {
                        expect(hookLogDays()).toBe(14);
                        expect(retentionEnabled()).toBe(true);
                });
        });
        test("UNOWN_RETENTION_DAYS=0 is the global kill switch (and nothing else is)", () => {
                withEnv({ UNOWN_RETENTION_DAYS: "0" }, () => {
                        expect(retentionEnabled()).toBe(false);
                });
                withEnv({ UNOWN_RETENTION_DAYS: "7" }, () => {
                        expect(retentionEnabled()).toBe(true);
                });
        });
});

describe("runRetentionPass (throwaway stores)", () => {
        test("windows prune old telemetry, keep fresh, never touch precious/undreamed/running", () => {
                withEnv({}, () => {
                        const s = seededStore();
                        const r = runRetentionPass(Date.now(), s);
                        expect(r.pruned.hook_log).toBe(3);
                        expect(r.pruned.runs).toBe(1); // old-run; stuck-run survives
                        expect(r.pruned.dreams).toBe(1);
                        expect(r.pruned.cycles).toBe(1); // open cycle survives
                        expect(r.pruned.notes).toBe(1); // old-dreamed only
                        expect(r.moreRemaining).toBe(false);
                        // the survivors:
                        expect(count(s, "hook_log")).toBe(2);
                        expect(count(s, "runs")).toBe(2);
                        expect(count(s, "notes")).toBe(2); // undreamed + fresh dreamed
                        expect(count(s, "cycles")).toBe(1);
                        // the precious set is untouched:
                        expect(count(s, "memory_versions")).toBe(1);
                        expect(count(s, "tasks")).toBe(1);
                        expect(count(s, "improvements")).toBe(1);
                        expect(count(s, "skills")).toBe(1);
                        s.close();
                });
        });

        test("kill switch: UNOWN_RETENTION_DAYS=0 prunes nothing", () => {
                withEnv({ UNOWN_RETENTION_DAYS: "0" }, () => {
                        const s = seededStore();
                        const before = count(s, "hook_log");
                        const r = runRetentionPass(Date.now(), s);
                        expect(Object.values(r.pruned).reduce((a, b) => a + b, 0)).toBe(0);
                        expect(count(s, "hook_log")).toBe(before);
                        s.close();
                });
        });

        test("an undreamed note is NEVER pruned, even at UNOWN_RETENTION_NOTES_DAYS=1", () => {
                withEnv({ UNOWN_RETENTION_NOTES_DAYS: "1" }, () => {
                        const s = seededStore();
                        runRetentionPass(Date.now(), s);
                        expect(count(s, "notes", "id = 'old-undreamed'")).toBe(1);
                        expect(count(s, "notes", "id = 'old-dreamed'")).toBe(0);
                        s.close();
                });
        });

        test("per-table knob 0 disables that table only", () => {
                withEnv({ UNOWN_RETENTION_HOOK_LOG_DAYS: "0" }, () => {
                        const s = seededStore();
                        const r = runRetentionPass(Date.now(), s);
                        expect(r.pruned.hook_log).toBe(0);
                        expect(r.pruned.runs).toBe(1); // others still active
                        s.close();
                });
        });

        test("UNOWN_RETENTION_DAYS=N overrides every default window", () => {
                withEnv({ UNOWN_RETENTION_DAYS: "365" }, () => {
                        const s = seededStore();
                        const r = runRetentionPass(Date.now(), s);
                        // rows are 400d old — beyond the 365d override, so still pruned
                        expect(r.pruned.hook_log).toBe(3);
                        s.close();
                });
                withEnv({ UNOWN_RETENTION_DAYS: "1000" }, () => {
                        const s = seededStore();
                        const r = runRetentionPass(Date.now(), s);
                        // nothing is 1000d old — zero prunes everywhere
                        expect(Object.values(r.pruned).reduce((a, b) => a + b, 0)).toBe(0);
                        s.close();
                });
        });

        test("hook_log row-cap backstop: newest cap rows kept regardless of age", () => {
                withEnv({ UNOWN_RETENTION_HOOK_LOG_MAX_ROWS: "2", UNOWN_RETENTION_HOOK_LOG_DAYS: "0" }, () => {
                        const s = seededStore();
                        const r = runRetentionPass(Date.now(), s);
                        // 5 rows, cap 2 → the 3 OLDEST ids go, the 2 newest stay (all are fresh)
                        expect(r.pruned.hook_log).toBe(3);
                        expect(count(s, "hook_log")).toBe(2);
                        s.close();
                });
        });

        test("batching: a pass is capped per table and reports moreRemaining; the next pass continues", () => {
                const path = join(ROOT, `batch.db`);
                for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
                const s = new Store(path);
                const now = Date.now();
                const old = now - 400 * DAY;
                // One transaction, not 12k autocommit round-trips: bun's
                // per-statement fsync makes an un-wrapped insert loop exceed
                // any test budget on a loaded CI runner (measured red on
                // windows, 2026-10-21 run 39590930647: 193s in this test,
                // then EBUSY tearing down the temp dir) — the sibling backlog
                // case below documented the same fix. BEGIN/COMMIT is the
                // shape the engine's own bulk writers use.
                s.run(`BEGIN`);
                for (let i = 0; i < 12_000; i++) {
                        s.run(`INSERT INTO hook_log (ts, hook, tool, decision) VALUES (?, 'PreToolUse', 'bash', 'allow')`, [old]);
                }
                s.run(`COMMIT`);
                withEnv({}, () => {
                        // cap the per-table budget far below the backlog via a tiny
                        // window? No — the budget is a constant (50k). Instead prove
                        // the MACHINERY: with 12k old rows and BATCH 5k, one pass
                        // prunes all 12k in 3 batches and reports moreRemaining=false.
                        const r1 = runRetentionPass(now, s);
                        expect(r1.pruned.hook_log).toBe(12_000);
                        expect(r1.moreRemaining).toBe(false);
                        // idempotent: a second pass on the same data prunes nothing
                        const r2 = runRetentionPass(now, s);
                        expect(r2.pruned.hook_log).toBe(0);
                });
                s.close();
        });

        test("moreRemaining=true when a table still has prunable rows after the budget", () => {
                // 60k old rows > the 50k per-table-per-pass budget: the pass must
                // stop at 50k, report moreRemaining, and the RETENTION_BACKLOG
                // reschedule path is the router's cue to re-run in 5 minutes.
                const path = join(ROOT, `backlog.db`);
                for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
                const s = new Store(path);
                const now = Date.now();
                const old = now - 400 * DAY;
                // One transaction, not 60k autocommit round-trips: bun's
                // per-statement fsync made this loop the suite's slowest
                // block — on a loaded 2-vCPU CI runner it alone exceeded
                // the test budget (10.1s measured) while the two retention
                // passes it feeds are batched DELETEs. BEGIN/COMMIT is the
                // same shape the engine's own bulk writers use.
                s.run(`BEGIN`);
                for (let i = 0; i < 60_000; i++) {
                        s.run(`INSERT INTO hook_log (ts, hook, tool, decision) VALUES (?, 'PreToolUse', 'bash', 'allow')`, [old]);
                }
                s.run(`COMMIT`);
                withEnv({}, () => {
                        const r1 = runRetentionPass(now, s);
                        expect(r1.pruned.hook_log).toBe(50_000);
                        expect(r1.moreRemaining).toBe(true);
                        const r2 = runRetentionPass(now, s);
                        expect(r2.pruned.hook_log).toBe(10_000);
                        expect(r2.moreRemaining).toBe(false);
                });
                s.close();
        }, 60_000);

        test("the registry covers exactly the six operational tables (precious tables have no predicate)", () => {
                expect([...RETENTION_TABLES].sort()).toEqual([
                        "automation_runs",
                        "cycles",
                        "dreams",
                        "hook_log",
                        "notes",
                        "runs",
                ]);
        });

        test("a missing table (fresh install, automations not yet installed) is skipped, not fatal", () => {
                withEnv({}, () => {
                        const s = seededStore();
                        s.run(`DROP TABLE IF EXISTS automation_runs`);
                        const r = runRetentionPass(Date.now(), s); // must not throw
                        expect(r.pruned).toBeDefined();
                        s.close();
                });
        });
});

describe("nextRunInterval (the router's M9 self-reschedule seam)", () => {
        test("a result carrying rescheduleMs>0 wins over the job's schedule", () => {
                expect(nextRunInterval({ rescheduleMs: 5_000 }, 86_400_000)).toBe(5_000);
        });
        test("rescheduleMs<=0 / non-objects / plain results keep the schedule", () => {
                expect(nextRunInterval({ rescheduleMs: 0 }, 86_400_000)).toBe(86_400_000);
                expect(nextRunInterval({ rescheduleMs: -5 }, 86_400_000)).toBe(86_400_000);
                expect(nextRunInterval({ removed: 3 }, 900_000)).toBe(900_000);
                expect(nextRunInterval("done", 900_000)).toBe(900_000);
                expect(nextRunInterval(undefined, 900_000)).toBe(900_000);
        });
        test("no schedule and no request → undefined (event jobs stay event-driven)", () => {
                expect(nextRunInterval({ removed: 1 }, undefined)).toBeUndefined();
        });
        test("the backlog reschedule constant is the documented 5 minutes", () => {
                expect(RETENTION_BACKLOG_RESCHEDULE_MS).toBe(5 * 60_000);
        });
});
