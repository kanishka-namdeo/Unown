/**
 * checkpoints.ts — session checkpoints + the receipts audit ledger.
 *
 * Reverse-engineered from codewhale's receipts/checkpoint surface
 * (docs/RECEIPTS.md: `/undo` `/restore` `/receipts` — "ordered audit of every
 * file, command, web/MCP call, agent, approval (with decider), denial,
 * failure + totals") and Claude Code / Gemini CLI checkpointing, reduced to
 * what fits pi's extension seams with zero dependencies and no git
 * requirement:
 *
 *   - ReceiptsLedger — append-only JSONL, one file per session boot under
 *     `<project>/.unown/receipts/`, recording session starts, inputs (first
 *     200 chars), every tool call + result (isError, files, usage),
 *     checkpoints and restores. `/receipts [n]` renders the last n entries
 *     plus totals.
 *   - CheckpointStore — content-addressed blob store + manifests under
 *     `<project>/.unown/checkpoints/`. Turn checkpoints seal the pre-turn
 *     state of every file the turn wrote (before-images captured at
 *     tool_call time, dropped again if that write never succeeded); named
 *     checkpoints (`/checkpoint <label>`) snapshot the current state of
 *     every file the session touched. `/undo [n]` restores before-images of
 *     the last n turns and walks the index back; `/restore <label|id>`
 *     restores a named snapshot; tombstones (hash: null) delete files that
 *     did not exist before.
 *
 * Everything is plain fs + crypto — cross-platform by construction (no shell,
 * no git dependency, no native modules). Restore only ever writes inside the
 * project cwd (same jail the terminal hooks enforce on tools).
 *
 * Known limits (documented in docs/usage.md): bash-caused file changes are
 * recorded as commands in the ledger but not itemized per-file (no workspace
 * diffing); subagent processes keep their own ledger file under the same
 * `.unown/receipts/` (marked `[subagent]`), and `/undo` walks only the
 * current process's turn checkpoints — use `/checkpoint` + `/restore` to
 * rewind across processes.
 */
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Paths + hashing helpers (pure, exported for tests)
// ---------------------------------------------------------------------------

export function receiptsDir(cwd: string): string {
    return join(cwd, ".unown", "receipts");
}

export function checkpointsDir(cwd: string): string {
    return join(cwd, ".unown", "checkpoints");
}

export function sha256(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

/** True when `p` resolves inside `root` (the terminal path jail). */
export function insideRoot(root: string, p: string): boolean {
    const rel = relative(resolve(root), resolve(p));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function slugify(label: string): string {
    return (
        label
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 40) || "checkpoint"
    );
}

// ---------------------------------------------------------------------------
// Receipts ledger
// ---------------------------------------------------------------------------

export type ReceiptEntry =
    | { seq: number; ts: number; kind: "session_start"; subagent: boolean; cwd: string }
    | { seq: number; ts: number; kind: "input"; preview: string }
    | {
            seq: number;
            ts: number;
            kind: "tool_call";
            id: string;
            tool: string;
            input: Record<string, unknown>;
      }
    | {
            seq: number;
            ts: number;
            kind: "tool_result";
            id: string;
            tool: string;
            isError: boolean;
            preview: string;
            usage?: { input: number; output: number };
      }
    | { seq: number; ts: number; kind: "checkpoint"; id: string; label?: string; files: number; turn: boolean }
    | { seq: number; ts: number; kind: "restore"; ids: string[]; files: number }
    | { seq: number; ts: number; kind: "note"; preview: string };

const INPUT_CAP = 4096;
const PREVIEW_CAP = 200;
const LEDGER_MAX_ENTRIES = 5000;

/** One JSONL ledger per session boot. Appends are synchronous and small. */
export class ReceiptsLedger {
    readonly file: string;
    private seq = 0;
    private count = 0;

    constructor(file: string) {
        this.file = file;
        mkdirSync(dirname(file), { recursive: true });
    }

    append(entry: Omit<ReceiptEntry, "seq" | "ts">): ReceiptEntry {
        if (this.count >= LEDGER_MAX_ENTRIES) {
            return { ...(entry as any), seq: this.seq, ts: Date.now() };
        }
        const full = { ...(entry as any), seq: ++this.seq, ts: Date.now() } as ReceiptEntry;
        try {
            writeFileSync(this.file, JSON.stringify(full) + "\n", { flag: "a" });
            this.count++;
        } catch {
            /* receipts must never break a session */
        }
        return full;
    }

    /** Read every entry (oldest first). Tolerates a truncated tail line. */
    entries(): ReceiptEntry[] {
        if (!existsSync(this.file)) return [];
        const out: ReceiptEntry[] = [];
        for (const line of readFileSync(this.file, "utf8").split("\n")) {
            if (!line.trim()) continue;
            try {
                out.push(JSON.parse(line));
            } catch {
                continue;
            }
        }
        return out;
    }
}

export function previewText(content: unknown): string {
    if (Array.isArray(content)) {
        const text = content
            .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        return text.slice(0, PREVIEW_CAP);
    }
    if (typeof content === "string") return content.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CAP);
    return "";
}

