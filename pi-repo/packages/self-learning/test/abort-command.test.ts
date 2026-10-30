// abort-command.test.ts — the /abort slash command registered by the
// unown-tools extension (the sessions round): the named surface for the
// unified abort matrix (Esc parity). Pins:
//   1. the command registers with the Esc-parity description
//   2. idle → honest "Nothing to abort" notice, abortActiveOperation NOT
//      called twice, exit stays in the command (no throw)
//   3. streaming (isIdle false, matrix true) → the turn-abort notice naming
//      the editor queue restore + `unown -c`
//   4. non-streaming activity (bash/compaction/retry: isIdle true, matrix
//      true) → the operation-abort notice
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUnownToolsExtension } from "../src/tools.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-abort-test-"));
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
    const pi: any = {
        on: () => {},
        registerCommand: (name: string, def: { description: string; handler: Handler }) =>
            commands.set(name, def),
        registerFlag: () => {},
        registerTool: () => {},
        registerShortcut: () => {},
        appendEntry: () => {},
        getFlag: () => undefined,
        getActiveTools: () => ["read", "bash", "edit", "write"],
        setActiveTools: () => {},
        sendMessage: () => {},
    };
    return { pi, commands };
}

/** A ctx whose abort matrix answers `matrix` and whose idle probe answers
 *  `idle` — the two probes /abort makes before wording its notice. */
function makeCtx(matrix: boolean, idle: boolean) {
    const messages: Array<{ text: string; level: string }> = [];
    const calls: string[] = [];
    return {
        messages,
        calls,
        ctx: {
            hasUI: true,
            mode: "tui",
            isIdle: () => {
                calls.push("isIdle");
                return idle;
            },
            abortActiveOperation: () => {
                calls.push("abortActiveOperation");
                return matrix;
            },
            ui: {
                notify: (text: string, level: string = "info") => messages.push({ text, level }),
                setStatus: () => {},
                setWidget: () => {},
                select: async () => null,
                editor: async () => "",
            },
            sessionManager: { getEntries: () => [] },
        },
    };
}

async function wireAbort() {
    const dir = join(tmpRoot, "ext");
    const ext = createUnownToolsExtension({ cwd: dir, engineUrl: "http://127.0.0.1:3030" });
    const fake = makeFakePi();
    ext.factory(fake.pi);
    return fake;
}

describe("/abort wiring in the unown-tools extension", () => {
    test("registers with the Esc-parity description", async () => {
        const fake = await wireAbort();
        const cmd = fake.commands.get("abort");
        expect(cmd).toBeDefined();
        expect(cmd!.description).toContain("turn");
        expect(cmd!.description).toContain("Esc");
        expect(cmd!.description).toContain("unown -c");
    });

    test("idle → the honest nothing-to-abort notice, one probe + one abort call", async () => {
        const fake = await wireAbort();
        const probe = makeCtx(false, true);
        await fake.commands.get("abort")!.handler("", probe.ctx);
        expect(probe.messages).toHaveLength(1);
        expect(probe.messages[0].text).toContain("Nothing to abort");
        expect(probe.messages[0].text).toContain("Esc");
        expect(probe.calls).toEqual(["isIdle", "abortActiveOperation"]);
    });

    test("streaming → the turn-abort notice (queue restore + resume hint)", async () => {
        const fake = await wireAbort();
        const probe = makeCtx(true, false);
        await fake.commands.get("abort")!.handler("", probe.ctx);
        expect(probe.messages).toHaveLength(1);
        expect(probe.messages[0].text).toContain("Aborted the running turn");
        expect(probe.messages[0].text).toContain("queued messages are back in the editor");
        expect(probe.messages[0].text).toContain("unown -c");
    });

    test("non-streaming activity → the operation-abort notice", async () => {
        const fake = await wireAbort();
        const probe = makeCtx(true, true);
        await fake.commands.get("abort")!.handler("", probe.ctx);
        expect(probe.messages).toHaveLength(1);
        expect(probe.messages[0].text).toContain("Aborted the running operation");
        expect(probe.messages[0].text).toContain("bash / compaction / retry");
    });

    test("the handler never throws on any state combination", async () => {
        const fake = await wireAbort();
        for (const [matrix, idle] of [
            [false, true],
            [true, false],
            [true, true],
        ] as const) {
            const probe = makeCtx(matrix, idle);
            await expect(fake.commands.get("abort")!.handler("", probe.ctx)).resolves.toBeUndefined();
        }
    });
});
