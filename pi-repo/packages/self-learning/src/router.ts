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
import { store } from "./store.ts";
import { runCycle, runRegression, pickNextTask } from "./harness.ts";
import { runDream } from "./dream.ts";
import { undreamedNotes } from "./notes.ts";
import { gcSandboxes } from "./sandbox.ts";
import { emit, onAsync } from "./bus.ts";

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
                description: "Consolidates new session notes into project memory (needs ≥3 new notes).",
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
                id: "sandbox-gc",
                name: "Sandbox GC",
                kind: "interval",
                scheduleMs: 15 * 60_000,
                description: "Prunes old sandbox directories (keeps newest 40).",
        },
];

export class Router {
        private busy = false;
        private timer: any = null;
        private handlers: Array<() => void> = [];

        async start() {
                for (const def of JOB_DEFS) {
                        const existing = store.get(`SELECT id FROM jobs WHERE id = ?`, [def.id]);
                        if (!existing) {
                                store.run(
                                        `INSERT INTO jobs (id, name, kind, schedule_ms, event, enabled, next_run, run_count, status, description)
                                         VALUES (?, ?, ?, ?, ?, 1, ?, 0, 'idle', ?)`,
                                        [def.id, def.name, def.kind, def.scheduleMs ?? null, def.event ?? null, def.kind === "interval" ? Date.now() + (def.scheduleMs ?? 0) : null, def.description],
                                );
                        }
                }

                // event handlers
                for (const def of JOB_DEFS.filter((d) => d.kind === "event")) {
                        const off = onAsync(def.event!, async (payload: any) => {
                                if (!this.isEnabled(def.id)) return;
                                if (def.id === "dream-check") {
                                        // only fire when enough notes accumulated
                                        const pending = undreamedNotes(50).length;
                                        if (pending < 3) return;
                                }
                                await this.execute(def.id, payload);
                        });
                        this.handlers.push(off);
                }

                // interval scheduler tick
                this.timer = setInterval(() => this.tick(), 5_000);
                emit("router:started", { jobs: JOB_DEFS.length });
                console.log(`[router] started with ${JOB_DEFS.length} jobs`);
        }

        stop() {
                if (this.timer) clearInterval(this.timer);
                for (const off of this.handlers) off();
        }

        private isEnabled(id: string): boolean {
                const row = store.get<{ enabled: number }>(`SELECT enabled FROM jobs WHERE id = ?`, [id]);
                return Boolean(row?.enabled);
        }

        private async tick() {
                if (this.busy) return;
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
                        const job = store.get<any>(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
                        if (!job) throw new Error(`unknown job: ${jobId}`);
                        store.run(`UPDATE jobs SET status = 'running', last_run = ?, run_count = run_count + 1 WHERE id = ?`, [Date.now(), jobId]);
                        emit("job:started", { id: jobId, name: job.name });
                        let result: any = null;
                        try {
                                result = await this.runJobInternal(jobId, payload);
                        } catch (err: any) {
                                emit("job:error", { id: jobId, error: err?.message ?? String(err) });
                        } finally {
                                const def = JOB_DEFS.find((d) => d.id === jobId);
                                const next = def?.scheduleMs ? Date.now() + def.scheduleMs : null;
                                store.run(`UPDATE jobs SET status = 'idle', next_run = ? WHERE id = ?`, [next, jobId]);
                                emit("job:finished", { id: jobId, name: job.name, result });
                        }
                        return result;
                });
        }

        /** Run arbitrary engine work under the busy mutex (used by API triggers). */
        async withBusy<T>(fn: () => Promise<T>): Promise<T> {
                if (this.busy) throw new Error("engine is busy with another job");
                this.busy = true;
                try {
                        return await fn();
                } finally {
                        this.busy = false;
                }
        }

        isBusy(): boolean {
                return this.busy;
        }

        private async runJobInternal(jobId: string, payload?: any): Promise<any> {
                switch (jobId) {
                        case "harness-cycle": {
                                const taskId = pickNextTask();
                                if (!taskId) return { skipped: "no tasks" };
                                const cycle = await runCycle(taskId);
                                return { cycle };
                        }
                        case "auto-dream": {
                                const pending = undreamedNotes(50).length;
                                if (pending < 3) return { skipped: `only ${pending} undreamed notes` };
                                const dream = await runDream();
                                return { dream: { id: dream.id, status: dream.status, notesIn: dream.notesIn } };
                        }
                        case "regression-on-ship": {
                                const results = await runRegression(2);
                                return { results };
                        }
                        case "dream-check": {
                                const dream = await runDream();
                                return { dream: { id: dream.id, status: dream.status } };
                        }
                        case "sandbox-gc": {
                                const removed = gcSandboxes(40);
                                return { removed };
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
