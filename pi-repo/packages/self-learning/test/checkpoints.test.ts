// Unit tests for src/checkpoints.ts — the receipts ledger + checkpoint store
// (the codewhale receipts / Claude-Gemini checkpointing port).
//
// Layers:
//   1. pure helpers — insideRoot jail, slugify, previewText,
//      describeToolInput, renderReceipts totals
//   2. ReceiptsLedger — append/read round-trip, truncated-tail tolerance,
//      entry cap
//   3. CheckpointStore — content-addressed blobs (dedup), captureFile
//      (existing + tombstone), restore (restored/deleted/missing-blob/
//      outside-jail), manifest listing, prune + blob GC
//   4. the extension factory — a fake `pi` capturing handlers, then driving
//      the full turn lifecycle: input → tool_call(write) → tool_result →
//      input (seals turn checkpoint) → /undo restores the before-image;
//      named /checkpoint + /restore; receipts rendering
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    checkpointsDir,
    CheckpointStore,
    createCheckpointsExtension,
    describeToolInput,
    insideRoot,
    previewText,
    ReceiptsLedger,
    receiptsDir,
    renderCheckpoints,
    renderReceipts,
    sha256,
    slugify,
} from "../src/checkpoints.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-cp-test-"));
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

describe("pure helpers", () => {
    test("insideRoot jails restores to the project dir", () => {
        const root = join(tmpRoot, "proj");
        expect(insideRoot(root, join(root, "a.ts"))).toBe(true);
        expect(insideRoot(root, join(root, "sub", "b.ts"))).toBe(true);
        expect(insideRoot(root, "/etc/passwd")).toBe(false);
        expect(insideRoot(root, join(root, "..", "escape.ts"))).toBe(false);
    });
    test("slugify", () => {
        expect(slugify("Before Refactor!")).toBe("before-refactor");
        expect(slugify("  ")).toBe("checkpoint");
        expect(slugify("a".repeat(80))).toHaveLength(40);
    });
    test("previewText caps and flattens", () => {
        expect(previewText([{ type: "text", text: "hello  world" }])).toBe("hello world");
        expect(previewText("x".repeat(500))).toHaveLength(200);
        expect(previewText([{ type: "image", ...{} }])).toBe("");
        expect(previewText(null)).toBe("");
    });
    test("describeToolInput shapes per tool", () => {
        expect(describeToolInput("bash", { command: "ls  -la" })).toBe('"ls -la"');
        expect(describeToolInput("write", { path: "/tmp/x.ts" })).toBe("/tmp/x.ts");
        expect(describeToolInput("fetch_url", { url: "https://example.com/page" })).toBe("https://example.com/page");
        expect(describeToolInput("task", { agent: "explore", task: "map the repo" })).toBe('→ explore "map the repo"');
        expect(describeToolInput("read", {})).toBe("");
    });
});

// ---------------------------------------------------------------------------
// 2. ReceiptsLedger
// ---------------------------------------------------------------------------

