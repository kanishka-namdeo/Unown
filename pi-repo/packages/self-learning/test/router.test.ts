// Unit tests for src/router.ts — the busy-mutex contract.
//
// Backlog reference: docs/testing-strategy.md §4.2 (self-learning engine).
// Only the in-process-constructible surface is tested: the Router class
// mutex (withBusy / execute / isBusy) and the JOB_DEFS schedule table,
// against the redirected test store (see ./_env.ts). tick() and
// runJobInternal() are module-private (needs extraction for unit coverage of
// the due-job query and per-job runners); start()/stop() are smoke-tested
// against the jobs table only.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emit } from "../src/bus.ts";
import { breakerStatus, breakerThreshold, markEngineProcess, recordLlmFailure, resetBreakerForTest, resetEngineProcessForTest } from "../src/governor.ts";
import { slugifyProject } from "../src/notes.ts";
import { JOB_DEFS, listJobs, Router, router, ROUTER_TEST_ONLY } from "../src/router.ts";
import { Store, store } from "../src/store.ts";

describe("JOB_DEFS", () => {
        test("defines the nine engine jobs", () => {
                expect(JOB_DEFS.map((d) => d.id).sort()).toEqual([
                        "auto-dream",
                        "db-retention",
                        "dream-check",
                        "harness-cycle",
                        "note-sync",
                        "regression-on-ship",
                        "sandbox-gc",
                        "task-mint",
                        "watch-scan", // M3 — the AI-comment watch (docs/watch.md)
                ]);
        });

        test("ids are unique", () => {
                expect(new Set(JOB_DEFS.map((d) => d.id)).size).toBe(JOB_DEFS.length);
        });

        test("every interval job has a positive schedule", () => {
                const intervals = JOB_DEFS.filter((d) => d.kind === "interval");
                expect(intervals.length).toBeGreaterThan(0);
                for (const d of intervals) expect(d.scheduleMs).toBeGreaterThan(0);
        });

        test("event jobs bind to their documented bus events", () => {
                const events = Object.fromEntries(JOB_DEFS.filter((d) => d.kind === "event").map((d) => [d.id, d.event]));
                expect(events).toEqual({
                        "regression-on-ship": "improvement:shipped",
                        "dream-check": "run:finished",
                });
        });
});

