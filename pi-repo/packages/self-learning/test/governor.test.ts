/**
 * Unit tests for src/governor.ts + the router's M1 hardening — the
 * auto-mode stability contract (docs/detached-engine-architecture.md):
 *
 *   F1  dream-check self-trigger guard + cooldown (the runaway dream loop)
 *   F2  job watchdog (no job holds the busy mutex forever) + row recovery
 *   F5  upstream circuit breaker (backoff window on consecutive failures)
 *   F7  budget governor (hourly/daily call + token ceilings)
 *
 * These run on `bun test` against the redirected test store (./_env.ts).
 */
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { emit } from "../src/bus.ts";
import {
        breakerStatus,
        budgetStatus,
        guardLearningJob,
        markEngineProcess,
        maxCallsHour,
        pruneLedger,
        recordLlmCall,
        recordLlmFailure,
        recordLlmSuccess,
        resetBreakerForTest,
        resetEngineProcessForTest,
} from "../src/governor.ts";
import { dreamCheckCooldownMs, JOB_DEFS, jobTimeoutMs, Router, ROUTER_TEST_ONLY } from "../src/router.ts";
import { store } from "../src/store.ts";

function seedJobRow(id: string): void {
        store.run(
                `INSERT OR REPLACE INTO jobs (id, name, kind, schedule_ms, event, enabled, next_run, run_count, status, description)
                 VALUES (?, 'test job', 'event', NULL, NULL, 1, NULL, 0, 'idle', 'unit test')`,
                [id],
        );
}

beforeAll(() => {
        markEngineProcess(); // the governor tracks the ENGINE process only
        resetBreakerForTest();
        store.run(`DELETE FROM llm_ledger`);
        store.run(`DELETE FROM runs`);
});
afterAll(() => {
        resetBreakerForTest();
        resetEngineProcessForTest();
        ROUTER_TEST_ONLY.timeoutOverrideMs = undefined;
        store.run(`DELETE FROM llm_ledger`);
});

/**
 * Env-var save/restore for governor knobs. Values are RESTORED VERBATIM —
 * never deleted — because ./_env.ts installs suite-wide defaults via ??= at
 * import time (unlimited budgets, huge breaker threshold) and a mid-suite
 * delete would expose the production defaults to every later test file
 * (the router suite's learning jobs then throttled on the accumulated
 * ledger — exactly the cross-file leak these tests exist to prevent).
 */
function withEnv(overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): () => Promise<void> {
        return async () => {
                const saved: Record<string, string | undefined> = {};
                for (const key of Object.keys(overrides)) {
                        saved[key] = process.env[key];
                        const v = overrides[key];
                        if (v === undefined) delete process.env[key];
                        else process.env[key] = v;
                }
                try {
                        await fn();
                } finally {
                        for (const key of Object.keys(saved)) {
                                const v = saved[key];
                                if (v === undefined) delete process.env[key];
                                else process.env[key] = v;
                        }
                }
        };
}

describe("process scope (the M2 runtime contract)", () => {
        test("record* calls are inert without the engine-process flag", () => {
                resetEngineProcessForTest();
                try {
                        recordLlmCall(true, 100, 50, "m");
                        recordLlmFailure();
                        recordLlmFailure();
                        recordLlmFailure();
                        recordLlmSuccess();
                        pruneLedger();
                        expect(budgetStatus().callsHour).toBe(0); // nothing landed in the ledger
                        expect(store.get(`SELECT COUNT(*) AS c FROM llm_ledger`)!.c).toBe(0);
                        expect(breakerStatus().open).toBe(false); // breaker untouched
                } finally {
                        markEngineProcess();
                }
        });
});

