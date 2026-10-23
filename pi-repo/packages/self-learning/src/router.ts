/**
 * router.ts — Routing (pattern 3/5).
 *
 * Connects the agent to schedules and events so it keeps learning while
 * nobody is watching:
 *   - interval jobs (harness cycle, auto-dream, sandbox GC)
 *   - event jobs  (regression sweep after an improvement ships,
 *                  dream check after runs complete)
 * A single scheduler tick serializes work through a busy mutex — one
 * background activity at a time.
 */

import { emit, onAsync } from "./bus.ts";
import { runDream, runProjectDream } from "./dream.ts";
import { pickNextTask, runCycle, runRegression } from "./harness.ts";
import { runMintJob } from "./mint.ts";
import { undreamedNotes } from "./notes.ts";
import { syncNoteOutbox } from "./outbox.ts";
import { RETENTION_BACKLOG_RESCHEDULE_MS, runRetentionPass } from "./retention.ts";
import { gcSandboxes } from "./sandbox.ts";
import { store } from "./store.ts";
import { guardLearningJob } from "./governor.ts";
import { runWatchScan, watchDisabled } from "./watch.ts";

export interface JobDef {
        id: string;
        name: string;
        kind: "interval" | "event";
        scheduleMs?: number;
        event?: string;
        description: string;
}

export const JOB_DEFS: JobDef[] = [
        {
                id: "harness-cycle",
                name: "Self-improvement cycle",
                kind: "interval",
                scheduleMs: 10 * 60_000,
                description: "Runs the next task through the mine → patch → validate loop.",
        },
        {
                id: "auto-dream",
                name: "AutoDream consolidation",
                kind: "interval",
                scheduleMs: 10 * 60_000,
                description:
                        "Consolidates new session notes into project memory (needs ≥3 benchmark notes); terminal notes are dreamed into their own projects.",
        },
        {
                id: "note-sync",
                name: "Terminal note sync",
                kind: "interval",
                scheduleMs: 5 * 60_000,
                description: "Ingests session notes left by `unown` terminal sessions while the engine was unreachable.",
        },
        {
                id: "regression-on-ship",
                name: "Regression sweep on ship",
                kind: "event",
                event: "improvement:shipped",
                description: "Re-runs sampled tasks to check a shipped memory patch causes no regressions.",
        },
        {
                id: "dream-check",
                name: "Dream check after runs",
                kind: "event",
                event: "run:finished",
                description: "Wakes AutoDream when enough undreamed notes have accumulated.",
        },
        {
                id: "task-mint",
                name: "Task minting",
                kind: "interval",
                scheduleMs: 30 * 60_000,
                description:
                        "Mines failed runs (or, when the suite is saturated, generates harder curriculum variants) into new capability-eval tasks; a task only ships if the agent genuinely fails it.",
        },
        {
                id: "sandbox-gc",
                name: "Sandbox GC",
                kind: "interval",
                scheduleMs: 15 * 60_000,
                description: "Prunes old sandbox directories (keeps newest 40).",
        },
        {
                id: "db-retention",
                name: "DB retention",
                kind: "interval",
                scheduleMs: 24 * 60 * 60_000,
                description:
                        "Prunes operational telemetry past its retention window (hook_log, runs, dreams, cycles, automation_runs, dreamed notes); precious tables (memory, skills, tasks, improvements, automations) are never touched.",
        },
        {
                id: "watch-scan",
                name: "AI comment watch",
                kind: "interval",
                scheduleMs: 120_000,
                description:
                        "Scans watch roots (opt-in .unown/watch.json) for new # AI:/AI!/AI? comments and dispatches one batched headless run per root (aider --watch-files semantics); hash dedup keeps quiet scans free.",
        },
];

/**
 * Jobs that CONSULT the governor before starting (they spend LLM tokens or
 * spawn agent runs) — watch-scan's batched runs go through the automations
 * spawn seam, so budget exhaustion throttles them like any learning job (the
 * correct behavior: an AI-comment firehose must not bypass the spend
 * ceilings). note-sync, sandbox-gc and db-retention never do — they are the
 * engine's catch-up and housekeeping mechanics (pure SQL/files) and must
 * always run, even while the governor throttles LLM spend.
 */
