// Unit tests for the /redo half of src/checkpoints.ts — the opencode/Cursor
// undo→redo port. /undo pushes one redo entry per undone turn (capturing the
// content it is about to overwrite, BEFORE the before-images land); /redo [n]
// pops entries newest-first and re-applies them through the same hash-verified,
// jailed restore path.
//
// Layers:
//   1. CheckpointStore redo stack — writeRedo/listRedo ordering + broken-file
//      tolerance, nextRedoSeq, clearRedo (owner + global), pruneRedo floors,
//      and the gcBlobs integration (redo-referenced blobs survive a prune)
//   2. the extension through a fake pi — undo→redo round-trips (byte-exact,
//      incl. binary content and new-file tombstones), multi-level
//      `/undo 2` + `/redo 2`, stepwise `/undo 1`+`/undo 1` + `/redo 1`,
//      ownership (/redo --all), redo-stack clearing on new turn AND named
//      checkpoints (redo then fails cleanly), empty-stack errors, corrupt-blob
//      refusal, /checkpoints redo depth, receipts ledger entries
import "./_env.ts"; // MUST be first: store.ts opens SQLite at module scope
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    checkpointsDir,
    CheckpointStore,
    createCheckpointsExtension,
    ReceiptsLedger,
    renderCheckpoints,
    renderReceipts,
    sha256,
} from "../src/checkpoints.ts";

