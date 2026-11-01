// plan-mode-todo-unification.test.ts — the todo unification round's pins.
//
// The reported bug: TWO to-do lists around plan mode. Root cause (the round's
// session doc): the V1 plan-steps widget and the V2 seeded todo overlay both
// mounted above the editor after approval, the todo tool rode the plan-mode
// toolset (Codex/Gemini both exclude it), seeding appended instead of
// replacing, and [DONE:n] tags and todo flips never synced.
//
// The contract (the competitor consensus): plan and todos are different
// things — the plan is a user-approved proposal artifact, the todo list is
// live execution state; exactly ONE progress surface is visible at a time;
// the plan→todo handoff happens once, atomically, at approval.
//
// Pins:
//   M1  no plan-steps widget ever mounts while the todo addon is live — the
//       seeded unown-todos overlay is the only checklist above the editor
//       (the legacy widget survives only as the addon-disabled fallback)
//   M2  approval REPLACES the foreground list, mounts the panel at once and
//       persists ONE replayable seed entry; re-approval never stacks plan B
//       on plan A
//   M3  the todo tool is off the plan-mode toolset (the Codex/Gemini lane)
//   M4  [DONE:n] flips the seeded todo; a hand-driven todo completion flips
//       the plan step (chip + persisted state agree)
//   M5  the fallback gate's execute instruction is display:false — the user
//       sees the approved plan once, then the live panel
//   RES plan steps and replayed todos reconcile in BOTH directions on resume
//   RLD the bridges are a (re)registration-cycle contract, not a one-way
//     latch: a /addons disable + /reload retires them and the legacy widget
//     returns (the 0.0.53 recovery round - see resetTodoAddonBridges)
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addonsConfigPath, loadAddonsConfig, saveAddonsConfig } from "../src/addons/config.ts";
import { createUnownAddonsExtension } from "../src/addons/index.ts";
import { isTodoOverlayAvailable, registerTodoAddon, resetTodoAddonBridges } from "../src/addons/todo.ts";
import { createUnownToolsExtension } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-plan-todo-test-"));
afterAll(() => {
        try {
                rmSync(tmpRoot, { recursive: true, force: true });
        } catch {
                /* best effort */
        }
});

type Handler = (event: any, ctx?: any) => any;

/** The wiring under test: BOTH extensions on one fake pi, registration order
 *  mirroring cli.ts bootRuntime (unown-tools first, the todo addon second —
 *  the resume reconcile depends on that order). */
function makeFakePi(entries: any[] = []) {
        const handlers = new Map<string, Handler[]>();
        const commands = new Map<string, { description: string; handler: Handler }>();
        const shortcuts = new Map<string, { description?: string; handler: Handler }>();
        const tools = new Map<string, any>();
        const appended: Array<{ customType: string; data: any }> = [];
        const sent: Array<{ message: any; options: any }> = [];
        const activeTools: string[] = ["read", "bash", "edit", "write", "todo", "task"];
        const pi: any = {
                on: (event: string, handler: Handler) => {
                        if (!handlers.has(event)) handlers.set(event, []);
                        handlers.get(event)!.push(handler);
                },
                registerCommand: (name: string, def: { description: string; handler: Handler }) => commands.set(name, def),
                registerFlag: () => {},
                registerTool: (tool: any) => tools.set(tool.name, tool),
                registerShortcut: (key: string, def: { description?: string; handler: Handler }) => shortcuts.set(key, def),
                appendEntry: (customType: string, data: unknown) => appended.push({ customType, data }),
                getFlag: () => undefined,
                getActiveTools: () => [...activeTools], // copy — the real pi never hands back a live reference
                setActiveTools: (next: string[]) => {
                        activeTools.length = 0;
                        activeTools.push(...next);
                },
                sendMessage: (message: any, options: any) => sent.push({ message, options }),
                setModel: async () => true,
                setSessionName: () => {},
        };
        const emit = async (event: string, payload: any, ctx?: any) => {
                let result: any;
                for (const h of handlers.get(event) ?? []) {
                        const r = await h(payload, ctx);
                        if (r !== undefined) result = r;
                }
                return result;
        };
        const runTool = async (name: string, params: any, ctx: any) =>
                tools.get(name)!.execute("t", params, undefined, undefined, ctx);
        const branch = [...entries];
        const ctx = {
                hasUI: true,
                ui: { notify: () => {}, setStatus: () => {}, setWidget: () => {} },
                sessionManager: {
                        getEntries: () => entries,
                        getSessionId: () => "s1",
                        getBranch: () => branch,
                },
        };
        return { pi, emit, runTool, commands, shortcuts, tools, appended, sent, activeTools, ctx, entriesForCtx: entries };
}