const LEARNING_JOBS = new Set(["harness-cycle", "auto-dream", "dream-check", "task-mint", "regression-on-ship", "watch-scan"]);

/**
 * The M9 self-reschedule seam, as a pure function: a job result may carry
 * `{ rescheduleMs }` to ask for a SHORTER next interval than its schedule —
 * db-retention re-runs at 5 minutes while a prune backlog remains (a pass is
 * capped at 50k rows/table). Anything else keeps the job's own scheduleMs.
 * Exported for the table tests (test/retention.test.ts).
 */
export function nextRunInterval(result: unknown, scheduleMs: number | undefined): number | undefined {
        if (result && typeof result === "object" && typeof (result as any).rescheduleMs === "number") {
                const ms = (result as any).rescheduleMs as number;
                if (ms > 0) return ms;
        }
        return scheduleMs;
}

/**
 * Jobs whose internal runs must NOT re-trigger dream-check — the self-trigger
 * guard (docs/detached-engine-architecture.md F1). A dream's canary run
 * finishing emits run:finished SYNCHRONOUSLY INSIDE the dream job; without
 * the guard that event queued another dream-check and the loop never ended
 * (measured: 9 back-to-back dreams, ~630k prompt tokens in 50 minutes).
 */
const DREAM_JOBS = new Set(["dream-check", "auto-dream"]);

export function jobTimeoutMs(): number {
        const raw = Number(process.env.PI_JOB_TIMEOUT_MS);
        return Number.isFinite(raw) && raw >= 60_000 ? raw : 20 * 60_000;
}

/**
 * Test seam: the watchdog timeout floor (60s) is too slow for unit tests, so a
 * Router constructed with an override uses it verbatim. Production always
 * constructs via the module singleton (no override).
 */
export const ROUTER_TEST_ONLY = { timeoutOverrideMs: undefined as number | undefined };

/**
 * Watchdog row-recovery grace, ms (BUG 7): recoverRunningRows floors a run's
 * started_at this far BELOW the job's own start — rows minted in the same
 * breath as the job (a harness run INSERTed a tick before execute() takes
 * the jobs row) belong to the job; genuinely foreign rows (minutes/hours
 * old — a crashed boot's leftovers, another lane's live run) stay outside
 * the window and survive. 2s is far below any real job's cadence and far
 * above scheduler/test-setup jitter.
 */
const WATCHDOG_RECOVERY_GRACE_MS = 2_000;

export function dreamCheckCooldownMs(): number {
        const raw = Number(process.env.PI_DREAM_CHECK_COOLDOWN_MS);
        return Number.isFinite(raw) && raw >= 0 ? raw : 10 * 60_000;
}

export class Router {
        private busy = false;
        /** When the current job started (0 = idle) — feeds /api/overview router.busyMs and doctor's wedged-mutex warning (F4). */
        private busySince = 0;
        /** The job currently holding the mutex ('' = idle) — the dream-check self-trigger guard reads it. */
        private activeJobId = "";
        /** Last dream-check execution (ms epoch) — collapses re-trigger storms to one per cooldown window (F1). */
        private lastDreamCheckAt = 0;
        private timer: any = null;
        private handlers: Array<() => void> = [];
        /** Event jobs that arrived while the engine was busy, drained by tick(). */
        private pendingEvents: Array<{ id: string; payload: any }> = [];
        private tickMs: number;

        constructor(tickMs = 5_000) {
                this.tickMs = tickMs;
        }

