// automations.test.ts — scheduled recurring agent runs (the zcode Automations
// port). Pins the three trust pillars the feature was gated on plus the
// scheduling machinery itself:
//
//   1. CRUD validation — cron x delayMinutes exclusivity, bounds, workspace
//      existence, the 20-automation create limit, lifecycle transitions
//      (pause/resume re-arm, completed-is-terminal).
//   2. The scheduler's zcode-transliterated constants — single-flight claims,
//      the 2-concurrent cap, misfire grace (skip, never replay), dispatch
//      retry with backoff to exhaustion, maxRuns finalization, one-shot
//      completion, and the frozen-run-id retry contract.
//   3. The in-session trust gate — automation_list survives inside an
//      automation run; automation_create/update/delete (and the task tool)
//      are HIDDEN there and inside subagents (no recursion).
//
// The scheduler tests never start the poll loop (tick() is public for exactly
// this reason) and inject a fake RunDispatcher, so no real CLI session is
// spawned. "Due" states are set up by bending next_run_at directly — the CRUD
// layer itself is covered by creating through it.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        AUTOMATION_CREATE_LIMIT,
        AutomationsScheduler,
        createAutomation,
        deleteAutomation,
        getAutomation,
        listRuns,
        MAX_CONCURRENT_AUTOMATION_RUNS,
        planSchedule,
        skipNextOccurrence,
        snoozeNextOccurrence,
        type AutomationRow,
        READ_ONLY_TOOLS,
        updateAutomation,
} from "../src/automations.ts";
import { runAutomationsCommand } from "../src/automations-cli.ts";
import { schedulerInFlight } from "../src/automations.ts";
import { store } from "../src/store.ts";
import { apiRequestBody } from "../src/server.ts";
import { createUnownToolsExtension } from "../src/tools.ts";
import { createUnownAddonsExtension } from "../src/addons/index.ts";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WORKSPACE = mkdtempSync(join(tmpdir(), "unown-auto-ws-"));
const TMP_ROOT = mkdtempSync(join(tmpdir(), "unown-auto-"));
/** Extra workspace (must exist) for multi-workspace list isolation. */
const OTHER_WS = join(TMP_ROOT, "other");
mkdirSync(OTHER_WS, { recursive: true });

/** IDs created by these tests — deleted in afterAll (and on the hot path). */
const created: string[] = [];

function track<T extends { ok: true; automation: AutomationRow }>(r: T): AutomationRow {
        created.push(r.automation.id);
        return r.automation;
}

/** Create a cron automation that is DUE right now (next_run_at bent to the past). */
function dueAutomation(schedule: { cron?: string; delayMinutes?: number }, opts: { maxRuns?: number } = {}): AutomationRow {
        const r = createAutomation({
                title: `test ${Math.random().toString(36).slice(2, 8)}`,
                prompt: "test prompt",
                workspace: WORKSPACE,
                schedule,
                maxRuns: opts.maxRuns ?? null,
        });
        if (!r.ok) throw new Error(`createAutomation failed: ${r.error}`);
        created.push(r.automation.id);
        store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 1000, r.automation.id]);
        return getAutomation(r.automation.id)!;
}

/** A dispatcher the test controls: resolves when the gate opens. */
function gatedDispatcher() {
        let release!: () => void;
        const gate = new Promise<void>((res) => {
                release = res;
        });
        const dispatched: string[] = [];
        const dispatch = async (a: AutomationRow) => {
                dispatched.push(a.id);
                await gate;
                return { exitCode: 0, output: `ran ${a.title}`, turns: 2, tokensIn: 30, tokensOut: 40 };
        };
        return { dispatch, release, dispatched };
}