describe("Router busy mutex (withBusy / execute / isBusy)", () => {
        test("withBusy returns the fn's value and reports busy only while running", async () => {
                const r = new Router();
                let release!: () => void;
                const gate = new Promise<void>((res) => (release = res));
                const job = r.withBusy(async () => {
                        expect(r.isBusy()).toBe(true);
                        await gate;
                        return 42;
                });
                expect(r.isBusy()).toBe(true);
                release();
                await expect(job).resolves.toBe(42);
                expect(r.isBusy()).toBe(false);
        });

        test("withBusy error path: rejects AND restores busy=false", async () => {
                const r = new Router();
                await expect(r.withBusy(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
                expect(r.isBusy()).toBe(false);
                // the router accepts work again afterwards
                await expect(r.withBusy(async () => "ok")).resolves.toBe("ok");
        });

        test("reentrancy: a nested withBusy call is rejected", async () => {
                const r = new Router();
                await r.withBusy(async () => {
                        await expect(r.withBusy(async () => "never")).rejects.toThrow("engine is busy with another job");
                });
                expect(r.isBusy()).toBe(false);
        });

        test("reentrancy: execute() while busy is rejected (manual-trigger guard)", async () => {
                const r = new Router();
                let release!: () => void;
                const gate = new Promise<void>((res) => (release = res));
                const job = r.withBusy(() => gate.then(() => "done"));
                expect(r.isBusy()).toBe(true);
                await expect(r.execute("harness-cycle")).rejects.toThrow("router is busy with another job");
                release();
                await expect(job).resolves.toBe("done");
        });

        test("execute() of an unknown job rejects and still restores the mutex", async () => {
                const r = new Router();
                await expect(r.execute("does-not-exist")).rejects.toThrow("unknown job: does-not-exist");
                expect(r.isBusy()).toBe(false);
        });

        test("module singleton is a Router instance, initially idle", () => {
                expect(router instanceof Router).toBe(true);
                expect(router.isBusy()).toBe(false);
        });
});

describe("Router.start()/stop() (jobs table on the redirected test store)", () => {
        test("start seeds the jobs table exactly once per job; stop clears timers", async () => {
                const r = new Router();
                await r.start();
                expect(listJobs().length).toBe(JOB_DEFS.length);
                const r2 = new Router();
                await r2.start(); // same defs — no duplicate rows
                expect(listJobs().length).toBe(JOB_DEFS.length);
                r.stop();
                r2.stop();
        });
});

// ---------------------------------------------------------------------------
// Event-job queue (audit HIGH-1): improvement:shipped is emitted from INSIDE
// runCycle, which always holds the busy mutex — the old handler called
// execute() directly, which always threw "router is busy", so the
// regression-on-ship sweep NEVER executed automatically (dead automation:
// run_count stayed 0 forever, only a router:error SSE event appeared).
// These tests pin the queue: busy events are held (coalesced), then drained
// by the tick loop as soon as the engine frees.
// ---------------------------------------------------------------------------
describe("Router event-job queue (HIGH-1)", () => {
        const jobRow = () => store.get<{ run_count: number; status: string }>(
                `SELECT run_count, status FROM jobs WHERE id = 'regression-on-ship'`,
        )!;

        /**
         * Pin the SHARED jobs table into a known state before a queue test.
         * bun test runs every file in ONE process against one store, so an
         * earlier suite can leave interval jobs stale-due (the 5ms test tick
         * would misfire them mid-test) or an event job toggled off / stuck in
         * 'running' (isEnabled then silently drops the emit — the queue
         * assertions would see a DROP, not a queue, and the drain poll would
         * wait on a status this router never wrote).
         */
        function hermeticJobs() {
                store.run(`UPDATE jobs SET next_run = ? WHERE kind = 'interval'`, [Date.now() + 3_600_000]);
                store.run(`UPDATE jobs SET enabled = 1, status = 'idle'`);
        }

        /** Poll until fn() is truthy (bounded ~2s — the tick loop runs at 5ms in these tests). */
        async function until(fn: () => boolean, ms = 2000): Promise<boolean> {
                const deadline = Date.now() + ms;
                while (Date.now() < deadline) {
                        if (fn()) return true;
                        await Bun.sleep(10);
                }
                return fn();
        }

        test("an event fired while the engine is busy is QUEUED and DRAINED, not dropped", async () => {
                // Hermetic: regression-on-ship with an empty tasks table runs no
                // agent runs (runRegression samples only tasks with passes+fails>0).
                store.run(`DELETE FROM tasks`);
                hermeticJobs();
                const before = jobRow().run_count;
                const r = new Router(5); // tick every 5ms
                await r.start();
                try {
                        // The HIGH-1 shape: the event fires from inside a busy stretch.
                        await r.withBusy(async () => {
                                emit("improvement:shipped", { id: "imp-1", tier: "project", memoryVersion: 3 });
                        });
                        // The handler ran synchronously under the mutex: the job must be queued.
                        expect(r.pendingEventJobs().map((p) => p.id)).toEqual(["regression-on-ship"]);
                        // The engine is free now; the tick loop drains the queue...
                        //
                        // The predicate waits for the FULL drain, not just run_count
                        // movement. bun test runs every file in ONE process with a
                        // shared bus + jobs table, and bun's file-loading order varies
                        // by platform and runner (the bunfig.toml preload note). If a
                        // file that boots the real engine (startServer →
                        // router.start()) loaded earlier and left its router
                        // subscribed, THAT router receives this emit too and — idle —
                        // executes the sweep SYNCHRONOUSLY inside the emit, so
                        // run_count can move long before THIS router's 5ms tick
                        // drains its own queue. A run_count-only poll then asserted a
                        // still-pending queue (CI's intermittent `expected [] /
                        // received [{id:"regression-on-ship"}]`, ~3ms into the test).
                        // Waiting for THIS router's queue to empty AND the shared job
                        // row to settle back to idle is order-independent: the tick
                        // loop finishes the drain within one 5ms tick, and both
                        // executes are fast here (runRegression samples nothing — the
                        // tasks table is empty).
                        //
                        // The three post-poll assertions re-check the predicate's own
                        // conditions, and that is race-free BY CONSTRUCTION: between
                        // until()'s final truthy fn() and these expects there is no
                        // await, so no timer (tick, foreign router) can interleave —
                        // a foreign emit can only land while this test sleeps inside
                        // until(), where the predicate re-evaluates it. The explicit
                        // 30s test timeout keeps the runner's default 5s kill from
                        // firing BEFORE the 10s poll budget can report a clean
                        // `drained === false` on a pathologically loaded CI box.
                        const drained = await until(
                                () =>
                                        jobRow().run_count > before &&
                                        r.pendingEventJobs().length === 0 &&
                                        jobRow().status === "idle",
                                10_000,
                        );
                        expect(drained).toBe(true); // ...the sweep finally executes automatically
                        expect(r.pendingEventJobs()).toEqual([]);
                        expect(jobRow().status).toBe("idle");
                } finally {
                        r.stop();
                }
        }, 30_000);

        test("duplicate queued ids coalesce (one pending instance, newest payload wins)", async () => {
                hermeticJobs();
                const r = new Router(60_000); // slow tick: nothing drains during the test
                await r.start();
                try {
                        let release!: () => void;
                        const gate = new Promise<void>((res) => (release = res));
                        const busy = r.withBusy(() => gate.then(() => "done"));
                        emit("improvement:shipped", { id: "a", memoryVersion: 1 });
                        emit("improvement:shipped", { id: "b", memoryVersion: 2 });
                        expect(r.pendingEventJobs().length).toBe(1); // coalesced, not stacked
                        release();
                        await busy;
                } finally {
                        r.stop();
                }
                expect(r.pendingEventJobs()).toEqual([]); // stop() clears the queue
        });

        test("an event fired while idle executes immediately (no queue detour)", async () => {
                store.run(`DELETE FROM tasks`);
                hermeticJobs();
                const before = jobRow().run_count;
                const r = new Router(60_000); // slow tick: immediate path must not depend on it
                await r.start();
                try {
                        emit("improvement:shipped", { id: "imp-2" });
                        // 10s poll + explicit 30s test timeout: same CI-load headroom
                        // rule as the queue test above (poll budget must fit inside
                        // the runner timeout, or a slow box reports a misleading
                        // "timed out after 5000ms" instead of `ran === false`).
                        const ran = await until(() => jobRow().run_count > before, 10_000);
                        expect(ran).toBe(true);
                        expect(r.pendingEventJobs()).toEqual([]);
                } finally {
                        r.stop();
                }
        }, 30_000);
});

// ---------------------------------------------------------------------------
// BUG 7 (audit #7): the watchdog's running-row recovery used to be a GLOBAL
// `UPDATE runs SET status='error' WHERE status='running'` — any run row alive
// outside the timed-out job (an automation-lane run, an API-triggered run
// that slipped past the mutex, or a row left 'running' by a crashed earlier
// boot — recoverOrphans heals those only at boot) was falsely errored while
// THIS job hung. The recovery is now scoped to runs started AT OR AFTER the
// job's own start timestamp.
// ---------------------------------------------------------------------------
describe("watchdog row recovery is scoped to THIS job's runs (BUG 7)", () => {
        test("a foreign 'running' row from before the job start survives the timeout; rows started during the job are recovered", async () => {
                // The jobs table is seeded by the earlier start()/stop() suite; pin the
                // row back to idle so execute() can take it.
                store.run(`UPDATE jobs SET status = 'idle' WHERE id = 'dream-check'`);
                // A foreign run row: started 60s BEFORE the job (e.g. left 'running' by
                // a lane that does not hold the router mutex, or a crashed earlier boot).
                store.run(
                        `INSERT INTO runs (id, task_id, kind, status, started_at) VALUES ('bug7-foreign-run', 't', 'regression', 'running', ?)`,
                        [Date.now() - 60_000],
                );
                const r = new Router();
                // A job whose internal work starts a run row DURING the job, then hangs
                // forever — the pre-fix engine would hold the busy mutex forever.
                (r as any).runJobInternal = async () => {
                        store.run(
                                `INSERT INTO runs (id, task_id, kind, status, started_at) VALUES ('bug7-job-run', 't', 'regression', 'running', ?)`,
                                [Date.now()],
                        );
                        return new Promise(() => {});
                };
                ROUTER_TEST_ONLY.timeoutOverrideMs = 100;
                try {
                        const result = (await r.execute("dream-check")) as { error?: string };
                        expect(result?.error).toContain("watchdog: job dream-check exceeded");
                        // The job's OWN run row (started during the job) was healed to error.
                        const jobRow = store.get<{ status: string; error: string }>(
                                `SELECT status, error FROM runs WHERE id = 'bug7-job-run'`,
                        )!;
                        expect(jobRow.status).toBe("error");
                        expect(jobRow.error).toContain("watchdog");
                        // The FOREIGN row (started before the job) SURVIVES — the global
                        // UPDATE of the pre-fix code errored it out from under its owner.
                        const foreignRow = store.get<{ status: string }>(
                                `SELECT status FROM runs WHERE id = 'bug7-foreign-run'`,
                        )!;
                        expect(foreignRow.status).toBe("running");
                } finally {
                        store.run(`DELETE FROM runs WHERE id IN ('bug7-foreign-run', 'bug7-job-run')`);
                        ROUTER_TEST_ONLY.timeoutOverrideMs = undefined;
                }
        });

        test("a watchdog-killed job heals its orphaned 'running' DREAM row in the same tick (2026-10-23)", async () => {
                // Measured live: an auto-dream exceeding the 20-min watchdog left its dream
                // row 'running' forever — recoverOrphans heals dreams only at the NEXT
                // engine boot, so the dashboard showed a phantom in-flight dream until a
                // restart. The busy mutex guarantees any 'running' dream belongs to the
                // killed job; the watchdog now heals it inline.
                store.run(`UPDATE jobs SET status = 'idle' WHERE id = 'auto-dream'`);
                store.run(`DELETE FROM dreams WHERE id = 'wd-dream-1'`);
                store.run(
                        `INSERT INTO dreams (id, started_at, status, notes_in) VALUES ('wd-dream-1', ?, 'running', 2)`,
                        [Date.now()],
                );
                const r = new Router();
                (r as any).runJobInternal = () => new Promise(() => {});
                ROUTER_TEST_ONLY.timeoutOverrideMs = 100;
                try {
                        const result = (await r.execute("auto-dream")) as { error?: string };
                        expect(result?.error).toContain("watchdog: job auto-dream exceeded");
                        const dream = store.get<{ status: string; ended_at: number | null; note: string }>(
                                `SELECT status, ended_at, note FROM dreams WHERE id = 'wd-dream-1'`,
                        )!;
                        expect(dream.status).toBe("error");
                        expect(dream.ended_at).not.toBeNull();
                        expect(dream.note).toContain("job killed by watchdog");
                } finally {
                        store.run(`DELETE FROM dreams WHERE id = 'wd-dream-1'`);
                        ROUTER_TEST_ONLY.timeoutOverrideMs = undefined;
                }
        });
});

// ---------------------------------------------------------------------------
// M11: the per-job OUTCOME columns (jobs.last_ok / last_error /
// last_duration_ms). Until these landed the table carried a SCHEDULE and no
// VERDICT, so a job erroring on every cycle was indistinguishable from one that
// had not come round yet — and the Router screen's `✓ N runs` claimed a passing
// history for both.
// ---------------------------------------------------------------------------
describe("Router job outcome columns (M11)", () => {
        const PROBE = "m10-outcome-probe";
        type OutcomeRow = {
                last_ok: number | null;
                last_error: string | null;
                last_duration_ms: number | null;
                last_run: number | null;
                run_count: number;
                status: string;
                next_run: number | null;
        };
        const row = (): OutcomeRow =>
                store.get<OutcomeRow>(
                        `SELECT last_ok, last_error, last_duration_ms, last_run, run_count, status, next_run FROM jobs WHERE id = ?`,
                        [PROBE],
                )!;

        function seedProbe() {
                store.run(`DELETE FROM jobs WHERE id = ?`, [PROBE]);
                // schedule_ms goes through a BOUND PARAM, never inlined: SQLite only
                // accepts underscores in numeric literals from 3.46 (2024), and bun's
                // darwin-x64 build bundles an older engine — an inlined 3_600_000 is
                // "unrecognized token" there while every other CI leg stays green.
                // Found by the xplat lane's macos-intel leg (the darwin-x64 gap leg
                // ci.yml's arm64-only macos matrix cannot run): run 40192211514.
                store.run(
                        `INSERT INTO jobs (id, name, kind, schedule_ms, event, enabled, next_run, run_count, status, description)
                         VALUES (?, ?, 'interval', ?, NULL, 1, ?, 0, 'idle', 'M11 outcome probe')`,
                        [PROBE, PROBE, 3_600_000, Date.now() + 3_600_000],
                );
        }

        /** Put a real learning job back the way router.start() seeded it. */
        function clearOutcome(id: string) {
                store.run(`UPDATE jobs SET last_ok = NULL, last_error = NULL, last_duration_ms = NULL WHERE id = ?`, [id]);
        }

        afterAll(() => {
                store.run(`DELETE FROM jobs WHERE id = ?`, [PROBE]);
                clearOutcome("db-retention");
                clearOutcome("harness-cycle");
        });

        test("a failed run records last_ok=0 + the message, in the same write that reschedules", async () => {
                seedProbe();
                const r = new Router();
                // execute() RESOLVES when a job's runner throws — the error is recorded
                // and the mutex released, NOT propagated. That non-rejection is exactly
                // why a permanently failing job used to look like a working one.
                await expect(r.execute(PROBE)).resolves.toBeNull();
                const after = row();
                expect(after.last_ok).toBe(0);
                expect(after.last_error).toBe(`no runner for job ${PROBE}`);
                expect(after.last_duration_ms).toBeGreaterThanOrEqual(0);
                expect(after.run_count).toBe(1);
                // A failure must never leave the job stuck: idle + a future next_run.
                expect(after.status).toBe("idle");
                // next_run goes NULL for a job id that is not in JOB_DEFS: the schedule
                // is owned by the def table, not by the row's schedule_ms column.
                expect(after.next_run).toBeNull();
        });

        test("a passing run records last_ok=1 and CLEARS the previous error", async () => {
                // db-retention is the pass-path job: pure SQL (retention.ts), no LLM, and
                // deliberately NOT in LEARNING_JOBS, so the governor gate cannot turn the
                // run into a skip (which returns BEFORE the outcome write — pinned below).
                store.run(`UPDATE jobs SET last_ok = 0, last_error = 'previous failure', last_duration_ms = 1234 WHERE id = 'db-retention'`);
                const r = new Router();
                await r.execute("db-retention");
                const after = store.get<OutcomeRow>(
                        `SELECT last_ok, last_error, last_duration_ms, status FROM jobs WHERE id = 'db-retention'`,
                )!;
                expect(after.last_ok).toBe(1);
                expect(after.last_error).toBeNull();
                expect(after.last_duration_ms).toBeGreaterThanOrEqual(0);
                expect(after.status).toBe("idle");
        });

        test("a governor SKIP writes no outcome: a skip is not a run", async () => {
                seedProbe();
                clearOutcome("harness-cycle");
                store.run(`UPDATE jobs SET status = 'idle', run_count = 0 WHERE id = 'harness-cycle'`);
                // Open the breaker so the GATE refuses (harness-cycle is a learning job).
                // Note what this pins: a job whose RUNNER returns { skipped } because
                // there is nothing to do is a PASS and does record a verdict — only the
                // gate's early return writes nothing.
                markEngineProcess();
                try {
                        for (let i = 0; i < breakerThreshold(); i++) recordLlmFailure();
                        expect(breakerStatus().open).toBe(true);
                        const r = new Router();
                        const out = (await r.execute("harness-cycle")) as { skipped?: string };
                        expect(out?.skipped).toContain("upstream backoff");
                        const dream = store.get<OutcomeRow>(`SELECT last_ok, last_error, run_count FROM jobs WHERE id = 'harness-cycle'`)!;
                        expect(dream.last_ok).toBeNull();
                        expect(dream.last_error).toBeNull();
                        expect(dream.run_count).toBe(0);
                } finally {
                        resetBreakerForTest();
                        resetEngineProcessForTest();
                }
        });

        test("the legacy jobs table gains the columns and reports never-run, not 'passed'", async () => {
                // The DDL below is the pre-M11 shape taken VERBATIM from
                // git show HEAD:src/store.ts — a migration test whose "old schema" is
                // typed from memory proves nothing about the real migration.
                const dir = mkdtempSync(join(tmpdir(), "unown-m10-legacy-"));
                const dbPath = join(dir, "legacy.db");
                const legacy = new Database(dbPath, { create: true });
                legacy.exec(`CREATE TABLE IF NOT EXISTS jobs (
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
);`);
                legacy.run(`INSERT INTO jobs (id, name, kind, enabled, last_run, run_count, status) VALUES ('old-job', 'Old Job', 'interval', 1, ?, 5, 'idle')`, [
                        Date.now() - 86_400_000,
                ]);
                legacy.close();

                const migrated = new Store(dbPath);
                try {
                        const names = migrated.query<{ name: string }>(`PRAGMA table_info(jobs)`).map((c) => c.name);
                        expect(names).toContain("last_ok");
                        expect(names).toContain("last_error");
                        expect(names).toContain("last_duration_ms");
                        const old = migrated.get<{ last_ok: number | null; last_error: string | null; last_duration_ms: number | null }>(
                                `SELECT last_ok, last_error, last_duration_ms FROM jobs WHERE id = 'old-job'`,
                        )!;
                        // NULL = unknown. The screen renders "no glyph", never a checkmark, for this.
                        expect(old.last_ok).toBeNull();
                        expect(old.last_error).toBeNull();
                        expect(old.last_duration_ms).toBeNull();
                        // Re-opening must be idempotent: the migration is guarded by PRAGMA.
                        expect(() => new Store(dbPath).close()).not.toThrow();
                } finally {
                        // SQLite handles (and Defender scanning the fresh WAL) can keep a
                        // just-closed temp dir EBUSY on Windows for a moment — the same
                        // bounded-retry teardown idiom as test/retention.test.ts, so a
                        // handle that has not released yet cannot fail the suite.
                        migrated.close();
                        for (let attempt = 0; attempt < 10; attempt++) {
                                try {
                                        rmSync(dir, { recursive: true, force: true });
                                        break;
                                } catch {
                                        await new Promise((r) => setTimeout(r, 250));
                                }
                        }
                }
        }, 20_000); // real DB migration on the windows CI leg ran 5.4s vs the 5s default (2026-10-22)

        test("listJobs() carries the outcome fields to the API — SELECT * is the contract", () => {
                const first = listJobs()[0] as Record<string, unknown> | undefined;
                expect(first).toBeDefined();
                expect(Object.keys(first!)).toEqual(expect.arrayContaining(["last_ok", "last_error", "last_duration_ms"]));
        });
});

// ---------------------------------------------------------------------------
// BUG 10: dream-check must count notes KIND-AWARE. The pre-fix event gate
// counted undreamed notes of BOTH kinds toward the benchmark dream's >=3
// threshold while the job body ran runDream() unconditionally — and
// runDream() consumes BENCHMARK notes only, inserting a junk 'no-notes'
// dreams row when it finds none. A terminal-only backlog therefore fired
// dream-check once per finished run, manufactured a junk row each time, and
// the terminal notes themselves were never routed anywhere by this lane.
// The gate now counts benchmark notes for the benchmark threshold and lets
// ANY pending terminal note dispatch; the runner mirrors auto-dream —
// runDream() only at its own >=3, terminal pressure served by
// runProjectDream() (each project's own .unown memory).
// ---------------------------------------------------------------------------
describe("dream-check is kind-aware (BUG 10)", () => {
        const SCRATCH = join(tmpdir(), `unown-bug10-dreamcheck-${Date.now().toString(36)}`);
        const PROJECT = join(SCRATCH, "proj");
        // The project dream rows carry the group slug (recomputed from the
        // path at dream time — the stored project_slug column is display data
        // only), so row matching/cleanup keys on THIS, not on any seeded slug.
        //
        // Materialize the dir BEFORE hashing it, and hash the REALPATH: on
        // macOS /var and /var/folders are symlinks into /private/…, and
        // resolveProjectIdentity() realpaths an existing dir but falls back to
        // the literal spelling for a missing one — a not-yet-created PROJECT
        // gives a different key than the dream's own (created) lookup. That
        // latent identity split sits underneath the slow dead-bridge path the
        // 30s window below covers (this pin failed on the macOS leg of xplat
        // run 40202377629); deriving both sides from the same realpath removes it.
        mkdirSync(PROJECT, { recursive: true });
        const SLUG = slugifyProject(realpathSync(PROJECT));
        const noNotesCount = () => (store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM dreams WHERE status = 'no-notes'`)?.c ?? 0);
        const dreamCheckRow = () => store.get<{ run_count: number; status: string }>(`SELECT run_count, status FROM jobs WHERE id = 'dream-check'`)!;
        const projectDreamRow = () =>
                store.get<{ ended_at: number | null }>(`SELECT ended_at FROM dreams WHERE note LIKE ? AND ended_at IS NOT NULL`, [`%${SLUG}%`]);

        /** Hermetic pin for the shared jobs row (see the HIGH-1 suite's note). */
        function pinDreamCheck() {
                store.run(`UPDATE jobs SET enabled = 1, status = 'idle' WHERE id = 'dream-check'`);
        }

        /** Poll until fn() is truthy (bounded — the emit path resolves in microtasks). */
        async function until(fn: () => boolean, ms = 10_000): Promise<boolean> {
                const deadline = Date.now() + ms;
                while (Date.now() < deadline) {
                        if (fn()) return true;
                        await Bun.sleep(10);
                }
                return fn();
        }

        beforeAll(() => {
                mkdirSync(PROJECT, { recursive: true });
                store.run(`DELETE FROM notes`);
        });

        afterAll(() => {
                // Only THIS suite's rows: the marker slug is unique per run, and
                // the shared dreams/notes tables carry other suites' history.
                store.run(`DELETE FROM notes WHERE project_path = ?`, [PROJECT]);
                store.run(`DELETE FROM dreams WHERE note LIKE ?`, [`%${SLUG}%`]);
                rmSync(SCRATCH, { recursive: true, force: true });
        });

        test("10 terminal notes, 0 benchmark: the runner takes the PROJECT lane — no junk no-notes row", async () => {
                store.run(`DELETE FROM notes`);
                pinDreamCheck();
                const noNotesBefore = noNotesCount();
                for (let i = 0; i < 10; i++) store.run(`INSERT INTO notes (id, run_id, content, created_at, kind, project_path, project_slug) VALUES (?, NULL, ?, ?, 'terminal', ?, 'bug10-proj')`, [`bug10-t${i}`, `bug10 terminal note ${i}`, Date.now() + i, PROJECT]);
                const r = new Router();
                const result = (await r.execute("dream-check")) as { dream: unknown; projects: Array<{ notesIn: number; projectPath: string }> };
                // Benchmark lane skipped entirely (0 < 3) — pre-fix runDream() ran
                // unconditionally and minted the junk row.
                expect(result.dream).toBeNull();
                // THE routing fix: the terminal notes reached the PROJECT dream lane
                // (all 10 of them — the dead test bridge makes the honest 'error'
                // outcome, exactly like dreams-run-projects.test.ts pins).
                expect(result.projects).toHaveLength(1);
                expect(result.projects[0].projectPath).toBe(PROJECT);
                expect(result.projects[0].notesIn).toBe(10);
                expect(noNotesCount()).toBe(noNotesBefore); // no new junk 'no-notes' row
        }, 45_000);

        test("run:finished with terminal-only pressure DISPATCHES dream-check (gate is kind-aware)", async () => {
                store.run(`DELETE FROM notes`);
                pinDreamCheck();
                const noNotesBefore = noNotesCount();
                const before = dreamCheckRow().run_count;
                // Fresh terminal-only backlog (the prior test's notes stayed pending —
                // the dead-bridge error is lossless — but seed fresh for determinism).
                for (let i = 0; i < 10; i++) store.run(`INSERT INTO notes (id, run_id, content, created_at, kind, project_path, project_slug) VALUES (?, NULL, ?, ?, 'terminal', ?, 'bug10-proj')`, [`bug10-e${i}`, `bug10 emit note ${i}`, Date.now() + i, PROJECT]);
                const r = new Router(60_000); // slow tick: the emit path dispatches, not the scheduler
                await r.start();
                try {
                        emit("run:finished", { id: "x", kind: "baseline", taskId: "t", status: "passed", durationMs: 5 });
                        const dispatched = await until(() => dreamCheckRow().run_count > before && dreamCheckRow().status === "idle");
                        expect(dispatched).toBe(true);
                        // The dispatched run took the project lane for the terminal notes.
                        // 30s window, NOT the 10s default: the dead-bridge error path
                        // (platform init + the extraction retries + every embed call
                        // refusing) is SLOW on the macOS CI runner — measured on the
                        // v0.0.19 release run (40201780672, macos-latest): the row
                        // lands past 10s and the default window failed the exact
                        // assertion this pins. dreams-run-projects.test.ts pins the
                        // SAME dead-bridge outcome with the same 30_000 budget — this
                        // matches it.
                        const projectRow = await until(() => Boolean(projectDreamRow()), 30_000);
                        expect(projectRow).toBe(true);
                        expect(noNotesCount()).toBe(noNotesBefore); // still no junk row
                } finally {
                        r.stop();
                }
        }, 60_000);

        test("run:finished with NOTHING dreamable does not dispatch", async () => {
                store.run(`DELETE FROM notes`); // no benchmark >=3, no terminal notes
                pinDreamCheck();
                const r = new Router(60_000);
                // The shared jobs row is FOREIGN-ROUTER territory (bun test runs every
                // file in one process; a still-subscribed router from an earlier suite
                // could drain its own stale queue on its own tick and move run_count
                // under this test). The gate's own contract — THIS router's handler
                // must not reach dispatchEventJob — is asserted directly instead.
                let dispatches = 0;
                (r as any).dispatchEventJob = () => {
                        dispatches++;
                };
                await r.start();
                try {
                        emit("run:finished", { id: "y", kind: "baseline", taskId: "t", status: "passed", durationMs: 5 });
                        // The dispatch path executes immediately when idle — a short settle
                        // window is enough to see it happen (or prove it never does).
                        await Bun.sleep(150);
                        expect(dispatches).toBe(0);
                        expect(r.pendingEventJobs()).toEqual([]);
                } finally {
                        r.stop();
                }
        });
});
