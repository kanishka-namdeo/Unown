// plan-mode-v3.test.ts — the Plan Mode V3 orchestration's extension-level
// pins (the 2026-11-01 capability-orchestrator round, docs/plan-mode-v3.md).
//
// The V3 data model's own pins live in plan-v3.test.ts (pure plan.ts); the
// toolset switches are pinned where they were first introduced
// (plan-mode-todo-unification M3, acp setMode, cli/golden --plan). This file
// pins what only the EXTENSION can prove:
//
//   1. the planning-time delegation guard: a writing agent is refused with
//      the specialist roster in the message; the admitted set is exactly the
//      read-only roster (isPlanSafeAgent against the real discovery list)
//   2. plan_write scores through the V3 rubric: a V2-shaped doc fails with
//      the V3 dimensions flagged; a full V3 doc passes the same threshold
//   3. plan_retrospective: guarded before approval; after a scripted
//      approval it validates, merges into the plan file surgically and
//      confirms; an invalid failure classification is rejected with the fix
//      list
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnownToolsExtension, discoverSubagents, isPlanSafeAgent } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-plan-v3-test-"));
afterAll(() => {
        try {
                rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
        const commands = new Map<string, { description: string; handler: Handler }>();
        const shortcuts = new Map<string, { description?: string; handler: Handler }>();
        const piTools = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
        let activeTools: string[] = ["read", "bash", "edit", "write", "task", "todo", "grep", "glob"];
        const pi: any = {
                on: () => {},
                registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
                registerFlag: () => {},
                registerTool: (tool: any) => piTools.set(tool.name, tool),
                registerShortcut: (key: string, def: { description?: string; handler: Handler }) => shortcuts.set(key, def),
                appendEntry: () => {},
                getFlag: () => undefined,
                getActiveTools: () => activeTools,
                setActiveTools: (tools: string[]) => {
                        activeTools = tools;
                },
                sendMessage: () => {},
                setModel: async () => true,
        };
        return { pi, commands, shortcuts, piTools, getActiveTools: () => activeTools };
}

function makeSeams(mode: "default" | "acceptEdits" = "default") {
        const state = { mode, applied: true };
        const setCalls: string[] = [];
        const setPermissionMode = (m: string) => {
                state.mode = m as any;
                setCalls.push(m);
                return { applied: true, effectiveMode: state.mode };
        };
        return { setPermissionMode, permissionsStatus: () => ({ mode: state.mode }), setCalls, state };
}

async function wire(mode: "default" | "acceptEdits" = "default") {
        const dir = join(tmpRoot, `ext-${Math.random().toString(36).slice(2)}`);
        mkdirSync(dir, { recursive: true });
        const seams = makeSeams(mode);
        const ext = createUnownToolsExtension({
                cwd: dir,
                engineUrl: "http://127.0.0.1:9",
                setPermissionMode: seams.setPermissionMode,
                permissionsStatus: seams.permissionsStatus,
        });
        const fake = makeFakePi();
        ext.factory(fake.pi as any);
        return { fake, seams, dir };
}

function makeCtx() {
        const notices: Array<{ text: string; level: string }> = [];
        const ctx = {
                hasUI: true,
                mode: "tui",
                ui: {
                        notify: (text: string, level: string = "info") => notices.push({ text, level }),
                        setStatus: () => {},
                        setWidget: () => {},
                        theme: { fg: (_name: string, text: string) => text },
                },
        };
        return { ctx, notices };
}

function makeApprovalCtx(script: Array<string | undefined>) {
        const selects: Array<{ title: string; options: string[] }> = [];
        const notices: Array<{ text: string; level: string }> = [];
        let call = 0;
        const ctx = {
                hasUI: true,
                mode: "tui",
                ui: {
                        select: async (title: string, options: string[]) => {
                                selects.push({ title, options });
                                return script[call++];
                        },
                        editor: async () => "",
                        input: async () => "",
                        notify: (text: string, level: string = "info") => notices.push({ text, level }),
                        setStatus: () => {},
                        setWidget: () => {},
                        theme: { fg: (_name: string, text: string) => text },
                },
        };
        return { ctx, selects, notices };
}

/** Enter plan mode through the real shortcut (the same lane a user drives). */
async function enterPlanMode(fake: ReturnType<typeof makeFakePi>) {
        const { ctx } = makeCtx();
        await fake.shortcuts.get("ctrl+alt+p")!.handler(ctx);
}

const AUDIT = [
        "- tiered-memory — USED: the project memory carries the parser conventions (relevance: high; benefit: no re-derivation; confidence: 80)",
        "- existing-skills — USED: the repo-exploration skill fits the first step",
        "- workflows — SKIPPED: no prior plan covers this surface",
        "- standing-orders — SKIPPED: no Program section applies",
        "- routines — SKIPPED: nothing recurring here",
        "- repo-map — SKIPPED: the touched files are already known",
        "- project-context — USED: AGENTS.md documents the contract",
        "- prior-learnings — SKIPPED: no session notes on this lane",
        "- benchmarks — SKIPPED: no committed receipt covers it",
        "- agent-patterns — SKIPPED: no delegation pattern needed",
        "- subagent-delegation — USED: the reviewer subagent closes the loop",
].join("\n");

const V3_PLAN = `# Plan: Add the usage summary command

## Context

Users need a quick token-and-cost rollup without leaving the session. The
/usage report exists but nothing summarizes just this conversation cheaply.

## Capability audit

${AUDIT}

## Approach

Reuse the bridge's usage log through a read-only rollup; no new storage.

## Specialist review

### product-strategist — ALIGNED
- The need is real: session-scoped cost is the top request.
### solution-architect — SOUND
- Reading the usage log is cheaper than a new telemetry lane.

## Synthesis

- consensus: reuse the existing usage log
- conflicts: none — both reviews agree
- missing: a cap on the rollup window for huge sessions
- confidence: 85

## Steps

1. Add the rollup command reading the usage log (files: src/cli.ts)
2. Wire the session-scoped filter with a window cap (files: src/usage.ts)
3. Cover the cap edge case with a unit test (files: test/usage.test.ts)

## Risks

- A corrupt usage log line crashes the rollup — skip-and-count instead.
- Huge sessions make the rollup slow — cap the window.

## Learning plan

- memory: whether the usage-log skip-and-count pattern recurs elsewhere
- benchmark: rollup latency on a 10k-line usage log

## Verification

bun test test/usage.test.ts
`;

// A well-formed V2 plan (the pre-V3 shape): scores fine under the V2 rubric,
// fails the V3 gate on the three new dimensions.
const V2_SHAPE_PLAN = `# Plan: Add the export button

## Context

The dashboard needs an export button next to the filter bar for CSV downloads.

## Approach

Add a button component wired to the existing export API endpoint.

## Steps

1. Add the button component (files: src/button.tsx)
2. Wire the click handler to the export API (files: src/dashboard.tsx)

## Risks

- API rate limits under large exports.

## Verification

bun test src
`;

const VALID_RETROSPECTIVE = `- outcome: partial
- failure class: execution
- root cause: the usage-log reader assumed a stable column count
- resolution: switched to tolerant parsing with skip-and-count
- prevention: pin the tolerant parser with a unit test before merging
- learnings:
  - memory: usage-log lines vary in column count — always parse tolerantly
- improvements:
  - plan mode: surface a log-format check in the capability audit`;

describe("Plan Mode V3 — the planning-time delegation guard", () => {
        test("a writing agent is refused while planning, with the specialist roster in the message", async () => {
                const { fake } = await wire();
                await enterPlanMode(fake);
                const task = fake.piTools.get("task")!;
                const { ctx } = makeCtx();
                const result = await task.execute("t1", { agent: "worker", task: "implement the thing" }, undefined, undefined, ctx);
                const text = JSON.stringify(result);
                expect(text).toContain("READ-ONLY agents");
                expect(text).toContain("product-strategist");
                expect(text).toContain("worker: tools =");
                // No spawn ever happened — the refusal is preflight (the fake has no
                // spawn capability; reaching it would throw, so the clean return IS
                // the proof the guard fired first).
        });
        test("a mixed batch is refused whole (one unsafe agent fails the call before any spawn)", async () => {
                const { fake } = await wire();
                await enterPlanMode(fake);
                const task = fake.piTools.get("task")!;
                const { ctx } = makeCtx();
                const result = await task.execute(
                        "t2",
                        {
                                tasks: [
                                        { agent: "product-strategist", task: "review the plan" },
                                        { agent: "general", task: "also implement it" },
                                ],
                        },
                        undefined,
                        undefined,
                        ctx,
                );
                const text = JSON.stringify(result);
                expect(text).toContain("READ-ONLY agents");
                expect(text).toContain("general");
        });
        test("isPlanSafeAgent admits exactly the read-only roster from the real discovery list", () => {
                const agents = discoverSubagents(join(tmpRoot, "nowhere")); // no project agents → built-ins only
                const byName = new Map(agents.map((a) => [a.name, a]));
                // The specialist bench + the read-only recon lanes pass.
                for (const name of [
                        "product-strategist",
                        "solution-architect",
                        "delivery-manager",
                        "qa-architect",
                        "devils-advocate",
                        "learning-analyst",
                        "memory-auditor",
                        "skill-architect",
                        "scout",
                        "explore",
                ]) {
                        const agent = byName.get(name);
                        expect(agent).toBeDefined();
                        expect(isPlanSafeAgent(agent!)).toBe(true);
                }
                // Writing agents (no tools field = full set; or declared writers) fail.
                for (const name of ["general", "worker", "test", "documenter"]) {
                        expect(isPlanSafeAgent(byName.get(name)!)).toBe(false);
                }
                // bash-carrying read-only-ish agents (reviewer, security-reviewer, debug)
                // are refused too: bash can mutate, and plan mode admits no maybe.
                for (const name of ["reviewer", "security-reviewer", "debug"]) {
                        expect(isPlanSafeAgent(byName.get(name)!)).toBe(false);
                }
        });
});

describe("Plan Mode V3 — plan_write scores through the V3 rubric", () => {
        test("a V2-shaped doc fails the V3 gate on the three new dimensions", async () => {
                const { fake } = await wire();
                await enterPlanMode(fake);
                const planWrite = fake.piTools.get("plan_write")!;
                const { ctx } = makeCtx();
                const result = await planWrite.execute("t1", { content: V2_SHAPE_PLAN }, undefined, undefined, ctx);
                const text = JSON.stringify(result);
                expect(text).toContain("below 70");
                expect(text).toContain("[Capability audit]");
                expect(text).toContain("[Specialist review]");
                expect(text).toContain("[Learning plan]");
        });
        test("a full V3 doc passes the same threshold", async () => {
                const { fake } = await wire();
                await enterPlanMode(fake);
                const planWrite = fake.piTools.get("plan_write")!;
                const { ctx } = makeCtx();
                const result = await planWrite.execute("t2", { content: V3_PLAN }, undefined, undefined, ctx);
                const text = JSON.stringify(result);
                expect(text).toContain("100/100");
                expect(text).toContain("exit_plan_mode");
        });
});

describe("Plan Mode V3 — plan_retrospective", () => {
        async function approvedExecution(dirSeed: string) {
                const { fake } = await wire();
                await enterPlanMode(fake);
                const planWrite = fake.piTools.get("plan_write")!;
                const plain = makeCtx();
                await planWrite.execute("t1", { content: V3_PLAN }, undefined, undefined, plain.ctx);
                const exit = fake.piTools.get("exit_plan_mode")!;
                const ui = makeApprovalCtx(["Execute — auto-accept edits"]);
                await exit.execute("t2", {}, undefined, undefined, ui.ctx);
                return { fake, dir: dirSeed };
        }
        test("guarded: before approval it answers with the execution-phase message", async () => {
                const { fake } = await wire();
                const retro = fake.piTools.get("plan_retrospective")!;
                const { ctx } = makeCtx();
                const result = await retro.execute("t1", { content: VALID_RETROSPECTIVE }, undefined, undefined, ctx);
                expect(result.isError).toBe(true);
                expect(JSON.stringify(result)).toContain("only available while executing an approved plan");
        });
        test("happy path: after approval it validates, merges into the plan file and confirms", async () => {
                const run = await approvedExecution("retro-happy");
                const retro = run.fake.piTools.get("plan_retrospective")!;
                const { ctx } = makeCtx();
                const result = await retro.execute("t3", { content: VALID_RETROSPECTIVE }, undefined, undefined, ctx);
                const text = JSON.stringify(result);
                expect(result.isError).toBeUndefined();
                expect(text).toContain("Retrospective recorded");
                expect(text).toContain("failure class: execution");
                // The plan file on disk carries the merged section.
                const planFile = findNewestPlanFile();
                expect(planFile).toBeTruthy();
                const onDisk = readFileSync(planFile!, "utf-8");
                expect(onDisk).toContain("## Retrospective");
                expect(onDisk).toContain("- outcome: partial");
                expect(onDisk).toContain("usage-log lines vary in column count");
                // The plan's original bytes survive the surgical merge.
                expect(onDisk).toContain("### solution-architect — SOUND");
                expect(onDisk).toContain("# Plan: Add the usage summary command");
        });
        test("an invalid failure classification is rejected with the fix list", async () => {
                const run = await approvedExecution("retro-invalid");
                const retro = run.fake.piTools.get("plan_retrospective")!;
                const { ctx } = makeCtx();
                const bad = VALID_RETROSPECTIVE.replace("failure class: execution", "failure class: mystery");
                const result = await retro.execute("t4", { content: bad }, undefined, undefined, ctx);
                expect(result.isError).toBe(true);
                const text = JSON.stringify(result);
                expect(text).toContain("Retrospective rejected");
                expect(text).toContain("failure class");
        });
        test("a delivered outcome with nothing extracted is rejected (learning is the objective)", async () => {
                const run = await approvedExecution("retro-empty");
                const retro = run.fake.piTools.get("plan_retrospective")!;
                const { ctx } = makeCtx();
                const empty = "- outcome: delivered\n- failure class: none";
                const result = await retro.execute("t5", { content: empty }, undefined, undefined, ctx);
                expect(result.isError).toBe(true);
                expect(JSON.stringify(result)).toContain("at least one learning candidate or one improvement");
        });
});

/** The extension writes plan files under <wireDir>/.unown/plans — wire()
 *  creates ext-<rand> dirs under the shared temp root; the newest plan file
 *  across them is the one this run just wrote. */
function findNewestPlanFile(): string | null {
        let newest: { path: string; mtime: number } | null = null;
        for (const entry of readdirSync(tmpRoot)) {
                const plans = join(tmpRoot, entry, ".unown", "plans");
                if (!existsSync(plans)) continue;
                for (const f of readdirSync(plans)) {
                        if (!f.endsWith(".md")) continue;
                        const path = join(plans, f);
                        const mtime = statSync(path).mtimeMs;
                        if (!newest || mtime > newest.mtime) newest = { path, mtime };
                }
        }
        return newest?.path ?? null;
}
