// Unit tests for src/canary.ts + dream.ts's canaryCheck — the §5.2 hardening:
// K-stratified canary sampling, tool-drift detection and claim-vs-executed
// verification (findings F4A / F7).
//
// Layers:
//   - pure analysis (extractExecutedCommands / runnerToken / claimRunners /
//     analyzeCanaryRun): the live F4 signature (reference ran bun, canary ran
//     node) must trip drift; the "claims bun, executed node" class must trip
//     claimMismatch; honest reports and same-runner runs stay clean;
//   - sampleCanaryTasks against the store: distinct-task stratification,
//     newest-reference-first, regression/failed/running runs excluded, k clamp;
//   - canaryCheck end-to-end with a faked runAgent seam (no pi agent, no LLM):
//     rollback on fail, GATE on drift, GATE on claim mismatch, infra-error
//     skip, PI_DREAM_GATE=0 / K<=0 disable paths, and the dream-note outcome
//     strings the audit trail reads.
import "./_env.ts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canaryCheck } from "../src/dream.ts";
import { MEMORY_DIR, readTier, writeTier } from "../src/memory.ts";
import { analyzeCanaryRun, canaryK, claimRunners, extractExecutedCommands, runnerToken, sampleCanaryTasks } from "../src/canary.ts";
import { store } from "../src/store.ts";

// ---------------------------------------------------------------------------
// Transcript fixtures (shaped like real rows: tool "bash", input = JSON string)
// ---------------------------------------------------------------------------
function transcript(entries: Array<{ tool: string; command?: string; input?: string }>) {
        return JSON.stringify(
                entries.map((e) => ({
                        type: "tool_start",
                        ts: Date.now(),
                        tool: e.tool,
                        input: e.input ?? JSON.stringify({ command: e.command ?? "" }),
                })),
        );
}

const REF_BUN = transcript([{ tool: "read", input: JSON.stringify({ path: "fizzbuzz.js" }) }, { tool: "bash", command: "bun fizzbuzz.test.mjs" }]);
const CANARY_NODE = transcript([{ tool: "read", input: JSON.stringify({ path: "fizzbuzz.js" }) }, { tool: "bash", command: "node fizzbuzz.test.mjs" }]);
const CANARY_BUN = transcript([{ tool: "bash", command: "bun fizzbuzz.test.mjs" }]);

// ---------------------------------------------------------------------------
// Pure analysis
// ---------------------------------------------------------------------------
describe("extractExecutedCommands / runnerToken", () => {
        test("collects bash commands, skips other tools, tolerates malformed input", () => {
                const t = JSON.stringify([
                        { type: "tool_start", tool: "read", input: '{"path":"x.js"}' },
                        { type: "tool_start", tool: "bash", input: '{"command":"bun fizzbuzz.test.mjs"}' },
                        { type: "tool_start", tool: "bash", input: "not json at all" },
                        { type: "tool_start", tool: "bash", input: '{"path":"no command key"}' },
                        { type: "tool_end", tool: "bash" },
                ]);
                expect(extractExecutedCommands(t)).toEqual(["bun fizzbuzz.test.mjs"]);
        });

        test("accepts an already-parsed array and a JSON string equally", () => {
                expect(extractExecutedCommands(CANARY_BUN)).toEqual(["bun fizzbuzz.test.mjs"]);
                expect(extractExecutedCommands(JSON.parse(CANARY_BUN))).toEqual(["bun fizzbuzz.test.mjs"]);
        });

        test("runnerToken maps a command to its runner (null for non-runners)", () => {
                expect(runnerToken("bun fizzbuzz.test.mjs")).toBe("bun");
                expect(runnerToken("node csv.test.mjs")).toBe("node");
                expect(runnerToken("python3 -m pytest")).toBe("python3");
                expect(runnerToken("ls -la")).toBeNull();
        });
});