afterAll(() => {
        for (const id of created) {
                try {
                        store.run(`DELETE FROM automations WHERE id = ?`, [id]);
                        store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
                } catch {
                        /* best effort — temp ids are unique per run */
                }
        }
        rmSync(WORKSPACE, { recursive: true, force: true });
        rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// planSchedule — pure validation
// ---------------------------------------------------------------------------

describe("planSchedule", () => {
        test("cron and delayMinutes are mutually exclusive", () => {
                expect(planSchedule({ cron: "* * * * *", delayMinutes: 5 })).toMatchObject({ ok: false });
        });
        test("neither is an error", () => {
                expect(planSchedule({})).toMatchObject({ ok: false });
        });
        test("delayMinutes bounds", () => {
                expect(planSchedule({ delayMinutes: 0 })).toMatchObject({ ok: false });
                expect(planSchedule({ delayMinutes: 525_601 })).toMatchObject({ ok: false });
                const ok = planSchedule({ delayMinutes: 1 }, null, new Date(2026, 0, 1, 12, 0, 0));
                expect(ok.ok).toBe(true);
                if (ok.ok) expect(ok.nextRunAt).toBe(new Date(2026, 0, 1, 12, 1, 0, 0).getTime());
        });
        test("bad cron surfaces the parse error", () => {
                const r = planSchedule({ cron: "61 * * * *" });
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.error).toContain("field 1");
        });
        test("impossible cron (Feb 30) reports no occurrence", () => {
                const r = planSchedule({ cron: "0 0 30 2 *" });
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.error).toContain("no occurrence");
        });
        test("cron next run is strictly in the future", () => {
                const now = new Date();
                const r = planSchedule({ cron: "*/5 * * * *" }, null, now);
                expect(r.ok).toBe(true);
                if (r.ok) expect(r.nextRunAt).toBeGreaterThan(now.getTime());
        });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("createAutomation", () => {
        test("happy path — cron row lands with the full shape", () => {
                const r = createAutomation({ title: "  weekday brief  ", prompt: " do the thing ", workspace: WORKSPACE, schedule: { cron: "0 9 * * 1-5" } });
                expect(r.ok).toBe(true);
                if (!r.ok) return;
                track(r);
                expect(r.automation.title).toBe("weekday brief"); // trimmed
                expect(r.automation.prompt).toBe("do the thing");
                expect(r.automation.cron_expr).toBe("0 9 * * 1-5");
                expect(r.automation.delay_ms).toBeNull();
                expect(r.automation.mode).toBe("read-only"); // the default trust posture
                expect(r.automation.lifecycle).toBe("active");
                expect(r.automation.running).toBe(0);
                expect(r.automation.dispatch_status).toBe("idle");
                expect(r.automation.next_run_at).toBeGreaterThan(Date.now());
        });
        test("one-shot delay row", () => {
                const r = createAutomation({ title: "once", prompt: "p", workspace: WORKSPACE, schedule: { delayMinutes: 60 } });
                expect(r.ok).toBe(true);
                if (!r.ok) return;
                track(r);
                expect(r.automation.cron_expr).toBeNull();
                expect(r.automation.delay_ms).toBeGreaterThan(Date.now());
        });
        test("validation: title/prompt/workspace/schedule", () => {
                expect(createAutomation({ title: "", prompt: "p", workspace: WORKSPACE, schedule: { cron: "* * * * *" } })).toMatchObject({ ok: false, status: 400 });
                expect(createAutomation({ title: "t", prompt: "", workspace: WORKSPACE, schedule: { cron: "* * * * *" } })).toMatchObject({ ok: false, status: 400 });
                expect(createAutomation({ title: "t", prompt: "p", workspace: "/nonexistent-ws-xyz", schedule: { cron: "* * * * *" } })).toMatchObject({ ok: false, status: 400 });
                expect(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { cron: "nope" } })).toMatchObject({ ok: false, status: 400 });
        });
        test("the 20-automation create limit (zcode AUTOMATION_CREATE_LIMIT)", () => {
                // Count what exists (other tests in this file may have rows alive).
                const existing = store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM automations`)!.c;
                const filler: string[] = [];
                for (let i = existing; i < AUTOMATION_CREATE_LIMIT; i++) {
                        const r = createAutomation({ title: `filler ${i}`, prompt: "p", workspace: WORKSPACE, schedule: { cron: "0 3 * * *" } });
                        expect(r.ok).toBe(true);
                        if (r.ok) filler.push(r.automation.id);
                }
                try {
                        const over = createAutomation({ title: "one too many", prompt: "p", workspace: WORKSPACE, schedule: { cron: "0 3 * * *" } });
                        expect(over.ok).toBe(false);
                        if (!over.ok) {
                                expect(over.status).toBe(400);
                                expect(over.error).toContain("limit");
                        }
                } finally {
                        for (const id of filler) {
                                store.run(`DELETE FROM automations WHERE id = ?`, [id]);
                                store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
                        }
                }
        });
});

describe("updateAutomation", () => {
        test("patch title/prompt and re-arm on cron change", async () => {
                const row = track(createAutomation({ title: "old", prompt: "old p", workspace: WORKSPACE, schedule: { cron: "0 9 * * 1-5" } }) as any);
                const next = await updateAutomation(row.id, { title: "new", prompt: "new p", cron: "30 8 * * *" });
                expect(next.ok).toBe(true);
                if (!next.ok) return;
                expect(next.automation.title).toBe("new");
                expect(next.automation.cron_expr).toBe("30 8 * * *");
                expect(next.automation.next_run_at).toBeGreaterThan(Date.now());
        });
        test("pause → resume re-arms next_run_at from now", async () => {
                const row = track(createAutomation({ title: "p", prompt: "p", workspace: WORKSPACE, schedule: { cron: "* * * * *" } }) as any);
                const paused = await updateAutomation(row.id, { lifecycle: "paused" });
                expect(paused.ok && paused.automation.lifecycle).toBe("paused");
                const before = Date.now();
                const resumed = await updateAutomation(row.id, { lifecycle: "active" });
                expect(resumed.ok).toBe(true);
                if (resumed.ok) {
                        expect(resumed.automation.lifecycle).toBe("active");
                        // every-minute cron from now: the re-arm is within ~2 minutes
                        expect(resumed.automation.next_run_at!).toBeGreaterThan(before);
                        expect(resumed.automation.next_run_at! - before).toBeLessThanOrEqual(2 * 60_000);
                }
        });
        test("completed is terminal", async () => {
                const row = track(createAutomation({ title: "done", prompt: "p", workspace: WORKSPACE, schedule: { delayMinutes: 5 } }) as any);
                store.run(`UPDATE automations SET lifecycle = 'completed' WHERE id = ?`, [row.id]);
                const r = await updateAutomation(row.id, { lifecycle: "active" });
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.status).toBe(400);
        });
        test("unknown id → 404", async () => {
                const r = await updateAutomation("auto-does-not-exist", { title: "x" });
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.status).toBe(404);
        });
        test("delete removes the row and its settled runs", async () => {
                const row = track(createAutomation({ title: "gone", prompt: "p", workspace: WORKSPACE, schedule: { delayMinutes: 5 } }) as any);
                expect(deleteAutomation(row.id)).toBe(true);
                expect(getAutomation(row.id)).toBeNull(); // store.get's not-found shape
                expect(deleteAutomation(row.id)).toBe(false); // idempotent-second-delete
                created.splice(created.indexOf(row.id), 1);
        });
});

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

describe("AutomationsScheduler", () => {
        test("a due automation dispatches exactly once (single-flight claim)", async () => {
                const gate = gatedDispatcher();
                const s = new AutomationsScheduler(gate.dispatch, 60_000);
                const row = dueAutomation({ cron: "*/5 * * * *" });
                await s.tick();
                await s.tick(); // second tick while in flight: no second dispatch
                expect(gate.dispatched).toEqual([row.id]);
                const runs = listRuns(row.id);
                expect(runs).toHaveLength(1);
                expect(runs[0].status).toBe("running");
                gate.release();
                await new Promise((r) => setTimeout(r, 20));
                s.stop();
                const done = listRuns(row.id);
                expect(done[0].status).toBe("succeeded");
                expect(done[0].output).toContain("ran ");
                expect(done[0].turns).toBe(2);
                // run_count bumped, next slot armed in the future
                const after = getAutomation(row.id)!;
                expect(after.run_count).toBe(1);
                expect(after.next_run_at!).toBeGreaterThan(Date.now());
        });

        test("concurrency cap: a third due automation waits for a free slot", async () => {
                const gate = gatedDispatcher();
                const s = new AutomationsScheduler(gate.dispatch, 60_000);
                const a = dueAutomation({ cron: "*/5 * * * *" });
                const b = dueAutomation({ cron: "*/5 * * * *" });
                const c = dueAutomation({ cron: "*/5 * * * *" });
                await s.tick();
                expect(gate.dispatched.length).toBe(MAX_CONCURRENT_AUTOMATION_RUNS);
                expect(gate.dispatched).toContain(a.id);
                expect(gate.dispatched).toContain(b.id);
                expect(gate.dispatched).not.toContain(c.id); // still waiting
                gate.release();
                await new Promise((r) => setTimeout(r, 20));
                await s.tick(); // c's turn
                expect(gate.dispatched).toContain(c.id);
                await new Promise((r) => setTimeout(r, 20));
                s.stop();
        });

        test("misfire grace: an attempt older than 5 minutes is SKIPPED, never replayed", async () => {
                const dispatcher = async () => {
                        throw new Error("must not dispatch a misfired slot");
                };
                const s = new AutomationsScheduler(dispatcher, 60_000);
                const row = dueAutomation({ cron: "*/5 * * * *" });
                // Bend the slot 6 minutes into the past.
                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 6 * 60_000 - 1000, row.id]);
                await s.tick();
                s.stop();
                const runs = listRuns(row.id);
                expect(runs).toHaveLength(1);
                expect(runs[0].status).toBe("skipped");
                expect(runs[0].error).toContain("asleep");
                const after = getAutomation(row.id)!;
                expect(after.next_run_at!).toBeGreaterThan(Date.now()); // rescheduled forward
        });

        test("a misfired ONE-SHOT completes instead of rescheduling", async () => {
                const dispatcher = async () => {
                        throw new Error("must not dispatch a misfired slot");
                };
                const s = new AutomationsScheduler(dispatcher, 60_000);
                const row = dueAutomation({ delayMinutes: 10 });
                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 6 * 60_000 - 1000, row.id]);
                await s.tick();
                s.stop();
                const after = getAutomation(row.id)!;
                expect(after.lifecycle).toBe("completed");
                expect(after.next_run_at).toBeNull();
        });

        // ------------------------------------------------------------------
        // M9: launchd-style catch-up-once (UNOWN_AUTOMATION_MISFIRE_CATCHUP=1)
        // + env-tunable grace (PI_AUTOMATION_MISFIRE_GRACE_MS)
        // ------------------------------------------------------------------
        const MISFIRE_ENV = ["UNOWN_AUTOMATION_MISFIRE_CATCHUP", "PI_AUTOMATION_MISFIRE_GRACE_MS"];
        function withMisfireEnv(overrides: Record<string, string>, fn: () => Promise<void> | void): Promise<void> | void {
                const saved: Record<string, string | undefined> = {};
                for (const k of MISFIRE_ENV) saved[k] = process.env[k];
                try {
                        for (const k of MISFIRE_ENV) delete process.env[k];
                        for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
                        return fn();
                } finally {
                        for (const k of MISFIRE_ENV) {
                                if (saved[k] === undefined) delete process.env[k];
                                else process.env[k] = saved[k];
                        }
                }
        }

        test("catch-up ON: a slot missed by hours runs ONCE (coalesced), rescheduled from now", async () => {
                await withMisfireEnv({ UNOWN_AUTOMATION_MISFIRE_CATCHUP: "1" }, async () => {
                        let dispatched = 0;
                        const s = new AutomationsScheduler(async () => {
                                dispatched++;
                                return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                        }, 60_000);
                        const row = dueAutomation({ cron: "*/5 * * * *" });
                        try {
                                // 3 hours asleep — past the grace, well inside the 24h horizon
                                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 3 * 60 * 60_000, row.id]);
                                const before = Date.now();
                                await s.tick();
                                // executeClaimed is fire-and-forget (void …): wait for the
                                // in-flight run to finish before asserting on its bookkeeping
                                const deadline = Date.now() + 5_000;
                                while (schedulerInFlight(s).length > 0 && Date.now() < deadline) {
                                        await new Promise((r) => setTimeout(r, 25));
                                }
                                s.stop();
                                expect(dispatched).toBe(1); // ONCE — never N replays
                                const after = getAutomation(row.id)!;
                                // rescheduled FROM the tick (assert against a pre-tick
                                // timestamp — Date.now() at assert time has moved on)
                                expect(after.next_run_at!).toBeGreaterThan(before);
                                const runs = listRuns(row.id);
                                expect(runs.some((r) => r.status === "skipped")).toBe(false);
                        } finally {
                                store.run(`DELETE FROM automations WHERE id = ?`, [row.id]); // hot-path cleanup (20-row cap)
                        }
                });
        });

        test("catch-up OFF (default): the same missed slot is skipped with the asleep reason — unchanged behavior", async () => {
                await withMisfireEnv({}, async () => {
                        const s = new AutomationsScheduler(async () => {
                                throw new Error("must not dispatch a misfired slot");
                        }, 60_000);
                        const row = dueAutomation({ cron: "*/5 * * * *" });
                        try {
                                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 3 * 60 * 60_000, row.id]);
                                await s.tick();
                                s.stop();
                                const runs = listRuns(row.id);
                                expect(runs).toHaveLength(1);
                                expect(runs[0].status).toBe("skipped");
                                expect(runs[0].error).toContain("asleep");
                        } finally {
                                store.run(`DELETE FROM automations WHERE id = ?`, [row.id]); // hot-path cleanup (20-row cap)
                        }
                });
        });

        test("catch-up ON but lag beyond 24h: cron slots still skip (launchd coalesces a night, not a month)", async () => {
                await withMisfireEnv({ UNOWN_AUTOMATION_MISFIRE_CATCHUP: "1" }, async () => {
                        const s = new AutomationsScheduler(async () => {
                                throw new Error("must not dispatch a month-old slot");
                        }, 60_000);
                        const row = dueAutomation({ cron: "*/5 * * * *" });
                        try {
                                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 3 * 24 * 60 * 60_000, row.id]);
                                await s.tick();
                                s.stop();
                                const runs = listRuns(row.id);
                                expect(runs[0].status).toBe("skipped");
                        } finally {
                                store.run(`DELETE FROM automations WHERE id = ?`, [row.id]);
                        }
                });
        });

        test("catch-up ON: a missed ONE-SHOT within 24h still completes without replay", async () => {
                await withMisfireEnv({ UNOWN_AUTOMATION_MISFIRE_CATCHUP: "1" }, async () => {
                        let dispatched = 0;
                        const s = new AutomationsScheduler(async () => {
                                dispatched++;
                                return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                        }, 60_000);
                        const row = dueAutomation({ delayMinutes: 10 });
                        try {
                                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 3 * 60 * 60_000, row.id]);
                                await s.tick();
                                // one-shot completion bookkeeping happens after the
                                // dispatcher resolves (executeClaimed's post-run
                                // reschedule is async) — poll for it, bounded
                                const deadline = Date.now() + 5_000;
                                let after = getAutomation(row.id)!;
                                while (after.lifecycle === "active" && Date.now() < deadline) {
                                        await new Promise((r) => setTimeout(r, 25));
                                        after = getAutomation(row.id)!;
                                }
                                s.stop();
                                expect(dispatched).toBeLessThanOrEqual(1);
                                expect(after.lifecycle).toBe("completed"); // one-shots complete either way
                                expect(after.next_run_at).toBeNull();
                        } finally {
                                store.run(`DELETE FROM automations WHERE id = ?`, [row.id]);
                        }
                });
        });

        test("PI_AUTOMATION_MISFIRE_GRACE_MS widens the window: a 10-min-old slot is NOT a misfire at 15min grace", async () => {
                await withMisfireEnv({ PI_AUTOMATION_MISFIRE_GRACE_MS: String(15 * 60_000) }, async () => {
                        let dispatched = 0;
                        const s = new AutomationsScheduler(async () => {
                                dispatched++;
                                return { exitCode: 0, output: "ok", turns: 1, tokensIn: 1, tokensOut: 1 };
                        }, 60_000);
                        const row = dueAutomation({ cron: "*/5 * * * *" });
                        try {
                                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 10 * 60_000, row.id]);
                                await s.tick();
                                s.stop();
                                expect(dispatched).toBe(1); // inside the widened grace → normal dispatch
                                const runs = listRuns(row.id);
                                expect(runs.some((r) => r.status === "skipped")).toBe(false);
                        } finally {
                                store.run(`DELETE FROM automations WHERE id = ?`, [row.id]);
                        }
                });
        });

        test("dispatch failure → retry with backoff, frozen run id, exhausted after 5 attempts", async () => {
                let attempts = 0;
                const dispatcher = async () => {
                        attempts++;
                        throw new Error(`boom ${attempts}`);
                };
                const s = new AutomationsScheduler(dispatcher, 60_000);
                const row = dueAutomation({ cron: "*/5 * * * *" });
                const slot = getAutomation(row.id)!.next_run_at!;
                // Attempt 1..
                await s.tick();
                let a = getAutomation(row.id)!;
                expect(a.dispatch_status).toBe("retry");
                expect(a.dispatch_attempts).toBe(1);
                expect(a.retry_at!).toBeGreaterThan(Date.now()); // 30s backoff
                expect(a.running).toBe(0);
                expect(listRuns(row.id)).toHaveLength(1); // frozen run id: ONE row for the slot
                expect(listRuns(row.id)[0].status).toBe("failed");
                // Attempts 2..5 — force each backoff elapsed. (At n=5 the counter is
                // already reset to 0 by the exhausted branch — asserted post-loop.)
                for (let n = 2; n <= 5; n++) {
                        store.run(`UPDATE automations SET retry_at = ? WHERE id = ?`, [Date.now() - 1000, row.id]);
                        await s.tick();
                        a = getAutomation(row.id)!;
                        if (n < 5) expect(a.dispatch_attempts).toBe(n);
                }
                expect(attempts).toBe(5);
                // Exhausted: recurring → idle, rescheduled forward, attempt counter reset.
                expect(a.dispatch_status).toBe("idle");
                expect(a.dispatch_attempts).toBe(0);
                expect(a.retry_at).toBeNull();
                expect(a.next_run_at!).toBeGreaterThan(Date.now());
                // The retry chain reused ONE run record for the frozen slot.
                expect(listRuns(row.id)).toHaveLength(1);
                expect(listRuns(row.id)[0].scheduled_at).toBe(slot);
                expect(listRuns(row.id)[0].error).toContain("dispatch attempt 5");
                s.stop();
        });

        test("maxRuns finalizes the automation after the last scheduled run", async () => {
                const gate = gatedDispatcher();
                const s = new AutomationsScheduler(gate.dispatch, 60_000);
                const row = dueAutomation({ cron: "*/5 * * * *" }, { maxRuns: 2 });
                // Run 1.
                await s.tick();
                gate.release();
                await new Promise((r) => setTimeout(r, 20));
                expect(getAutomation(row.id)!.scheduled_run_count).toBe(1);
                expect(getAutomation(row.id)!.lifecycle).toBe("active");
                // Run 2 (bend the next slot due again).
                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 1000, row.id]);
                await s.tick();
                gate.release();
                await new Promise((r) => setTimeout(r, 20));
                const after = getAutomation(row.id)!;
                expect(after.scheduled_run_count).toBe(2);
                expect(after.run_count).toBe(2);
                expect(after.lifecycle).toBe("completed");
                expect(after.next_run_at).toBeNull();
                s.stop();
        });

        test("one-shot completes after its single run", async () => {
                const gate = gatedDispatcher();
                const s = new AutomationsScheduler(gate.dispatch, 60_000);
                const row = dueAutomation({ delayMinutes: 10 });
                await s.tick();
                gate.release();
                await new Promise((r) => setTimeout(r, 20));
                const after = getAutomation(row.id)!;
                expect(after.lifecycle).toBe("completed");
                expect(after.run_count).toBe(1);
                expect(after.next_run_at).toBeNull();
                s.stop();
        });

        test("runNow: manual trigger works and rejects while a run is in progress (409)", async () => {
                const gate = gatedDispatcher();
                const s = new AutomationsScheduler(gate.dispatch, 60_000);
                const row = dueAutomation({ cron: "*/5 * * * *" }, { maxRuns: 1 });
                // Manual while idle: ok.
                const first = await s.runNow(row.id);
                expect(first.ok).toBe(true);
                // Manual while running: 409.
                const second = await s.runNow(row.id);
                expect(second.ok).toBe(false);
                if (!second.ok) expect(second.status).toBe(409);
                // The scheduled slot firing while manually running: skipped by the claim.
                const ticked = await s.tick();
                expect(ticked).toBeUndefined();
                gate.release();
                await new Promise((r) => setTimeout(r, 20));
                // Manual runs do NOT consume maxRuns (zcode contract).
                const after = getAutomation(row.id)!;
                expect(after.scheduled_run_count).toBe(0);
                expect(after.run_count).toBe(1);
                const runs = listRuns(row.id);
                expect(runs.some((r) => r.trigger_kind === "manual" && r.status === "succeeded")).toBe(true);
                s.stop();
        });

        test("read-only mode is the default; standard must be explicit", () => {
                const ro = track(createAutomation({ title: "ro", prompt: "p", workspace: WORKSPACE, schedule: { cron: "0 9 * * 1-5" } }) as any);
                expect(ro.mode).toBe("read-only");
                const bad = createAutomation({ title: "x", prompt: "p", workspace: WORKSPACE, schedule: { cron: "0 9 * * 1-5" }, mode: "root" as any });
                expect(bad.ok).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// The in-session trust gate (tools.ts)
// ---------------------------------------------------------------------------

/** Collect the tool names the session extensions register for a given env.
 *  Env is set BEFORE createUnownToolsExtension — isSubagent is captured at
 *  creation time, while isAutomationRun is read at factory time; both must
 *  see their flag. Mirrors cli.ts bootRuntime: tools + addons together
 *  (the todo tool lives in the addons extension since the rpiv port). */
function registeredToolNames(env: Record<string, string | undefined>): string[] {
        const names: string[] = [];
        const saved: Array<[string, string | undefined]> = Object.entries(env).map(([k]) => [k, process.env[k]]);
        for (const [k, v] of Object.entries(env)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
        }
        try {
                const ext = createUnownToolsExtension({ cwd: WORKSPACE, engineUrl: "http://127.0.0.1:9" });
                const addons = createUnownAddonsExtension({ cwd: WORKSPACE });
                const pi: any = {
                        on: () => {},
                        registerCommand: () => {},
                        registerFlag: () => {},
                        registerTool: (t: { name: string }) => names.push(t.name),
                        registerShortcut: () => {},
                        registerMessageRenderer: () => {},
                        appendEntry: () => {},
                        getFlag: () => undefined,
                        getActiveTools: () => ["read", "bash", "edit", "write"],
                        setActiveTools: () => {},
                        sendMessage: () => {},
                };
                ext.factory(pi);
                addons.factory(pi);
        } finally {
                for (const [k, v] of saved) {
                        if (v === undefined) delete process.env[k];
                        else process.env[k] = v;
                }
        }
        return names;
}

describe("automation session tools — the trust gate", () => {
        test("default session: list + create/update/delete all registered", () => {
                const names = registeredToolNames({ UNOWN_AUTOMATION: undefined, UNOWN_SUBAGENT: undefined });
                expect(names).toContain("automation_list");
                expect(names).toContain("automation_create");
                expect(names).toContain("automation_update");
                expect(names).toContain("automation_delete");
                expect(names).toContain("task");
        });
        test("inside an automation run (UNOWN_AUTOMATION=1): ONLY automation_list survives", () => {
                const names = registeredToolNames({ UNOWN_AUTOMATION: "1", UNOWN_SUBAGENT: undefined });
                expect(names).toContain("automation_list");
                expect(names).not.toContain("automation_create");
                expect(names).not.toContain("automation_update");
                expect(names).not.toContain("automation_delete");
                // `task` stays REGISTERED in an automation run (a standard-mode run may
                // use subagents; subagents inherit UNOWN_AUTOMATION=1, so they cannot
                // mutate automations either). READ-ONLY runs exclude it not here but
                // through the --tools allowlist — pinned below.
                expect(names).toContain("task");
        });
        test("inside a subagent (UNOWN_SUBAGENT=1): automation mutations hidden too", () => {
                const names = registeredToolNames({ UNOWN_AUTOMATION: undefined, UNOWN_SUBAGENT: "1" });
                expect(names).toContain("automation_list");
                expect(names).not.toContain("automation_create");
                expect(names).not.toContain("automation_delete");
        });
        test("UNOWN_AUTOMATION accepts 1/true case-insensitively", () => {
                expect(registeredToolNames({ UNOWN_AUTOMATION: "TRUE" })).not.toContain("automation_create");
                expect(registeredToolNames({ UNOWN_AUTOMATION: "yes" })).toContain("automation_create"); // not a truthy spelling
        });

        test("READ_ONLY_TOOLS excludes every mutation + escape hatch (the --tools allowlist IS the read-only story)", () => {
                const allow = READ_ONLY_TOOLS.split(",");
                // no shell, no writes/edits
                for (const banned of ["bash", "powershell", "edit", "write", "task"]) {
                        expect(allow).not.toContain(banned);
                }
                // the reading + reporting set the unattended agent needs
                // (web_search/webfetch: read-only network reads, same
                // classification plan mode gives them — an unattended
                // "morning brief" automation needs the web)
                for (const needed of ["read", "grep", "find", "ls", "todo", "note", "fetch_url", "web_search", "webfetch", "lsp"]) {
                        expect(allow).toContain(needed);
                }
                // every name must be a real tool (a typo here would silently widen the run)
                const known = [...registeredToolNames({}), "read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];
                for (const t of allow) expect(known).toContain(t);
        });
});

// ---------------------------------------------------------------------------
// apiRequestBody — the HTTP layer's body gate (live-E2E regression)
// ---------------------------------------------------------------------------
// The engine's fetch handler parsed JSON bodies for POST only, so every
// PATCH route (automations edit/pause/resume, memory rollback, job toggles)
// received body = null and answered "nothing to update" — while these unit
// suites stayed green because they call handleApi() directly with the body
// already parsed. Found by live E2E (`unown automations pause` -> 400 against
// the real engine); these tests pin the extracted gate itself.
// ---------------------------------------------------------------------------
describe("apiRequestBody (the HTTP body gate)", () => {
        test("PATCH bodies parse (automations pause/resume/edit depend on this)", async () => {
                const req = new Request("http://engine/api/automations/auto-x", {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ lifecycle: "paused" }),
                });
                expect(await apiRequestBody(req)).toEqual({ lifecycle: "paused" });
        });

        test("POST bodies parse", async () => {
                const req = new Request("http://engine/api/automations", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ title: "t", prompt: "p", delayMinutes: 5 }),
                });
                expect(await apiRequestBody(req)).toEqual({ title: "t", prompt: "p", delayMinutes: 5 });
        });

        test("body-less methods (GET/HEAD/OPTIONS) never parse", async () => {
                for (const method of ["GET", "HEAD", "OPTIONS"]) {
                        const req = new Request("http://engine/api/automations", { method });
                        expect(await apiRequestBody(req)).toBeNull();
                }
        });

        test("invalid JSON parses as null, not a throw (a stray body cannot 500 the route)", async () => {
                const req = new Request("http://engine/api/automations", {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: "not-json{",
                });
                expect(await apiRequestBody(req)).toBeNull();
        });
});

// ---------------------------------------------------------------------------
// automations CLI — runAutomationsCommand (live-E2E regression: list --all)
// ---------------------------------------------------------------------------
// `list --all` used to filter with `!hasFlag(--all) && workspace === cwd` —
// always false under --all — and its empty-hint early return was also
// --all-gated, so the flag printed NOTHING on a machine with automations
// configured. Found by live E2E; pinned here against a stubbed engine.
// ---------------------------------------------------------------------------
describe("automations CLI (runAutomationsCommand against a stubbed engine)", () => {
        /** REST list rows for the stubbed engine: one in WORKSPACE, one in OTHER_WS. */
        const stubRows = [
                {
                        id: "auto-cli-a",
                        title: "in this workspace",
                        workspace: WORKSPACE,
                        cron_expr: "0 9 * * 1-5",
                        schedule: "9:00 AM on weekdays",
                        mode: "read-only",
                        lifecycle: "active",
                        run_count: 0,
                        next_run_at: Date.now() + 3_600_000,
                        lastRun: null,
                },
                {
                        id: "auto-cli-b",
                        title: "elsewhere",
                        workspace: OTHER_WS,
                        cron_expr: null,
                        schedule: "one-shot",
                        mode: "standard",
                        lifecycle: "paused",
                        run_count: 1,
                        next_run_at: null,
                        lastRun: null,
                },
        ];

        /** Install a fetch stub answering GET /api/automations with the rows. */
        function stubEngine(rows: unknown[]): () => void {
                const orig = globalThis.fetch;
                globalThis.fetch = (async () =>
                        new Response(JSON.stringify({ automations: rows }), {
                                status: 200,
                                headers: { "content-type": "application/json" },
                        })) as typeof fetch;
                return () => {
                        globalThis.fetch = orig;
                };
        }

        test("list --all prints automations from EVERY workspace (regression: printed nothing)", async () => {
                const restore = stubEngine(stubRows);
                try {
                        const res = await runAutomationsCommand(["list", "--all"], { cwd: WORKSPACE });
                        expect(res.exitCode).toBe(0);
                        expect(res.stdout).toContain("auto-cli-a");
                        expect(res.stdout).toContain("auto-cli-b"); // the --all contract: foreign rows included
                } finally {
                        restore();
                }
        });

        test("plain list shows only this workspace's rows", async () => {
                const restore = stubEngine(stubRows);
                try {
                        const res = await runAutomationsCommand(["list"], { cwd: WORKSPACE });
                        expect(res.exitCode).toBe(0);
                        expect(res.stdout).toContain("auto-cli-a");
                        expect(res.stdout).not.toContain("auto-cli-b");
                } finally {
                        restore();
                }
        });

        test("plain list from a foreign cwd prints the filtered hint with the TOTAL count", async () => {
                const foreign = mkdtempSync(join(tmpdir(), "unown-auto-foreign-"));
                const restore = stubEngine(stubRows);
                try {
                        const res = await runAutomationsCommand(["list"], { cwd: foreign });
                        expect(res.exitCode).toBe(0);
                        expect(res.stdout).toContain("No automations in this project");
                        expect(res.stdout).toContain("2 filtered"); // both rows exist, neither is this cwd's
                        expect(res.stdout).toContain("--all");
                } finally {
                        restore();
                        rmSync(foreign, { recursive: true, force: true });
                }
        });

        test("empty engine + --all still prints the onboarding hint, not silence", async () => {
                const foreign = mkdtempSync(join(tmpdir(), "unown-auto-empty-"));
                const restore = stubEngine([]);
                try {
                        const res = await runAutomationsCommand(["list", "--all"], { cwd: foreign });
                        expect(res.exitCode).toBe(0);
                        expect(res.stdout).toContain("No automations yet");
                } finally {
                        restore();
                        rmSync(foreign, { recursive: true, force: true });
                }
        });
});

// ---------------------------------------------------------------------------
// Routines v2 — kinds, boundaries, skip/snooze, per-row misfire, concurrency
// ---------------------------------------------------------------------------

/** Hot-path cleanup (the 20-row cap bites mid-file; afterAll is too late). */
function cleanupRoutine(id: string): void {
        try {
                store.run(`DELETE FROM automations WHERE id = ?`, [id]);
                store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
        } catch {
                /* best effort */
        }
        const i = created.indexOf(id);
        if (i >= 0) created.splice(i, 1);
}

describe("routines v2 — creation + kinds", () => {
        beforeAll(() => {
                // The file's earlier describes leave rows behind (afterAll is too
                // late for the 20-row cap) — start this section from a clean slate.
                store.run(`DELETE FROM automations`);
                store.run(`DELETE FROM automation_runs`);
        });

        test("every 2d at 09:00 in a timezone lands the normalized columns", () => {
                const r = createAutomation({
                        title: "bi-daily standup digest",
                        prompt: "summarize commits",
                        workspace: WORKSPACE,
                        schedule: { every: "2d at 09:00" },
                        timezone: "America/New_York",
                        misfire: "catch-up",
                });
                expect(r.ok).toBe(true);
                if (!r.ok) return;
                track(r);
                expect(r.automation.schedule_kind).toBe("every");
                expect(r.automation.interval_n).toBe(2);
                expect(r.automation.interval_unit).toBe("d");
                expect(r.automation.interval_at).toBe("09:00");
                expect(r.automation.timezone).toBe("America/New_York");
                expect(r.automation.misfire).toBe("catch-up");
                cleanupRoutine(r.automation.id);
        });
        test("after 45m arms 45m out and records the kind", () => {
                const r = createAutomation({
                        title: "regen check",
                        prompt: "check",
                        workspace: WORKSPACE,
                        schedule: { after: "45m" },
                });
                expect(r.ok).toBe(true);
                if (!r.ok) return;
                track(r);
                expect(r.automation.schedule_kind).toBe("after");
                expect(r.automation.next_run_at).toBeGreaterThan(Date.now() + 44 * 60_000);
                cleanupRoutine(r.automation.id);
        });
        test("conflicting schedule inputs are rejected", () => {
                const r = createAutomation({
                        title: "x",
                        prompt: "x",
                        workspace: WORKSPACE,
                        schedule: { every: "2d", cron: "0 9 * * *" },
                });
                expect(r).toMatchObject({ ok: false });
        });
        test("unknown timezone is rejected with the IANA hint", () => {
                const r = createAutomation({
                        title: "x",
                        prompt: "x",
                        workspace: WORKSPACE,
                        schedule: { every: "2d" },
                        timezone: "Mars/Olympus",
                });
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.error).toContain("America/New_York");
        });
        test("until before the first occurrence is rejected", () => {
                const r = createAutomation({
                        title: "x",
                        prompt: "x",
                        workspace: WORKSPACE,
                        schedule: { every: "1d" },
                        untilMs: Date.now() - 1000,
                });
                expect(r).toMatchObject({ ok: false });
        });
        test("misfire validation", () => {
                const r = createAutomation({
                        title: "x",
                        prompt: "x",
                        workspace: WORKSPACE,
                        schedule: { every: "1d" },
                        misfire: "backfill" as any,
                });
                expect(r).toMatchObject({ ok: false });
        });
        test("legacy rows (no kind) infer cron/once and keep working", () => {
                const r = createAutomation({ title: "legacy cron", prompt: "p", workspace: WORKSPACE, schedule: { cron: "0 9 * * *" } });
                expect(r.ok).toBe(true);
                if (!r.ok) return;
                track(r);
                expect(r.automation.schedule_kind).toBe("cron"); // normalized at insert
                cleanupRoutine(r.automation.id);
        });
});

describe("routines v2 — updateAutomation with new fields", () => {
        test("schedule edits re-arm and switch kinds", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { cron: "0 9 * * *" } })!);
                const u = updateAutomation(r.id, { every: "3w at 08:30", timezone: "Europe/Berlin" });
                expect(u.ok).toBe(true);
                if (!u.ok) return;
                expect(u.automation.schedule_kind).toBe("every");
                expect(u.automation.interval_unit).toBe("w");
                expect(u.automation.interval_n).toBe(3);
                expect(u.automation.timezone).toBe("Europe/Berlin");
                expect(u.automation.next_run_at).toBeGreaterThan(Date.now());
                cleanupRoutine(r.id);
        });
        test("until + misfire + maxRuns edits validate", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                expect(updateAutomation(r.id, { misfire: "weird" as any })).toMatchObject({ ok: false });
                const u = updateAutomation(r.id, { until_ms: Date.now() + 90 * 86_400_000, misfire: "catch-up" });
                expect(u.ok).toBe(true);
                // A PAST until ends the routine instead of erroring (the
                // "stop after today" flow): the pending slot is past the boundary.
                const ended = updateAutomation(r.id, { until_ms: Date.now() - 5 });
                expect(ended.ok).toBe(true);
                if (ended.ok) expect(ended.automation.lifecycle).toBe("completed");
                cleanupRoutine(r.id);
        });
        test("resume re-arms an every-routine phase-preserving", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d at 09:00" } })!);
                expect(updateAutomation(r.id, { lifecycle: "paused" })).toMatchObject({ ok: true });
                // Bend the stale slot far into the past, then resume: the next
                // slot must be a future 09:00 (same phase, not re-anchored).
                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 20 * 86_400_000, r.id]);
                const u = updateAutomation(r.id, { lifecycle: "active" });
                expect(u.ok).toBe(true);
                if (!u.ok) return;
                expect(u.automation.next_run_at).toBeGreaterThan(Date.now());
                expect(u.automation.next_run_at! - Date.now()).toBeLessThan(2 * 86_400_000);
                cleanupRoutine(r.id);
        });
});

describe("routines v2 — skip + snooze", () => {
        test("skip records a skipped run and advances one slot", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d at 09:00" } })!);
                const before = getAutomation(r.id)!.next_run_at!;
                const s = skipNextOccurrence(r.id);
                expect(s.ok).toBe(true);
                if (!s.ok) return;
                expect(s.automation.next_run_at).toBe(before + 86_400_000); // exactly one slot later (local wall-clock)
                const runs = listRuns(r.id);
                expect(runs.some((x) => x.status === "skipped" && x.error === "skipped_by_user")).toBe(true);
                cleanupRoutine(r.id);
        });
        test("skipping a one-shot completes it", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { delayMinutes: 30 } })!);
                const s = skipNextOccurrence(r.id);
                expect(s.ok).toBe(true);
                if (!s.ok) return;
                expect(s.automation.lifecycle).toBe("completed");
                cleanupRoutine(r.id);
        });
        test("skip refuses non-active routines", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                updateAutomation(r.id, { lifecycle: "paused" });
                expect(skipNextOccurrence(r.id)).toMatchObject({ ok: false });
                cleanupRoutine(r.id);
        });
        test("snooze pushes next_run_at by N minutes, bounded by until", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                const before = getAutomation(r.id)!.next_run_at!;
                const s = snoozeNextOccurrence(r.id, 30);
                expect(s.ok).toBe(true);
                if (!s.ok) return;
                expect(s.automation.next_run_at).toBe(before + 30 * 60_000);
                expect(snoozeNextOccurrence(r.id, 0)).toMatchObject({ ok: false });
                store.run(`UPDATE automations SET until_ms = ? WHERE id = ?`, [before + 45 * 60_000, r.id]);
                expect(snoozeNextOccurrence(r.id, 60)).toMatchObject({ ok: false });
                cleanupRoutine(r.id);
        });
});

describe("routines v2 — scheduler semantics per kind", () => {
        test("an every-1m routine runs on the tick and re-arms one minute out", async () => {
                const r = dueAutomation({ every: "1m" });
                const { dispatch, release, dispatched } = gatedDispatcher();
                const sched = new AutomationsScheduler(dispatch);
                await sched.tick();
                expect(dispatched).toContain(r.id);
                release();
                await Bun.sleep(20);
                const after = getAutomation(r.id)!;
                expect(after.next_run_at).toBeGreaterThan(Date.now());
                expect(after.next_run_at! - Date.now()).toBeLessThanOrEqual(60_000);
                cleanupRoutine(r.id);
        });
        test("an after-3m routine re-arms from the run's END, not its slot", async () => {
                const r = dueAutomation({ after: "3m" });
                const dispatch = async () => {
                        await Bun.sleep(50); // a run that takes 50ms
                        return { exitCode: 0, output: "done", turns: 1, tokensIn: 1, tokensOut: 1 };
                };
                const sched = new AutomationsScheduler(dispatch);
                const startAt = Date.now();
                await sched.tick();
                await Bun.sleep(120); // let the run finish
                const after = getAutomation(r.id)!;
                // next = completion (startAt+50ish) + 3m — NOT slot + 3m (slot is in the past)
                expect(after.next_run_at).toBeGreaterThan(startAt + 3 * 60_000 - 10);
                expect(after.next_run_at).toBeLessThan(Date.now() + 3 * 60_000 + 100);
                cleanupRoutine(r.id);
        });
        test("a manual run of an every-routine leaves the pending slot untouched", async () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d at 09:00" } })!);
                const pending = getAutomation(r.id)!.next_run_at!;
                const dispatch = async () => ({ exitCode: 0, output: "manual", turns: 1, tokensIn: 1, tokensOut: 1 });
                const sched = new AutomationsScheduler(dispatch);
                await sched.runNow(r.id);
                await Bun.sleep(30);
                expect(getAutomation(r.id)!.next_run_at).toBe(pending); // slot preserved
                cleanupRoutine(r.id);
        });
        test("per-row misfire=catch-up runs a missed slot; default skips it", async () => {
                // catch-up row
                const cu = track(createAutomation({ title: "catchup", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" }, misfire: "catch-up" })!);
                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 20 * 60_000, cu.id]); // lag 20m > 5m grace
                // default row
                const sk = track(createAutomation({ title: "skipper", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [Date.now() - 20 * 60_000, sk.id]);
                const dispatched: string[] = [];
                const dispatch = async (a: AutomationRow) => {
                        dispatched.push(a.id);
                        return { exitCode: 0, output: "x", turns: 0, tokensIn: 0, tokensOut: 0 };
                };
                const sched = new AutomationsScheduler(dispatch);
                await sched.tick();
                expect(dispatched).toContain(cu.id); // catch-up ran
                expect(dispatched).not.toContain(sk.id); // default skipped
                const skRuns = listRuns(sk.id);
                expect(skRuns.some((x) => x.status === "skipped" && x.error === "computer_asleep_or_engine_not_running")).toBe(true);
                await Bun.sleep(20);
                cleanupRoutine(cu.id);
                cleanupRoutine(sk.id);
        });
        test("runNow respects the engine-wide concurrency cap", async () => {
                const a1 = track(createAutomation({ title: "one", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                const a2 = track(createAutomation({ title: "two", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                const a3 = track(createAutomation({ title: "three", prompt: "p", workspace: WORKSPACE, schedule: { every: "1d" } })!);
                const { dispatch, release } = gatedDispatcher();
                const sched = new AutomationsScheduler(dispatch);
                expect((await sched.runNow(a1.id))).toMatchObject({ ok: true });
                expect((await sched.runNow(a2.id))).toMatchObject({ ok: true });
                const third = await sched.runNow(a3.id);
                expect(third.ok).toBe(false);
                if (!third.ok) expect(third.status).toBe(429);
                release();
                await Bun.sleep(20);
                cleanupRoutine(a1.id);
                cleanupRoutine(a2.id);
                cleanupRoutine(a3.id);
        });
        test("deleting a routine removes ALL its runs, running ones included", () => {
                const r = track(createAutomation({ title: "t", prompt: "p", workspace: WORKSPACE, schedule: { delayMinutes: 30 } })!);
                store.run(
                        `INSERT INTO automation_runs (id, automation_id, trigger_kind, status, started_at) VALUES (?, ?, 'schedule', 'running', ?)`,
                        ["fake-running", r.id, Date.now()],
                );
                expect(deleteAutomation(r.id)).toBe(true);
                expect(listRuns(r.id)).toHaveLength(0);
                created.splice(created.indexOf(r.id), 1);
        });
});
