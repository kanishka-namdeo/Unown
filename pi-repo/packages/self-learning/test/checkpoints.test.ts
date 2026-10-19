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
//   5. H1 hardening — atomic writes + self-heal, corrupt-blob verification,
//      GC grace + the two-store GC race, the realpath jail, oversized
//      captures, ownership (/undo --all, per-owner prune floors), and
//      crash-safe undo ordering (the R-b §5 reproductions made deterministic)
import { spawnSync } from "node:child_process";
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    checkpointsDir,
    CheckpointStore,
    createCheckpointsExtension,
    describeToolInput,
    ensureUnownGitignore,
    insideRoot,
    insideRootReal,
    previewText,
    ReceiptsLedger,
    receiptsDir,
    redactSecrets,
    redactToolInput,
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
// 1b. Privacy redaction (R-b V2/U4)
// ---------------------------------------------------------------------------

describe("redactSecrets + redactToolInput", () => {
    test("redactSecrets masks env assignments with secret-bearing keys", () => {
        expect(redactSecrets("export API_TOKEN=sk-abcdefgh1234")).toBe("export API_TOKEN=***");
        expect(redactSecrets("MY_SECRET=hunter2 other=stuff")).toBe("MY_SECRET=*** other=stuff");
        expect(redactSecrets("--api_key=xyz --verbose")).toBe("--api_key=*** --verbose");
        // non-secret keys untouched
        expect(redactSecrets("NODE_ENV=production")).toBe("NODE_ENV=production");
    });
    test("redactSecrets masks Authorization headers and long tokens", () => {
        expect(redactSecrets('curl -H "Authorization: Bearer sk-abcdefgh1234" https://x')).toBe(
            'curl -H "Authorization: ***" https://x',
        );
        expect(redactSecrets("Bearer tokentokentoken123")).toBe("Bearer ***");
        expect(redactSecrets("key is sk-abcdefgh1234 here")).toBe("key is sk-*** here");
        // short sk- literals (prose) left alone
        expect(redactSecrets("the sk-x prefix")).toBe("the sk-x prefix");
    });
    test("redactSecrets is idempotent", () => {
        const once = redactSecrets("export API_TOKEN=sk-abcdefgh1234");
        expect(redactSecrets(once)).toBe(once);
    });
    test("redactToolInput: write/edit content → size note only; secret-named fields → ***", () => {
        const out = redactToolInput("write", { path: "/p/a.ts", content: "const x = 1;" });
        expect(out.content).toBe("<12 chars>");
        expect(out.path).toBe("/p/a.ts");
        expect(redactToolInput("edit", { path: "/p/a.ts", content: "x" }).content).toBe("<1 chars>");
        expect(redactToolInput("bash", { command: "echo hi", api_key: "k-1234567890" }).api_key).toBe("***");
    });
    test("describeToolInput renders bash commands redacted (U4 legacy defense)", () => {
        expect(describeToolInput("bash", { command: 'curl -H "Authorization: Bearer sk-abcdefgh1234" https://api' })).not.toContain(
            "sk-abcdefgh1234",
        );
        expect(describeToolInput("bash", { command: "export PASSWORD=hunter2" })).not.toContain("hunter2");
        expect(describeToolInput("bash", { command: "ls -la" })).toBe('"ls -la"'); // no false positives
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
        const t0 = Date.now();
        store.writeManifest({ id: "m1", seq: 1, kind: "named", ts: t0 - 1000, files: [{ path: "a", hash: store.putBlob("aaa"), size: 3 }] });
        store.writeManifest({ id: "m2", seq: 2, kind: "named", ts: t0, files: [{ path: "b", hash: store.putBlob("bbb"), size: 3 }] });
        writeFileSync(join(dir, `${"cp-"}broken.json`), "{not json");
        const list = store.list();
        expect(list.map((m) => m.id)).toEqual(["m1", "m2"]);
        // GC keeps a 10-minute mtime grace (concurrency safety) — age the
        // soon-to-be-orphaned "aaa" blob past it so this prune test stays
        // deterministic under the grace rule.
        const aaaHash = sha256("aaa");
        const aged = new Date(t0 - 15 * 60 * 1000);
        utimesSync(join(dir, "files", aaaHash.slice(0, 2), aaaHash), aged, aged);
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

/** Drive one full turn through a fake-pi harness: input → write tool_call →
 *  tool_result → the write landing on disk → next input (seals the turn). */
async function driveWriteTurn(harness: ReturnType<typeof makeFakePi>, file: string, content: string): Promise<void> {
    await harness.emit("input", { text: "turn" });
    await harness.emit("tool_call", { toolName: "write", toolCallId: `t-${file}`, input: { path: file, content } });
    await harness.emit("tool_result", { toolName: "write", toolCallId: `t-${file}`, input: { path: file }, content: [], isError: false });
    writeFileSync(file, content); // the write landed
    await harness.emit("input", { text: "next" }); // seals the turn checkpoint
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

// ---------------------------------------------------------------------------
// 5. H1 hardening — atomicity, integrity, GC safety, jail, disk budget
//    (the R-b §5 empirical reproductions, made deterministic)
// ---------------------------------------------------------------------------

describe("CheckpointStore hardening (H1)", () => {
    test("truncated blob → restore reports corrupt-blob, never wrong content (R-b §5.2)", () => {
        const proj = join(tmpRoot, "h1-corrupt");
        mkdirSync(proj, { recursive: true });
        const dir = join(tmpRoot, "h1-corrupt-store");
        const store = new CheckpointStore(dir);
        const file = join(proj, "victim.txt");
        writeFileSync(file, "v2");
        const hash = store.putBlob("0123456789ABCDEF");
        // crash-truncate the blob at its content-addressed path
        writeFileSync(join(dir, "files", hash.slice(0, 2), hash), "0123456789ABC");
        const outcomes = store.restore({ id: "x", seq: 1, kind: "named", ts: Date.now(), files: [{ path: "victim.txt", hash, size: 16 }] }, proj);
        expect(outcomes[0]).toMatchObject({ ok: false, action: "corrupt-blob" });
        expect(readFileSync(file, "utf8")).toBe("v2"); // NOT overwritten with truncated content
    });

    test("putBlob self-heals a truncated blob parked at the hash path (R-b A1)", () => {
        const dir = join(tmpRoot, "h1-heal");
        const store = new CheckpointStore(dir);
        const hash = sha256("full-content-16");
        mkdirSync(join(dir, "files", hash.slice(0, 2)), { recursive: true });
        writeFileSync(join(dir, "files", hash.slice(0, 2), hash), "full-cont"); // truncated
        const h = store.putBlob("full-content-16");
        expect(h).toBe(hash);
        expect(store.readBlob(hash)?.toString()).toBe("full-content-16");
    });

    test("atomic writes leave no .tmp leftovers; binary blobs round-trip byte-exact", () => {
        const dir = join(tmpRoot, "h1-atomic");
        const store = new CheckpointStore(dir);
        const bytes = Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe, 0x7f, 0xc0, 0x1f, 0x00, 0xff]);
        const hash = store.putBlob(bytes);
        expect(hash).toBe(sha256(bytes));
        expect(Buffer.compare(store.readBlob(hash)!, bytes)).toBe(0);
        store.writeManifest({ id: "m", seq: 1, kind: "named", ts: Date.now(), files: [] });
        expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
        expect(readdirSync(join(dir, "files", hash.slice(0, 2))).filter((n) => n.includes(".tmp-"))).toEqual([]);
    });

    test("GC grace: young orphan blobs survive a prune, aged orphans are cleaned (R-b C1)", () => {
        const dir = join(tmpRoot, "h1-grace");
        const store = new CheckpointStore(dir);
        const fresh = store.putBlob("fresh-orphan"); // crash between blob write and manifest write
        const stale = store.putBlob("stale-orphan");
        const blobFile = (h: string) => join(dir, "files", h.slice(0, 2), h);
        const aged = new Date(Date.now() - 15 * 60 * 1000);
        utimesSync(blobFile(stale), aged, aged);
        store.writeManifest({ id: "m0", seq: 1, kind: "named", ts: Date.now(), files: [] });
        store.prune(0); // drops m0, GCs with no manifests left → grace is the only rule
        expect(store.readBlob(fresh)).not.toBe(null); // inside the 10-minute grace window
        expect(store.readBlob(stale)).toBe(null); // past the grace window → cleaned
    });

    test("GC never deletes a blob newer than the newest manifest (in-flight past grace)", () => {
        const dir = join(tmpRoot, "h1-newest");
        const store = new CheckpointStore(dir);
        const inflight = store.putBlob("inflight");
        const stale = store.putBlob("stale");
        const now = Date.now();
        store.writeManifest({ id: "drop", seq: 1, kind: "named", ts: now - 31 * 60 * 1000, files: [] });
        store.writeManifest({ id: "keep", seq: 2, kind: "named", ts: now - 30 * 60 * 1000, files: [] });
        const blobFile = (h: string) => join(dir, "files", h.slice(0, 2), h);
        utimesSync(blobFile(inflight), new Date(now - 20 * 60 * 1000), new Date(now - 20 * 60 * 1000)); // past grace, newer than newest manifest
        utimesSync(blobFile(stale), new Date(now - 45 * 60 * 1000), new Date(now - 45 * 60 * 1000)); // past grace, older than newest manifest
        store.prune(1); // drops "drop", keeps "keep" (newest manifest: 30 min ago)
        expect(store.readBlob(inflight)).not.toBe(null); // in-flight → protected
        expect(store.readBlob(stale)).toBe(null); // genuinely stale → cleaned
    });

    test("symlink jail: restore refuses to write through an escaping symlink (R-b §5.1)", () => {
        if (process.platform === "win32") return; // symlink creation needs privileges on Windows
        const proj = join(tmpRoot, "h1-jail");
        mkdirSync(proj, { recursive: true });
        const outsideDir = join(tmpRoot, "h1-jail-outside");
        mkdirSync(outsideDir, { recursive: true });
        const outside = join(outsideDir, "target.txt");
        writeFileSync(outside, "SENTINEL");
        symlinkSync(outside, join(proj, "link.txt"));
        const dir = join(tmpRoot, "h1-jail-store");
        const store = new CheckpointStore(dir);
        const hash = store.putBlob("PWNED-CONTENT");
        const outcomes = store.restore({ id: "x", seq: 1, kind: "named", ts: Date.now(), files: [{ path: "link.txt", hash, size: 13 }] }, proj);
        expect(outcomes[0]).toMatchObject({ ok: false, action: "outside" });
        expect(readFileSync(outside, "utf8")).toBe("SENTINEL"); // the escape was blocked
    });

    test("insideRootReal: symlink chains resolved; new files still pass the jail", () => {
        if (process.platform === "win32") return; // symlink creation needs privileges on Windows
        const proj = join(tmpRoot, "h1-jail-real");
        mkdirSync(join(proj, "sub"), { recursive: true });
        const outsideDir = join(tmpRoot, "h1-jail-real-out");
        mkdirSync(outsideDir, { recursive: true });
        symlinkSync(outsideDir, join(proj, "sub", "escape-link"));
        writeFileSync(join(proj, "sub", "ok-target.txt"), "x");
        symlinkSync(join(proj, "sub", "ok-target.txt"), join(proj, "in-link.txt"));
        expect(insideRootReal(proj, join(proj, "a.txt"))).toBe(true); // plain existing-ancestor case
        expect(insideRootReal(proj, join(proj, "sub", "new.txt"))).toBe(true); // nonexistent tail
        expect(insideRootReal(proj, join(proj, "in-link.txt"))).toBe(true); // in-project symlink
        expect(insideRootReal(proj, join(proj, "sub", "escape-link", "f.txt"))).toBe(false); // escapes via symlink dir
        expect(insideRootReal(proj, "/etc/passwd")).toBe(false);
    });

    test("oversized capture: no blob, honest oversized entry in the manifest (R-b D1)", () => {
        const dir = join(tmpRoot, "h1-oversize-store");
        const srcDir = join(tmpRoot, "h1-oversize-src");
        mkdirSync(srcDir, { recursive: true });
        const big = join(srcDir, "big.bin");
        writeFileSync(big, "x".repeat(4096));
        const prev = process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
        process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES = "1024";
        try {
            const store = new CheckpointStore(dir);
            const captured = store.captureFile(big);
            expect(captured).toMatchObject({ oversized: true, hash: null, size: 4096 });
            expect(store.sizeBytes()).toBe(0); // nothing was blobbed
        } finally {
            if (prev === undefined) delete process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
            else process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES = prev;
        }
    });

    test("oversized env parse is tolerant: NaN/negative/zero → 64 MiB default", () => {
        const dir = join(tmpRoot, "h1-env");
        const srcDir = join(tmpRoot, "h1-env-src");
        mkdirSync(srcDir, { recursive: true });
        const small = join(srcDir, "small.txt");
        writeFileSync(small, "small");
        const store = new CheckpointStore(dir);
        const prev = process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
        try {
            for (const bad of ["abc", "-1", "0", ""]) {
                process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES = bad;
                const captured = store.captureFile(small);
                expect(captured?.oversized).toBeUndefined();
                expect(captured?.hash).toBe(sha256("small"));
            }
            delete process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
            const captured = store.captureFile(small);
            expect(captured?.hash).toBe(sha256("small"));
        } finally {
            if (prev === undefined) delete process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
            else process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES = prev;
        }
    });

    test("prune per-owner floor: one session's prune never evicts another owner's checkpoints (R-b C3)", () => {
        const dir = join(tmpRoot, "h1-floor");
        const store = new CheckpointStore(dir);
        for (let i = 1; i <= 45; i++) store.writeManifest({ id: `a${i}`, seq: i, kind: "turn", ts: Date.now(), files: [], owner: "boot-a" });
        store.writeManifest({ id: "b1", seq: 46, kind: "turn", ts: Date.now(), files: [], owner: "boot-b" });
        expect(store.prune(40, "boot-b")).toBe(0); // B's own floor is untouched and the global cap is far away
        expect(store.list()).toHaveLength(46); // A's 45 + B's 1 all survive B's prune
        expect(store.prune(40, "boot-a")).toBe(5); // A evicts only ITS oldest 5
        const remaining = store.list();
        expect(remaining).toHaveLength(41);
        expect(remaining.some((m) => m.id === "a1")).toBe(false);
        expect(remaining.some((m) => m.id === "a45")).toBe(true);
        expect(remaining.some((m) => m.id === "b1")).toBe(true);
    });

    test("prune global cap evicts the oldest across owners past 200 manifests", () => {
        const dir = join(tmpRoot, "h1-cap");
        const store = new CheckpointStore(dir);
        for (let i = 1; i <= 196; i++) store.writeManifest({ id: `a${i}`, seq: i, kind: "turn", ts: Date.now(), files: [], owner: "boot-a" });
        for (let i = 1; i <= 5; i++) store.writeManifest({ id: `b${i}`, seq: 200 + i, kind: "turn", ts: Date.now(), files: [], owner: "boot-b" });
        // B prunes (own 5 ≤ floor 40) but the store is 1 over the global cap → the single oldest goes
        const removed = store.prune(40, "boot-b");
        expect(removed).toBe(1);
        const remaining = store.list();
        expect(remaining).toHaveLength(200);
        expect(remaining.some((m) => m.id === "a1")).toBe(false); // oldest evicted even though it is A's
        expect(remaining.some((m) => m.id === "a2")).toBe(true);
        expect(remaining.some((m) => m.id === "b5")).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 6. H1 hardening — extension-level: GC race, ownership, oversized /undo,
//    crash-safe undo ordering, honest failure surfaces
// ---------------------------------------------------------------------------

describe("createCheckpointsExtension — hardening (H1)", () => {
    function makeExt(proj: string, boot: string) {
        const ext = createCheckpointsExtension({
            cwd: proj,
            storeDir: join(proj, ".unown", "checkpoints"),
            receiptsFile: join(proj, ".unown", "receipts", `${boot}.jsonl`),
            bootId: boot,
        });
        const harness = makeFakePi();
        ext.factory(harness.pi);
        return harness;
    }

    test("GC race (R-b §5.3): session B's prune+GC cannot delete session A's in-flight blob", async () => {
        const proj = join(tmpRoot, "h1-race");
        mkdirSync(join(proj, ".unown", "checkpoints"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const store = new CheckpointStore(storeDir);
        const aFile = join(proj, "a.ts");
        writeFileSync(aFile, "a-original");
        const A = makeExt(proj, "boot-a");
        const B = makeExt(proj, "boot-b");
        // A captures a before-image (tool_call time) — blob written, manifest NOT yet sealed
        await A.emit("input", { text: "A turn" });
        await A.emit("tool_call", { toolName: "write", toolCallId: "ta1", input: { path: aFile, content: "a-changed" } });
        const blobHash = sha256("a-original");
        expect(store.readBlob(blobHash)).not.toBe(null); // in-flight blob exists, unreferenced
        // an old orphan that SHOULD be collected by the same prune (proves the GC actually ran)
        const oldOrphan = store.putBlob("old-orphan");
        const aged = new Date(Date.now() - 15 * 60 * 1000);
        utimesSync(join(storeDir, "files", oldOrphan.slice(0, 2), oldOrphan), aged, aged);
        // B's own backlog pushes its prune past the floor so gcBlobs actually runs
        for (let i = 1; i <= 45; i++) store.writeManifest({ id: `b-seed-${i}`, seq: i, kind: "turn", ts: Date.now(), files: [], owner: "boot-b" });
        // B runs a full turn cycle: seal → prune → GC while A's blob is unreferenced
        await driveWriteTurn(B, join(proj, "b.ts"), "b");
        expect(store.readBlob(oldOrphan)).toBe(null); // GC ran and collected the aged orphan
        expect(store.readBlob(blobHash)).not.toBe(null); // A's in-flight blob survived via the grace window
        // A's write lands and succeeds, A seals (referencing the blob), A's /undo still works
        writeFileSync(aFile, "a-changed");
        await A.emit("tool_result", { toolName: "write", toolCallId: "ta1", input: { path: aFile }, content: [], isError: false });
        await A.emit("input", { text: "A next" });
        const { ctx, messages } = makeNotify();
        await A.runCommand("undo", "", ctx);
        expect(readFileSync(aFile, "utf8")).toBe("a-original");
        expect(messages.some((m) => m.text.includes("1 turn(s)"))).toBe(true);
    });

    test("ownership: /undo consumes only this session's turns (R-b C2)", async () => {
        const proj = join(tmpRoot, "h1-own");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const aFile = join(proj, "a.ts");
        const bFile = join(proj, "b.ts");
        writeFileSync(aFile, "a0");
        writeFileSync(bFile, "b0");
        const A = makeExt(proj, "boot-a");
        const B = makeExt(proj, "boot-b");
        await driveWriteTurn(A, aFile, "a1");
        await driveWriteTurn(B, bFile, "b1");
        const store = new CheckpointStore(storeDir);
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(2);
        // a third session with no turns gets pointed at --all, consumes nothing
        const C = makeExt(proj, "boot-c");
        const { ctx: ctxC, messages: msgsC } = makeNotify();
        await C.runCommand("undo", "", ctxC);
        expect(msgsC.some((m) => m.text.includes("--all"))).toBe(true);
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(2);
        // B's /undo reverts B's turn only
        const { ctx: ctxB } = makeNotify();
        await B.runCommand("undo", "", ctxB);
        expect(readFileSync(bFile, "utf8")).toBe("b0");
        expect(readFileSync(aFile, "utf8")).toBe("a1"); // A's file untouched
        const turns = store.list().filter((m) => m.kind === "turn");
        expect(turns).toHaveLength(1);
        expect(turns[0].owner).toBe("boot-a");
        // then A's own /undo finishes the job
        const { ctx: ctxA } = makeNotify();
        await A.runCommand("undo", "", ctxA);
        expect(readFileSync(aFile, "utf8")).toBe("a0");
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(0);
    });

    test("ownership: /undo --all consumes other sessions' turns and legacy manifests", async () => {
        const proj = join(tmpRoot, "h1-own-all");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const store = new CheckpointStore(storeDir);
        const legacyFile = join(proj, "legacy.txt");
        writeFileSync(legacyFile, "legacy-new");
        const aFile = join(proj, "a.ts");
        writeFileSync(aFile, "a0");
        // a legacy manifest (written before ownership existed): unknown owner — not "own"
        store.writeManifest({ id: "tlegacy", seq: 1, kind: "turn", ts: Date.now(), files: [{ path: "legacy.txt", hash: store.putBlob("legacy-orig"), size: 11 }] });
        const A = makeExt(proj, "boot-a");
        const B = makeExt(proj, "boot-b");
        await driveWriteTurn(A, aFile, "a1");
        await driveWriteTurn(B, join(proj, "b.ts"), "b1");
        // default /undo (A) consumes only A's own turn — legacy stays
        const { ctx: ctxA } = makeNotify();
        await A.runCommand("undo", "", ctxA);
        expect(readFileSync(aFile, "utf8")).toBe("a0");
        const afterOwn = store.list().filter((m) => m.kind === "turn");
        expect(afterOwn.map((m) => m.owner ?? "legacy").sort()).toEqual(["boot-b", "legacy"]);
        // --all opts into the cross-owner + legacy turns
        const { ctx: ctxAll, messages } = makeNotify();
        await A.runCommand("undo", "--all 2", ctxAll);
        expect(readFileSync(legacyFile, "utf8")).toBe("legacy-orig");
        expect(existsSync(join(proj, "b.ts"))).toBe(false); // tombstone: b.ts did not exist pre-turn
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(0);
        expect(messages.some((m) => m.text.includes("2 turn(s)"))).toBe(true);
    });

    test("oversized file: manifest records the tombstone-like entry, /undo reports honestly", async () => {
        const proj = join(tmpRoot, "h1-oversize");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const file = join(proj, "big.bin");
        writeFileSync(file, "x".repeat(4096));
        const prev = process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
        process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES = "1024";
        try {
            const A = makeExt(proj, "boot-o");
            await driveWriteTurn(A, file, "y".repeat(4096));
            const store = new CheckpointStore(storeDir);
            const turns = store.list().filter((m) => m.kind === "turn");
            expect(turns).toHaveLength(1);
            expect(turns[0].files[0]).toMatchObject({ oversized: true, hash: null, size: 4096 });
            expect(store.sizeBytes()).toBe(0); // no blob was ever written
            const { ctx, messages } = makeNotify();
            await A.runCommand("undo", "", ctx);
            // honest degradation: the file is left as-is (not deleted, not wrongly reverted)
            expect(readFileSync(file, "utf8")).toBe("y".repeat(4096));
            expect(messages.some((m) => m.level === "warning" && m.text.includes("oversized"))).toBe(true);
            // the capture-time warning was noted in the ledger (once)
            const ledger = new ReceiptsLedger(join(proj, ".unown", "receipts", "boot-o.jsonl"));
            const notes = ledger.entries().filter((e) => e.kind === "note") as Array<{ preview: string }>;
            expect(notes.filter((n) => n.preview.includes("too large"))).toHaveLength(1);
        } finally {
            if (prev === undefined) delete process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES;
            else process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES = prev;
        }
    });

    test("crash mid-undo: re-run completes the interrupted turns, never an extra one (R-b A3)", async () => {
        const proj = join(tmpRoot, "h1-crash");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const f1 = join(proj, "f1.txt");
        const f2 = join(proj, "f2.txt");
        const f3 = join(proj, "f3.txt");
        writeFileSync(f1, "f1-orig");
        writeFileSync(f2, "f2-orig");
        writeFileSync(f3, "f3-orig");
        const A = makeExt(proj, "boot-c");
        await driveWriteTurn(A, f1, "f1-new");
        await driveWriteTurn(A, f2, "f2-new");
        await driveWriteTurn(A, f3, "f3-new");
        const store = new CheckpointStore(storeDir);
        const turns = store.list().filter((m) => m.kind === "turn");
        expect(turns).toHaveLength(3);
        // simulate a crash mid-/undo 2 (chosen: t2, t3): the handler marked both
        // consumed, fully finished t2 (restored + removed), then died before t3
        const victims = turns.slice(-2);
        for (const m of victims) store.writeManifest({ ...m, consumed: true });
        store.restore(victims[0], proj); // t2's files reverted
        store.removeManifest(victims[0].id); // t2 consumed
        expect(readFileSync(f2, "utf8")).toBe("f2-orig");
        // re-run /undo 2: it must complete the interrupted t3 ONLY — without the
        // pending-first rule it would pick [t1, t3] and over-undo t1
        const { ctx, messages } = makeNotify();
        await A.runCommand("undo", "2", ctx);
        expect(readFileSync(f3, "utf8")).toBe("f3-orig"); // completed
        expect(readFileSync(f1, "utf8")).toBe("f1-new"); // NOT over-undone
        const remaining = store.list().filter((m) => m.kind === "turn");
        expect(remaining.map((m) => m.id)).toEqual([turns[0].id]); // only t1 survives
        expect(messages.some((m) => m.text.includes("interrupted"))).toBe(true);
    });

    test("/undo surfaces per-file failures instead of reporting success (R-b U1)", async () => {
        const proj = join(tmpRoot, "h1-undo-fail");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const file = join(proj, "a.ts");
        writeFileSync(file, "orig");
        const A = makeExt(proj, "boot-u");
        await driveWriteTurn(A, file, "changed");
        // the before-image blob vanishes (over-aggressive GC / disk rot)
        const hash = sha256("orig");
        rmSync(join(storeDir, "files", hash.slice(0, 2), hash));
        const { ctx, messages } = makeNotify();
        await A.runCommand("undo", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("changed"); // not revertible — left as-is
        expect(messages.some((m) => m.level === "warning" && m.text.includes("missing-blob"))).toBe(true);
        expect(messages.some((m) => m.text.includes("a.ts"))).toBe(true);
    });

    test("/restore renders corrupt-blob prominently (warning, file untouched)", async () => {
        const proj = join(tmpRoot, "h1-restore-corrupt");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const storeDir = join(proj, ".unown", "checkpoints");
        const file = join(proj, "state.txt");
        const A = makeExt(proj, "boot-r");
        await A.emit("input", { text: "edit" });
        await A.emit("tool_call", { toolName: "edit", toolCallId: "t1", input: { path: file, old: "a", new: "b" } });
        await A.emit("tool_result", { toolName: "edit", toolCallId: "t1", input: { path: file }, content: [], isError: false });
        writeFileSync(file, "snap-state");
        const { ctx } = makeNotify();
        await A.runCommand("checkpoint", "snap", ctx);
        const store = new CheckpointStore(storeDir);
        const named = store.list().find((m) => m.kind === "named")!;
        const hash = named.files[0].hash!;
        // bit-rot the snapshot blob
        writeFileSync(join(storeDir, "files", hash.slice(0, 2), hash), "rotted-bytes");
        writeFileSync(file, "later-state");
        const { ctx: ctx2, messages } = makeNotify();
        await A.runCommand("restore", "snap", ctx2);
        expect(readFileSync(file, "utf8")).toBe("later-state"); // NOT overwritten with wrong content
        expect(messages.some((m) => m.level === "warning" && m.text.includes("corrupt-blob"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 6. H2 privacy hardening — .unown/.gitignore self-heal (V1) + ledger
//    redaction at rest (V2) and at render (U4)
// ---------------------------------------------------------------------------

describe("privacy hardening (H2)", () => {
    /** Minimal git fixture (spawnSync without a shell — no /bin/sh on every
     *  host; mkdir FIRST: bun reports a missing cwd as spawn ENOENT). */
    function gitOk(dir: string, args: string[]): boolean {
        const res = spawnSync("git", args, { cwd: dir });
        return res.status === 0;
    }

    test("V1: fresh project → session_start creates .unown/.gitignore with header + the 3 runtime entries", async () => {
        const proj = join(tmpRoot, "h2-fresh");
        mkdirSync(proj, { recursive: true });
        expect(gitOk(proj, ["init", "-q", "-b", "main"])).toBe(true);
        expect(gitOk(proj, ["config", "user.email", "t@t"])).toBe(true);
        expect(gitOk(proj, ["config", "user.name", "t"])).toBe(true);
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit } = makeFakePi();
        ext.factory(pi);
        await emit("session_start", {});
        const file = join(proj, ".unown", ".gitignore");
        expect(existsSync(file)).toBe(true);
        const text = readFileSync(file, "utf8");
        expect(text).toContain("# unown runtime state");
        expect(text).toContain("receipts/");
        expect(text).toContain("checkpoints/");
        expect(text).toContain("reviews/");
        // the entries actually ignore the runtime dirs (audit's verification)
        expect(gitOk(proj, ["check-ignore", "-q", ".unown/receipts/x.jsonl"])).toBe(true);
        expect(gitOk(proj, ["check-ignore", "-q", ".unown/checkpoints/files/aa/bb"])).toBe(true);
        expect(gitOk(proj, ["check-ignore", "-q", ".unown/reviews/some-review.md"])).toBe(true);
    });

    test("V1: existing user .gitignore is preserved; only missing entries are appended; idempotent", async () => {
        const proj = join(tmpRoot, "h2-existing");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const user = join(proj, ".unown", ".gitignore");
        writeFileSync(user, "# my project ignores\nnode_modules/\nreceipts/\n");
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile: join(proj, ".unown", "receipts", "r.jsonl") });
        const { pi, emit } = makeFakePi();
        ext.factory(pi);
        await emit("session_start", {});
        const text = readFileSync(user, "utf8");
        // user content intact, receipts/ not duplicated
        expect(text).toContain("# my project ignores");
        expect(text).toContain("node_modules/");
        expect(text.match(/^receipts\/$/gm)).toHaveLength(1);
        // missing entries appended
        expect(text).toContain("checkpoints/");
        expect(text).toContain("reviews/");
        // second boot changes nothing (append-if-missing is idempotent)
        const before = readFileSync(user, "utf8");
        await emit("session_start", {});
        expect(readFileSync(user, "utf8")).toBe(before);
    });

    test("V2: write tool_call input persists content as a size note, never the file body", async () => {
        const proj = join(tmpRoot, "h2-write-redact");
        mkdirSync(proj, { recursive: true });
        const receiptsFile = join(proj, ".unown", "receipts", "r.jsonl");
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile });
        const { pi, emit } = makeFakePi();
        ext.factory(pi);
        await emit("input", { text: "write the file" });
        const body = "const secret = 'CLASSIFIED-BODY';\n";
        await emit("tool_call", {
            toolName: "write",
            toolCallId: "t1",
            input: { path: join(proj, "a.ts"), content: body },
        });
        const raw = readFileSync(receiptsFile, "utf8");
        expect(raw).not.toContain("CLASSIFIED-BODY");
        expect(raw).toContain(`<${body.length} chars>`);
        const entry = new ReceiptsLedger(receiptsFile).entries().find((e) => e.kind === "tool_call") as any;
        expect(entry.input.content).toBe(`<${body.length} chars>`);
        expect(entry.input.path).toBe(join(proj, "a.ts")); // paths survive — they are the audit trail
    });

    test("V2: bash tool_call inputs are secret-redacted at rest", async () => {
        const proj = join(tmpRoot, "h2-bash-redact");
        mkdirSync(proj, { recursive: true });
        const receiptsFile = join(proj, ".unown", "receipts", "r.jsonl");
        const ext = createCheckpointsExtension({ cwd: proj, receiptsFile });
        const { pi, emit } = makeFakePi();
        ext.factory(pi);
        await emit("input", { text: "deploy" });
        await emit("tool_call", {
            toolName: "bash",
            toolCallId: "t1",
            input: { command: 'export API_TOKEN=sk-abcdefgh1234 && curl -H "Authorization: Bearer sk-token123456" https://api' },
        });
        const raw = readFileSync(receiptsFile, "utf8");
        expect(raw).not.toContain("sk-abcdefgh1234");
        expect(raw).not.toContain("sk-token123456");
        expect(raw).toContain("API_TOKEN=***");
        expect(raw).toContain("Authorization: ***");
    });

    test("U4: renderReceipts masks secrets from LEGACY entries persisted before the redaction", () => {
        // an old ledger line, written pre-H2 with the raw command inline
        const legacy = [
            {
                seq: 1,
                ts: Date.now(),
                kind: "tool_call",
                id: "t9",
                tool: "bash",
                input: { command: 'curl -H "Authorization: Bearer sk-legacysecret" https://x' },
            },
        ] as any[];
        const text = renderReceipts(legacy, 10);
        expect(text).not.toContain("sk-legacysecret");
        expect(text).toContain("Authorization: ***");
    });
});

// ---------------------------------------------------------------------------
// 5. agent_end turn sealing — the /undo-right-after-the-turn regression
// ---------------------------------------------------------------------------

describe("createCheckpointsExtension — agent_end sealing", () => {
    test("agent_end seals the finished turn — /undo works with no further input event", async () => {
        const proj = join(tmpRoot, "ext-agent-end");
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
        // the write lands on disk
        writeFileSync(file, "changed();");

        // the turn ENDS — no further user input. The slash command path in
        // agent-session prompt() must not matter: agent_end seals now.
        await emit("agent_end", {});

        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.list().filter((m) => m.kind === "turn")).toHaveLength(1);

        // /undo immediately after the turn must revert to the before-image
        await runCommand("undo", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("original();\n");
        expect(messages.some((m) => m.text.includes("1 turn(s)"))).toBe(true);
    });
});