/** A ctx that captures every setWidget/setStatus call — the widget-capture
 *  lane the round's M1/M2/M4 assertions ride. select is scripted per call. */
function makeCaptureCtx(script: Array<string | undefined> = [], entries: any[] = []) {
        const widgets: Array<{ key: string; value: unknown }> = [];
        const statuses: Array<[string, string | undefined]> = [];
        const notices: Array<{ text: string; level: string }> = [];
        let call = 0;
        const ctx = {
                hasUI: true,
                ui: {
                        select: async (_title: string, _options: string[]) => script[call++],
                        editor: async () => "",
                        input: async () => "",
                        notify: (text: string, level: string = "info") => notices.push({ text, level }),
                        setStatus: (key: string, text: string | undefined) => statuses.push([key, text]),
                        setWidget: (key: string, value: unknown) => widgets.push({ key, value }),
                        theme: { fg: (_name: string, text: string) => text },
                },
                sessionManager: { getEntries: () => entries, getSessionId: () => "s1", getBranch: () => entries },
        };
        return { ctx, widgets, statuses, notices };
}

async function wire(entries: any[] = []) {
        const dir = join(tmpRoot, `ext-${Math.random().toString(36).slice(2)}`);
        const toolsExt = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:9" });
        const fake = makeFakePi(entries);
        toolsExt.factory(fake.pi);
        registerTodoAddon(fake.pi, { enabled: true, maxWidgetLines: 12, collapseKey: "off", guidance: {} }, () => 12);
        return fake;
}

const PLAN_A = `# Plan: Add the export button

## Context
The dashboard needs an export button next to the filter bar (files: src/dashboard.tsx).

## Approach
Add a button component wired to the existing export API endpoint.

## Steps
1. Add the button component (files: src/button.tsx)
2. Wire the click handler to the export API (files: src/dashboard.tsx)

## Risks
- API rate limits under large exports.

## Verification
- bun test src
`;

const PLAN_B = `# Plan: Add the import lane

## Context
The dashboard also imports CSV bundles (files: src/importer.ts).

## Approach
A dedicated importer module behind the settings screen.

## Steps
1. Create the importer module (files: src/importer.ts)
2. Mount it behind the settings screen (files: src/settings.tsx)

## Risks
- Large CSVs block the UI thread.

## Verification
- bun test src
`;

/** Enter plan mode → write the plan → session_start already emitted. Returns
 *  the capture ctx so assertions can read widgets/statuses/notices. */
async function planApproved(fake: any, plan: string, choice = "Execute \u2014 auto-accept edits") {
        const cap = makeCaptureCtx([choice]);
        await fake.emit("session_start", {}, cap.ctx); // claim foreground + overlay uiCtx
        await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
        await fake.runTool("plan_write", { content: plan }, cap.ctx);
        const result = await fake.runTool("exit_plan_mode", {}, cap.ctx);
        return { cap, result };
}

/** The todo tool's list rendering (the ONE visible list's content). */
async function todoList(fake: any, ctx: any): Promise<string> {
        const result = await fake.runTool("todo", { action: "list" }, ctx);
        return result.content[0].text as string;
}

