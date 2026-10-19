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
 *   - Redo stack (the opencode/Cursor undo→redo port) — `/undo` captures,
 *     per undone turn and BEFORE restoring its before-images, the content it
 *     is about to overwrite into `redo-*.json` entries in the same store
 *     (content-addressed blobs make the capture a dedup no-op when nothing
 *     changed); `/redo [n]` pops entries newest-first and re-applies them
 *     through the same hash-verified, jailed restore path, so `/undo n` +
 *     `/redo n` is a byte-exact round trip. Any newly sealed checkpoint
 *     (turn or named, any session sharing the store) clears the stack — new
 *     edits invalidate redo, the classic editor rule. Redo is not itself
 *     undoable: after `/redo`, `/undo` reverts earlier turns.
 *
 * Everything is plain fs + crypto — cross-platform by construction (no shell,
 * no git dependency, no native modules). Restore only ever writes inside the
 * project cwd — lexically AND through realpath (an in-project symlink whose
 * target escapes the project is refused; the same jail the terminal hooks
 * enforce on tools).
 *
 * Hardening (R-b workflows audit, Milestone H1 — data integrity): every blob,
 * manifest and restored file goes through atomicWriteFileSync (temp + fsync +
 * rename — a crash never parks a truncated file at a content-addressed path);
 * restores verify sha256(blob) against the manifest hash and report
 * corrupt-blob instead of silently writing wrong content; blob GC keeps a
 * 10-minute mtime grace and never deletes blobs newer than the newest
 * manifest (concurrent sessions sharing one store cannot lose each other's
 * in-flight before-images); manifests carry owner/consumed fields — /undo
 * defaults to this session's turns (/undo --all opts into cross-session) and
 * consumption is journaled before any file is touched, so a crash mid-undo
 * re-runs safely; files larger than MAX_BLOB_BYTES are never blobbed (honest
 * oversized entries — /undo says it cannot revert them).
 *
 * Hardening (R-b workflows audit, Milestone H2 — privacy): every boot
 * self-heals `<project>/.unown/.gitignore` so receipts/, checkpoints/ and
 * reviews/ are ignored in USER projects too (previously only Unown's own
 * repo covered them — `git add .` committed full file snapshots, tool
 * inputs and source diffs); tool_call inputs are REDACTED before they hit
 * the ledger — write/edit file content persists as a size note only
 * (`content: <n chars>`), secret-looking values (KEY=VALUE assignments with
 * token/secret/password/api-key/authorization/bearer keys, Authorization
 * headers, long sk-/Bearer tokens) are masked at the single input
 * chokepoint AND at render time for legacy entries (defense in depth).
 *
 * Known limits (documented in docs/usage.md): bash-caused file changes are
 * recorded as commands in the ledger but not itemized per-file (no workspace
 * diffing); subagent processes keep their own ledger file under the same
 * `.unown/receipts/` (marked `[subagent]`); capture-time reads follow
 * symlinks (the jail is enforced on restore writes); turn checkpoints are
 * sealed at the next input / shutdown, not per write.
 */
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { atomicWriteFileSync } from "./atomic.ts";

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

/**
 * Resolve the deepest EXISTING ancestor of `p` to its real (symlink-free)
 * location and re-attach the non-existent tail lexically (the hooks.ts
 * jailPath pattern, re-implemented locally — importing hooks.ts would drag
 * the SQLite store module into every checkpoints importer). Falls back to
 * the lexical path when nothing exists up to the filesystem root, so
 * brand-new files still pass the jail (only existing symlinks are resolved).
 */
function realpathAncestor(p: string): string {
    let dir = p;
    let tail = "";
    for (;;) {
        try {
            const real = realpathSync(dir);
            // join() (not `${real}/${tail}`): canonical separators on win32.
            return tail ? join(real, tail) : real;
        } catch {
            /* missing path (or broken symlink) — climb one level */
        }
        const parent = dirname(dir);
        if (parent === dir) return p; // reached "/" without an existing ancestor
        tail = tail ? join(basename(dir), tail) : basename(dir);
        dir = parent;
    }
}

/**
 * Realpath jail: insideRoot plus symlink resolution — an in-project symlink
 * chain whose target escapes the root fails here (the lexical check alone is
 * bypassable: proj/link -> /etc/x passes insideRoot, but restoring THROUGH
 * it writes outside the project). Restores require BOTH checks; new files
 * with no existing symlinked ancestor still pass.
 */
