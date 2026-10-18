// Unit tests for src/goal.ts + the /goal wiring in tools.ts — the
// zcode Goal Mode / muse goals port.
//
// Layers:
//   1. pure helpers — parseGoalCommand, goalContextMessage, renderGoalStatus,
//      resolveEvidencePath
//   2. checkGoalCompletion — the evidence gate: tag, todos, evidence markers
//   3. the extension wiring through a fake pi — /goal set/pause/resume/clear,
//      --goal flag bootstrap, session-entry restore, agent_end completion
//      gate (verify + reject paths)
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    checkGoalCompletion,
    goalContextMessage,
    parseGoalCommand,
    renderGoalStatus,
    resolveEvidencePath,
    type GoalState,
} from "../src/goal.ts";
import { createUnownToolsExtension } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-goal-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// 1. Pure helpers
// ---------------------------------------------------------------------------

describe("parseGoalCommand", () => {
    test("empty → status; keywords; text → set", () => {
        expect(parseGoalCommand("")).toEqual({ action: "status" });
        expect(parseGoalCommand("  ")).toEqual({ action: "status" });
        expect(parseGoalCommand("pause")).toEqual({ action: "pause" });
        expect(parseGoalCommand("RESUME")).toEqual({ action: "resume" });
        expect(parseGoalCommand("clear")).toEqual({ action: "clear" });
        expect(parseGoalCommand("stop")).toEqual({ action: "clear" });
        expect(parseGoalCommand("make the tests pass")).toEqual({ action: "set", text: "make the tests pass" });
    });
});

describe("goalContextMessage", () => {
    test("carries the objective + evidence contract", () => {
        const goal: GoalState = { text: "fix the login bug", status: "active", createdAt: Date.now() - 60_000 };
        const text = goalContextMessage(goal);
        expect(text).toContain("fix the login bug");
        expect(text).toContain("[GOAL:COMPLETE]");
        expect(text).toContain("todo");
        expect(text).toContain("evidence");
    });
});

describe("renderGoalStatus + resolveEvidencePath", () => {
    test("null + active + complete renderings", () => {
        expect(renderGoalStatus(null)).toContain("No goal set");
        const active: GoalState = { text: "ship it", status: "active", createdAt: Date.parse("2026-10-18T10:00:00Z") };
        expect(renderGoalStatus(active)).toContain("[ACTIVE]");
        expect(renderGoalStatus(active)).toContain("ship it");
        const done: GoalState = {
            text: "ship it",
            status: "complete",
            createdAt: 0,
            completedAt: 1000,
            completedEvidence: ["file: src/a.ts", "output: tests passed"],
        };
        const rendered = renderGoalStatus(done);
        expect(rendered).toContain("COMPLETE");
        expect(rendered).toContain("src/a.ts");
    });
    test("resolveEvidencePath joins relative paths", () => {
        expect(resolveEvidencePath("/proj", "src/a.ts")).toBe(join("/proj", "src/a.ts"));
        expect(resolveEvidencePath("/proj", "/abs/a.ts")).toBe("/abs/a.ts");
        expect(resolveEvidencePath("/proj", '"src/b.ts"')).toBe(join("/proj", "src/b.ts"));
    });
});

// ---------------------------------------------------------------------------
// 2. The completion gate
// ---------------------------------------------------------------------------