const tmpRoot = mkdtempSync(join(tmpdir(), "unown-redo-test-"));
afterAll(() => {
    try {
        rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

// ---------------------------------------------------------------------------
// Fake-pi harness (the checkpoints.test.ts patterns)
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

/** Drive one full turn: input → write tool_call → tool_result → the write
 *  landing on disk → next input (seals the turn checkpoint). */
async function driveWriteTurn(harness: ReturnType<typeof makeFakePi>, file: string, content: string | Buffer): Promise<void> {
    await harness.emit("input", { text: "turn" });
    await harness.emit("tool_call", { toolName: "write", toolCallId: `t-${file}`, input: { path: file, content } });
    await harness.emit("tool_result", { toolName: "write", toolCallId: `t-${file}`, input: { path: file }, content: [], isError: false });
    writeFileSync(file, content); // the write landed
    await harness.emit("input", { text: "next" }); // seals the turn checkpoint
}

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

// ---------------------------------------------------------------------------
// 1. CheckpointStore — redo stack persistence, retention, GC integration
// ---------------------------------------------------------------------------

describe("CheckpointStore redo stack", () => {
    test("writeRedo/listRedo are seq-ordered, broken files skipped, removeRedo pops", () => {
        const dir = join(tmpRoot, "store-redo");
        const store = new CheckpointStore(dir);
        store.writeRedo({ id: "r1", seq: 1, ts: 1, files: [{ path: "a.txt", hash: store.putBlob("a"), size: 1 }], owner: "boot-a" });
        store.writeRedo({ id: "r2", seq: 2, ts: 2, files: [], owner: "boot-a" });
        writeFileSync(join(dir, "redo-broken.json"), "{not json");
        expect(store.listRedo().map((m) => m.id)).toEqual(["r1", "r2"]);
        expect(store.nextRedoSeq()).toBe(3);
        store.removeRedo("r1");
        expect(store.listRedo().map((m) => m.id)).toEqual(["r2"]);
        expect(store.nextRedoSeq()).toBe(3); // max surviving seq is still 2
    });

    test("clearRedo: owner-scoped and global forms", () => {
        const dir = join(tmpRoot, "store-clear");
        const store = new CheckpointStore(dir);
        store.writeRedo({ id: "r1", seq: 1, ts: 1, files: [], owner: "boot-a" });
        store.writeRedo({ id: "r2", seq: 2, ts: 2, files: [], owner: "boot-b" });
        expect(store.clearRedo("boot-zz")).toBe(0); // unknown owner: nothing goes
        expect(store.clearRedo("boot-a")).toBe(1);
        expect(store.listRedo().map((m) => m.id)).toEqual(["r2"]);
        expect(store.clearRedo()).toBe(1); // global
        expect(store.listRedo()).toHaveLength(0);
    });

    test("pruneRedo keeps a per-owner floor and a global cap (the prune() shape)", () => {
        const dir = join(tmpRoot, "store-prune-redo");
        const store = new CheckpointStore(dir);
        for (let i = 1; i <= 25; i++) store.writeRedo({ id: `a${i}`, seq: i, ts: i, files: [], owner: "boot-a" });
        store.writeRedo({ id: "b1", seq: 26, ts: 26, files: [], owner: "boot-b" });
        expect(store.pruneRedo(20, "boot-b")).toBe(0); // B's own floor untouched, global cap far away
        expect(store.listRedo()).toHaveLength(26);
        expect(store.pruneRedo(20, "boot-a")).toBe(5); // A evicts only ITS oldest 5
        const remaining = store.listRedo();
        expect(remaining).toHaveLength(21);
        expect(remaining.some((m) => m.id === "a1")).toBe(false);
        expect(remaining.some((m) => m.id === "a25")).toBe(true);
        expect(remaining.some((m) => m.id === "b1")).toBe(true);
        // global cap: bring the store past 60 entries → B's prune evicts the oldest across owners
        for (let i = 26; i <= 64; i++) store.writeRedo({ id: `a${i}`, seq: i, ts: i, files: [], owner: "boot-a" });
        store.writeRedo({ id: "b2", seq: 1001, ts: 1001, files: [], owner: "boot-b" });
        expect(store.listRedo()).toHaveLength(61); // 59 A + 2 B
        expect(store.pruneRedo(20, "boot-b")).toBe(1); // one over the cap → the single oldest goes
        expect(store.listRedo()).toHaveLength(60);
        expect(store.listRedo().some((m) => m.id === "a6")).toBe(false); // oldest evicted even though it is A's
        expect(store.listRedo().some((m) => m.id === "a7")).toBe(true);
        expect(store.listRedo().some((m) => m.id === "b2")).toBe(true);
        // the no-owner form keeps the newest `keep` globally (the pre-ownership prune shape)
        expect(store.pruneRedo(2)).toBe(58); // 60 → 2
        expect(store.listRedo().map((m) => m.id)).toEqual(["a64", "b2"]); // highest seqs survive
    }, 20_000); // 60+ fs writes: crossed bun's 5s default on a loaded windows release runner

    test("gcBlobs never collects a blob referenced only by a redo entry", () => {
        const dir = join(tmpRoot, "store-redo-gc");
        const store = new CheckpointStore(dir);
        const redoBlob = store.putBlob("redo-only-content"); // referenced ONLY by the redo entry below
        const stale = store.putBlob("stale-orphan"); // referenced by nothing
        store.writeRedo({ id: "r1", seq: 1, ts: Date.now(), files: [{ path: "a.txt", hash: redoBlob, size: 17 }], owner: "boot-a" });
        store.writeManifest({ id: "m1", seq: 1, kind: "named", ts: Date.now(), files: [] });
        // age both past the 10-minute GC grace so only referencing keeps a blob alive
        const aged = new Date(Date.now() - 15 * 60 * 1000);
        const blobFile = (h: string) => join(dir, "files", h.slice(0, 2), h);
        utimesSync(blobFile(redoBlob), aged, aged);
        utimesSync(blobFile(stale), aged, aged);
        store.prune(0); // drops m1 → gcBlobs runs with zero cp- manifests but one redo entry
        expect(store.readBlob(redoBlob)).not.toBe(null); // redo-referenced → survives
        expect(store.readBlob(stale)).toBe(null); // unreferenced → collected (GC really ran)
    });

    test("renderCheckpoints shows redo depth only when > 0", () => {
        expect(renderCheckpoints([], 0)).toContain("No checkpoints yet");
        expect(renderCheckpoints([], 0)).not.toContain("redo");
        expect(renderCheckpoints([], 0, 2)).toContain("2 undone change(s) are redoable");
        const text = renderCheckpoints([{ id: "t1", seq: 1, kind: "turn", ts: Date.now(), files: [] as any[] }], 2048, 2);
        expect(text).toContain("t1 [turn]");
        expect(text).toContain("redo depth: 2");
        expect(text).toContain("/redo [n] re-applies undone changes");
    });
});

// ---------------------------------------------------------------------------
// 2. The extension — /undo pushes, /redo pops, round-trips, invalidation
// ---------------------------------------------------------------------------

describe("createCheckpointsExtension — /redo", () => {
    test("undo → redo round-trip restores exact byte-identical content", async () => {
        const proj = join(tmpRoot, "ext-roundtrip");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "src.ts");
        writeFileSync(file, "original();\n");
        const A = makeExt(proj, "boot-a");

        await driveWriteTurn(A, file, "changed();");
        const { ctx } = makeNotify();
        await A.runCommand("undo", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("original();\n");

        // the redo stack holds exactly one entry: the pre-undo content
        const store = new CheckpointStore(checkpointsDir(proj));
        const stack = store.listRedo();
        expect(stack).toHaveLength(1);
        expect(stack[0].owner).toBe("boot-a");
        expect(stack[0].files[0].path).toBe("src.ts");
        expect(stack[0].files[0].hash).toBe(sha256("changed();"));

        const { ctx: ctx2, messages } = makeNotify();
        await A.runCommand("redo", "5", ctx2); // n capped to the stack size (1)
        expect(readFileSync(file, "utf8")).toBe("changed();"); // byte-identical to pre-undo
        expect(messages.some((m) => m.text.includes("Redid 1 change(s)") && m.text.includes("src.ts"))).toBe(true);
        expect(store.listRedo()).toHaveLength(0); // popped

        // the receipts ledger recorded the redo (audit: file-changing op)
        const ledger = new ReceiptsLedger(join(proj, ".unown", "receipts", "boot-a.jsonl"));
        const redoEntries = ledger.entries().filter((e) => e.kind === "redo");
        expect(redoEntries).toHaveLength(1);
        expect((redoEntries[0] as any).files).toBe(1);
        expect(renderReceipts(ledger.entries(), 50)).toContain("1 redo(s)");
    });

    test("multi-level: /undo 2 then /redo 2 restores the exact pre-undo state (files + binary)", async () => {
        const proj = join(tmpRoot, "ext-multi");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const text = join(proj, "a.txt");
        const bin = join(proj, "b.bin");
        writeFileSync(text, "v0");
        const binV1 = Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe, 0x7f, 0xc0, 0x1f]);
        writeFileSync(bin, binV1);
        const binV2 = Buffer.from([0xff, 0x0e, 0x00, 0x42]);
        const A = makeExt(proj, "boot-a");

        await driveWriteTurn(A, text, "v1");
        await driveWriteTurn(A, bin, binV2);
        const { ctx } = makeNotify();
        await A.runCommand("undo", "2", ctx);
        expect(readFileSync(text, "utf8")).toBe("v0");
        expect(Buffer.compare(readFileSync(bin), binV1)).toBe(0);
        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.listRedo()).toHaveLength(2); // one entry per undone turn

        const { ctx: ctx2, messages } = makeNotify();
        await A.runCommand("redo", "2", ctx2);
        expect(readFileSync(text, "utf8")).toBe("v1"); // exact pre-undo content
        expect(Buffer.compare(readFileSync(bin), binV2)).toBe(0); // byte-exact, binary-safe
        expect(messages.some((m) => m.text.includes("Redid 2 change(s)"))).toBe(true);
        expect(store.listRedo()).toHaveLength(0);
    });

    test("multi-level same file: /undo 2 → /redo 2 round-trips; /undo 1 + /undo 1 step through", async () => {
        const proj = join(tmpRoot, "ext-multi-same");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "f.txt");
        writeFileSync(file, "v0");
        const A = makeExt(proj, "boot-a");
        await driveWriteTurn(A, file, "v1");
        await driveWriteTurn(A, file, "v2");

        // stepwise: two single undos, then two single redos — each /redo 1
        // re-applies the MOST RECENTLY undone state (LIFO, classic editor)
        const { ctx } = makeNotify();
        await A.runCommand("undo", "1", ctx);
        expect(readFileSync(file, "utf8")).toBe("v1");
        await A.runCommand("undo", "1", ctx);
        expect(readFileSync(file, "utf8")).toBe("v0");
        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.listRedo()).toHaveLength(2);
        await A.runCommand("redo", "1", ctx);
        expect(readFileSync(file, "utf8")).toBe("v1"); // last-undone state first
        await A.runCommand("redo", "1", ctx);
        expect(readFileSync(file, "utf8")).toBe("v2"); // then the one before
        expect(store.listRedo()).toHaveLength(0);

        // one command each way on a third turn
        await driveWriteTurn(A, file, "v3");
        const { ctx: ctx2 } = makeNotify();
        await A.runCommand("undo", "1", ctx2);
        expect(readFileSync(file, "utf8")).toBe("v2");
        await A.runCommand("redo", "1", ctx2);
        expect(readFileSync(file, "utf8")).toBe("v3"); // byte-identical round trip
    });

    test("tombstones round-trip: /undo deletes a new file, /redo re-creates it; deeper stacks delete mid-walk", async () => {
        const proj = join(tmpRoot, "ext-tombstone");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const fresh = join(proj, "new.ts");
        const A = makeExt(proj, "boot-a");

        await driveWriteTurn(A, fresh, "brand new");
        const { ctx } = makeNotify();
        await A.runCommand("undo", "", ctx);
        expect(existsSync(fresh)).toBe(false); // tombstoned away
        const { ctx: ctx2 } = makeNotify();
        await A.runCommand("redo", "", ctx2);
        expect(readFileSync(fresh, "utf8")).toBe("brand new"); // re-created, exact content

        // deeper: turn 1 creates X, turn 2 edits it — /undo 2 walks through a
        // delete (t1's tombstone) so the t2-step redo capture sees X missing
        // (tombstone in the redo entry) and /redo 2 deletes then re-creates
        const X = join(proj, "x.txt");
        const B = makeExt(proj, "boot-b");
        await driveWriteTurn(B, X, "x1");
        await driveWriteTurn(B, X, "x2");
        await B.runCommand("undo", "2", ctx);
        expect(readFileSync(X, "utf8")).toBe("x1"); // walk order: t2's before-image wins
        await B.runCommand("redo", "2", ctx2);
        expect(readFileSync(X, "utf8")).toBe("x2"); // exact pre-undo content restored
    });

    test("a NEW checkpoint after an undo clears the redo stack — /redo then fails cleanly", async () => {
        const proj = join(tmpRoot, "ext-invalidate");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "a.ts");
        writeFileSync(file, "v0");
        const A = makeExt(proj, "boot-a");
        await driveWriteTurn(A, file, "v1");
        const { ctx } = makeNotify();
        await A.runCommand("undo", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("v0");
        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.listRedo()).toHaveLength(1);

        // a fresh edit turn seals a new turn checkpoint at the next input → clears
        await driveWriteTurn(A, file, "v2");
        expect(store.listRedo()).toHaveLength(0);
        const { ctx: ctx2, messages } = makeNotify();
        await A.runCommand("redo", "", ctx2);
        expect(readFileSync(file, "utf8")).toBe("v2"); // untouched — redo refused cleanly
        expect(messages.some((m) => m.level === "warning" && m.text.includes("Nothing to redo"))).toBe(true);
        // the clearing was journaled in the receipts ledger
        const ledger = new ReceiptsLedger(join(proj, ".unown", "receipts", "boot-a.jsonl"));
        expect(ledger.entries().some((e) => e.kind === "note" && (e as any).preview.includes("redo stack cleared"))).toBe(true);
    });

    test("a named /checkpoint also clears the redo stack (any new checkpoint invalidates redo)", async () => {
        const proj = join(tmpRoot, "ext-invalidate-named");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "a.ts");
        writeFileSync(file, "v0");
        const A = makeExt(proj, "boot-a");
        await driveWriteTurn(A, file, "v1");
        const { ctx } = makeNotify();
        await A.runCommand("undo", "", ctx);
        const store = new CheckpointStore(checkpointsDir(proj));
        expect(store.listRedo()).toHaveLength(1);
        await A.runCommand("checkpoint", "after-undo", ctx);
        expect(store.listRedo()).toHaveLength(0);
        const { ctx: ctx2, messages } = makeNotify();
        await A.runCommand("redo", "", ctx2);
        expect(readFileSync(file, "utf8")).toBe("v0"); // untouched
        expect(messages.some((m) => m.level === "warning" && m.text.includes("Nothing to redo"))).toBe(true);
    });

    test("/redo on an empty stack is a friendly warning, never a crash (all arg shapes)", async () => {
        const proj = join(tmpRoot, "ext-empty");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const A = makeExt(proj, "boot-a");
        const { ctx, messages } = makeNotify();
        await A.runCommand("redo", "", ctx); // no await-crash: the handler resolves
        await A.runCommand("redo", "5", ctx);
        await A.runCommand("redo", "--all", ctx);
        await A.runCommand("redo", "abc", ctx); // NaN → default 1, still empty
        const warnings = messages.filter((m) => m.level === "warning");
        expect(warnings).toHaveLength(4);
        expect(warnings.every((m) => m.text.includes("Nothing to redo") && m.text.includes("redo stack is empty"))).toBe(true);
    });

    test("blob corruption → /redo refuses (hash mismatch), reports corrupt-blob, touches nothing", async () => {
        const proj = join(tmpRoot, "ext-corrupt");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "a.ts");
        writeFileSync(file, "orig");
        const A = makeExt(proj, "boot-a");
        await driveWriteTurn(A, file, "changed");
        const { ctx } = makeNotify();
        await A.runCommand("undo", "", ctx);
        expect(readFileSync(file, "utf8")).toBe("orig");

        // bit-rot the redo blob (the captured pre-undo content "changed")
        const hash = sha256("changed");
        writeFileSync(join(checkpointsDir(proj), "files", hash.slice(0, 2), hash), "rotted-bytes");
        const { ctx: ctx2, messages } = makeNotify();
        await A.runCommand("redo", "", ctx2);
        expect(readFileSync(file, "utf8")).toBe("orig"); // NOT overwritten with wrong content
        expect(messages.some((m) => m.level === "warning" && m.text.includes("corrupt-blob"))).toBe(true);
        expect(messages.some((m) => m.text.includes("a.ts"))).toBe(true);
    });

    test("ownership: /redo defaults to this session's undos; --all opts into other sessions'", async () => {
        const proj = join(tmpRoot, "ext-own");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const file = join(proj, "a.ts");
        writeFileSync(file, "v0");
        const A = makeExt(proj, "boot-a");
        const B = makeExt(proj, "boot-b");
        await driveWriteTurn(A, file, "v1");
        const { ctx: ctxA } = makeNotify();
        await A.runCommand("undo", "", ctxA); // A's redo stack: 1 entry, owner boot-a
        expect(readFileSync(file, "utf8")).toBe("v0");

        // B (same store, different session) has nothing of its own to redo
        const { ctx: ctxB, messages: msgsB } = makeNotify();
        await B.runCommand("redo", "", ctxB);
        expect(readFileSync(file, "utf8")).toBe("v0"); // untouched
        expect(msgsB.some((m) => m.level === "warning" && m.text.includes("/redo --all"))).toBe(true);

        // /redo --all opts in and re-applies A's undone change
        const { ctx: ctxB2, messages: msgsB2 } = makeNotify();
        await B.runCommand("redo", "--all", ctxB2);
        expect(readFileSync(file, "utf8")).toBe("v1");
        expect(msgsB2.some((m) => m.text.includes("Redid 1 change(s)"))).toBe(true);
        expect(new CheckpointStore(checkpointsDir(proj)).listRedo()).toHaveLength(0);
    });

    test("/checkpoints shows the session's redo depth; /undo's message points at /redo", async () => {
        const proj = join(tmpRoot, "ext-depth");
        mkdirSync(join(proj, ".unown"), { recursive: true });
        const a = join(proj, "a.txt");
        const b = join(proj, "b.txt");
        writeFileSync(a, "a0");
        writeFileSync(b, "b0");
        const A = makeExt(proj, "boot-a");
        await driveWriteTurn(A, a, "a1");
        await driveWriteTurn(A, b, "b1");
        const { ctx, messages } = makeNotify();
        await A.runCommand("undo", "1", ctx); // one turn manifest survives, depth 1
        expect(messages.some((m) => m.text.includes("/redo [n] re-applies undone changes."))).toBe(true);

        await A.runCommand("checkpoints", "", ctx);
        const listing = messages.find((m) => m.text.includes("Checkpoints (newest first"));
        expect(listing).toBeDefined();
        expect(listing!.text).toContain("redo depth: 1");

        // with EVERY turn undone the manifest listing is empty, but the redo
        // depth still surfaces (the empty-store branch)
        await A.runCommand("undo", "1", ctx);
        await A.runCommand("checkpoints", "", ctx);
        expect(messages.some((m) => m.text.includes("2 undone change(s) are redoable"))).toBe(true);

        // another session's /checkpoints shows only ITS depth (ownership view)
        const B = makeExt(proj, "boot-b");
        const { ctx: ctxB, messages: msgsB } = makeNotify();
        await B.runCommand("checkpoints", "", ctxB);
        expect(msgsB.some((m) => m.text.includes("redo depth") || m.text.includes("redoable"))).toBe(false);
    });
});
