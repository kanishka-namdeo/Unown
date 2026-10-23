// server-busy.test.ts — the engine-busy error contract (BUG 13, audit #13).
//
// The cycleTriggerGuard answers busy conflicts with a 409 payload
// ({error, reason, ...context}); Router.withBusy()/execute() throw the same
// conflict as a bare Error. Before the fix, every lane that raced the mutex
// answered differently: the AWAITED mint lane re-threw into the generic 500
// catch (a raw 500 for a normal busy conflict), and the FIRE-AND-FORGET lanes
// (tasks/:id/run, agent/prompt, dreams/run) had already answered
// {started:true} — the busy rejection only surfaced as a router:error SSE
// event while the client polled for a cycle that never ran.
//
// Pinned here:
//   1. the contract helpers themselves (isEngineBusyError / engineBusyResponse);
//   2. Router.startFireAndForget — the synchronous busy gate that replaces
//      the racy isBusy()-probe-then-withBusy pair on the fire-and-forget lanes;
//   3. handleApi end-to-end WITH THE MUTEX HELD: every busy lane answers the
//      SAME 409 shape — status 409, {error, reason: "engine-busy"} — never a
//      raw 500, never a false {started:true}.
//
// The engine is never booted: handleApi is called directly (the
// server-cors.test.ts pattern) against the redirected store, with the module
// router singleton's mutex held by a gated promise.
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";

import { engineBusyResponse, handleApi, isEngineBusyError } from "../src/server.ts";
import { Router, router } from "../src/router.ts";
import { store } from "../src/store.ts";

const REQ = {
        method: "POST",
        query: new URLSearchParams(),
        body: null as any,
};

async function bodyOf(res: Response): Promise<Record<string, any>> {
        return (await res.json()) as Record<string, any>;
}

// ---------------------------------------------------------------------------
// The contract helpers
// ---------------------------------------------------------------------------
describe("isEngineBusyError — one class, one contract", () => {
        test("recognizes both spellings of the mutex conflict (withBusy + execute)", () => {
                expect(isEngineBusyError(new Error("engine is busy with another job"))).toBe(true);
                expect(isEngineBusyError(new Error("router is busy with another job"))).toBe(true);
        });

        test("anything else is NOT a busy conflict — no fuzzy matching", () => {
                expect(isEngineBusyError(new Error("engine is busy-ish"))).toBe(false);
                expect(isEngineBusyError(new Error("unknown job: does-not-exist"))).toBe(false);
                expect(isEngineBusyError(new Error("watchdog: job dream-check exceeded 1200s"))).toBe(false);
                expect(isEngineBusyError("some other thrown string")).toBe(false);
                expect(isEngineBusyError(undefined)).toBe(false);
                expect(isEngineBusyError(null)).toBe(false);
                expect(isEngineBusyError({ message: "engine is busy with another job" })).toBe(false);
        });

        test("a thrown raw string carrying the exact busy message is recognized too — one class, however thrown", () => {
                // The exact-match rule (no fuzzy prefix/contains) is what keeps the
                // classifier honest; the raw-string case just means a non-Error throw
                // site still joins the contract.
                expect(isEngineBusyError("engine is busy with another job")).toBe(true);
                expect(isEngineBusyError("router is busy with another job")).toBe(true);
        });
});

describe("engineBusyResponse — the 409 shape every busy lane answers with", () => {
        test("status 409, JSON body with the guard's {error, reason} contract", async () => {
                const res = engineBusyResponse();
                expect(res.status).toBe(409);
                expect(res.headers.get("content-type")).toContain("application/json");
                const body = await bodyOf(res);
                expect(body.reason).toBe("engine-busy");
                expect(String(body.error)).toContain("engine is busy with another job");
        });
});