describe("ReceiptsLedger", () => {
    test("append + entries round-trip with seq/ts assigned", () => {
        const dir = join(tmpRoot, "ledger1", ".unown", "receipts");
        const ledger = new ReceiptsLedger(join(dir, "s1.jsonl"));
        ledger.append({ kind: "session_start", subagent: false, cwd: "/proj" });
        ledger.append({ kind: "input", preview: "fix the bug" });
        ledger.append({ kind: "tool_call", id: "t1", tool: "write", input: { path: "/proj/a.ts" } });
        ledger.append({ kind: "tool_result", id: "t1", tool: "write", isError: false, preview: "ok" });
        const entries = ledger.entries();
        expect(entries.map((e) => e.kind)).toEqual(["session_start", "input", "tool_call", "tool_result"]);
        expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
        expect(entries.every((e) => e.ts > 0)).toBe(true);
    });
    test("tolerates a truncated tail line", () => {
        const file = join(tmpRoot, "ledger2", ".unown", "receipts", "s2.jsonl");
        const ledger = new ReceiptsLedger(file);
        ledger.append({ kind: "input", preview: "a" });
        writeFileSync(file, '{"kind":"input","prev', { flag: "a" });
        const entries = ledger.entries();
        expect(entries).toHaveLength(1);
    });
    test("entry cap stops writing but never throws", () => {
        const file = join(tmpRoot, "ledger3", ".unown", "receipts", "s3.jsonl");
        const ledger = new ReceiptsLedger(file);
        for (let i = 0; i < 5010; i++) ledger.append({ kind: "input", preview: String(i) });
        expect(ledger.entries().length).toBeLessThanOrEqual(5000);
    });
    test("renderReceipts totals and lines", () => {
        const entries = [
            { seq: 1, ts: Date.now(), kind: "session_start", subagent: false, cwd: "/p" },
            { seq: 2, ts: Date.now(), kind: "input", preview: "do things" },
            { seq: 3, ts: Date.now(), kind: "tool_call", id: "a", tool: "write", input: { path: "/p/a.ts" } },
            { seq: 4, ts: Date.now(), kind: "tool_result", id: "a", tool: "write", isError: false, preview: "" },
            { seq: 5, ts: Date.now(), kind: "tool_result", id: "b", tool: "bash", isError: true, preview: "blocked" },
            { seq: 6, ts: Date.now(), kind: "checkpoint", id: "t1", files: 2, turn: true },
        ] as any[];
        const text = renderReceipts(entries, 10);
        expect(text).toContain("1 input(s), 1 tool call(s)");
        expect(text).toContain("[write×1]");
        expect(text).toContain("1 distinct file(s) written");
        expect(text).toContain("1 error(s)");
        expect(text).toContain("FAIL");
        expect(text).toContain("ckpt   t1");
    });
});

// ---------------------------------------------------------------------------
// 3. CheckpointStore
// ---------------------------------------------------------------------------

describe("CheckpointStore", () => {
    test("blobs are content-addressed and deduplicated", () => {
        const dir = join(tmpRoot, "store1");
        const store = new CheckpointStore(dir);
        const h1 = store.putBlob("hello");
        const h2 = store.putBlob("hello");
        expect(h1).toBe(h2);
        expect(h1).toBe(sha256("hello"));
        expect(store.readBlob(h1)?.toString()).toBe("hello");
    });
    test("captureFile: existing file → blob; missing → tombstone", () => {
        const dir = join(tmpRoot, "store2");
        const store = new CheckpointStore(dir);
        const file = join(tmpRoot, "store2src", "a.txt");
        mkdirSync(join(tmpRoot, "store2src"), { recursive: true });
        writeFileSync(file, "content-1");
        const captured = store.captureFile(file);
        expect(captured?.hash).toBe(sha256("content-1"));
        expect(captured?.size).toBe(9);
        const missing = store.captureFile(join(tmpRoot, "store2src", "nope.txt"));
        expect(missing?.hash).toBe(null);
    });
    test("restore: restored / deleted (tombstone) / missing-blob / outside jail", () => {
        const proj = join(tmpRoot, "store3proj");
        mkdirSync(proj, { recursive: true });
        const dir = join(tmpRoot, "store3");
        const store = new CheckpointStore(dir);
        const file = join(proj, "a.txt");
        writeFileSync(file, "v2");
        const hash = store.putBlob("v1");
        const outsideHash = store.putBlob("outside");
        const outcomes = store.restore(
            {
                id: "x",
                seq: 1,
                kind: "named",
                ts: Date.now(),
                files: [
                    { path: "a.txt", hash, size: 2 },
                    { path: "b.txt", hash: null, size: 0 },
                    { path: "c.txt", hash: "deadbeef".repeat(8), size: 0 },
                    { path: join("..", "escape.txt"), hash: outsideHash, size: 7 },
                ],
            },
            proj,
        );
        expect(outcomes[0]).toMatchObject({ ok: true, action: "restored" });
        expect(readFileSync(file, "utf8")).toBe("v1");
        expect(outcomes[1]).toMatchObject({ ok: true, action: "deleted" });
        expect(existsSync(join(proj, "b.txt"))).toBe(false);
        expect(outcomes[2]).toMatchObject({ ok: false, action: "missing-blob" });
        expect(outcomes[3]).toMatchObject({ ok: false, action: "outside" });
        expect(existsSync(join(tmpRoot, "escape.txt"))).toBe(false);
    });
    test("manifest list is seq-ordered and tolerates broken files; prune GCs blobs", () => {
        const dir = join(tmpRoot, "store4");
        const store = new CheckpointStore(dir);
        store.writeManifest({ id: "m1", seq: 1, kind: "named", ts: 1, files: [{ path: "a", hash: store.putBlob("aaa"), size: 3 }] });
        store.writeManifest({ id: "m2", seq: 2, kind: "named", ts: 2, files: [{ path: "b", hash: store.putBlob("bbb"), size: 3 }] });
        writeFileSync(join(dir, `${"cp-"}broken.json`), "{not json");
        const list = store.list();
        expect(list.map((m) => m.id)).toEqual(["m1", "m2"]);
        // prune(1) drops m1 and GCs the "aaa" blob
        const removed = store.prune(1);
        expect(removed).toBe(1);
        expect(store.list().map((m) => m.id)).toEqual(["m2"]);
        expect(store.readBlob(sha256("aaa"))).toBe(null);
        expect(store.readBlob(sha256("bbb"))).not.toBe(null);
    });
    test("renderCheckpoints empty + populated", () => {
        expect(renderCheckpoints([], 0)).toContain("No checkpoints yet");
        const text = renderCheckpoints(
            [
                { id: "t1", seq: 1, kind: "turn", ts: Date.now(), files: [] as any[] },
                { id: "n1", seq: 2, kind: "named", label: "before-refactor", ts: Date.now(), files: [] as any[] },
            ],
            2048,
        );
        expect(text).toContain("t1 [turn]");
        expect(text).toContain("n1 [named]");
        expect(text).toContain('"before-refactor"');
        expect(text).toContain("~2 KB");
    });
});