        async start() {
                // Idempotent, mirroring AutomationsScheduler.start(): the engine
                // lock's same-pid path supports an in-process restart calling
                // startServer() twice (server.ts re-enters with our own pid), and
                // without this guard every re-entry re-registered the event
                // handlers — each bus event then dispatched N times (the extras
                // throw "router is busy" and land in pendingEvents, so a restart
                // doubled/tripled every queued sweep) — and overwrote this.timer,
                // leaking the previous interval: stop() could only ever clear
                // the most recent one.
                if (this.timer) return;
                for (const def of JOB_DEFS) {
                        const existing = store.get(`SELECT id FROM jobs WHERE id = ?`, [def.id]);
                        if (!existing) {
                                // M3 watch kill switch: PI_WATCH_DISABLE=1 at boot seeds the
                                // job DISABLED (the row exists — visible/idle in the Router
                                // screen — but never fires). The job body re-checks the env
                                // too, so a var set after boot also stops the scans without
                                // a toggle.
                                const seedEnabled = def.id === "watch-scan" && watchDisabled() ? 0 : 1;
                                store.run(
                                        `INSERT INTO jobs (id, name, kind, schedule_ms, event, enabled, next_run, run_count, status, description)
                                         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'idle', ?)`,
                                        [
                                                def.id,
                                                def.name,
                                                def.kind,
                                                def.scheduleMs ?? null,
                                                def.event ?? null,
                                                seedEnabled,
                                                def.kind === "interval" ? Date.now() + (def.scheduleMs ?? 0) : null,
                                                def.description,
                                        ],
                                );
                        }
                }

                // event handlers
                for (const def of JOB_DEFS.filter((d) => d.kind === "event")) {
                        const off = onAsync(def.event!, async (payload: any) => {
                                if (!this.isEnabled(def.id)) return;
                                if (def.id === "dream-check") {
                                        // F1 SELF-TRIGGER GUARD: a run finishing inside a dream job
                                        // (its own canary/regression runs) must not queue another
                                        // dream-check — that is the measured runaway loop. Runs
                                        // finishing inside OTHER jobs (harness cycles, regression
                                        // sweeps) are legitimate triggers.
                                        if (DREAM_JOBS.has(this.activeJobId)) return;
                                        // F1 COOLDOWN: at most one dream-check per window, however
                                        // many run:finished events arrive (harness cycles emit one
                                        // per run; a burst must not become a dream storm).
                                        const cooldown = dreamCheckCooldownMs();
                                        if (cooldown > 0 && Date.now() - this.lastDreamCheckAt < cooldown) return;
                                        // only fire when enough notes accumulated
                                        const pending = undreamedNotes(50).length;
                                        if (pending < 3) return;
                                }
                                this.dispatchEventJob(def.id, payload);
                        });
                        this.handlers.push(off);
                }

                // interval scheduler tick
                this.timer = setInterval(() => this.tick(), this.tickMs);
                emit("router:started", { jobs: JOB_DEFS.length });
                console.log(`[router] started with ${JOB_DEFS.length} jobs`);
        }

        stop() {
                // Null the timer so start() is re-entrant after a stop (the guard
                // above keys on it) — stop() used to leave the stale handle set.
                if (this.timer) {
                        clearInterval(this.timer);
                        this.timer = null;
                }
                for (const off of this.handlers) off();
                this.handlers = [];
                this.pendingEvents = []; // no zombie queued jobs after stop
        }

        private isEnabled(id: string): boolean {
                const row = store.get<{ enabled: number }>(`SELECT enabled FROM jobs WHERE id = ?`, [id]);
                return Boolean(row?.enabled);
        }

        /**
         * Route an event job: run immediately when idle, QUEUE when busy.
         *
         * Until this queue existed, every event job that fired while busy — which
         * is the ONLY time they fire: improvement:shipped is emitted from inside
         * runCycle, which always holds the mutex — threw "router is busy" and
         * died as a router:error. The regression-on-ship sweep (the documented
         * post-ship safety net) had never once executed automatically.
         */
        private dispatchEventJob(id: string, payload: any) {
                if (!this.busy) {
                        this.execute(id, payload).catch(() => this.enqueueEventJob(id, payload)); // busy race -> queue
                        return;
                }
                this.enqueueEventJob(id, payload);
        }

        /** A queued id replaces its still-pending twin: a sweep delayed behind a busy stretch does not need two sweeps; run:finished storms stay bounded. */
        private enqueueEventJob(id: string, payload: any) {
                const existing = this.pendingEvents.findIndex((p) => p.id === id);
                if (existing >= 0) this.pendingEvents[existing].payload = payload;
                else this.pendingEvents.push({ id, payload });
                console.log(`[router] ${id} queued behind busy engine (${this.pendingEvents.length} pending)`);
        }