describe("checkGoalCompletion", () => {
    const goodMessage = [
        "Implemented the fix in src/auth.ts and added tests in src/auth.test.ts.",
        "Ran `bun test src/auth.test.ts` — 12/12 passed, exit code 0.",
        "[GOAL:COMPLETE]",
    ].join("\n");

    test("accepts tag + done todos + evidence", () => {
        const check = checkGoalCompletion(goodMessage, [{ done: true }, { done: true }]);
        expect(check.complete).toBe(true);
        expect(check.reasons).toHaveLength(0);
        expect(check.evidence.length).toBeGreaterThanOrEqual(2);
    });

    test("rejects: no tag", () => {
        const check = checkGoalCompletion("did the work in src/a.ts, tests 5/5 passed", []);
        expect(check.complete).toBe(false);
        expect(check.reasons.join(" ")).toContain("no [GOAL:COMPLETE] tag");
    });

    test("rejects: unfinished todos", () => {
        const check = checkGoalCompletion(goodMessage, [{ done: true }, { done: false }]);
        expect(check.complete).toBe(false);
        expect(check.reasons.join(" ")).toContain("unfinished todo");
    });

    test("rejects: tag without evidence", () => {
        const check = checkGoalCompletion("All done, trust me.\n[GOAL:COMPLETE]", []);
        expect(check.complete).toBe(false);
        expect(check.reasons.join(" ")).toContain("insufficient evidence");
    });

    test("counts file paths and command output as evidence markers", () => {
        const check = checkGoalCompletion(goodMessage, []);
        expect(check.evidence.some((e) => e.startsWith("file:"))).toBe(true);
        expect(check.evidence.some((e) => e.startsWith("output:"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3. Extension wiring (fake pi)
// ---------------------------------------------------------------------------

type Handler = (event: any, ctx?: any) => any;

function makeFakePi(entries: any[] = []) {
    const handlers = new Map<string, Handler[]>();
    const commands = new Map<string, { description: string; handler: Handler }>();
    const flags = new Map<string, unknown>();
    const appended: Array<{ customType: string; data: unknown }> = [];
    const pi: any = {
        on: (event: string, handler: Handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
        },
        registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
        registerFlag: (name: string, def: any) => flags.set(name, def.default),
        registerTool: () => {},
        registerShortcut: () => {},
        appendEntry: (customType: string, data: unknown) => appended.push({ customType, data }),
        getFlag: (name: string) => flags.get(name),
        getActiveTools: () => ["read", "bash", "edit", "write"],
        setActiveTools: () => {},
        sendMessage: () => {},
    };
    const emit = async (event: string, payload: any, ctx?: any) => {
        let result: any;
        for (const h of handlers.get(event) ?? []) {
            const r = await h(payload, ctx);
            if (r !== undefined) result = r;
        }
        return result;
    };
    const runCommand = async (name: string, args: string, ctx: any) => {
        await commands.get(name)!.handler(args, ctx);
    };
    const ctx = {
        hasUI: true,
        ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {}, select: async () => null, editor: async () => "" },
        sessionManager: { getEntries: () => entries },
    };
    return { pi, emit, runCommand, commands, appended, ctx, setFlag: (name: string, value: unknown) => flags.set(name, value) };
}

function makeNotify() {
    const messages: Array<{ text: string; level: string }> = [];
    return {
        messages,
        ctx: { hasUI: true, ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) } },
    };
}

describe("/goal wiring in the unown-tools extension", () => {
    test("set → per-turn context injection → agent_end completion gate accepts evidence", async () => {
        const dir = join(tmpRoot, "ext1");
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const fake = makeFakePi([]);
        ext.factory(fake.pi);
        const notify = makeNotify();

        await fake.runCommand("goal", "make the build green", notify.ctx);
        expect(notify.messages.some((m) => m.text.includes("Goal set: make the build green"))).toBe(true);

        // Per-turn injection: before_agent_start returns the goal context
        const context = await fake.emit("before_agent_start", {});
        expect(context?.message?.customType).toBe("unown-goal-context");
        expect(context?.message?.content).toContain("make the build green");
        expect(context?.message?.content).toContain("[GOAL:COMPLETE]");

        // Completion: assistant claims done with evidence, todos empty (all done)
        const agentEnd = await fake.emit(
            "agent_end",
            {
                messages: [
                    { role: "user", content: "go" },
                    {
                        role: "assistant",
                        content: "Fixed src/build.ts and ran `bun test` — 8/8 passed.\n[GOAL:COMPLETE]",
                    },
                ],
            },
            notify.ctx,
        );
        expect(agentEnd).toBeUndefined();
        expect(notify.messages.some((m) => m.text.includes("Goal COMPLETE"))).toBe(true);
        // Persisted as complete
        const persisted = fake.appended.filter((e) => e.customType === "unown-goal");
        expect(persisted.length).toBeGreaterThanOrEqual(1);
        expect((persisted[persisted.length - 1].data as GoalState).status).toBe("complete");
    });

    test("completion gate rejects missing evidence with a warning", async () => {
        const dir = join(tmpRoot, "ext2");
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const fake = makeFakePi([]);
        ext.factory(fake.pi);
        const notify = makeNotify();

        await fake.runCommand("goal", "document the API", notify.ctx);
        await fake.emit(
            "agent_end",
            { messages: [{ role: "assistant", content: "Done.\n[GOAL:COMPLETE]" }] },
            notify.ctx,
        );
        const warning = notify.messages.find((m) => m.level === "warning");
        expect(warning).toBeDefined();
        expect(warning!.text).toContain("Goal NOT complete");
        expect(warning!.text).toContain("insufficient evidence");
    });

    test("pause stops per-turn injection; resume restores it; clear removes it", async () => {
        const dir = join(tmpRoot, "ext3");
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const fake = makeFakePi([]);
        ext.factory(fake.pi);
        const notify = makeNotify();

        await fake.runCommand("goal", "refactor the parser", notify.ctx);
        await fake.runCommand("goal", "pause", notify.ctx);
        const duringPause = await fake.emit("before_agent_start", {});
        expect(duringPause).toBeUndefined();
        await fake.runCommand("goal", "resume", notify.ctx);
        const duringResume = await fake.emit("before_agent_start", {});
        expect(duringResume?.message?.content).toContain("refactor the parser");
        await fake.runCommand("goal", "clear", notify.ctx);
        const afterClear = await fake.emit("before_agent_start", {});
        expect(afterClear).toBeUndefined();
        await fake.runCommand("goal", "", notify.ctx);
        expect(notify.messages[notify.messages.length - 1].text).toContain("No goal set");
    });

    test("--goal flag bootstraps a fresh goal at session_start", async () => {
        const dir = join(tmpRoot, "ext4");
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        const fake = makeFakePi([]);
        ext.factory(fake.pi);
        fake.setFlag("goal", "close issue #42");
        await fake.emit("session_start", {}, fake.ctx);
        const notify = makeNotify();
        await fake.runCommand("goal", "", notify.ctx);
        expect(notify.messages[0].text).toContain("close issue #42");
        expect(notify.messages[0].text).toContain("[ACTIVE]");
    });

    test("goal state restores from session entries across sessions", async () => {
        const dir = join(tmpRoot, "ext5");
        const saved: GoalState = { text: "survive the restart", status: "active", createdAt: 12345 };
        const fake = makeFakePi([{ type: "custom", customType: "unown-goal", data: saved }]);
        const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
        ext.factory(fake.pi);
        await fake.emit("session_start", {}, fake.ctx);
        const notify = makeNotify();
        await fake.runCommand("goal", "", notify.ctx);
        expect(notify.messages[0].text).toContain("survive the restart");
    });
});
