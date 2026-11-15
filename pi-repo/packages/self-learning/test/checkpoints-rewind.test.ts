// checkpoints-rewind.test.ts — the /rewind picker (Toccata round A14, the
// Claude Code rewind-menu port in src/checkpoints.ts): turn manifests carry
// the conversation point (entryId — the prompt that drove the turn), the
// picker lists checkpoints with their prompt previews, and the action menu
// offers restore code / restore conversation / both — gated exactly like
// Claude Code's (the two code restores only with tracked file changes).
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpointsDir, CheckpointStore, createCheckpointsExtension } from "../src/checkpoints.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-rewind-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
    const handlers = new Map<string, Handler[]>();
    const commands = new Map<string, { description: string; handler: Handler }>();
    const navigateCalls: Array<{ targetId: string; options?: any }> = [];
    const pi: any = {
        on: (event: string, handler: Handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
        },
        registerCommand: (name: string, def: { description: string; handler: Handler }) => {
            commands.set(name, def);
        },
        navigateTree: async (targetId: string, options?: any) => {
            navigateCalls.push({ targetId, options });
            return { cancelled: false, editorText: undefined };
        },
    };
    const emit = async (event: string, payload: any, ctx?: any) => {
        for (const h of handlers.get(event) ?? []) await h(payload, ctx);
    };
    const runCommand = async (name: string, args: string, ctx: any) => {
        const def = commands.get(name);
        if (!def) throw new Error(`no command ${name}`);
        await def.handler(args, ctx);
    };
    return { pi, emit, runCommand, commands, navigateCalls };
}

interface ScriptedUi {
    selects: Array<{ title: string; options: string[] }>;
    messages: Array<{ text: string; level: string }>;
}