describe("claimRunners — the agent's final report as a claim", () => {
        test("verb+runner and runner+testfile phrasing are claims", () => {
                expect(claimRunners("I ran bun test and it passed")).toEqual(["bun"]);
                expect(claimRunners("Executed node fizzbuzz.test.mjs — green.")).toEqual(["node"]);
                expect(claimRunners("The suite passes with node.")).toEqual(["node"]);
        });

        test("a bare success report claims nothing (no runner named)", () => {
                expect(claimRunners("All tests pass. The fix handles edge cases.")).toEqual([]);
                expect(claimRunners("")).toEqual([]);
        });
});

describe("analyzeCanaryRun — the F4 live case and the honest cases", () => {
        test("THE F4 SIGNATURE: canary switched bun → node while still passing = tool drift", () => {
                const a = analyzeCanaryRun(
                        { status: "passed", transcript: CANARY_NODE, lastAssistantText: "All tests pass with node." },
                        { transcript: REF_BUN },
                );
                expect(a.drift).toBe(true);
                expect(a.claimMismatch).toBe(false); // it honestly reported node
                expect(a.reason).toContain("tool drift");
                expect(a.executedRunners).toEqual(["node"]);
                expect(a.referenceRunners).toEqual(["bun"]);
        });

        test("same runner, honest report: clean", () => {
                const a = analyzeCanaryRun(
                        { status: "passed", transcript: CANARY_BUN, lastAssistantText: "I ran bun fizzbuzz.test.mjs and it passed." },
                        { transcript: REF_BUN },
                );
                expect(a.drift).toBe(false);
                expect(a.claimMismatch).toBe(false);
                expect(a.reason).toBeUndefined();
        });

        test("claims bun, executed node: claim mismatch (self-report corruption)", () => {
                const a = analyzeCanaryRun(
                        { status: "passed", transcript: CANARY_NODE, lastAssistantText: "I ran bun test and it passed." },
                        { transcript: CANARY_NODE }, // reference also node — no drift
                );
                expect(a.drift).toBe(false);
                expect(a.claimMismatch).toBe(true);
                expect(a.reason).toContain("claim mismatch");
        });

        test("claims verification but executed NOTHING: claim mismatch", () => {
                const a = analyzeCanaryRun(
                        { status: "passed", transcript: "[]", lastAssistantText: "I ran bun test and it passed." },
                        { transcript: REF_BUN },
                );
                expect(a.claimMismatch).toBe(true);
        });

        test("no reference transcript → analysis one-sided, drift suppressed", () => {
                const a = analyzeCanaryRun({ status: "passed", transcript: CANARY_NODE, lastAssistantText: "ok" }, null);
                expect(a.referenceUnavailable).toBe(true);
                expect(a.drift).toBe(false);
        });

        test("mixed runner sets that intersect the reference are not drift", () => {
                const mixed = transcript([{ tool: "bash", command: "node fizzbuzz.test.mjs" }, { tool: "bash", command: "bun fizzbuzz.test.mjs" }]);
                const a = analyzeCanaryRun({ status: "passed", transcript: mixed, lastAssistantText: "green" }, { transcript: REF_BUN });
                expect(a.drift).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// Sampling (store-backed)
// ---------------------------------------------------------------------------
function insertRun(taskId: string, kind: string, status: string, endedAt: number, transcriptText?: string) {
        const id = randomUUID();
        store.run(
                `INSERT INTO runs (id, task_id, kind, status, started_at, ended_at, transcript) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, taskId, kind, status, endedAt - 60_000, endedAt, transcriptText ?? null],
        );
        return id;
}

beforeAll(() => {
        store.run(`DELETE FROM runs`);
        store.run(`DELETE FROM tasks`);
        rmSync(MEMORY_DIR, { recursive: true, force: true });
});

afterAll(() => {
        store.run(`DELETE FROM runs`);
        store.run(`DELETE FROM tasks`);
});

describe("sampleCanaryTasks — K stratified, reference = newest passing baseline/candidate", () => {
        beforeEach(() => store.run(`DELETE FROM runs`));

        test("distinct tasks, newest-first, one reference each", () => {
                const aOld = insertRun("taskA", "baseline", "passed", 100);
                insertRun("taskA", "candidate", "passed", 300); // newer reference for A
                const bRun = insertRun("taskB", "baseline", "passed", 200);
                insertRun("taskA", "baseline", "passed", 50); // older, deduped anyway
                const samples = sampleCanaryTasks(3);
                expect(samples.map((s) => s.taskId)).toEqual(["taskA", "taskB"]);
                expect(samples[0].referenceRunId).not.toBe(aOld); // newest A reference
                expect(samples.find((s) => s.taskId === "taskB")!.referenceRunId).toBe(bRun);
        });

        test("regression / failed / running / interactive runs are never references", () => {
                insertRun("taskC", "regression", "passed", 900);
                insertRun("taskD", "baseline", "failed", 800);
                insertRun("taskE", "candidate", "running", 700);
                insertRun("taskF", "interactive", "passed", 600);
                expect(sampleCanaryTasks(5)).toEqual([]);
        });

        test("k=0 disables sampling; fewer distinct tasks than k clamp naturally", () => {
                insertRun("taskA", "baseline", "passed", 100);
                expect(sampleCanaryTasks(0)).toEqual([]);
                expect(sampleCanaryTasks(10)).toHaveLength(1);
        });
});

describe("canaryK — env knob", () => {
        test("default 3; numeric override; garbage falls back", () => {
                const saved = process.env.PI_DREAM_CANARY_K;
                try {
                        delete process.env.PI_DREAM_CANARY_K;
                        expect(canaryK()).toBe(3);
                        process.env.PI_DREAM_CANARY_K = "5";
                        expect(canaryK()).toBe(5);
                        process.env.PI_DREAM_CANARY_K = "not-a-number";
                        expect(canaryK()).toBe(3);
                        process.env.PI_DREAM_CANARY_K = "0";
                        expect(canaryK()).toBe(0);
                } finally {
                        if (saved === undefined) delete process.env.PI_DREAM_CANARY_K;
                        else process.env.PI_DREAM_CANARY_K = saved;
                }
        });
});

// ---------------------------------------------------------------------------
// canaryCheck end-to-end (faked agent runs; store-fabricated references)
// ---------------------------------------------------------------------------
function insertTask(id: string) {
        store.run(
                `INSERT INTO tasks (id, name, description, category, difficulty, prompt, files, verify, created_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [id, id, id, "unit", 1, `prompt for ${id}`, JSON.stringify({ "x.js": "1" }), "console.log('verify')", Date.now()],
        );
}

const fakeAgent = (result: { status: string; transcript?: string; lastAssistantText?: string }) =>
        jestLike => Promise.resolve(result);

describe("canaryCheck — the gate decisions", () => {
        beforeEach(() => {
                store.run(`DELETE FROM runs`);
                store.run(`DELETE FROM tasks`);
                store.run(`DELETE FROM memory_versions`);
                rmSync(MEMORY_DIR, { recursive: true, force: true });
                // v1 seed, then the "dream under canary" as v2 — canaryCheck(3)
                // rolls back to v2's content on a gate.
                writeTier("project", "# Seed\n- initial\n", "test", "v1");
                writeTier("project", "# Memory\n- stable rule [seed]\n", "test", "v2 dream under canary");
        });

        test("a FAILED canary rolls the dream back to v2's content", async () => {
                insertTask("taskA");
                insertRun("taskA", "baseline", "passed", 100, REF_BUN);
                const gate = await canaryCheck(3, {
                        runAgentFn: () => Promise.resolve({ status: "failed", transcript: "[]", lastAssistantText: "" }),
                });
                expect(gate.rolledBack).toBe(true);
                expect(gate.reason).toContain("taskA failed under new memory v3");
                expect(readTier("project")).toBe("# Memory\n- stable rule [seed]\n");
        });

        test("THE F4 CASE LIVE-PINNED: a PASSING canary that drifted bun→node gates the dream", async () => {
                insertTask("taskA");
                insertRun("taskA", "baseline", "passed", 100, REF_BUN);
                const gate = await canaryCheck(3, {
                        runAgentFn: fakeAgent({ status: "passed", transcript: CANARY_NODE, lastAssistantText: "All tests pass with node." }),
                });
                expect(gate.rolledBack).toBe(true);
                expect(gate.reason).toContain("tool drift");
                expect(gate.reason).toContain("node");
                expect(readTier("project")).toBe("# Memory\n- stable rule [seed]\n");
        });

        test("a PASSING canary whose report claims a runner it never ran gates the dream", async () => {
                insertTask("taskA");
                insertRun("taskA", "baseline", "passed", 100, CANARY_NODE);
                const gate = await canaryCheck(3, {
                        runAgentFn: fakeAgent({ status: "passed", transcript: CANARY_NODE, lastAssistantText: "I ran bun test and it passed." }),
                });
                expect(gate.rolledBack).toBe(true);
                expect(gate.reason).toContain("claim mismatch");
        });

        test("an honest passing canary returns outcomes with runner evidence", async () => {
                insertTask("taskA");
                insertRun("taskA", "baseline", "passed", 100, REF_BUN);
                const gate = await canaryCheck(3, {
                        runAgentFn: fakeAgent({ status: "passed", transcript: CANARY_BUN, lastAssistantText: "I ran bun fizzbuzz.test.mjs and it passed." }),
                });
                expect(gate.rolledBack).toBe(false);
                expect(gate.canaries).toEqual(["taskA: passed (runners: bun; claimed: bun)"]);
        });

        test("infrastructure errors skip the sample and keep the dream", async () => {
                insertTask("taskA");
                insertRun("taskA", "baseline", "passed", 100, REF_BUN);
                const gate = await canaryCheck(3, {
                        runAgentFn: () => Promise.resolve({ status: "error", transcript: "[]", lastAssistantText: "" }),
                });
                expect(gate.rolledBack).toBe(false);
                expect(gate.skipped).toBe(true);
                expect(gate.reason).toContain("infrastructure error");
                expect(readTier("project")).toBe("# Memory\n- stable rule [seed]\n");
        });

        test("PI_DREAM_GATE=0 skips everything (documented escape hatch)", async () => {
                const saved = process.env.PI_DREAM_GATE;
                try {
                        process.env.PI_DREAM_GATE = "0";
                        insertTask("taskA");
                        insertRun("taskA", "baseline", "passed", 100, REF_BUN);
                        const gate = await canaryCheck(3, {
                                runAgentFn: () => Promise.resolve({ status: "failed", transcript: "[]", lastAssistantText: "" }),
                        });
                        expect(gate.skipped).toBe(true);
                        expect(gate.reason).toBe("gate disabled");
                } finally {
                        if (saved === undefined) delete process.env.PI_DREAM_GATE;
                        else process.env.PI_DREAM_GATE = saved;
                }
        });

        test("K<=0 disables sampling (env knob)", async () => {
                const saved = process.env.PI_DREAM_CANARY_K;
                try {
                        process.env.PI_DREAM_CANARY_K = "0";
                        insertTask("taskA");
                        insertRun("taskA", "baseline", "passed", 100, REF_BUN);
                        const gate = await canaryCheck(1, {
                                runAgentFn: () => Promise.resolve({ status: "failed", transcript: "[]", lastAssistantText: "" }),
                        });
                        expect(gate.skipped).toBe(true);
                        expect(gate.reason).toContain("sampling disabled");
                } finally {
                        if (saved === undefined) delete process.env.PI_DREAM_CANARY_K;
                        else process.env.PI_DREAM_CANARY_K = saved;
                }
        });

        test("missing task registry rows are skipped, not crashed", async () => {
                insertRun("ghost-task", "baseline", "passed", 100, REF_BUN);
                const gate = await canaryCheck(3, {
                        runAgentFn: () => Promise.resolve({ status: "passed", transcript: CANARY_BUN, lastAssistantText: "green" }),
                });
                expect(gate.rolledBack).toBe(false);
                expect(gate.skipped).toBe(true);
                expect(gate.reason).toContain("task missing");
        });

        test("no passed runs at all → skipped with the honest reason", async () => {
                const gate = await canaryCheck(3, {
                        runAgentFn: () => Promise.resolve({ status: "passed", transcript: CANARY_BUN, lastAssistantText: "green" }),
                });
                expect(gate.skipped).toBe(true);
                expect(gate.reason).toBe("no previously-passing task");
        });
});

// silence the unused-param lint on the fakeAgent helper's signature
void fakeAgent;
