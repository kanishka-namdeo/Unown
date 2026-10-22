/**
 * ralph.test.ts — M4: the Ralph loop. PURE layers (verdict parsing, prompts,
 * iteration caps) + the orchestrator with an injected fake spawn and fake
 * diff capture (never a real LLM call, never a real git repo).
 */
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
        buildReviewerPrompt,
        buildWorkerPrompt,
        capIterations,
        ensureRalphSchema,
        parseRalphVerdict,
        RALPH_DEFAULT_ITERATIONS,
        RALPH_MAX_ITERATIONS,
        runRalphLoop,
        spawnRalphRun,
        type RalphSpawnFn,
} from "../src/ralph.ts";
import { store, DATA_DIR } from "../src/store.ts";

const WORKSPACE = mkdtempSync(join(tmpdir(), "unown-ralph-ws-"));
const LOCK = join(DATA_DIR, "engine.lock");

// ---------------------------------------------------------------------------
// PURE: parseRalphVerdict
// ---------------------------------------------------------------------------

describe("parseRalphVerdict", () => {
        test("the exact grammar, both verdicts, case-insensitive", () => {
                expect(parseRalphVerdict("analysis…\n\nVERDICT: SHIP")).toBe("ship");
                expect(parseRalphVerdict("VERDICT: REVISE")).toBe("revise");
                expect(parseRalphVerdict("verdict: ship")).toBe("ship");
                expect(parseRalphVerdict("  VERDICT:  REVISE  ")).toBe("revise");
        });
        test("prose never matches — the marker is start-of-line only", () => {
                expect(parseRalphVerdict("I think the verdict: ship it now")).toBeNull();
                expect(parseRalphVerdict("VERDICT: MAYBE")).toBeNull();
                expect(parseRalphVerdict("")).toBeNull();
        });
        test("the FIRST verdict wins (a reviewer that reconsiders is judged by its first call)", () => {
                expect(parseRalphVerdict("VERDICT: REVISE\n…on reflection VERDICT: SHIP")).toBe("revise");
        });
        test("FEEDBACK sections survive alongside the verdict (the loop reads them from the file)", () => {
                const out = "VERDICT: REVISE\n\nFEEDBACK:\n- add tests";
                expect(parseRalphVerdict(out)).toBe("revise");
        });
});

// ---------------------------------------------------------------------------
// PURE: iteration caps
// ---------------------------------------------------------------------------

describe("capIterations", () => {
        test("valid budgets pass through", () => {
                expect(capIterations(1)).toEqual({ ok: true, iterations: 1 });
                expect(capIterations(RALPH_MAX_ITERATIONS)).toEqual({ ok: true, iterations: RALPH_MAX_ITERATIONS });
        });
        test("garbage is rejected with a printable error", () => {
                expect(capIterations(0).ok).toBe(false);
                expect(capIterations(-3).ok).toBe(false);
                expect(capIterations(2.5).ok).toBe(false);
                expect(capIterations(RALPH_MAX_ITERATIONS + 1).ok).toBe(false);
        });
        test("the default is the documented 5", () => {
                expect(RALPH_DEFAULT_ITERATIONS).toBe(5);
        });
});

// ---------------------------------------------------------------------------
// PURE: prompts
// ---------------------------------------------------------------------------

describe("buildWorkerPrompt", () => {
        const args = { task: "fix the flaky test", iteration: 2, maxIterations: 5, summaryPath: "/ws/.unown/ralph/r1/summary.md" };
        test("iteration 1 carries NO feedback block (fresh start)", () => {
                const p = buildWorkerPrompt({ ...args, iteration: 1, feedback: null });
                expect(p).toContain("fix the flaky test");
                expect(p).toContain("iteration 1 of 5");
                expect(p).not.toContain("reviewer's feedback");
        });
        test("later iterations embed the feedback verbatim + address-every-point rule", () => {
                const p = buildWorkerPrompt({ ...args, feedback: "FEEDBACK:\n- the retry loop is unbounded" });
                expect(p).toContain("iteration 2 of 5");
                expect(p).toContain("- the retry loop is unbounded");
                expect(p).toContain("address EVERY point");
        });
});

describe("buildReviewerPrompt", () => {
        test("the VERDICT grammar is contractual + claims-vs-state framing", () => {
                const p = buildReviewerPrompt({ task: "T", summary: "did it", diff: "diff --git a/x", untracked: null });
                expect(p).toContain("VERDICT: SHIP");
                expect(p).toContain("VERDICT: REVISE");
                expect(p).toContain("claims, not facts");
                expect(p).toContain("diff --git a/x");
        });
        test("no git → the reviewer is told so, never handed an empty lie", () => {
                const p = buildReviewerPrompt({ task: "T", summary: "", diff: null, untracked: null });
                expect(p).toContain("not a git repository");
                expect(p).toContain("(missing — the worker did not write one)");
        });
        test("an unchanged repo says so; untracked files ride along", () => {
                const p = buildReviewerPrompt({ task: "T", summary: "s", diff: "", untracked: "new_file.py" });
                expect(p).toContain("no tracked changes since the loop started");
                expect(p).toContain("new_file.py");
        });
});