function makeCtx(sessionEntries: any[], picks: Array<string | undefined>) {
    const ui: ScriptedUi = { selects: [], messages: [] };
    return {
        ui: {
            selects: ui.selects,
            select: async (title: string, options: string[]) => {
                ui.selects.push({ title, options });
                return picks.shift();
            },
            notify: (text: string, level: string) => ui.messages.push({ text, level }),
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...{},
        hasUI: true,
        sessionManager: {
            getEntries: () => sessionEntries,
        },
        _ui: ui,
    };
}

/** Drive one full turn that writes `file`, sealing a checkpoint with `entryId`. */
async function sealTurnWithWrite(
    proj: string,
    file: string,
    before: string,
    after: string,
    promptEntry: { id: string; message: { role: string; content: unknown } },
): Promise<{ emit: (event: string, payload: any, ctx?: any) => Promise<void>; navigateCalls: Array<{ targetId: string }> }> {
    const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
    const { pi, emit, navigateCalls } = makeFakePi();
    ext.factory(pi);
    const ctx = { sessionManager: { getEntries: () => [promptEntry] } };
    await emit("session_start", {});
    await emit("input", { text: "change the file" }, ctx);
    await emit("tool_call", { toolName: "write", toolCallId: "tc1", input: { path: file, content: after } }, ctx);
    await emit(
        "tool_result",
        { toolName: "write", toolCallId: "tc1", input: { path: file }, content: [{ type: "text", text: "ok" }], isError: false },
        ctx,
    );
    writeFileSync(file, after); // the write landed
    await emit("agent_end", {}, ctx); // seals the turn checkpoint
    return { emit, navigateCalls };
}

describe("/rewind picker (Toccata A14 — the Claude Code rewind menu)", () => {
    test("a sealed turn manifest carries the turn's prompt entry id", async () => {
        const proj = join(tmpRoot, "entryid");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "a.ts");
        writeFileSync(file, "v0");
        await sealTurnWithWrite(proj, file, "v0", "v1", {
            id: "entry-7",
            message: { role: "user", content: "please change a.ts" },
        });
        const store = new CheckpointStore(checkpointsDir(proj));
        const turns = store.list().filter((m) => m.kind === "turn");
        expect(turns).toHaveLength(1);
        expect((turns[0] as any).entryId).toBe("entry-7");
    });

    test("no checkpoints → an honest notice, no pickers", async () => {
        const proj = join(tmpRoot, "empty");
        mkdirSync(proj, { recursive: true });
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, runCommand } = makeFakePi();
        ext.factory(pi);
        const ctx = makeCtx([], []);
        await runCommand("rewind", "", ctx);
        expect(ctx._ui.messages).toHaveLength(1);
        expect(ctx._ui.messages[0]!.text).toContain("No checkpoints");
        expect(ctx._ui.selects).toHaveLength(0);
    });

    test("the picker lists prompt previews; code+conversation restores files AND navigates", async () => {
        const proj = join(tmpRoot, "both");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "b.ts");
        writeFileSync(file, "before");
        const { navigateCalls } = await sealTurnWithWrite(proj, file, "before", "after", {
            id: "entry-1",
            message: { role: "user", content: "rewrite b.ts please" },
        });
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, runCommand, navigateCalls: rewindNavigations } = makeFakePi();
        ext.factory(pi);
        const ctx = makeCtx(
            [{ id: "entry-1", message: { role: "user", content: "rewrite b.ts please" } }],
            ["pick-1", "Restore code and conversation"],
        );
        // Replace select to return by row content: patch picks by index — use
        // a custom select that answers with the row that contains the preview.
        let selectIndex = 0;
        ctx.ui.select = async (title: string, options: string[]) => {
            ctx._ui.selects.push({ title, options });
            if (selectIndex === 0) {
                selectIndex += 1;
                return options.find((o) => o.includes("rewrite b.ts please"));
            }
            return options[0];
        };
        await runCommand("rewind", "", ctx);

        // Code restored to the before-image.
        expect(readFileSync(file, "utf8")).toBe("before");
        // Conversation rewound to the turn's prompt entry (through the command's own pi).
        expect(rewindNavigations).toHaveLength(1);
        expect(rewindNavigations[0]!.targetId).toBe("entry-1");
        // The action menu offered the Claude Code labels.
        const actionSelect = ctx._ui.selects[1]!;
        expect(actionSelect.options).toContain("Restore code and conversation");
        expect(actionSelect.options).toContain("Restore conversation");
        expect(actionSelect.options).toContain("Restore code");
        expect(actionSelect.options).toContain("Never mind");
        expect(ctx._ui.messages.some((m) => m.text.includes("Rewound"))).toBe(true);
    });

    test("restore conversation only: files untouched, navigate to the prompt entry", async () => {
        const proj = join(tmpRoot, "convo");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "c.ts");
        writeFileSync(file, "before");
        const { navigateCalls } = await sealTurnWithWrite(proj, file, "before", "after", {
            id: "entry-2",
            message: { role: "user", content: "touch c.ts" },
        });
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, runCommand, navigateCalls: fresh } = makeFakePi();
        ext.factory(pi);
        const ctx = makeCtx([{ id: "entry-2", message: { role: "user", content: "touch c.ts" } }], []);
        let selectIndex = 0;
        ctx.ui.select = async (title: string, options: string[]) => {
            ctx._ui.selects.push({ title, options });
            if (selectIndex === 0) {
                selectIndex += 1;
                return options.find((o) => o.includes("touch c.ts"));
            }
            return "Restore conversation";
        };
        await runCommand("rewind", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("after"); // untouched
        expect(fresh).toHaveLength(1);
        expect(fresh[0]!.targetId).toBe("entry-2");
        expect(navigateCalls).toHaveLength(0); // the sealing pi was never navigated
    });

    test("a manifest without entryId offers code restores only (legacy manifests)", async () => {
        const proj = join(tmpRoot, "legacy");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "d.ts");
        writeFileSync(file, "v0");
        // Seal WITHOUT a ctx (no session entries) — the legacy shape.
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit, runCommand } = makeFakePi();
        ext.factory(pi);
        await emit("session_start", {});
        await emit("input", { text: "write it" });
        await emit("tool_call", { toolName: "write", toolCallId: "t", input: { path: file, content: "v1" } });
        await emit("tool_result", { toolName: "write", toolCallId: "t", input: { path: file }, content: [], isError: false });
        writeFileSync(file, "v1");
        await emit("agent_end", {});
        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.list().some((m) => (m as any).entryId === undefined)).toBe(true);

        const ctx = makeCtx([], []);
        let selectIndex = 0;
        ctx.ui.select = async (title: string, options: string[]) => {
            ctx._ui.selects.push({ title, options });
            if (selectIndex === 0) {
                selectIndex += 1;
                return options[0];
            }
            return "Restore code";
        };
        await runCommand("rewind", "", ctx);
        const actions = ctx._ui.selects[1]!.options;
        expect(actions).not.toContain("Restore code and conversation");
        expect(actions).not.toContain("Restore conversation");
        expect(actions).toContain("Restore code");
        expect(readFileSync(file, "utf8")).toBe("v0");
    });

    test("'Never mind' leaves everything untouched", async () => {
        const proj = join(tmpRoot, "never");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "e.ts");
        writeFileSync(file, "before");
        await sealTurnWithWrite(proj, file, "before", "after", {
            id: "entry-3",
            message: { role: "user", content: "edit e.ts" },
        });
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, runCommand } = makeFakePi();
        ext.factory(pi);
        const ctx = makeCtx([{ id: "entry-3", message: { role: "user", content: "edit e.ts" } }], []);
        let selectIndex = 0;
        ctx.ui.select = async (title: string, options: string[]) => {
            ctx._ui.selects.push({ title, options });
            if (selectIndex === 0) {
                selectIndex += 1;
                return options.find((o) => o.includes("edit e.ts"));
            }
            return "Never mind";
        };
        await runCommand("rewind", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("after");
        expect(ctx._ui.messages).toHaveLength(0);
    });
});