export function insideRootReal(root: string, p: string): boolean {
    let rootReal = resolve(root);
    try {
        rootReal = realpathSync(root);
    } catch {
        /* jail root does not exist yet — keep the lexical prefix */
    }
    const rel = relative(rootReal, realpathAncestor(resolve(p)));
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
    | { seq: number; ts: number; kind: "redo"; ids: string[]; files: number }
    | { seq: number; ts: number; kind: "note"; preview: string };

/**
 * Distributive Omit: keeps each union member's own shape instead of
 * collapsing to the shared keys (plain Omit<ReceiptEntry, ...> would drop
 * member-specific fields like `ids`/`preview`/`subagent` and type-error on
 * every append call site).
 */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type ReceiptEntryInput = DistributiveOmit<ReceiptEntry, "seq" | "ts">;

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

    append(entry: ReceiptEntryInput): ReceiptEntry {
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

// ---------------------------------------------------------------------------
// Privacy redaction (R-b V2/U4)
// ---------------------------------------------------------------------------

/** Secret-bearing KEY substrings: assignments, object fields and headers
 *  whose key contains one of these get their value masked in the ledger. */
const SECRET_KEY = /(token|secret|password|api[_-]?key|authorization|bearer)/i;

/**
 * Redact secret-looking values from free text (R-b V2):
 *   - `KEY=VALUE` assignments whose KEY looks secret-bearing → `KEY=***`
 *     (`export API_TOKEN=sk-…`, `--api_key=x` in command lines)
 *   - `Authorization: <token>` headers (any case) → `Authorization: ***`
 *   - long `Bearer <token>` and `sk-…` tokens (8+ chars — short `sk-x`
 *     literals in prose are left alone)
 * Applied at the ledger's tool_call input chokepoint AND at render time
 * (U4: legacy entries written before redaction existed must not leak on
 * screen either). Idempotent — re-running it on redacted text is a no-op.
 */
export function redactSecrets(text: string): string {
    let out = text.replace(
        /\b([A-Za-z_][A-Za-z0-9_-]{0,40})\s*=\s*("[^"]{0,256}"|'[^']{0,256}'|[^\s;&|>"']{1,256})/g,
        (whole, key: string) => (SECRET_KEY.test(key) ? `${key}=***` : whole),
    );
    // "Authorization: Bearer <tok>" and bare "Authorization: <tok>" alike —
    // the optional Bearer prefix is consumed so the token cannot survive as
    // a separate match for the sk-/Bearer rules below; surrounding quotes
    // (curl -H "Authorization: …") are left in place.
    out = out.replace(/\b(authorization\s*:\s*)(?:bearer\s+)?[^\s"']+/gi, "$1***");
    out = out.replace(/\bBearer\s+[A-Za-z0-9._+/=-]{8,}/gi, "Bearer ***");
    out = out.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***");
    return out;
}

/**
 * Redact a tool_call input before it is persisted to the ledger (R-b V2 —
 * the single chokepoint the extension's tool_call handler uses):
 *   - write/edit `content` → `<n chars>` (file content NEVER persists —
 *     the audit's 4 KB-of-every-tool-input included full file bodies)
 *   - any input field whose NAME looks secret-bearing → `***`
 *   - every string value → `redactSecrets` (command lines, prompts, URLs)
 * Non-string leaves (numbers, booleans, nested structures) pass through.
 */
export function redactToolInput(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input ?? {})) {
        if ((tool === "write" || tool === "edit") && key === "content" && typeof value === "string") {
            out[key] = `<${value.length} chars>`;
        } else if (SECRET_KEY.test(key) && typeof value === "string" && value.length > 0) {
            out[key] = "***";
        } else if (typeof value === "string") {
            out[key] = redactSecrets(value);
        } else {
            out[key] = value;
        }
    }
    return out;
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
        redos: 0,
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
        else if (e.kind === "redo") totals.redos++;
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
        } else if (e.kind === "redo") {
            lines.push(`#${e.seq} ${time} redo   ${e.ids.join(", ")} — ${e.files} file(s)`);
        } else if (e.kind === "note") {
            lines.push(`#${e.seq} ${time} note   "${e.preview}"`);
        }
    }
    const toolSummary = [...byTool.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(" ");
    const head =
        `Receipts — ${totals.inputs} input(s), ${totals.toolCalls} tool call(s)${toolSummary ? ` [${toolSummary}]` : ""}, ` +
        `${totals.filesWritten} distinct file(s) written, ${totals.errors} error(s), ` +
        `${totals.checkpoints} checkpoint(s), ${totals.restores} restore(s), ${totals.redos} redo(s).`;
    const tail =
        entries.length > shown.length ? `\n(showing last ${shown.length} of ${entries.length}; /receipts <n> for more)` : "";
    return `${head}\n${lines.join("\n")}${tail}`;
}

export function describeToolInput(tool: string, input: Record<string, unknown> | undefined): string {
    if (!input) return "";
    const p = typeof input.path === "string" ? input.path : undefined;
    if (tool === "bash" || tool === "powershell") {
        const cmd = typeof input.command === "string" ? input.command : "";
        // U4: render-time redaction — legacy entries persisted before the V2
        // chokepoint existed must not leak their command-line secrets on screen.
        return `"${redactSecrets(cmd).replace(/\s+/g, " ").slice(0, 120)}"`;
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
    /** Blob sha256 — null is a tombstone (the file did not exist) or an
     *  oversized capture (oversized: true — the content was never blobbed). */
    hash: string | null;
    size: number;
    /** True when the file exceeded MAX_BLOB_BYTES at capture time: no blob
     *  exists and /undo cannot revert it — restore reports this honestly
     *  instead of guessing (never deletes, never writes wrong content). */
    oversized?: boolean;
}

export interface CheckpointManifest {
    id: string;
    seq: number;
    kind: "turn" | "named";
    label?: string;
    ts: number;
    files: CheckpointFile[];
    /** Session boot id that sealed this manifest. Absent on legacy manifests
     *  (written before ownership existed) — read as "unknown", never as own. */
    owner?: string;
    /** Set (atomically, before any file is touched) once /undo has claimed
     *  this manifest — a durable marker for crash-safe undo ordering. */
    consumed?: boolean;
}

/** One redo-stack entry — the content /undo is about to overwrite, captured
 *  per undone turn before its before-images are restored. Same shape as a
 *  manifest's files (tombstone = the file did not exist at capture time, so
 *  /redo deletes it again), same content-addressed blob store. */
export interface RedoManifest {
    id: string;
    seq: number;
    ts: number;
    files: CheckpointFile[];
    /** Session boot id that ran the /undo (the session /redo defaults to). */
    owner?: string;
}

/** The subset of a manifest restore() needs — shared by cp- manifests and
 *  RedoManifest entries, so /redo re-uses the exact same hash-verified,
 *  jailed write path as /restore and /undo. */
export interface RestoreSource {
    files: CheckpointFile[];
}

/** Per-file outcome of CheckpointStore.restore(). */
export type RestoreAction = "restored" | "deleted" | "missing-blob" | "corrupt-blob" | "outside" | "oversized";
export interface RestoreOutcome {
    path: string;
    ok: boolean;
    action: RestoreAction;
}

const MANIFEST_PREFIX = "cp-";
const KEEP_MANIFESTS = 40;
/** Cross-owner ceiling for owner-scoped prunes: past this line the OLDEST
 *  manifests are evicted across all owners, so one busy session cannot evict
 *  a quiet session's live checkpoints below its own KEEP_MANIFESTS floor
 *  until the whole store is genuinely over budget (R-b C3). */
const GLOBAL_KEEP_MANIFESTS = 200;
/** Redo-stack retention (the opencode/Cursor undo→redo port): /undo and
 *  /redo cap n at 20, so a 20-entry floor per owner keeps every reachable
 *  stack alive; 60 across owners bounds a shared store the same way
 *  GLOBAL_KEEP_MANIFESTS bounds the manifests. */
const REDO_PREFIX = "redo-";
const KEEP_REDO_ENTRIES = 20;
const GLOBAL_KEEP_REDO_ENTRIES = 60;
/** Blob GC grace (git's gc.pruneExpire pattern): blobs younger than this are
 *  never deleted — another process sharing this store may hold them inside
 *  its put-to-seal window (before-image captured at tool_call time, manifest
 *  sealed at the next input; /review's subagent processes hit this by
 *  design — R-b C1). */
const GC_GRACE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BLOB_BYTES = 64 * 1024 * 1024;

/** Per-file blob cap, env-overridable, parsed tolerantly (NaN/negative/zero
 *  or unset → the 64 MiB default — R-b D1). Read per call so tests can pin
 *  it without re-importing the module. */
function maxBlobBytes(): number {
    const raw = Number.parseInt(process.env.UNOWN_CHECKPOINT_MAX_BLOB_BYTES ?? "", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BLOB_BYTES;
}

/** atomicWriteFileSync is string-typed, but writeFileSync passes Buffer data
 *  through verbatim (the utf8 encoding option only applies to strings) — blob
 *  snapshots stay binary-safe through this one narrow cast. */
function atomicWriteBlob(file: string, content: string | Buffer): void {
    atomicWriteFileSync(file, content as unknown as string);
}

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

    /** Store content, return its hash. Content-addressed (dedup by write).
     *  Atomic (temp+fsync+rename) and self-healing: a crash-truncated blob
     *  already parked at this content-addressed path would otherwise be
     *  permanent — the size check below rewrites it (R-b A1). */
    putBlob(content: string | Buffer): string {
        const hash = sha256(content);
        const target = this.blobPath(hash);
        const expected = typeof content === "string" ? Buffer.byteLength(content) : content.length;
        let write = true;
        if (existsSync(target)) {
            try {
                write = statSync(target).size !== expected;
            } catch {
                write = true;
            }
        }
        if (write) atomicWriteBlob(target, content);
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
        // Atomic (temp+fsync+rename): a crash mid-write must never leave a
        // truncated cp-<id>.json that list() would silently skip (R-b A2).
        atomicWriteFileSync(this.manifestPath(manifest.id), JSON.stringify(manifest, null, 2));
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

    /** Capture the current on-disk state of one file (tombstone if absent;
     *  oversized marker if bigger than MAX_BLOB_BYTES — never blobbed, R-b D1). */
    captureFile(absPath: string): CheckpointFile | null {
        try {
            const size = statSync(absPath).size;
            if (size > maxBlobBytes()) return { path: absPath, hash: null, size, oversized: true };
            const content = readFileSync(absPath);
            return { path: absPath, hash: this.putBlob(content), size };
        } catch {
            return { path: absPath, hash: null, size: 0 };
        }
    }

    /** Restore one manifest's files. Returns per-file outcomes. Every blob is
     *  hash-verified before it is written (a truncated or bit-rotted blob is
     *  reported as corrupt-blob, never silently restored as wrong content —
     *  R-b R1), and every target must pass BOTH the lexical and the realpath
     *  jail (R-b P1). Writes are atomic per file. Takes any RestoreSource —
     *  cp- manifests and redo entries share this exact path. */
    restore(manifest: RestoreSource, cwd: string): RestoreOutcome[] {
        const out: RestoreOutcome[] = [];
        for (const f of manifest.files) {
            const abs = isAbsolute(f.path) ? f.path : join(cwd, f.path);
            if (!insideRoot(cwd, abs) || !insideRootReal(cwd, abs)) {
                out.push({ path: f.path, ok: false, action: "outside" });
                continue;
            }
            if (f.oversized === true) {
                // Oversized captures: the pre-turn content exceeded
                // MAX_BLOB_BYTES and was never blobbed. DECISION — skip and
                // report rather than delete: the file existed before the turn,
                // so tombstone-deleting it would destroy user data the store
                // never actually captured; the honest degradation (matching
                // the capture-time "too large to checkpoint — /undo will not
                // revert it" note) is to leave the file and say so.
                out.push({ path: f.path, ok: false, action: "oversized" });
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
            if (sha256(blob) !== f.hash) {
                out.push({ path: f.path, ok: false, action: "corrupt-blob" });
                continue;
            }
            try {
                atomicWriteBlob(abs, blob);
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

    // -----------------------------------------------------------------------
    // Redo stack (opencode/Cursor undo→redo): one redo-*.json entry per
    // undone turn, holding the content /undo is about to overwrite. Same
    // atomicity, hash-verification and jail as cp- manifests; /redo pops
    // entries newest-first; any newly sealed checkpoint clears the stack.
    // -----------------------------------------------------------------------

    redoPath(id: string): string {
        return join(this.dir, `${REDO_PREFIX}${id}.json`);
    }

    /** Next redo seq — rescanned from disk per call (no cache) so sessions
     *  sharing one store interleave correctly; redo stacks stay tiny, the
     *  readdir is cheap (the extension's nextStoreSeq pattern). */
    nextRedoSeq(): number {
        let max = 0;
        for (const m of this.listRedo()) max = Math.max(max, m.seq);
        return max + 1;
    }

    writeRedo(manifest: RedoManifest): void {
        this.ensure();
        // Atomic like writeManifest: a crash mid-write must never leave a
        // truncated redo-<id>.json that listRedo() would silently skip.
        atomicWriteFileSync(this.redoPath(manifest.id), JSON.stringify(manifest, null, 2));
    }

    /** All redo entries, oldest first (push order — /redo pops from the
     *  end). Tolerates broken files (skipped). */
    listRedo(): RedoManifest[] {
        if (!existsSync(this.dir)) return [];
        const out: RedoManifest[] = [];
        for (const name of readdirSync(this.dir)) {
            if (!name.startsWith(REDO_PREFIX) || !name.endsWith(".json")) continue;
            try {
                out.push(JSON.parse(readFileSync(join(this.dir, name), "utf8")) as RedoManifest);
            } catch {
                continue;
            }
        }
        out.sort((a, b) => a.seq - b.seq);
        return out;
    }

    removeRedo(id: string): void {
        try {
            rmSync(this.redoPath(id));
        } catch {
            /* already gone */
        }
    }

    /** Drop redo entries — all of them, or one owner's. Returns how many
     *  went. Blob reclamation is left to gcBlobs (grace window applies). */
    clearRedo(owner?: string): number {
        const all = this.listRedo();
        const doomed = owner === undefined ? all : all.filter((m) => m.owner === owner);
        for (const m of doomed) this.removeRedo(m.id);
        return doomed.length;
    }

    /** Redo-stack retention — the prune() shape at redo scale: an owner
     *  floor plus a global cap, so one session's deep undo cannot evict
     *  another's redo stack below its own floor until the whole store is
     *  genuinely over budget. */
    pruneRedo(keep = KEEP_REDO_ENTRIES, owner?: string): number {
        const all = this.listRedo();
        if (owner === undefined) {
            if (all.length <= keep) return 0;
            const removed = all.slice(0, all.length - keep);
            for (const m of removed) this.removeRedo(m.id);
            if (removed.length > 0) this.gcBlobs();
            return removed.length;
        }
        const doomed = new Set<string>();
        const own = all.filter((m) => m.owner === owner);
        if (own.length > keep) for (const m of own.slice(0, own.length - keep)) doomed.add(m.id);
        for (const m of all) {
            // oldest first (listRedo is seq-ordered) across ALL owners, only
            // past the global cap — the per-owner floor above is untouched.
            if (all.length - doomed.size <= GLOBAL_KEEP_REDO_ENTRIES) break;
            doomed.add(m.id);
        }
        for (const id of doomed) this.removeRedo(id);
        if (doomed.size > 0) this.gcBlobs();
        return doomed.size;
    }

    /**
     * Retention + blob GC. Without `owner` this keeps the newest `keep`
     * manifests globally (pre-ownership behavior). With `owner` (the
     * extension always passes its bootId) the prune is owner-scoped: only
     * THAT owner's manifests are evicted beyond its own `keep` floor, plus a
     * global cap (GLOBAL_KEEP_MANIFESTS) that evicts the oldest manifests
     * across all owners — one session's prune can no longer evict another
     * session's live checkpoints below the cap line (R-b C3).
     */
    prune(keep = KEEP_MANIFESTS, owner?: string): number {
        const all = this.list();
        if (owner === undefined) {
            if (all.length <= keep) return 0;
            const removed = all.slice(0, all.length - keep);
            for (const m of removed) this.removeManifest(m.id);
            this.gcBlobs();
            return removed.length;
        }
        const doomed = new Set<string>();
        const own = all.filter((m) => m.owner === owner);
        if (own.length > keep) for (const m of own.slice(0, own.length - keep)) doomed.add(m.id);
        for (const m of all) {
            // oldest first (list() is seq-ordered) across ALL owners, only
            // past the global cap — the per-owner floor above is untouched.
            if (all.length - doomed.size <= GLOBAL_KEEP_MANIFESTS) break;
            doomed.add(m.id);
        }
        for (const id of doomed) this.removeManifest(id);
        if (doomed.size > 0) this.gcBlobs();
        return doomed.size;
    }

    /**
     * Delete unreferenced blobs — with a safety margin: never a blob younger
     * than GC_GRACE_MS (another process may hold it inside its put-to-seal
     * window — R-b C1), and never a blob newer than the newest surviving
     * manifest (in-flight even past the grace while the store is idle).
     * Shard readdirs are guarded: a concurrent GC removing a shard between
     * the two readdirs is a skip, not a crash (R-b C6).
     */
    private gcBlobs(): void {
        const all = this.list();
        const redos = this.listRedo();
        const referenced = new Set<string>();
        let newestTs = -Infinity;
        for (const m of all) {
            for (const f of m.files) if (f.hash) referenced.add(f.hash);
            newestTs = Math.max(newestTs, m.ts);
        }
        // Redo entries reference blobs too (the pre-undo content /undo
        // captured) — a live redo stack is as load-bearing as the manifests
        // it inverts, so its blobs must never be collected out from under it.
        for (const r of redos) {
            for (const f of r.files) if (f.hash) referenced.add(f.hash);
            newestTs = Math.max(newestTs, r.ts);
        }
        const haveManifests = all.length > 0 || redos.length > 0;
        const filesRoot = join(this.dir, "files");
        if (!existsSync(filesRoot)) return;
        let shards: string[];
        try {
            shards = readdirSync(filesRoot);
        } catch {
            return; // vanished between existsSync and readdir — nothing to do
        }
        const now = Date.now();
        for (const shard of shards) {
            const shardDir = join(filesRoot, shard);
            let hashes: string[];
            try {
                hashes = readdirSync(shardDir);
            } catch {
                continue; // shard raced away — skip it
            }
            for (const hash of hashes) {
                if (referenced.has(hash)) continue;
                const entry = join(shardDir, hash);
                try {
                    const st = statSync(entry);
                    if (now - st.mtimeMs < GC_GRACE_MS) continue;
                    if (haveManifests && st.mtimeMs > newestTs) continue;
                    rmSync(entry);
                } catch {
                    /* raced away — best effort */
                }
            }
        }
    }

    /** Rough on-disk size of the blob store (bytes). */
    sizeBytes(): number {
        const filesRoot = join(this.dir, "files");
        if (!existsSync(filesRoot)) return 0;
        let total = 0;
        let shards: string[];
        try {
            shards = readdirSync(filesRoot);
        } catch {
            return 0; // raced away mid-scan — report what we have
        }
        for (const shard of shards) {
            let hashes: string[];
            try {
                hashes = readdirSync(join(filesRoot, shard));
            } catch {
                continue; // shard vanished between the two readdirs — skip it (R-b C6)
            }
            for (const hash of hashes) {
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

/** Render the /checkpoints listing. `redoDepth` is this session's redo-stack
 *  depth — shown when > 0 so the user can see undone work is recoverable. */
export function renderCheckpoints(manifests: CheckpointManifest[], sizeBytes: number, redoDepth = 0): string {
    if (manifests.length === 0) {
        return redoDepth > 0
            ? `No checkpoints yet, but ${redoDepth} undone change(s) are redoable — /redo [n] re-applies them (any new checkpoint clears the redo stack).`
            : "No checkpoints yet. /checkpoint <label> snapshots the files this session touched; turn checkpoints are sealed automatically when a turn writes files.";
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
    const redoLine = redoDepth > 0 ? `\nredo depth: ${redoDepth} — /redo [n] re-applies undone change(s) (any new checkpoint clears the stack).` : "";
    return `Checkpoints (newest first, ${manifests.length} total, ~${kb} KB of blobs):\n${lines.join("\n")}${redoLine}\n/restore <id|label> rewrites the snapshot; /undo [n] reverts the last n turn(s) of this session; /undo --all also reverts other sessions' turns; /redo [n] re-applies undone changes.`;
}

/** Friendly render text per failing restore action (/restore hint line). */
const RESTORE_FAIL_HINTS: Record<RestoreAction, string> = {
    restored: "",
    deleted: "",
    "missing-blob": "blob missing — was the store pruned?",
    "corrupt-blob": "blob failed its integrity check — checkpoint data is corrupt",
    outside: "path escapes the project jail",
    oversized: "file was too large to checkpoint — cannot revert",
};

// ---------------------------------------------------------------------------
// The extension
// ---------------------------------------------------------------------------

/** .unown/.gitignore entries that must never be committed by `git add .` in
 *  a USER project (R-b V1: receipts hold 4 KB of every tool input including
 *  command lines with secrets, checkpoints hold full file snapshots,
 *  reviews hold source diffs; worktrees hold isolated repo copies created by
 *  the task tool's worktree-isolation lane). */
const RUNTIME_IGNORE_ENTRIES = ["receipts/", "checkpoints/", "reviews/", "worktrees/"];
const RUNTIME_IGNORE_HEADER = "# unown runtime state — audit ledgers, checkpoint blobs, review artifacts";

/**
 * Append-if-missing the runtime ignore entries to `<cwd>/.unown/.gitignore`
 * (R-b V1 self-heal — covers projects scaffolded before the fix). Creates
 * the file with a header when absent; appends ONLY the missing entries when
 * present, append-only, so user content is never rewritten, reordered or
 * lost. Best-effort: never breaks a session.
 */
export function ensureUnownGitignore(cwd: string): void {
    try {
        const unownDir = join(cwd, ".unown");
        mkdirSync(unownDir, { recursive: true });
        const file = join(unownDir, ".gitignore");
        let existing = "";
        try {
            existing = readFileSync(file, "utf8");
        } catch {
            /* absent — created by the append below */
        }
        const have = new Set(existing.split("\n").map((l) => l.trim()));
        const missing = RUNTIME_IGNORE_ENTRIES.filter((e) => !have.has(e));
        if (missing.length === 0) return;
        const block: string[] = [];
        if (existing.trim().length > 0 && !existing.endsWith("\n")) block.push(""); // keep the user's last line intact
        if (!existing.includes(RUNTIME_IGNORE_HEADER)) block.push(RUNTIME_IGNORE_HEADER);
        block.push(...missing);
        writeFileSync(file, block.join("\n") + "\n", { flag: "a" });
    } catch {
        /* never break a session over the ignore file */
    }
}

export interface CheckpointsOptions {
    cwd: string;
    verbose?: boolean;
    /** Override dirs (tests). */
    receiptsFile?: string;
    storeDir?: string;
    /** Override the session boot id stamped into manifests (tests — deterministic owners). */
    bootId?: string;
}

export function createCheckpointsExtension(opts: CheckpointsOptions) {
    const verbose = opts.verbose ?? false;
    const subagent = process.env.UNOWN_SUBAGENT === "1";
    const log = (msg: string) => {
        if (verbose) console.error(`[unown-checkpoints] ${msg}`);
    };

    const bootId =
        opts.bootId ?? `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const ledgerFile = opts.receiptsFile ?? join(receiptsDir(opts.cwd), `${subagent ? "sub-" : ""}${bootId}.jsonl`);
    const ledger = new ReceiptsLedger(ledgerFile);
    const store = new CheckpointStore(opts.storeDir ?? checkpointsDir(opts.cwd));

    // Per-turn state (in-memory): before-images + which files actually changed.
    let turnBefore = new Map<string, { hash: string | null; size: number; oversized?: boolean }>();
    let turnWritten = new Set<string>();
    // Files already noted in the ledger as too large to checkpoint (warn once).
    const oversizedWarned = new Set<string>();
    // Every file this session successfully wrote/edited (for named snapshots).
    const sessionTouched = new Set<string>();

    const resolveFile = (p: string): string => (isAbsolute(p) ? p : join(opts.cwd, p));

    // Classic redo semantics (the opencode/Cursor undo→redo port): any newly
    // sealed checkpoint invalidates the redo stack — re-applying pre-undo
    // content over fresh edits would clobber them. Cleared GLOBALLY: any
    // session sealing into this store invalidates redo for everyone sharing
    // it (the conservative direction — stale content never overwrites new).
    const clearRedoStack = (reason: string): number => {
        const cleared = store.clearRedo();
        if (cleared > 0) {
            ledger.append({
                kind: "note",
                preview: `redo stack cleared (${cleared} ${cleared === 1 ? "entry" : "entries"}) — ${reason}; undone work is no longer redoable`,
            });
            log(`cleared ${cleared} redo entry(ies) (${reason})`);
        }
        return cleared;
    };

    // Redo material: /undo captures, per undone turn and BEFORE restoring its
    // before-images, the current content of every file that turn is about to
    // overwrite. One entry per turn, pushed in walk order — /redo pops them
    // newest-first and re-applies, so `/undo n` + `/redo n` is a byte-exact
    // round trip (content-addressed blobs make the capture a dedup no-op
    // when nothing changed). Tombstones round-trip too: a file that did not
    // exist at capture time is deleted again on redo.
    const captureRedoEntry = (undone: CheckpointManifest): RedoManifest | null => {
        const files: CheckpointFile[] = [];
        for (const f of undone.files) {
            const abs = isAbsolute(f.path) ? f.path : join(opts.cwd, f.path);
            const cur = store.captureFile(abs);
            if (cur) files.push({ ...cur, path: f.path });
        }
        if (files.length === 0) return null;
        const entry: RedoManifest = {
            id: `r${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            seq: store.nextRedoSeq(),
            ts: Date.now(),
            files,
            owner: bootId,
        };
        store.writeRedo(entry);
        store.pruneRedo(KEEP_REDO_ENTRIES, bootId);
        log(`pushed redo entry ${entry.id} (${files.length} files)`);
        return entry;
    };

    const sealTurnCheckpoint = (): CheckpointManifest | null => {
        if (turnWritten.size === 0) return null;
        const files: CheckpointFile[] = [];
        for (const path of turnWritten) {
            const before = turnBefore.get(path);
            if (!before) continue; // captured outside this turn — not ours to revert
            const entry: CheckpointFile = { path: relative(opts.cwd, path), hash: before.hash, size: before.size };
            if (before.oversized) entry.oversized = true;
            files.push(entry);
        }
        if (files.length === 0) return null;
        const manifest: CheckpointManifest = {
            id: `t${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
            seq: nextStoreSeq(),
            kind: "turn",
            ts: Date.now(),
            files,
            owner: bootId,
        };
        store.writeManifest(manifest);
        store.prune(KEEP_MANIFESTS, bootId);
        ledger.append({ kind: "checkpoint", id: manifest.id, files: files.length, turn: true });
        clearRedoStack(`new turn checkpoint ${manifest.id} sealed`);
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
            // V1 self-heal: runtime state dirs must be gitignored in USER
            // projects — every boot re-checks (idempotent, append-only).
            ensureUnownGitignore(opts.cwd);
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
        pi.on("agent_end", () => {
            // Seal at TURN END, not only on the next input: /undo and
            // /checkpoints are extension slash commands, and prompt() dispatches
            // those BEFORE the "input" event fires — without this, the turn that
            // just finished stays unsealed and /undo finds nothing to revert
            // until the user sends another (non-slash) message.
            sealTurnCheckpoint();
            turnBefore = new Map();
            turnWritten = new Set();
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
                        if (state) {
                            turnBefore.set(path, { hash: state.hash, size: state.size, oversized: state.oversized });
                            if (state.oversized && !oversizedWarned.has(path)) {
                                oversizedWarned.add(path);
                                ledger.append({
                                    kind: "note",
                                    preview: `file too large to checkpoint — /undo will not revert it: ${relative(opts.cwd, path)} (${state.size} bytes > ${maxBlobBytes()} cap)`,
                                });
                                log(`oversized capture skipped: ${path} (${state.size} bytes)`);
                            }
                        }
                    }
                }
            }
            // Bound + REDACT the recorded input payload (R-b V2): write/edit
            // file content persists as a size note only; secret-looking
            // values are masked at this single chokepoint — nothing downstream
            // (ledger file, /receipts render) ever sees the raw input.
            let bounded: Record<string, unknown>;
            try {
                bounded = redactToolInput(tool ?? "", input);
                const json = JSON.stringify(bounded);
                if (json.length > INPUT_CAP) bounded = { truncated: true, preview: redactSecrets(json.slice(0, INPUT_CAP)) };
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
            description: "List checkpoints (turn + named) with blob-store size and redo depth",
            handler: async (_args: string, ctx: any) => {
                // Session-scoped depth — the number the default /redo acts on
                // (mirrors /undo's ownership story; /redo --all for the rest).
                const redoDepth = store.listRedo().filter((m) => m.owner === bootId).length;
                ctx.ui.notify(renderCheckpoints(store.list(), store.sizeBytes(), redoDepth), "info");
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
                    owner: bootId,
                };
                store.writeManifest(manifest);
                store.prune(KEEP_MANIFESTS, bootId);
                ledger.append({ kind: "checkpoint", id: manifest.id, label: manifest.label, files: files.length, turn: false });
                clearRedoStack(`checkpoint ${manifest.id} sealed`);
                ctx.ui.notify(`Checkpoint ${manifest.id} — ${files.length} file(s) snapshot. /restore ${manifest.id} rewinds to this state.`, "info");
            },
        });

        pi.registerCommand("undo", {
            description: "Revert the file changes of the last n turn(s) of this session (default 1); /redo re-applies them: /undo [n] [--all]",
            handler: async (args: string, ctx: any) => {
                const tokens = (args ?? "").trim().split(/\s+/).filter((t) => t.length > 0);
                const all = tokens.includes("--all");
                const nTok = tokens.find((t) => t !== "--all") ?? "1";
                const n = Math.min(Math.max(Number.parseInt(nTok, 10) || 1, 1), 20);
                // Ownership (R-b C2): default to THIS session's turn manifests;
                // legacy manifests (no owner) count as unknown, never as own;
                // --all opts into other sessions' turns too.
                const turns = store.list().filter((m) => m.kind === "turn" && (all || m.owner === bootId));
                if (turns.length === 0) {
                    const anyTurns = store.list().some((m) => m.kind === "turn");
                    ctx.ui.notify(
                        anyTurns
                            ? "No turn checkpoints from this session to undo (other sessions' turns exist — /undo --all opts in; /restore <id> for named snapshots)."
                            : "No turn checkpoints to undo (nothing sealed this session — try /restore <id> for named snapshots).",
                        "warning",
                    );
                    return;
                }
                // Crash-safe ordering (R-b A3): manifests already marked consumed
                // belong to an interrupted /undo — complete them FIRST (before-image
                // restores are deterministic, so restoring twice yields the same
                // content) instead of consuming fresh turns, which is what caused
                // over-undo when a crash landed between restore and removeManifest.
                const pending = turns.filter((m) => m.consumed === true);
                const chosen = pending.length > 0 ? pending.slice(-n) : turns.slice(-n);
                // Consumption is journaled BEFORE any file is touched: each chosen
                // manifest is atomically rewritten with consumed: true, so a crash
                // at any point leaves the store in a state where re-running /undo
                // re-selects exactly these manifests and re-applies the same
                // deterministic restores — never an extra turn.
                for (const manifest of chosen) store.writeManifest({ ...manifest, consumed: true });
                let files = 0;
                const restoredPaths: string[] = [];
                const failures: Array<{ path: string; action: RestoreAction }> = [];
                let redoPushed = 0;
                for (const manifest of chosen) {
                    // Redo material FIRST: capture what this step is about to
                    // overwrite (the current on-disk content) BEFORE the
                    // before-images land — after the restore it is gone. One
                    // entry per undone turn, in walk order, so /redo pops them
                    // newest-first and `/undo n` + `/redo n` round-trips.
                    if (captureRedoEntry(manifest)) redoPushed++;
                    const outcomes = store.restore(manifest, opts.cwd);
                    files += outcomes.filter((o) => o.ok).length;
                    restoredPaths.push(...outcomes.filter((o) => o.ok).map((o) => o.path));
                    failures.push(...outcomes.filter((o) => !o.ok).map((o) => ({ path: o.path, action: o.action })));
                    store.removeManifest(manifest.id);
                }
                ledger.append({ kind: "restore", ids: chosen.map((m) => m.id), files });
                const head = pending.length > 0 ? `Completed an interrupted undo — ${chosen.length} turn(s)` : `Undid ${chosen.length} turn(s)`;
                const reverted = restoredPaths.length > 0 ? `:\n${restoredPaths.slice(0, 20).join("\n")}` : "";
                const failed =
                    failures.length > 0
                        ? `\n${failures.length} file(s) could NOT be reverted:\n${failures.slice(0, 20).map((f) => `- ${f.path} (${f.action})`).join("\n")}`
                        : "";
                const redoHint = redoPushed > 0 ? " /redo [n] re-applies undone changes." : "";
                ctx.ui.notify(`${head} — ${files} file(s) reverted${reverted}${failed}.${redoHint}`, failures.length > 0 ? "warning" : "info");
            },
        });

        pi.registerCommand("redo", {
            description: "Re-apply the last n undone change(s) of this session (default 1): /redo [n] [--all]",
            handler: async (args: string, ctx: any) => {
                const tokens = (args ?? "").trim().split(/\s+/).filter((t) => t.length > 0);
                const all = tokens.includes("--all");
                const nTok = tokens.find((t) => t !== "--all") ?? "1";
                const n = Math.min(Math.max(Number.parseInt(nTok, 10) || 1, 1), 20);
                // Ownership mirrors /undo (R-b C2): default to THIS session's
                // redo entries (the undos this session performed); --all opts
                // into other sessions' redo entries too.
                const stack = store.listRedo().filter((m) => all || m.owner === bootId);
                if (stack.length === 0) {
                    const anyRedo = store.listRedo().length > 0;
                    ctx.ui.notify(
                        anyRedo
                            ? "No undone changes from this session to redo (other sessions' redo entries exist — /redo --all opts in)."
                            : "Nothing to redo — the redo stack is empty (/undo pushes entries; any new checkpoint clears them).",
                        "warning",
                    );
                    return;
                }
                // Pop NEWEST-first (LIFO — the exact reverse of the undo walk)
                // and apply-then-remove per entry: restores are deterministic
                // (same verified blobs → same content), so a crash mid-/redo
                // re-runs at most one already-applied entry as a no-op — the
                // same crash-safety shape /undo gets from consumed-marking.
                const chosen = stack.slice(-n).reverse();
                let files = 0;
                const redonePaths: string[] = [];
                const failures: Array<{ path: string; action: RestoreAction }> = [];
                for (const entry of chosen) {
                    const outcomes = store.restore(entry, opts.cwd);
                    files += outcomes.filter((o) => o.ok).length;
                    redonePaths.push(...outcomes.filter((o) => o.ok).map((o) => o.path));
                    failures.push(...outcomes.filter((o) => !o.ok).map((o) => ({ path: o.path, action: o.action })));
                    store.removeRedo(entry.id);
                }
                ledger.append({ kind: "redo", ids: chosen.map((m) => m.id), files });
                const listed = redonePaths.length > 0 ? `:\n${redonePaths.slice(0, 20).join("\n")}` : "";
                const failed =
                    failures.length > 0
                        ? `\n${failures.length} file(s) could NOT be re-applied:\n${failures.slice(0, 20).map((f) => `- ${f.path} (${f.action})`).join("\n")}`
                        : "";
                ctx.ui.notify(`Redid ${chosen.length} change(s) — ${files} file(s) re-applied${listed}${failed}.`, failures.length > 0 ? "warning" : "info");
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
                const failReasons = [...new Set(outcomes.filter((o) => !o.ok).map((o) => o.action))]
                    .map((a) => `${a}: ${RESTORE_FAIL_HINTS[a]}`)
                    .join("; ");
                ctx.ui.notify(
                    `Restored ${manifest.id} — ${ok}/${outcomes.length} file(s) rewritten${failReasons ? ` (${failReasons})` : ""}.`,
                    ok === outcomes.length ? "info" : "warning",
                );
            },
        });
    };

    return { name: "unown-checkpoints", factory, hidden: true } as const;
}