describe("the plan-mode todo unification (one list, two input paths)", () => {
        // The bridges are MODULE state shared by every test file in this bun
        // process: goal.test.ts (and any wrapper-wiring file) registers the todo
        // addon BEFORE this file runs, and bun's file execution order varies by
        // platform/runner - the 0.0.53 CI red was exactly that leak (the M1
        // fallback test saw the addon as "available" and the legacy widget never
        // mounted; red on all three CI OSes while the file alone passed 11/11).
        // Every test here starts from the unregistered state and wires what it
        // needs - order-proof by construction.
        beforeEach(() => {
                resetTodoAddonBridges();
        });

        test("M1 fallback: with the todo addon disabled, the legacy plan-steps widget is the execution surface", async () => {
                // wire WITHOUT registerTodoAddon — the /addons-off configuration
                const dir = join(tmpRoot, `noaddon-${Math.random().toString(36).slice(2)}`);
                const toolsExt = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:9" });
                const fake = makeFakePi([]);
                toolsExt.factory(fake.pi);
                const cap = makeCaptureCtx(["Execute \u2014 auto-accept edits"]);
                await fake.emit("session_start", {}, cap.ctx);
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
                await fake.runTool("plan_write", { content: PLAN_A }, cap.ctx);
                const result = await fake.runTool("exit_plan_mode", {}, cap.ctx);
                expect(JSON.stringify(result)).toContain("approved your plan");
                // The overlay never registered, so the legacy widget is the surface.
                const legacy = cap.widgets.filter((w) => w.key === "plan-steps" && Array.isArray(w.value));
                expect(legacy.length).toBeGreaterThanOrEqual(1);
                expect(cap.widgets.some((w) => w.key === "unown-todos")).toBe(false);
                // Its rows mirror the approved steps.
                expect(legacy[legacy.length - 1].value.join(" ")).toContain("Add the button component");
        });
        test("M3: the plan-mode toolset excludes the todo tool (the Codex/Gemini lane)", async () => {
                const fake = await wire();
                const cap = makeCaptureCtx();
                await fake.emit("session_start", {}, cap.ctx);
                expect(fake.activeTools).toContain("todo"); // before: the todo tool is live
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
                const active = [...fake.activeTools];
                expect(active).not.toContain("todo");
                expect(active).not.toContain("edit");
                expect(active).not.toContain("write");
                // Plan Mode V3 (2026-11-01): `task` stays available while planning — the
                // specialist-review phase delegates to the READ-ONLY planning bench (the
                // task tool's plan-mode guard enforces read-only per spawn). V2 (the
                // UNOWN_PLAN_MODE_V3=0 kill switch) keeps task disabled — pinned below.
                expect(active).toContain("task");
                expect(active).toContain("plan_write");
                expect(active).toContain("exit_plan_mode");
                // The retrospective tool never tempts the orchestrator mid-planning.
                expect(active).not.toContain("plan_retrospective");
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode OFF
                expect([...fake.activeTools]).toContain("todo"); // restored
        });
        test("M3 (V2 kill switch): UNOWN_PLAN_MODE_V3=0 restores the V2 toolset — no task while planning", async () => {
                process.env.UNOWN_PLAN_MODE_V3 = "0";
                try {
                        const fake = await wire();
                        const cap = makeCaptureCtx();
                        await fake.emit("session_start", {}, cap.ctx);
                        await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
                        const active = [...fake.activeTools];
                        expect(active).not.toContain("task"); // V2: no delegation while planning
                        expect(active).not.toContain("todo");
                        expect(active).not.toContain("edit");
                        expect(active).toContain("plan_write");
                        expect(active).toContain("exit_plan_mode");
                } finally {
                        delete process.env.UNOWN_PLAN_MODE_V3;
                }
        });

        test("M1+M2: approval mounts the seeded unown-todos overlay, never the plan-steps widget", async () => {
                const fake = await wire();
                const { cap, result } = await planApproved(fake, PLAN_A);
                expect(JSON.stringify(result)).toContain("approved your plan");
                // The ONE checklist: the todo overlay mounts above the editor...
                const mounted = cap.widgets.filter((w) => w.key === "unown-todos" && typeof w.value === "function");
                expect(mounted.length).toBeGreaterThanOrEqual(1);
                // ...and the legacy plan-steps widget NEVER receives a defined value.
                const legacy = cap.widgets.filter((w) => w.key === "plan-steps" && w.value !== undefined);
                expect(legacy).toHaveLength(0);
                // The footer chip is the compact progress surface.
                expect(cap.statuses.some(([key, text]) => key === "plan-mode" && text === "plan 0/2")).toBe(true);
        });

        test("M2: approval seeds ONE replayable snapshot; the seeded ids restart at 1", async () => {
                const fake = await wire();
                await planApproved(fake, PLAN_A);
                const seeds = fake.appended.filter((e) => e.customType === "unown-todo-state" && e.data.action === "seed");
                expect(seeds).toHaveLength(1);
                expect(seeds[0].data.tasks).toHaveLength(2);
                expect(seeds[0].data.tasks.map((t: any) => t.id)).toEqual([1, 2]);
                expect(seeds[0].data.tasks.every((t: any) => t.status === "pending")).toBe(true);
        });

        test("M2: re-approval REPLACES — plan B never stacks on plan A", async () => {
                const fake = await wire();
                const first = await planApproved(fake, PLAN_A);
                expect(await todoList(fake, first.cap.ctx)).toContain("Add the button component");
                // Second episode: re-enter plan mode, approve a DIFFERENT plan.
                const second = await planApproved(fake, PLAN_B);
                const list = await todoList(fake, second.cap.ctx);
                expect(list).toContain("Create the importer module");
                expect(list).toContain("Mount it behind the settings screen");
                expect(list).not.toContain("Add the button component");
                expect(list).not.toContain("Wire the click handler to the export API");
                const seeds = fake.appended.filter((e) => e.customType === "unown-todo-state" && e.data.action === "seed");
                expect(seeds).toHaveLength(2); // one per approval, each a full replacement
                expect(seeds[1].data.tasks).toHaveLength(2);
                expect(seeds[1].data.tasks.map((t: any) => t.id)).toEqual([1, 2]); // ids rewound, not 3-4
        });

        test("M4: a [DONE:n] tag flips the matching seeded todo", async () => {
                const fake = await wire();
                const { cap } = await planApproved(fake, PLAN_A);
                await fake.emit(
                        "turn_end",
                        { message: { role: "assistant", content: [{ type: "text", text: "Added the button. [DONE:1]" }] } },
                        cap.ctx,
                );
                const list = await todoList(fake, cap.ctx);
                expect(list).toContain("completed");
                expect(list).toContain("Add the button component");
                expect(cap.statuses.some(([key, text]) => key === "plan-mode" && text === "plan 1/2")).toBe(true);
        });

        test("M4: a hand-driven todo completion flips the matching plan step", async () => {
                const fake = await wire();
                const { cap } = await planApproved(fake, PLAN_A);
                await fake.runTool("todo", { action: "update", id: 2, status: "completed" }, cap.ctx);
                expect(cap.statuses.some(([key, text]) => key === "plan-mode" && text === "plan 1/2")).toBe(true);
                const persisted = fake.appended.filter((e) => e.customType === "unown-plan-mode");
                const last = persisted[persisted.length - 1].data;
                expect(last.steps[1].completed).toBe(true);
                expect(last.steps[0].completed).toBe(false);
        });

        test("planning suspends the overlay; abandoning planning brings the list back", async () => {
                const fake = await wire();
                const { cap } = await planApproved(fake, PLAN_A);
                const mountedAfterApproval = cap.widgets.filter(
                        (w) => w.key === "unown-todos" && typeof w.value === "function",
                ).length;
                expect(mountedAfterApproval).toBeGreaterThanOrEqual(1);
                // Re-enter plan mode: the leftover list stands down (the two-lists bug's
                // planning half) — data kept, widget unmounted.
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx);
                expect(cap.widgets.some((w) => w.key === "unown-todos" && w.value === undefined)).toBe(true);
                const duringPlanning = cap.widgets.filter((w) => w.key === "unown-todos" && typeof w.value === "function").length;
                expect(duringPlanning).toBe(mountedAfterApproval); // no NEW mounts while planning
                // Abandon planning: the list returns without an approval reseed.
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx);
                const remounts = cap.widgets.filter((w) => w.key === "unown-todos" && typeof w.value === "function").length;
                expect(remounts).toBeGreaterThan(duringPlanning);
                expect(await todoList(fake, cap.ctx)).toContain("Add the button component");
        });

        test("M5: the fallback gate's execute instruction is display:false (single echo)", async () => {
                const fake = await wire();
                const cap = makeCaptureCtx(["Execute \u2014 auto-accept edits"]);
                await fake.emit("session_start", {}, cap.ctx);
                await fake.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
                await fake.runTool("plan_write", { content: PLAN_A }, cap.ctx);
                // NO exit_plan_mode: the agent_end fallback gate picks the plan file up.
                await fake.emit(
                        "agent_end",
                        {
                                messages: [
                                        { role: "user", content: "plan it" },
                                        { role: "assistant", content: [{ type: "text", text: "I have written the plan." }] },
                                ],
                        },
                        cap.ctx,
                );
                const echo = fake.sent.find((s) => s.message.customType === "unown-plan-echo");
                const execute = fake.sent.find((s) => s.message.customType === "unown-plan-execute");
                expect(echo).toBeDefined();
                expect(echo.message.display).toBe(true); // the user sees the approved plan ONCE
                expect(execute).toBeDefined();
                expect(execute.message.display).toBe(false); // the model-facing instruction is silent
                // ...and the seeded overlay is the live checklist, not a second echo list.
                expect(cap.widgets.some((w) => w.key === "unown-todos" && typeof w.value === "function")).toBe(true);
        });

        test("RESUME: [DONE:n]-completed steps flip the replayed seeded todos", async () => {
                const fake = await wire([
                        {
                                type: "custom",
                                customType: "unown-plan-mode",
                                data: {
                                        enabled: false,
                                        executing: true,
                                        steps: [
                                                { step: 1, text: "Add the button component", files: [], completed: true },
                                                { step: 2, text: "Wire the click handler to the export API", files: [], completed: false },
                                        ],
                                },
                        },
                        {
                                type: "message",
                                message: {
                                        role: "toolResult",
                                        toolName: "todo",
                                        details: {
                                                action: "seed",
                                                params: {
                                                        action: "seed",
                                                        subjects: ["Add the button component", "Wire the click handler to the export API"],
                                                },
                                                tasks: [
                                                        { id: 1, subject: "Add the button component", status: "pending" },
                                                        { id: 2, subject: "Wire the click handler to the export API", status: "pending" },
                                                ],
                                                nextId: 3,
                                        },
                                },
                        },
                ]);
                const cap = makeCaptureCtx([], fake.entriesForCtx);
                await fake.emit("session_start", {}, cap.ctx);
                const list = await todoList(fake, cap.ctx);
                expect(list).toContain("completed"); // step 1's todo flipped by the reconcile
                const syncs = fake.appended.filter((e) => e.customType === "unown-todo-state" && e.data.action === "sync");
                expect(syncs).toHaveLength(1);
                expect(syncs[0].data.tasks[0].status).toBe("completed");
        });

        test("RESUME: completed replayed todos flip the plan steps (chip agrees)", async () => {
                const fake = await wire([
                        {
                                type: "custom",
                                customType: "unown-plan-mode",
                                data: {
                                        enabled: false,
                                        executing: true,
                                        steps: [
                                                { step: 1, text: "Add the button component", files: [], completed: false },
                                                { step: 2, text: "Wire the click handler to the export API", files: [], completed: false },
                                        ],
                                },
                        },
                        {
                                type: "message",
                                message: {
                                        role: "toolResult",
                                        toolName: "todo",
                                        details: {
                                                action: "seed",
                                                params: {
                                                        action: "seed",
                                                        subjects: ["Add the button component", "Wire the click handler to the export API"],
                                                },
                                                tasks: [
                                                        { id: 1, subject: "Add the button component", status: "completed" },
                                                        { id: 2, subject: "Wire the click handler to the export API", status: "pending" },
                                                ],
                                                nextId: 3,
                                        },
                                },
                        },
                ]);
                const cap = makeCaptureCtx([], fake.entriesForCtx);
                await fake.emit("session_start", {}, cap.ctx);
                // The completed todo completed the plan step: the footer chip agrees.
                expect(cap.statuses.some(([key, text]) => key === "plan-mode" && text === "plan 1/2")).toBe(true);
                const persisted = fake.appended.filter((e) => e.customType === "unown-plan-mode");
                const last = persisted[persisted.length - 1].data;
                expect(last.steps[0].completed).toBe(true);
                expect(last.steps[1].completed).toBe(false);
        });

        test("RELOAD: a /addons disable + /reload retires the bridges - the legacy widget returns", async () => {
                // The 0.0.53 recovery round's production pin: the todo bridges are a
                // (re)registration-cycle contract, not a one-way latch. Cycle 1
                // registers the addon (bridges live); the user then disables the todo
                // addon (the /addons toggle's durable write) and /reload re-runs BOTH
                // factories in the SAME process. The addons factory must reset the
                // bridges so isTodoOverlayAvailable() answers for the CURRENT cycle and
                // the legacy plan-steps widget is the execution surface again. Before
                // the fix the latch stayed set, the overlay could never remount, and
                // the fallback stayed retired: NO progress surface until a full
                // process restart.
                const configPath = addonsConfigPath();
                const savedConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
                try {
                        // Cycle 1 - todo enabled (the default config): the bridges go live.
                        const cycleA = makeFakePi([]);
                        createUnownAddonsExtension({ cwd: tmpRoot }).factory(cycleA.pi);
                        expect(isTodoOverlayAvailable()).toBe(true);

                        // The /addons toggle's durable write: todo off, everything else as-is.
                        const disabled = loadAddonsConfig();
                        disabled.todo.enabled = false;
                        saveAddonsConfig(disabled);

                        // Cycle 2 - /reload: fresh factories, SAME process (boot order:
                        // unown-tools first, the addons extension second).
                        const cycleB = makeFakePi([]);
                        const toolsDir = join(tmpRoot, `reload-${Math.random().toString(36).slice(2)}`);
                        createUnownToolsExtension({ cwd: toolsDir, engineUrl: "http://127.0.0.1:9" }).factory(cycleB.pi);
                        createUnownAddonsExtension({ cwd: tmpRoot }).factory(cycleB.pi);
                        expect(isTodoOverlayAvailable()).toBe(false); // the latch reset

                        // The legacy widget is the surface again: approving a plan mounts
                        // plan-steps, never the unown-todos overlay.
                        const cap = makeCaptureCtx(["Execute — auto-accept edits"]);
                        await cycleB.emit("session_start", {}, cap.ctx);
                        await cycleB.shortcuts.get("ctrl+alt+p")!.handler(cap.ctx); // plan mode ON
                        await cycleB.runTool("plan_write", { content: PLAN_A }, cap.ctx);
                        const result = await cycleB.runTool("exit_plan_mode", {}, cap.ctx);
                        expect(JSON.stringify(result)).toContain("approved your plan");
                        expect(cap.widgets.some((w) => w.key === "unown-todos")).toBe(false);
                        const legacy = cap.widgets.filter((w) => w.key === "plan-steps" && Array.isArray(w.value));
                        expect(legacy.length).toBeGreaterThanOrEqual(1);
                        expect(legacy[legacy.length - 1].value.join(" ")).toContain("Add the button component");
                } finally {
                        // The shared addons.json is cross-file state - restore it byte-exactly
                        // (the models-catalog SAVED_MODELS pattern: absent stays absent).
                        if (savedConfig === null) rmSync(configPath, { force: true });
                        else writeFileSync(configPath, savedConfig, "utf8");
                }
        });
});