// ---------------------------------------------------------------------------
// 4. Extension factory — the full turn lifecycle through a fake pi
// ---------------------------------------------------------------------------

type Handler = (event: any, ctx?: any) => any;

function makeFakePi() {
    const handlers = new Map<string, Handler[]>();
    const commands = new Map<string, { description: string; handler: Handler }>();
    const pi: any = {
        on: (event: string, handler: Handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event)!.push(handler);
        },
        registerCommand: (name: string, def: { description: string; handler: Handler }) => {
            commands.set(name, def);
        },
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
        const def = commands.get(name);
        if (!def) throw new Error(`no command ${name}`);
        await def.handler(args, ctx);
    };
    return { pi, emit, runCommand, commands };
}

function makeNotify() {
    const messages: Array<{ text: string; level: string }> = [];
    return {
        messages,
        ctx: { ui: { notify: (text: string, level: string = "info") => messages.push({ text, level }) } },
    };
}

describe("createCheckpointsExtension — turn lifecycle", () => {
    test("write → next input seals a turn checkpoint → /undo restores before-image", async () => {
        const proj = join(tmpRoot, "ext1");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "src.ts");
        writeFileSync(file, "original();\n");

        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeNotify();

        await emit("session_start", {});
        await emit("input", { text: "change the file" });
        await emit("tool_call", { toolName: "write", toolCallId: "tc1", input: { path: file, content: "changed();" } });
        await emit("tool_result", { toolName: "write", toolCallId: "tc1", input: { path: file }, content: [{ type: "text", text: "ok" }], isError: false });
        expect(readFileSync(file, "utf8")).toBe("original();\n"); // tool not actually run in this harness

        // simulate the write landing on disk
        writeFileSync(file, "changed();");
        // next input seals the turn checkpoint
        await emit("input", { text: "next turn" });

        const store = new CheckpointStore(checkpointsDir(proj));
        const turns = store.list().filter((m) => m.kind === "turn");
        expect(turns).toHaveLength(1);
        expect(turns[0].files).toHaveLength(1);
        expect(turns[0].files[0].hash).toBe(sha256("original();\n"));

        // /undo reverts to the pre-turn state
        await runCommand("undo", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("original();\n");
        expect(messages.some((m) => m.text.includes("1 turn(s)"))).toBe(true);
        // the walked-back checkpoint is consumed
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(0);

        // receipts ledger recorded the whole flow
        const ledger = new ReceiptsLedger(join(proj, ".unown", "receipts", "r.jsonl"));
        const kinds = ledger.entries().map((e) => e.kind);
        expect(kinds).toContain("session_start");
        expect(kinds).toContain("tool_call");
        expect(kinds).toContain("tool_result");
        expect(kinds).toContain("checkpoint");
        expect(kinds).toContain("restore");
    });

    test("failed writes are not sealed (before-image dropped)", async () => {
        const proj = join(tmpRoot, "ext2");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "a.ts");
        writeFileSync(file, "v0");

        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit } = makeFakePi();
        ext.factory(pi);

        await emit("input", { text: "try to write" });
        await emit("tool_call", { toolName: "write", toolCallId: "t1", input: { path: file, content: "v1" } });
        await emit("tool_result", { toolName: "write", toolCallId: "t1", input: { path: file }, content: [{ type: "text", text: "blocked: path escapes" }], isError: true });
        await emit("input", { text: "next" });

        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(0);
        // but the denial IS in the receipts ledger
        const ledger = new ReceiptsLedger(join(proj, ".unown", "receipts", "r.jsonl"));
        const failed = ledger.entries().filter((e) => e.kind === "tool_result" && e.isError);
        expect(failed).toHaveLength(1);
        expect((failed[0] as any).preview).toContain("blocked");
    });

    test("new-file writes become tombstones — /undo deletes them", async () => {
        const proj = join(tmpRoot, "ext3");
        mkdirSync(proj, { recursive: true });
        const file = join(proj, "new.ts");

        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx } = makeNotify();

        await emit("input", { text: "create a file" });
        await emit("tool_call", { toolName: "write", toolCallId: "t1", input: { path: file, content: "brand new" } });
        await emit("tool_result", { toolName: "write", toolCallId: "t1", input: { path: file }, content: [], isError: false });
        writeFileSync(file, "brand new"); // the write landed
        await emit("input", { text: "next" });

        await runCommand("undo", "", ctx);
        expect(existsSync(file)).toBe(false); // tombstoned away
    });

    test("named /checkpoint + /restore round-trip; /checkpoints lists", async () => {
        const proj = join(tmpRoot, "ext4");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "state.ts");

        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit, runCommand } = makeFakePi();
        ext.factory(pi);
        const { ctx, messages } = makeNotify();

        // session writes the file once so it lands in sessionTouched
        writeFileSync(file, "state-1");
        await emit("input", { text: "edit" });
        await emit("tool_call", { toolName: "edit", toolCallId: "t1", input: { path: file, old: "a", new: "b" } });
        await emit("tool_result", { toolName: "edit", toolCallId: "t1", input: { path: file }, content: [], isError: false });
        writeFileSync(file, "state-1-edited");

        await runCommand("checkpoint", "before-refactor", ctx);
        const store = new CheckpointStore(checkpointsDir(proj));
        const named = store.list().find((m) => m.kind === "named");
        expect(named?.label).toBe("before-refactor");
        expect(named?.files[0].hash).toBe(sha256("state-1-edited"));

        // change the file, then restore by label
        writeFileSync(file, "state-2-total-rewrite");
        await runCommand("restore", "before-refactor", ctx);
        expect(readFileSync(file, "utf8")).toBe("state-1-edited");
        expect(messages.some((m) => m.text.includes("Restored"))).toBe(true);

        await runCommand("checkpoints", "", ctx);
        expect(messages.some((m) => m.text.includes("before-refactor"))).toBe(true);
    });

    test("subagent flag marks the ledger", async () => {
        const proj = join(tmpRoot, "ext5");
        mkdirSync(proj, { recursive: true });
        const prev = process.env.UNOWN_SUBAGENT;
        process.env.UNOWN_SUBAGENT = "1";
        try {
            const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
            const { pi, emit } = makeFakePi();
            ext.factory(pi);
            await emit("session_start", {});
            const ledger = new ReceiptsLedger(join(proj, ".unown", "receipts", "r.jsonl"));
            const start = ledger.entries().find((e) => e.kind === "session_start") as any;
            expect(start.subagent).toBe(true);
        } finally {
            if (prev === undefined) delete process.env.UNOWN_SUBAGENT;
            else process.env.UNOWN_SUBAGENT = prev;
        }
    });

    test("paths helpers point under .unown", () => {
        expect(receiptsDir("/p").endsWith(join(".unown", "receipts"))).toBe(true);
        expect(checkpointsDir("/p").endsWith(join(".unown", "checkpoints"))).toBe(true);
    });
});