// ---------------------------------------------------------------------------
// Router.startFireAndForget — the synchronous busy gate (BUG 13)
// ---------------------------------------------------------------------------
describe("Router.startFireAndForget (fresh instance — the singleton is never touched here)", () => {
        test("idle: runs the work under the mutex and resolves with its value", async () => {
                const r = new Router();
                let busyInside = false;
                const p = r.startFireAndForget(async () => {
                        busyInside = r.isBusy();
                        return 42;
                });
                expect(r.isBusy()).toBe(true); // acquired synchronously, before any await
                await expect(p).resolves.toBe(42);
                expect(busyInside).toBe(true);
                expect(r.isBusy()).toBe(false);
        });

        test("busy: throws SYNCHRONOUSLY in the caller's tick — no rejected promise one microtask later", async () => {
                const r = new Router();
                let release!: () => void;
                const gate = new Promise<void>((res) => (release = res));
                const job = r.withBusy(() => gate.then(() => "done"));
                expect(() => r.startFireAndForget(async () => "never")).toThrow("engine is busy with another job");
                release();
                await expect(job).resolves.toBe("done");
        });

        test("the work's own async failure still rejects the returned promise (the router:error lane)", async () => {
                const r = new Router();
                await expect(r.startFireAndForget(() => Promise.reject(new Error("work exploded")))).rejects.toThrow("work exploded");
                expect(r.isBusy()).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// handleApi with the mutex held — every busy lane answers the same 409
// ---------------------------------------------------------------------------
describe("handleApi engine-busy lanes (mutex held on the module router singleton)", () => {
        const TASK = "busy-contract-task";
        const NOTE = "busy-contract-note";

        function seedFixtureRows() {
                store.run(`DELETE FROM cycles WHERE task_id = ?`, [TASK]);
                store.run(`DELETE FROM tasks WHERE id = ?`, [TASK]);
                store.run(
                        `INSERT INTO tasks (id, name, description, prompt, files, verify, created_at, active, pass_count, fail_count)
                         VALUES (?, 'Busy contract probe', 'D', 'P', '{}', 'x', ?, 1, 0, 0)`,
                        [TASK, Date.now()],
                );
                store.run(`DELETE FROM notes WHERE id = ?`, [NOTE]);
                store.run(`INSERT INTO notes (id, content, created_at) VALUES (?, 'probe note', ?)`, [NOTE, Date.now()]);
        }

        afterAll(() => {
                store.run(`DELETE FROM cycles WHERE task_id = ?`, [TASK]);
                store.run(`DELETE FROM tasks WHERE id = ?`, [TASK]);
                store.run(`DELETE FROM notes WHERE id = ?`, [NOTE]);
        });

        /** Hold the singleton's mutex for the duration of fn, then release. */
        async function withMutexHeld(fn: () => Promise<void>): Promise<void> {
                let release!: () => void;
                const gate = new Promise<void>((res) => (release = res));
                const job = router.withBusy(() => gate.then(() => "held"));
                try {
                        await fn();
                } finally {
                        release();
                        await job;
                }
        }

        test("POST /api/tasks/mint: the awaited withBusy race answers the 409 contract, not a raw 500", async () => {
                await withMutexHeld(async () => {
                        const res = await handleApi({ ...REQ, path: "/api/tasks/mint" });
                        expect(res.status).toBe(409);
                        const body = await bodyOf(res);
                        expect(body.reason).toBe("engine-busy");
                        expect(String(body.error)).toContain("engine is busy");
                });
        });

        test("POST /api/tasks/:id/run: the fire-and-forget race answers 409 — never a false {started:true}", async () => {
                seedFixtureRows();
                await withMutexHeld(async () => {
                        const res = await handleApi({ ...REQ, path: `/api/tasks/${TASK}/run` });
                        expect(res.status).toBe(409);
                        const body = await bodyOf(res);
                        expect(body.reason).toBe("engine-busy");
                        expect(body.started).toBeUndefined();
                        // And no cycle row was created for the task — the start genuinely failed
                        // (bun:sqlite's .get answers null for no rows).
                        expect(store.get(`SELECT id FROM cycles WHERE task_id = ?`, [TASK])).toBeNull();
                });
        });

        test("POST /api/agent/prompt: same 409 contract on the interactive lane", async () => {
                await withMutexHeld(async () => {
                        const res = await handleApi({ ...REQ, path: "/api/agent/prompt", body: { prompt: "hello" } });
                        expect(res.status).toBe(409);
                        const body = await bodyOf(res);
                        expect(body.reason).toBe("engine-busy");
                        expect(body.started).toBeUndefined();
                });
        });

        test("POST /api/dreams/run: same 409 contract on the dream lane", async () => {
                seedFixtureRows();
                await withMutexHeld(async () => {
                        const res = await handleApi({ ...REQ, path: "/api/dreams/run" });
                        expect(res.status).toBe(409);
                        const body = await bodyOf(res);
                        expect(body.reason).toBe("engine-busy");
                        expect(body.started).toBeUndefined();
                });
        });

        test("POST /api/jobs/:id/trigger: execute()'s busy conflict joins the same 409 shape", async () => {
                await withMutexHeld(async () => {
                        const res = await handleApi({ ...REQ, path: "/api/jobs/harness-cycle/trigger" });
                        expect(res.status).toBe(409);
                        const body = await bodyOf(res);
                        expect(body.reason).toBe("engine-busy");
                        expect(String(body.error)).toContain("engine is busy");
                });
        });
});