/** Totals block + the last `limit` entries, human-readable. */
export function renderReceipts(entries: ReceiptEntry[], limit = 20): string {
    const totals = {
        inputs: 0,
        toolCalls: 0,
        errors: 0,
        filesWritten: 0,
        checkpoints: 0,
        restores: 0,
    };
    const byTool = new Map<string, number>();
    const files = new Set<string>();
    for (const e of entries) {
        if (e.kind === "input") totals.inputs++;
        else if (e.kind === "tool_call") {
            totals.toolCalls++;
            byTool.set(e.tool, (byTool.get(e.tool) ?? 0) + 1);
            const p = typeof e.input?.path === "string" ? e.input.path : undefined;
            if ((e.tool === "write" || e.tool === "edit") && p) files.add(p);
        } else if (e.kind === "tool_result" && e.isError) totals.errors++;
        else if (e.kind === "checkpoint") totals.checkpoints++;
        else if (e.kind === "restore") totals.restores++;
    }
    totals.filesWritten = files.size;
    const shown = entries.slice(-limit);
    const lines: string[] = [];
    for (const e of shown) {
        const time = new Date(e.ts).toISOString().slice(11, 19);
        if (e.kind === "session_start") {
            lines.push(`#${e.seq} ${time} session start${e.subagent ? " [subagent]" : ""} in ${e.cwd}`);
        } else if (e.kind === "input") {
            lines.push(`#${e.seq} ${time} input  "${e.preview}"`);
        } else if (e.kind === "tool_call") {
            const detail = describeToolInput(e.tool, e.input);
            lines.push(`#${e.seq} ${time} call   ${e.tool}${detail ? ` ${detail}` : ""}`);
        } else if (e.kind === "tool_result") {
            const mark = e.isError ? "✗" : "✓";
            const usage = e.usage ? ` (${e.usage.input}/${e.usage.output} tok)` : "";
            lines.push(`#${e.seq} ${time} ${e.isError ? "FAIL " : "ok  "}  ${e.tool} ${mark}${usage}${e.preview ? ` — ${e.preview}` : ""}`);
        } else if (e.kind === "checkpoint") {
            lines.push(`#${e.seq} ${time} ckpt   ${e.id}${e.label ? ` ("${e.label}")` : ""} — ${e.files} file(s)${e.turn ? " [turn]" : ""}`);
        } else if (e.kind === "restore") {
            lines.push(`#${e.seq} ${time} rstr   ${e.ids.join(", ")} — ${e.files} file(s)`);
        } else if (e.kind === "note") {
            lines.push(`#${e.seq} ${time} note   "${e.preview}"`);
        }
    }
    const toolSummary = [...byTool.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(" ");
    const head =
        `Receipts — ${totals.inputs} input(s), ${totals.toolCalls} tool call(s)${toolSummary ? ` [${toolSummary}]` : ""}, ` +
        `${totals.filesWritten} distinct file(s) written, ${totals.errors} error(s), ` +
        `${totals.checkpoints} checkpoint(s), ${totals.restores} restore(s).`;
    const tail =
        entries.length > shown.length ? `\n(showing last ${shown.length} of ${entries.length}; /receipts <n> for more)` : "";
    return `${head}\n${lines.join("\n")}${tail}`;
}

export function describeToolInput(tool: string, input: Record<string, unknown> | undefined): string {
    if (!input) return "";
    const p = typeof input.path === "string" ? input.path : undefined;
    if (tool === "bash" || tool === "powershell") {
        const cmd = typeof input.command === "string" ? input.command : "";
        return `"${cmd.slice(0, 120).replace(/\s+/g, " ")}"`;
    }
    if (p) return p.length > 100 ? `…${p.slice(-99)}` : p;
    if (typeof input.url === "string") return input.url.slice(0, 100);
    if (typeof input.agent === "string" || typeof input.task === "string") {
        const task = typeof input.task === "string" ? input.task.slice(0, 80) : "";
        return `→ ${input.agent ?? "general"} "${task}"`;
    }
    return "";
}

// ---------------------------------------------------------------------------
// Checkpoint store
// ---------------------------------------------------------------------------

export interface CheckpointFile {
    /** Project-relative path. */
    path: string;
    /** Blob sha256 — null is a tombstone (the file did not exist). */
    hash: string | null;
    size: number;
}

export interface CheckpointManifest {
    id: string;
    seq: number;
    kind: "turn" | "named";
    label?: string;
    ts: number;
    files: CheckpointFile[];
}

const MANIFEST_PREFIX = "cp-";
const KEEP_MANIFESTS = 40;

/** Blob store + manifests under <cwd>/.unown/checkpoints/. */
export class CheckpointStore {
    readonly dir: string;
    private seqCache: number | null = null;

    constructor(dir: string) {
        this.dir = dir;
    }

    private ensure(): void {
        mkdirSync(this.dir, { recursive: true });
    }

    private blobPath(hash: string): string {
        return join(this.dir, "files", hash.slice(0, 2), hash);
    }

    /** Store content, return its hash. Content-addressed (dedup by write). */
    putBlob(content: string | Buffer): string {
        const hash = sha256(content);
        const target = this.blobPath(hash);
        if (!existsSync(target)) {
            this.ensure();
            mkdirSync(join(target, ".."), { recursive: true });
            writeFileSync(target, content);
        }
        return hash;
    }

    readBlob(hash: string): Buffer | null {
        try {
            return readFileSync(this.blobPath(hash));
        } catch {
            return null;
        }
    }

    private nextSeq(): number {
        if (this.seqCache === null) {
            this.seqCache = 0;
            for (const m of this.list()) this.seqCache = Math.max(this.seqCache, m.seq);
        }
        return ++this.seqCache;
    }

    manifestPath(id: string): string {
        return join(this.dir, `${MANIFEST_PREFIX}${id}.json`);
    }

    writeManifest(manifest: CheckpointManifest): void {
        this.ensure();
        writeFileSync(this.manifestPath(manifest.id), JSON.stringify(manifest, null, 2));
    }

    /** All manifests, oldest first. Tolerates broken files (skipped). */
    list(): CheckpointManifest[] {
        if (!existsSync(this.dir)) return [];
        const out: CheckpointManifest[] = [];
        for (const name of readdirSync(this.dir)) {
            if (!name.startsWith(MANIFEST_PREFIX) || !name.endsWith(".json")) continue;
            try {
                out.push(JSON.parse(readFileSync(join(this.dir, name), "utf8")) as CheckpointManifest);
            } catch {
                continue;
            }
        }
        out.sort((a, b) => a.seq - b.seq);
        return out;
    }

    /** Capture the current on-disk state of one file (tombstone if absent). */
    captureFile(absPath: string): CheckpointFile | null {
        try {
            const content = readFileSync(absPath);
            return { path: absPath, hash: this.putBlob(content), size: content.length };
        } catch {
            return { path: absPath, hash: null, size: 0 };
        }
    }

    /** Restore one manifest's files. Returns per-file outcomes. */
    restore(manifest: CheckpointManifest, cwd: string): Array<{ path: string; ok: boolean; action: "restored" | "deleted" | "missing-blob" | "outside" }> {
        const out: Array<{ path: string; ok: boolean; action: "restored" | "deleted" | "missing-blob" | "outside" }> = [];
        for (const f of manifest.files) {
            const abs = isAbsolute(f.path) ? f.path : join(cwd, f.path);
            if (!insideRoot(cwd, abs)) {
                out.push({ path: f.path, ok: false, action: "outside" });
                continue;
            }
            if (f.hash === null) {
                try {
                    if (existsSync(abs)) rmSync(abs);
                    out.push({ path: f.path, ok: true, action: "deleted" });
                } catch {
                    out.push({ path: f.path, ok: false, action: "deleted" });
                }
                continue;
            }
            const blob = this.readBlob(f.hash);
            if (blob === null) {
                out.push({ path: f.path, ok: false, action: "missing-blob" });
                continue;
            }
            try {
                mkdirSync(join(abs, ".."), { recursive: true });
                writeFileSync(abs, blob);
                out.push({ path: f.path, ok: true, action: "restored" });
            } catch {
                out.push({ path: f.path, ok: false, action: "restored" });
            }
        }
        return out;
    }

    removeManifest(id: string): void {
        try {
            rmSync(this.manifestPath(id));
        } catch {
            /* already gone */
        }
    }

    /** Keep the newest KEEP_MANIFESTS manifests; GC unreferenced blobs. */
    prune(keep = KEEP_MANIFESTS): number {
        const all = this.list();
        if (all.length <= keep) return 0;
        const removed = all.slice(0, all.length - keep);
        for (const m of removed) this.removeManifest(m.id);
        this.gcBlobs();
        return removed.length;
    }

    private gcBlobs(): void {
        const referenced = new Set<string>();
        for (const m of this.list()) {
            for (const f of m.files) if (f.hash) referenced.add(f.hash);
        }
        const filesRoot = join(this.dir, "files");
        if (!existsSync(filesRoot)) return;
        for (const shard of readdirSync(filesRoot)) {
            const shardDir = join(filesRoot, shard);
            for (const hash of readdirSync(shardDir)) {
                if (!referenced.has(hash)) {
                    try {
                        rmSync(join(shardDir, hash));
                    } catch {
                        /* best effort */
                    }
                }
            }
        }
    }

    /** Rough on-disk size of the blob store (bytes). */
    sizeBytes(): number {
        const filesRoot = join(this.dir, "files");
        if (!existsSync(filesRoot)) return 0;
        let total = 0;
        for (const shard of readdirSync(filesRoot)) {
            for (const hash of readdirSync(join(filesRoot, shard))) {
                try {
                    total += statSync(join(filesRoot, shard, hash)).size;
                } catch {
                    /* raced away */
                }
            }
        }
        return total;
    }
}

/** Render the /checkpoints listing. */
export function renderCheckpoints(manifests: CheckpointManifest[], sizeBytes: number): string {
    if (manifests.length === 0) {
        return "No checkpoints yet. /checkpoint <label> snapshots the files this session touched; turn checkpoints are sealed automatically when a turn writes files.";
    }
    const lines = manifests
        .slice(-30)
        .reverse()
        .map((m) => {
            const time = new Date(m.ts).toISOString().slice(5, 19).replace("T", " ");
            const kind = m.kind === "turn" ? "[turn]" : `[named]`;
            return `${m.id} ${kind} ${time} ${m.files.length} file(s)${m.label ? ` "${m.label}"` : ""}`;
        });
    const kb = Math.max(1, Math.round(sizeBytes / 1024));
    return `Checkpoints (newest first, ${manifests.length} total, ~${kb} KB of blobs):\n${lines.join("\n")}\n/restore <id|label> rewrites the snapshot; /undo [n] reverts the last n turn(s).`;
}

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

export interface CheckpointsOptions {
    cwd: string;
    verbose?: boolean;
    /** Override dirs (tests). */
    receiptsFile?: string;
    storeDir?: string;
}

export function createCheckpointsExtension(opts: CheckpointsOptions) {
    const verbose = opts.verbose ?? false;
    const subagent = process.env.UNOWN_SUBAGENT === "1";
    const log = (msg: string) => {
        if (verbose) console.error(`[unown-checkpoints] ${msg}`);
    };

    const bootId = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const ledgerFile = opts.receiptsFile ?? join(receiptsDir(opts.cwd), `${subagent ? "sub-" : ""}${bootId}.jsonl`);
    const ledger = new ReceiptsLedger(ledgerFile);
    const store = new CheckpointStore(opts.storeDir ?? checkpointsDir(opts.cwd));

    // Per-turn state (in-memory): before-images + which files actually changed.
    let turnBefore = new Map<string, { hash: string | null; size: number }>();
    let turnWritten = new Set<string>();
    // Every file this session successfully wrote/edited (for named snapshots).
    const sessionTouched = new Set<string>();

    const resolveFile = (p: string): string => (isAbsolute(p) ? p : join(opts.cwd, p));

    const sealTurnCheckpoint = (): CheckpointManifest | null => {
        if (turnWritten.size === 0) return null;
        const files: CheckpointFile[] = [];
        for (const path of turnWritten) {
            const before = turnBefore.get(path);
            if (!before) continue; // captured outside this turn — not ours to revert
            files.push({ path: relative(opts.cwd, path), hash: before.hash, size: before.size });
        }
        if (files.length === 0) return null;
        const manifest: CheckpointManifest = {
            id: `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            seq: nextStoreSeq(),
            kind: "turn",
            ts: Date.now(),
            files,
        };
        store.writeManifest(manifest);
        store.prune();
        ledger.append({ kind: "checkpoint", id: manifest.id, files: files.length, turn: true });
        log(`sealed turn checkpoint ${manifest.id} (${files.length} files)`);
        return manifest;
    };

    // seq helper bound to the store (exposed for tests via closure state)
    let seqCounter = 0;
    const nextStoreSeq = (): number => {
        const existing = store.list();
        seqCounter = Math.max(seqCounter, ...existing.map((m) => m.seq), 0);
        return ++seqCounter;
    };

    const factory = (pi: any) => {
        pi.on("session_start", () => {
            ledger.append({ kind: "session_start", subagent, cwd: opts.cwd });
            log(`ledger at ${ledgerFile}`);
        });

        pi.on("input", (event: any) => {
            const text = typeof event?.text === "string" ? event.text : "";
            sealTurnCheckpoint(); // close out the previous turn if it wrote files
            turnBefore = new Map();
            turnWritten = new Set();
            if (text.trim()) {
                ledger.append({ kind: "input", preview: previewText(text) });
            }
        });

        pi.on("tool_call", (event: any) => {
            const tool = event?.toolName as string;
            const input = event?.input ?? {};
            // Capture the pre-write state before the tool runs (before-image).
            if (tool === "write" || tool === "edit") {
                const raw = typeof input?.path === "string" ? input.path : "";
                if (raw) {
                    const path = resolveFile(raw);
                    if (!turnBefore.has(path)) {
                        const state = store.captureFile(path);
                        if (state) turnBefore.set(path, { hash: state.hash, size: state.size });
                    }
                }
            }
            // Bound the recorded input payload.
            let bounded: Record<string, unknown> = input;
            try {
                const json = JSON.stringify(input);
                if (json.length > INPUT_CAP) bounded = { truncated: true, preview: json.slice(0, INPUT_CAP) };
            } catch {
                bounded = { unserializable: true };
            }
            ledger.append({ kind: "tool_call", id: String(event?.toolCallId ?? ""), tool: tool ?? "", input: bounded });
        });

        pi.on("tool_result", (event: any) => {
            const tool = event?.toolName as string;
            if (tool === "write" || tool === "edit") {
                const raw = typeof event?.input?.path === "string" ? event.input.path : "";
                if (raw && !event?.isError) {
                    const path = resolveFile(raw);
                    turnWritten.add(path);
                    sessionTouched.add(path);
                }
            }
            ledger.append({
                kind: "tool_result",
                id: String(event?.toolCallId ?? ""),
                tool: tool ?? "",
                isError: Boolean(event?.isError),
                preview: previewText(event?.content),
                usage:
                    event?.usage && typeof event.usage.input === "number"
                        ? { input: event.usage.input, output: event.usage.output ?? 0 }
                        : undefined,
            });
        });

        pi.on("session_shutdown", () => {
            // Seal the final turn so a quit-after-edit session is still undoable
            // next boot (the manifest lives on disk; /undo reads the store).
            sealTurnCheckpoint();
        });

        // -------------------------------------------------------------------
        // Commands
        // -------------------------------------------------------------------

        pi.registerCommand("receipts", {
            description: "Show the session receipts audit ledger (last N entries + totals): /receipts [n]",
            handler: async (args: string, ctx: any) => {
                const n = Math.min(Math.max(Number.parseInt(args ?? "20", 10) || 20, 1), 500);
                ctx.ui.notify(renderReceipts(ledger.entries(), n), "info");
            },
        });

        pi.registerCommand("checkpoints", {
            description: "List checkpoints (turn + named) with blob-store size",
            handler: async (_args: string, ctx: any) => {
                ctx.ui.notify(renderCheckpoints(store.list(), store.sizeBytes()), "info");
            },
        });

        pi.registerCommand("checkpoint", {
            description: "Snapshot the current state of every file this session touched: /checkpoint [label]",
            handler: async (args: string, ctx: any) => {
                const label = (args ?? "").trim();
                const targets = [...sessionTouched];
                if (targets.length === 0) {
                    ctx.ui.notify(
                        "Nothing to snapshot yet — this session has not written any files (bash-caused changes are not tracked file-by-file).",
                        "warning",
                    );
                    return;
                }
                const files: CheckpointFile[] = [];
                for (const path of targets) {
                    const captured = store.captureFile(path);
                    if (captured) files.push({ ...captured, path: relative(opts.cwd, path) });
                }
                const manifest: CheckpointManifest = {
                    id: label ? `${slugify(label)}-${Date.now().toString(36)}` : `n${Date.now().toString(36)}`,
                    seq: nextStoreSeq(),
                    kind: "named",
                    label: label || undefined,
                    ts: Date.now(),
                    files,
                };
                store.writeManifest(manifest);
                store.prune();
                ledger.append({ kind: "checkpoint", id: manifest.id, label: manifest.label, files: files.length, turn: false });
                ctx.ui.notify(`Checkpoint ${manifest.id} — ${files.length} file(s) snapshot. /restore ${manifest.id} rewinds to this state.`, "info");
            },
        });

        pi.registerCommand("undo", {
            description: "Revert the file changes of the last n turn(s) (default 1): /undo [n]",
            handler: async (args: string, ctx: any) => {
                const n = Math.min(Math.max(Number.parseInt(args ?? "1", 10) || 1, 1), 20);
                const turns = store.list().filter((m) => m.kind === "turn");
                if (turns.length === 0) {
                    ctx.ui.notify("No turn checkpoints to undo (nothing sealed this session — try /restore <id> for named snapshots).", "warning");
                    return;
                }
                const chosen = turns.slice(-n);
                let files = 0;
                const restoredPaths: string[] = [];
                for (const manifest of chosen) {
                    const outcomes = store.restore(manifest, opts.cwd);
                    files += outcomes.filter((o) => o.ok).length;
                    restoredPaths.push(...outcomes.filter((o) => o.ok).map((o) => o.path));
                    store.removeManifest(manifest.id);
                }
                ledger.append({ kind: "restore", ids: chosen.map((m) => m.id), files });
                ctx.ui.notify(
                    `Undid ${chosen.length} turn(s) — ${files} file(s) reverted${restoredPaths.length ? `:\n${restoredPaths.slice(0, 20).join("\n")}` : ""}.`,
                    "info",
                );
            },
        });

        pi.registerCommand("restore", {
            description: "Restore a named checkpoint: /restore <id|label>",
            handler: async (args: string, ctx: any) => {
                const key = (args ?? "").trim();
                if (!key) {
                    ctx.ui.notify("Usage: /restore <id|label> (see /checkpoints)", "info");
                    return;
                }
                const all = store.list();
                const manifest =
                    all.find((m) => m.id === key) ??
                    all.find((m) => (m.label ?? "").toLowerCase() === key.toLowerCase()) ??
                    all.reverse().find((m) => m.id.startsWith(key) || (m.label ?? "").toLowerCase().startsWith(key.toLowerCase()));
                if (!manifest) {
                    ctx.ui.notify(`No checkpoint matches "${key}". /checkpoints lists them.`, "warning");
                    return;
                }
                const outcomes = store.restore(manifest, opts.cwd);
                const ok = outcomes.filter((o) => o.ok).length;
                ledger.append({ kind: "restore", ids: [manifest.id], files: ok });
                ctx.ui.notify(
                    `Restored ${manifest.id} — ${ok}/${outcomes.length} file(s) rewritten${ok ? "" : " (blobs missing — was the store pruned?)"}.`,
                    ok === outcomes.length ? "info" : "warning",
                );
            },
        });
    };

    return { name: "unown-checkpoints", factory, hidden: true } as const;
}