// ---------------------------------------------------------------------------
// ENGINE: the orchestrator (fake spawn, fake capture — zero LLM, zero git)
// ---------------------------------------------------------------------------

/** A fake spawn with a script: per-iteration worker/reviewer outcomes. */
function scriptedSpawn(script: Array<{ worker: string; reviewer: string; reviewerExit?: number; workerExit?: number }>): {
        spawn: RalphSpawnFn;
        calls: Array<{ kind: string; iteration: number; prompt: string; model: string | null }>;
} {
        const calls: Array<{ kind: string; iteration: number; prompt: string; model: string | null }> = [];
        const spawn: RalphSpawnFn = async (args) => {
                calls.push({ kind: args.kind, iteration: args.iteration, prompt: args.prompt, model: args.model });
                const s = script[args.iteration - 1];
                const out = args.kind === "worker" ? s.worker : s.reviewer;
                const code = args.kind === "worker" ? (s.workerExit ?? 0) : (s.reviewerExit ?? 0);
                return { exitCode: code, output: out, turns: 2, tokensIn: 100, tokensOut: 50 };
        };
        return { spawn, calls };
}

const noCapture = () => Promise.resolve({ diff: null, untracked: null });

describe("runRalphLoop (fake spawn, fake capture)", () => {
        beforeAll(() => {
                ensureRalphSchema();
        });

        test("a first-iteration SHIP: 2 spawns, ship final, verdict.md written, ralph_runs row updated", async () => {
                const { spawn, calls } = scriptedSpawn([{ worker: "did the work", reviewer: "looks good\n\nVERDICT: SHIP" }]);
                const res = await runRalphLoop({ task: "add a README section", workspace: WORKSPACE, maxIterations: 3, spawn, capture: noCapture });
                expect(res.final).toBe("ship");
                expect(res.iterations).toHaveLength(1);
                expect(res.iterations[0].verdictExplicit).toBe(true);
                expect(calls.map((c) => `${c.kind}${c.iteration}`)).toEqual(["worker1", "reviewer1"]);
                // The worker prompt is fresh-context: task verbatim, no feedback.
                expect(calls[0].prompt).toContain("add a README section");
                expect(calls[0].prompt).not.toContain("reviewer's feedback");
                // verdict.md carries the marker + the reviewer output.
                const verdict = readFileSync(join(res.dir, "verdict.md"), "utf8");
                expect(verdict).toContain("VERDICT: SHIP");
                expect(verdict).toContain("looks good");
                // The DB row flipped to ship with the token totals.
                const row = store.get<{ status: string; iterations_run: number; tokens_in: number }>(
                        `SELECT status, iterations_run, tokens_in FROM ralph_runs WHERE id = ?`,
                        [res.runId],
                );
                expect(row?.status).toBe("ship");
                expect(row?.iterations_run).toBe(1);
                expect(row?.tokens_in).toBe(200); // 2 spawns × 100
        });

        test("REVISE then SHIP: feedback rides the files — worker 2 sees worker 1's reviewer output verbatim", async () => {
                const { spawn, calls } = scriptedSpawn([
                        { worker: "attempt 1", reviewer: "FEEDBACK:\n- retry is unbounded\n\nVERDICT: REVISE" },
                        { worker: "attempt 2 with bound", reviewer: "VERDICT: SHIP" },
                ]);
                const res = await runRalphLoop({ task: "bound the retries", workspace: WORKSPACE, maxIterations: 3, spawn, capture: noCapture });
                expect(res.final).toBe("ship");
                expect(res.iterations).toHaveLength(2);
                expect(res.iterations[0].verdict).toBe("revise");
                // The handoff: worker 2's prompt embeds the reviewer's feedback.
                const worker2 = calls.find((c) => c.kind === "worker" && c.iteration === 2)!;
                expect(worker2.prompt).toContain("retry is unbounded");
                expect(worker2.prompt).toContain("address EVERY point");
                // feedback.md still holds the last revise (audit trail).
                expect(readFileSync(join(res.dir, "feedback.md"), "utf8")).toContain("retry is unbounded");
        });

        test("budget exhaustion ends honestly (max-iterations, exit-able verdict file)", async () => {
                const { spawn } = scriptedSpawn([
                        { worker: "a", reviewer: "VERDICT: REVISE" },
                        { worker: "b", reviewer: "VERDICT: REVISE" },
                ]);
                const res = await runRalphLoop({ task: "never ships", workspace: WORKSPACE, maxIterations: 2, spawn, capture: noCapture });
                expect(res.final).toBe("max-iterations");
                expect(res.iterations).toHaveLength(2);
                expect(existsSync(join(res.dir, "feedback.md"))).toBe(true);
                const verdict = readFileSync(join(res.dir, "verdict.md"), "utf8");
                expect(verdict).toContain("NOT shipped");
        });

        test("an unparsable reviewer output defaults to REVISE and the note rides the feedback file (never silently ship)", async () => {
                const { spawn, calls } = scriptedSpawn([
                        { worker: "a", reviewer: "I could not decide, the code seems okay?" },
                        { worker: "b", reviewer: "VERDICT: SHIP" },
                ]);
                const res = await runRalphLoop({ task: "t", workspace: WORKSPACE, maxIterations: 3, spawn, capture: noCapture });
                expect(res.iterations[0].verdictExplicit).toBe(false);
                expect(res.iterations[0].verdict).toBe("revise");
                expect(readFileSync(join(res.dir, "feedback.md"), "utf8")).toContain("no parseable VERDICT line");
                expect(res.final).toBe("ship"); // iteration 2 shipped
        });

        test("a reviewer crash (non-zero exit) is a revise-with-note, not a loop death", async () => {
                const { spawn } = scriptedSpawn([
                        { worker: "a", reviewer: "(stderr noise)", reviewerExit: 1 },
                        { worker: "b", reviewer: "VERDICT: SHIP" },
                ]);
                const res = await runRalphLoop({ task: "t", workspace: WORKSPACE, maxIterations: 3, spawn, capture: noCapture });
                expect(res.iterations[0].verdictExplicit).toBe(false);
                expect(res.iterations[0].reviewer.exitCode).toBe(1);
                expect(res.final).toBe("ship");
        });

        test("models pin through the spawn seam (worker + reviewer are independently settable)", async () => {
                const { spawn, calls } = scriptedSpawn([{ worker: "w", reviewer: "VERDICT: SHIP" }]);
                await runRalphLoop({
                        task: "t",
                        workspace: WORKSPACE,
                        maxIterations: 1,
                        workerModel: "agnes-3.0-flash",
                        reviewerModel: "some-other-model",
                        spawn,
                        capture: noCapture,
                });
                expect(calls.find((c) => c.kind === "worker")?.model).toBe("agnes-3.0-flash");
                expect(calls.find((c) => c.kind === "reviewer")?.model).toBe("some-other-model");
        });

        test("every spawn lands as a runs row (dashboard Runs pane surface, kind ralph-*)", async () => {
                const { spawn } = scriptedSpawn([{ worker: "w", reviewer: "VERDICT: REVISE" }, { worker: "w2", reviewer: "VERDICT: SHIP" }]);
                const res = await runRalphLoop({ task: "t", workspace: WORKSPACE, maxIterations: 2, spawn, capture: noCapture });
                const rows = store.query<{ kind: string; task_id: string }>(
                        `SELECT kind, task_id FROM runs WHERE task_id = ? ORDER BY kind, id`,
                        [res.runId],
                );
                const kinds = rows.map((r) => r.kind).sort();
                expect(kinds).toEqual(["ralph-reviewer", "ralph-reviewer", "ralph-worker", "ralph-worker"]);
        });

        test("an empty task is refused (no files, no rows)", async () => {
                const { spawn } = scriptedSpawn([]);
                await expect(runRalphLoop({ task: "   ", workspace: WORKSPACE, spawn, capture: noCapture })).rejects.toThrow(/task must not be empty/);
        });

        test("task.md is frozen verbatim + summary.md is seeded empty for the worker", async () => {
                const { spawn } = scriptedSpawn([{ worker: "w", reviewer: "VERDICT: SHIP" }]);
                const res = await runRalphLoop({ task: "the exact task text", workspace: WORKSPACE, maxIterations: 1, spawn, capture: noCapture });
                expect(readFileSync(join(res.dir, "task.md"), "utf8")).toBe("the exact task text\n");
                expect(readFileSync(join(res.dir, "summary.md"), "utf8")).toBe("");
        });
});

describe("spawnRalphRun (the seam contract, no spawn executed)", () => {
        test("the seam exists and is the production default (typed, exported) — smoke only", () => {
                expect(typeof spawnRalphRun).toBe("function");
        });
});

afterAll(() => {
        rmSync(WORKSPACE, { recursive: true, force: true });
        try {
                rmSync(LOCK, { force: true });
        } catch {
                /* best effort */
        }
});