        /** Queued event jobs (diagnostics + tests). */
        pendingEventJobs(): Array<{ id: string }> {
                return this.pendingEvents.map((p) => ({ id: p.id }));
        }

        private async tick() {
                if (this.busy) return;
                // Drain ONE queued event job per tick before interval scheduling —
                // the events that arrived while the engine was busy (audit HIGH-1).
                if (this.pendingEvents.length > 0) {
                        const next = this.pendingEvents.shift()!;
                        try {
                                await this.execute(next.id, next.payload);
                        } catch {
                                this.pendingEvents.unshift(next); // raced with a manual trigger — try next tick
                        }
                        return;
                }
                const now = Date.now();
                const due = store.get<{ id: string }>(
                        `SELECT id FROM jobs WHERE kind = 'interval' AND enabled = 1 AND status != 'running' AND next_run IS NOT NULL AND next_run <= ? ORDER BY next_run LIMIT 1`,
                        [now],
                );
                if (due) await this.execute(due.id);
        }

        /** Runs a job by id (manual trigger allowed). */
        async execute(jobId: string, payload?: any): Promise<any> {
                if (this.busy) throw new Error("router is busy with another job");
                return this.withBusy(async () => {
                        this.activeJobId = jobId;
                        try {
                        // M11: declared before anything in this block can throw, because the
                        // inner finally below writes the outcome and a `const` first assigned
                        // after the throw point would be read there in its TDZ.
                        // A throw BEFORE the job starts (unknown id, busy mutex) propagates out
                        // of execute() without an outcome write — that is a caller error, not a
                        // job run, and recording it would poison the job's health row.
                        const startedAt = Date.now();
                        let failure: string | null = null;
                        const job = store.get<any>(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
                        if (!job) throw new Error(`unknown job: ${jobId}`);
                        // F7/F5 GOVERNOR GATE: learning jobs consult the budget + breaker
                        // before starting. Manual API triggers skip the gate only for
                        // non-learning jobs (sync/GC always run; learning must obey even
                        // when hand-triggered — a user clicking "run now" on a throttled
                        // engine should see the skip reason, not a quiet spend burst).
                        if (LEARNING_JOBS.has(jobId)) {
                                const guard = guardLearningJob(jobId);
                                if (!guard.allowed) {
                                        const reason = guard.reason ?? "governor: skipped";
                                        emit("job:skipped", { id: jobId, name: job.name, reason });
                                        console.log(`[router] ${jobId} skipped: ${reason}`);
                                        return { skipped: reason };
                                }
                        }
                        store.run(`UPDATE jobs SET status = 'running', last_run = ?, run_count = run_count + 1 WHERE id = ?`, [
                                startedAt,
                                jobId,
                        ]);
                        if (jobId === "dream-check") this.lastDreamCheckAt = Date.now();
                        emit("job:started", { id: jobId, name: job.name });
                        let result: any = null;
                        // F2 JOB WATCHDOG: no job may hold the busy mutex forever. The
                        // job's promise races a timeout; on timeout the job is marked
                        // errored, its still-running runs are recovered (scoped
                        // recoverOrphans), and the mutex releases. The underlying work
                        // becomes a detached zombie whose late finalize is a no-op
                        // (runner.ts finalizes only rows still in 'running').
                        const timeoutMs = ROUTER_TEST_ONLY.timeoutOverrideMs ?? jobTimeoutMs();
                        let watchdogTimer: any = null;
                        const watchdog = new Promise<never>((_, reject) => {
                                watchdogTimer = setTimeout(
                                        () => reject(new Error(`watchdog: job ${jobId} exceeded ${Math.round(timeoutMs / 1000)}s`)),
                                        timeoutMs,
                                );
                        });
                        const work = this.runJobInternal(jobId, payload);
                        // Swallow the zombie's eventual rejection after the watchdog already
                        // lost the race — an unhandled rejection would kill the engine.
                        work.catch(() => {});
                        try {
                                result = await Promise.race([work, watchdog]);
                        } catch (err: any) {
                                const message = err?.message ?? String(err);
                                failure = message;
                                if (message.startsWith("watchdog:")) {
                                        emit("router:watchdog", { id: jobId, timeoutMs });
                                        // BUG 7 (audit #7): pass THIS job's start so the recovery
                                        // only touches runs the job itself started — never a
                                        // foreign 'running' row from before the job began.
                                        this.recoverRunningRows(jobId, startedAt);
                                        emit("job:error", { id: jobId, error: message });
                                        result = { error: message };
                                } else {
                                        emit("job:error", { id: jobId, error: message });
                                }
                        } finally {
                                clearTimeout(watchdogTimer);
                                const def = JOB_DEFS.find((d) => d.id === jobId);
                                // M9 self-reschedule seam: a job may return { rescheduleMs }
                                // to ask for a SHORTER next interval than its schedule —
                                // db-retention re-runs at 5 minutes while a prune backlog
                                // remains (a pass is capped at 50k rows/table). Anything
                                // else keeps the job's own scheduleMs.
                                const intervalMs = nextRunInterval(result, def?.scheduleMs);
                                const next = intervalMs ? Date.now() + intervalMs : null;
                                // M11: the outcome lands with the reschedule, in the same write,
                                // so a job can never be left marked running-but-healthy. Duration
                                // is measured from THIS run's start (last_run), not from boot.
                                store.run(
                                        `UPDATE jobs SET status = 'idle', next_run = ?, last_ok = ?, last_error = ?, last_duration_ms = ? WHERE id = ?`,
                                        [next, failure ? 0 : 1, failure, Math.max(0, Date.now() - startedAt), jobId],
                                );
                                emit("job:finished", { id: jobId, name: job.name, result });
                        }
                        return result;
                        } finally {
                                this.activeJobId = "";
                        }
                });
        }

        /**
         * F2: mark the timed-out job's still-running runs as errored. Scoped to
         * runs STARTED AROUND THIS JOB (started_at >= the job's start minus a
         * small grace) — the pre-fix UPDATE was global over status='running', so
         * any run row alive outside the timed-out job (a run left 'running' by
         * a crashed earlier boot, or one created by a lane that slipped past
         * the router mutex) was falsely errored while this job hung (audit #7).
         * Mirrors recoverOrphans' row healing (server.ts) so the zombie's late
         * finalize no-ops.
         *
         * The GRACE (2s) covers rows minted in the same breath as the job — a
         * harness task run is INSERTed immediately before/after execute() flips
         * the jobs row (the governor test mints the run row first, then starts
         * the router job a tick later; under suite load the two Date.now() calls
         * straddle a millisecond boundary and a strict >= scoping would leave
         * the job's OWN row unrecovered). Genuinely foreign rows — anything
         * older than the grace — survive for their owner or boot-time orphan
         * recovery to heal.
         */
        private recoverRunningRows(jobId: string, jobStartedAt: number): void {
                try {
                        const floor = jobStartedAt - WATCHDOG_RECOVERY_GRACE_MS;
                        const info = store.run(
                                `UPDATE runs SET status = 'error', ended_at = ?, error = ? WHERE status = 'running' AND started_at >= ?`,
                                [Date.now(), `job ${jobId} timed out (watchdog)`, floor],
                        );
                        if (info.changes > 0) console.log(`[router] watchdog: recovered ${info.changes} running row(s) from ${jobId}`);
                } catch (err: any) {
                        console.error(`[router] watchdog row recovery failed: ${err?.message ?? err}`);
                }
        }

        /** Run arbitrary engine work under the busy mutex (used by API triggers). */
        async withBusy<T>(fn: () => Promise<T>): Promise<T> {
                if (this.busy) throw new Error("engine is busy with another job");
                this.busy = true;
                this.busySince = Date.now();
                try {
                        return await fn();
                } finally {
                        this.busy = false;
                        this.busySince = 0;
                }
        }

        /**
         * BUG 13 (audit #13) — the fire-and-forget busy gate for the API lanes.
         * withBusy() reports a lost mutex race as a REJECTED promise, which
         * arrives a microtask later — after an HTTP handler that fires and
         * forgets already answered {started:true}, leaving the client polling
         * for a cycle that never runs (the rejection only surfaced as a
         * router:error SSE event, and in the awaited lanes as a raw 500).
         * This variant throws SYNCHRONOUSLY in the same tick as the call, so
         * the handler can answer the engine-busy 409 contract in the very
         * response that would otherwise lie. The synchronous busy check and
         * the withBusy() acquire below it have no await between them, so the
         * check-acquire pair is atomic — the TOCTOU window the cycleTriggerGuard
         * probe closed only by accident (runCycle's synchronous INSERT) is
         * closed by construction instead.
         */
        startFireAndForget<T>(fn: () => Promise<T>): Promise<T> {
                if (this.busy) throw new Error("engine is busy with another job");
                return this.withBusy(fn);
        }

        isBusy(): boolean {
                return this.busy;
        }

        /** How long the current job has held the mutex, in ms (0 = idle). Doctor warns past 2x the job timeout (F4). */
        busyMs(): number {
                return this.busySince === 0 ? 0 : Date.now() - this.busySince;
        }

        /** The job currently holding the mutex ('' = idle) — self-trigger guard + overview reporting. */
        activeJob(): string {
                return this.activeJobId;
        }

        private async runJobInternal(jobId: string, _payload?: any): Promise<any> {
                switch (jobId) {
                        case "harness-cycle": {
                                const taskId = pickNextTask();
                                if (!taskId) return { skipped: "no tasks" };
                                const cycle = await runCycle(taskId);
                                return { cycle };
                        }
                        case "auto-dream": {
                                const pending = undreamedNotes(50, "benchmark").length;
                                let dream: any = null;
                                if (pending >= 3) dream = await runDream();
                                // Terminal notes are consolidated into their own projects.
                                const projects = await runProjectDream();
                                if (!dream && projects.length === 0)
                                        return { skipped: `only ${pending} undreamed benchmark notes and no terminal notes` };
                                return { dream: dream ? { id: dream.id, status: dream.status, notesIn: dream.notesIn } : null, projects };
                        }
                        case "note-sync": {
                                const synced = syncNoteOutbox();
                                return { synced };
                        }
                        case "regression-on-ship": {
                                const results = await runRegression(2);
                                return { results };
                        }
                        case "dream-check": {
                                const dream = await runDream();
                                return { dream: { id: dream.id, status: dream.status } };
                        }
                        case "task-mint": {
                                const outcome = await runMintJob();
                                return { outcome };
                        }
                        case "sandbox-gc": {
                                const removed = gcSandboxes(40);
                                return { removed };
                        }
                        case "db-retention": {
                                // Pure SQL (retention.ts) — no LLM calls, so it stays off
                                // LEARNING_JOBS and runs even while the governor throttles.
                                const retention = runRetentionPass();
                                return {
                                        pruned: retention.pruned,
                                        moreRemaining: retention.moreRemaining,
                                        ...(retention.moreRemaining ? { rescheduleMs: RETENTION_BACKLOG_RESCHEDULE_MS } : {}),
                                };
                        }
                        case "watch-scan": {
                                // M3 AI-comment watch (docs/watch.md): scan every watch root;
                                // one batched headless run per root with NEW comments
                                // (hash-stable dedup — a quiet scan costs zero LLM). A
                                // learning job: the governor gates it like every job that
                                // spends tokens, and the kill switch is checked inside
                                // runWatchScan too.
                                const watch = await runWatchScan();
                                return { watch };
                        }
                        default:
                                throw new Error(`no runner for job ${jobId}`);
                }
        }
}

export const router = new Router();

export function listJobs() {
        return store.query<any>(`SELECT * FROM jobs ORDER BY kind, id`);
}

export function setJobEnabled(id: string, enabled: boolean) {
        store.run(`UPDATE jobs SET enabled = ? WHERE id = ?`, [enabled ? 1 : 0, id]);
        return store.get(`SELECT * FROM jobs WHERE id = ?`, [id]);
}