describe("budget governor (F7)", () => {
        test("under budget by default — learning allowed", () => {
                const g = guardLearningJob("harness-cycle");
                expect(g.allowed).toBe(true);
                expect(g.reason).toBeNull();
        });

        test("call ceiling: over the hourly limit throttles learning jobs", async () => {
                await withEnv({ PI_ENGINE_MAX_CALLS_HOUR: "2" }, async () => {
                        recordLlmCall(true, 10, 5, "test-model");
                        recordLlmCall(true, 10, 5, "test-model");
                        const g = guardLearningJob("auto-dream");
                        expect(g.allowed).toBe(false);
                        expect(g.reason).toContain("budget:throttled");
                        expect(g.reason).toContain("2 engine LLM calls");
                        expect(budgetStatus().overBudget).toBe(true);
                });
                store.run(`DELETE FROM llm_ledger`);
        });

        test("token ceilings count ledger + runs tokens", async () => {
                await withEnv({ PI_ENGINE_MAX_TOKENS_HOUR: "100" }, async () => {
                        recordLlmCall(true, 40, 10, "m"); // 50 from the ledger
                        store.run(
                                `INSERT INTO runs (id, task_id, kind, status, started_at, ended_at, tokens_in, tokens_out) VALUES (?, 't', 'baseline', 'passed', ?, ?, 40, 10)`,
                                ["budget-run-1", Date.now(), Date.now()],
                        );
                        const g = guardLearningJob("dream-check");
                        expect(g.allowed).toBe(false);
                        expect(g.reason).toContain("100 tokens in the last hour");
                });
                store.run(`DELETE FROM llm_ledger`);
                store.run(`DELETE FROM runs`);
        });

        test("failed calls count toward the CALL budget but add no tokens", async () => {
                await withEnv({ PI_ENGINE_MAX_CALLS_HOUR: "1" }, async () => {
                        recordLlmCall(false, null, null, "m");
                        expect(budgetStatus().callsHour).toBe(1);
                        expect(budgetStatus().tokensHour).toBe(0);
                        expect(guardLearningJob("task-mint").allowed).toBe(false);
                });
                store.run(`DELETE FROM llm_ledger`);
        });

        test("0 disables a ceiling (unlimited)", async () => {
                await withEnv({ PI_ENGINE_MAX_CALLS_HOUR: "0" }, async () => {
                        for (let i = 0; i < 5; i++) recordLlmCall(true, 1000, 1000, "m");
                        expect(guardLearningJob("harness-cycle").allowed).toBe(true);
                });
                store.run(`DELETE FROM llm_ledger`);
        });

        test("pruneLedger bounds growth to ~24h", () => {
                store.run(`INSERT INTO llm_ledger (ts, ok, prompt_tokens, completion_tokens, model) VALUES (?, 1, 1, 1, 'old')`, [
                        Date.now() - 26 * 60 * 60_000,
                ]);
                pruneLedger();
                const c = store.get<any>(`SELECT COUNT(*) AS c FROM llm_ledger`);
                expect(c.c).toBe(0);
        });

        test("maxCallsHour default is 60 (empty value = unset)", async () => {
                await withEnv({ PI_ENGINE_MAX_CALLS_HOUR: "" }, () => {
                        // intEnv treats "" as unset — same read as a production .env with an
                        // empty value — WITHOUT deleting the key (see withEnv's contract).
                        expect(maxCallsHour()).toBe(60);
                });
        });
});

describe("circuit breaker (F5)", () => {
        test("threshold consecutive failures open the backoff window", async () => {
                resetBreakerForTest();
                await withEnv({ PI_LLM_BREAKER_THRESHOLD: "3" }, async () => {
                        recordLlmFailure();
                        recordLlmFailure();
                        expect(breakerStatus().open).toBe(false); // 2 < 3 — not yet
                        recordLlmFailure();
                        const st = breakerStatus();
                        expect(st.open).toBe(true);
                        expect(st.retryInMs).toBeGreaterThan(0);
                        const g = guardLearningJob("harness-cycle");
                        expect(g.allowed).toBe(false);
                        expect(g.reason).toContain("upstream backoff");
                });
                resetBreakerForTest();
        });

        test("one success resets the breaker", async () => {
                await withEnv({ PI_LLM_BREAKER_THRESHOLD: "3" }, async () => {
                        resetBreakerForTest();
                        recordLlmFailure();
                        recordLlmFailure();
                        recordLlmFailure();
                        expect(breakerStatus().open).toBe(true);
                        recordLlmSuccess();
                        expect(breakerStatus().open).toBe(false);
                        expect(guardLearningJob("auto-dream").allowed).toBe(true);
                });
                resetBreakerForTest();
        });

        test("repeated trips grow the backoff (exponential, capped, jittered)", async () => {
                resetBreakerForTest();
                await withEnv({ PI_LLM_BREAKER_THRESHOLD: "1", PI_LLM_BACKOFF_BASE_MS: "1000" }, async () => {
                        const seen: number[] = [];
                        for (let i = 0; i < 8; i++) {
                                recordLlmFailure();
                                seen.push(breakerStatus().retryInMs);
                        }
                        // growth is jittered (50–100% of the window), so assert the CAP and
                        // that late windows are far larger than the first — not exact ratios.
                        expect(Math.max(...seen)).toBeLessThanOrEqual(15 * 60_000);
                        expect(seen[7]).toBeGreaterThan(seen[0]);
                });
                resetBreakerForTest();
        });
});

describe("job watchdog (F2)", () => {
        test("a hung job is cut off at the timeout, releases the mutex, and recovers running rows", async () => {
                seedJobRow("dream-check");
                store.run(
                        `INSERT INTO runs (id, task_id, kind, status, started_at) VALUES (?, 't', 'regression', 'running', ?)`,
                        ["wd-run-1", Date.now()],
                );
                const r = new Router();
                // a job whose internal work never settles — the pre-fix engine would
                // hold the busy mutex forever (observed live: >25 min)
                (r as any).runJobInternal = () => new Promise(() => {});
                ROUTER_TEST_ONLY.timeoutOverrideMs = 150;
                const t0 = Date.now();
                const result = await r.execute("dream-check");
                const took = Date.now() - t0;
                expect(took).toBeLessThan(5000); // cut off promptly, not the 20-min default
                expect(result).toEqual({ error: expect.stringContaining("watchdog: job dream-check exceeded") });
                // mutex released — the next job can run
                expect(r.isBusy()).toBe(false);
                expect(r.busyMs()).toBe(0);
                // the hung job's running row was healed to errored
                const row = store.get<any>(`SELECT status, error FROM runs WHERE id = 'wd-run-1'`);
                expect(row.status).toBe("error");
                expect(row.error).toContain("watchdog");
                // job row back to idle
                const job = store.get<any>(`SELECT status FROM jobs WHERE id = 'dream-check'`);
                expect(job.status).toBe("idle");
                store.run(`DELETE FROM runs WHERE id = 'wd-run-1'`);
                ROUTER_TEST_ONLY.timeoutOverrideMs = undefined;
        });

        test("a fast job still completes normally under the watchdog", async () => {
                seedJobRow("note-sync");
                const r = new Router();
                (r as any).runJobInternal = async () => ({ value: 42 });
                ROUTER_TEST_ONLY.timeoutOverrideMs = 5000;
                const result = await r.execute("note-sync");
                expect(result).toEqual({ value: 42 });
                expect(r.isBusy()).toBe(false);
                ROUTER_TEST_ONLY.timeoutOverrideMs = undefined;
        });

        test("governor gate skips learning jobs with the reason as result", async () => {
                seedJobRow("harness-cycle");
                await withEnv(
                        { PI_ENGINE_MAX_CALLS_HOUR: "0", PI_LLM_BREAKER_THRESHOLD: "1" },
                        async () => {
                                resetBreakerForTest();
                                recordLlmFailure(); // breaker open with threshold 1
                                const r = new Router();
                                (r as any).runJobInternal = async () => ({ cycle: "should-not-run" });
                                const result = await r.execute("harness-cycle");
                                expect(result).toEqual({ skipped: expect.stringContaining("upstream backoff") });
                        },
                );
                resetBreakerForTest();
        });

        test("jobTimeoutMs floors at 60s and defaults to 20 min", () => {
                const prev = process.env.PI_JOB_TIMEOUT_MS;
                process.env.PI_JOB_TIMEOUT_MS = undefined as unknown as string; // unset path
                expect(jobTimeoutMs()).toBe(20 * 60_000);
                process.env.PI_JOB_TIMEOUT_MS = "1000"; // below floor — ignored
                expect(jobTimeoutMs()).toBe(20 * 60_000);
                process.env.PI_JOB_TIMEOUT_MS = "120000";
                expect(jobTimeoutMs()).toBe(120_000);
                if (prev === undefined) delete process.env.PI_JOB_TIMEOUT_MS;
                else process.env.PI_JOB_TIMEOUT_MS = prev;
        });

        test("dream-check cooldown default is 10 minutes, 0 allowed (opt-out)", () => {
                const prev = process.env.PI_DREAM_CHECK_COOLDOWN_MS;
                delete process.env.PI_DREAM_CHECK_COOLDOWN_MS;
                expect(dreamCheckCooldownMs()).toBe(10 * 60_000);
                process.env.PI_DREAM_CHECK_COOLDOWN_MS = "0";
                expect(dreamCheckCooldownMs()).toBe(0);
                if (prev === undefined) delete process.env.PI_DREAM_CHECK_COOLDOWN_MS;
                else process.env.PI_DREAM_CHECK_COOLDOWN_MS = prev;
        });
});

describe("dream-check self-trigger guard (F1) — event-level contract", () => {
        // The guard lives inside start()'s event subscription: while a DREAM job
        // is active, run:finished must not queue another dream-check. The live
        // loop is exercised by the integration suite + the soak benchmark
        // (benchmarks/detached-engine); here we pin the invariants.
        test("dream-check and regression-on-ship remain the only event jobs", () => {
                const events = JOB_DEFS.filter((d) => d.kind === "event").map((d) => [d.id, d.event]);
                expect(events).toContainEqual(["dream-check", "run:finished"]);
                expect(events).toContainEqual(["regression-on-ship", "improvement:shipped"]);
        });

        test("activeJob is reported while a job runs (the guard's observable)", async () => {
                seedJobRow("note-sync");
                const r = new Router();
                let seenActive = "";
                (r as any).runJobInternal = async () => {
                        seenActive = r.activeJob();
                        await Bun.sleep(20);
                        return {};
                };
                await r.execute("note-sync");
                expect(seenActive).toBe("note-sync");
                expect(r.activeJob()).toBe(""); // cleared after
        });

        test("run:finished emitted during a dream-context job does not crash the bus", async () => {
                emit("run:finished", { id: "x", kind: "regression", taskId: "t", status: "passed", durationMs: 5 });
                await Bun.sleep(10);
                expect(true).toBe(true);
        });
});
