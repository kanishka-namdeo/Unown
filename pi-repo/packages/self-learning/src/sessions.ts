/**
 * sessions.ts — session export / import / list (Milestone 3.5).
 *
 * Reverse-engineered from opencode's `session/transfer.ts` serialization
 * pattern: a single self-describing JSON file with a version, a manifest
 * (id / createdAt / model / provider / cwd), the messages, the todos, the
 * notes, the skills used and a manifest of files touched. The format is
 * forward-compat — `importSession` refuses a `version` newer than what this
 * module wrote, so an export from a future Unown surfaces a clear error
 * instead of silently dropping fields.
 *
 * Pure module (no pi imports): it takes `SessionLike` and `CheckpointStoreLike`
 * interfaces as deps so tests can mock them. The CLI wrapper
 * (`sessions-cli.ts`) constructs the real SessionManager + CheckpointStore
 * instances from the cwd.
 *
 * Format:
 *   {
 *     "version": 1,
 *     "manifest": { id, createdAt, model, provider, cwd },
 *     "messages":  [ <AgentMessage>, ... ],   // from the session entries' .message
 *     "todos":     [ <Todo>, ... ],           // latest state from toolResult(toolName=todo) entries
 *     "notes":     [ <ReceiptEntry>, ... ],   // from the receipts ledger's `note` entries
 *     "skills":    [ "todo", "write", ... ],  // distinct tool names from the receipts ledger
 *     "files":     [ "/abs/path/a.ts", ... ]  // distinct write/edit paths from the receipts ledger
 *   }
 *
 * All writes go through `atomicWriteFileSync` (temp + fsync + rename) so a
 * crash mid-write never leaves a truncated export at the target path.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { atomicWriteFileSync } from "./atomic.ts";
import { type CheckpointManifest, ReceiptsLedger, receiptsDir } from "./checkpoints.ts";

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

export const SESSION_EXPORT_VERSION = 1;

export interface SessionManifest {
    id: string;
    createdAt: number;
    model: string | null;
    provider: string | null;
    cwd: string;
}

export interface SessionExport {
    version: number;
    manifest: SessionManifest;
    messages: unknown[];
    todos: unknown[];
    notes: unknown[];
    skills: string[];
    files: string[];
}

// ---------------------------------------------------------------------------
// Deps — minimal interfaces so tests can mock without spawning pi
// ---------------------------------------------------------------------------

/**
 * The subset of pi-coding-agent's `SessionManager` that export/list need.
 * `tools.ts` slash commands pass `ctx.sessionManager` (the live instance);
 * tests pass a mock.
 */
export interface SessionLike {
    getSessionId(): string;
    getCwd(): string;
    /** All non-header session entries (messages, model_changes, etc.). */
    getEntries(): SessionEntryLike[];
    /** The path root→leaf — `getEntries` is fine for export; `getBranch`
     *  is here for the edit-resend module's branch/resetLeaf needs. */
    getBranch?(): SessionEntryLike[];
    /** Session header (id, timestamp, cwd, parentSession?). */
    getHeader(): SessionHeaderLike | null;
}

export interface SessionHeaderLike {
    id: string;
    timestamp: string;
    cwd: string;
    parentSession?: string;
    version?: number;
}

export interface SessionEntryLike {
    type: string;
    id: string;
    parentId: string | null;
    timestamp: string;
    message?: any;
    // model_change fields (only present when type === "model_change")
    provider?: string;
    modelId?: string;
    [k: string]: unknown;
}

export interface CheckpointStoreLike {
    list(): CheckpointManifest[];
    readBlob(hash: string): Buffer | null;
}

export interface ExportOptions {
    outPath?: string;
    sessionManager?: SessionLike;
    /** Override the receipts file path (otherwise derived from cwd + sessionId). */
    receiptsFile?: string;
    checkpointStore?: CheckpointStoreLike;
}

export interface ImportOptions {
    newId?: string;
    /** Target session dir; defaults to <cwd>/.unown/sessions. */
    targetDir?: string;
    cwd?: string;
}

export interface SessionSummary {
    id: string;
    createdAt: number;
    messageCount: number;
    touchedFiles: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Default export path: `<cwd>/.unown/sessions/export-<sessionId>.json`. */
export function defaultExportPath(sessionId: string, cwd: string): string {
    return join(cwd, ".unown", "sessions", `export-${sessionId}.json`);
}

/**
 * Extract model + provider from session entries — the last `model_change`
 * entry wins, otherwise the last `assistant` message's `provider`/`model`.
 * Returns `{ null, null }` if neither is present.
 */
export function extractModel(entries: SessionEntryLike[]): { model: string | null; provider: string | null } {
    let model: string | null = null;
    let provider: string | null = null;
    for (const entry of entries) {
        if (entry.type === "model_change") {
            if (typeof entry.provider === "string") provider = entry.provider;
            if (typeof entry.modelId === "string") model = entry.modelId;
        } else if (entry.type === "message" && entry.message?.role === "assistant") {
            if (typeof entry.message.provider === "string") provider = entry.message.provider;
            if (typeof entry.message.model === "string") model = entry.message.model;
        }
    }
    return { model, provider };
}

/**
 * Extract the latest todo state from session entries — walks the entries in
 * order, replacing the snapshot every time a `toolResult(toolName="todo")`
 * message appears. Mirrors `tools.ts:reconstructTodos` exactly so export and
 * the live in-session list agree.
 */
export function extractTodos(entries: SessionEntryLike[]): unknown[] {
    let todos: unknown[] = [];
    for (const entry of entries) {
        if (entry.type !== "message") continue;
        const msg = entry.message;
        if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;
        const details = msg.details;
        if (details && Array.isArray(details.todos)) {
            todos = details.todos;
        }
    }
    return todos;
}

/** Extract note entries from the receipts ledger (kind === "note"). */
export function extractNotes(receiptsFile: string): unknown[] {
    if (!existsSync(receiptsFile)) return [];
    const ledger = new ReceiptsLedger(receiptsFile);
    return ledger.entries().filter((e) => e.kind === "note");
}

/** Extract distinct tool names invoked (the "skills used" set). */
export function extractSkills(receiptsFile: string): string[] {
    if (!existsSync(receiptsFile)) return [];
    const ledger = new ReceiptsLedger(receiptsFile);
    const set = new Set<string>();
    for (const e of ledger.entries()) {
        if (e.kind !== "tool_call") continue;
        const tool = (e as any).tool;
        if (typeof tool === "string" && tool.length > 0) set.add(tool);
    }
    return [...set].sort();
}

/** Extract distinct write/edit paths (files touched) from the receipts ledger. */
export function extractFiles(receiptsFile: string): string[] {
    if (!existsSync(receiptsFile)) return [];
    const ledger = new ReceiptsLedger(receiptsFile);
    const set = new Set<string>();
    for (const e of ledger.entries()) {
        if (e.kind !== "tool_call") continue;
        const tool = (e as any).tool;
        if (tool !== "write" && tool !== "edit") continue;
        const p = (e as any).input?.path;
        if (typeof p === "string" && p.length > 0) set.add(p);
    }
    return [...set].sort();
}

/**
 * Locate the receipts file for a session id. The receipts ledger is named
 * after the session boot id (`${bootId}.jsonl` or `sub-${bootId}.jsonl`),
 * NOT the session id — but a single session's receipts entries reference
 * the session in their `session_start` kind. We use a tolerant fallback:
 * prefer a file whose content references the session id, else the most
 * recently mtime'd .jsonl (the typical "last session" case).
 */
export function findReceiptsFile(cwd: string, sessionId: string): string | null {
    const dir = receiptsDir(cwd);
    if (!existsSync(dir)) return null;
    let files: string[];
    try {
        files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
        return null;
    }
    if (files.length === 0) return null;
    // 1. cheap filename match (rare — ids are uuidv7, bootIds are timestamps)
    const byName = files.find((f) => f.includes(sessionId));
    if (byName) return join(dir, byName);
    // 2. content scan for the session id (the ledger's session_start entry
    //    records cwd, not session id — but the file path of the session
    //    .jsonl might appear). Tolerate parse failures.
    for (const f of files) {
        try {
            const head = readFileSync(join(dir, f), "utf8").slice(0, 64 * 1024);
            if (head.includes(sessionId)) return join(dir, f);
        } catch {
            /* skip unreadable */
        }
    }
    // 3. fallback: most recent .jsonl by mtime
    try {
        const sorted = files
            .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
        return join(dir, sorted[0].f);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Serialize a session to a JSON file. Returns `{ path, bytes }`.
 * Throws on a missing sessionManager, an unreadable session or a write failure.
 */
export async function exportSession(
    sessionId: string,
    opts: ExportOptions = {},
): Promise<{ path: string; bytes: number }> {
    const sm = opts.sessionManager;
    if (!sm) throw new Error("exportSession: sessionManager is required (opts.sessionManager)");

    const cwd = sm.getCwd();
    const entries = sm.getEntries();
    const header = sm.getHeader();
    const createdAtRaw = header?.timestamp;
    const createdAt = createdAtRaw ? Date.parse(createdAtRaw) : Date.now();
    const { model, provider } = extractModel(entries);
    const todos = extractTodos(entries);

    // Notes / files / skills live in the receipts ledger, NOT the session
    // tree (the ledger is the audit surface). Locate the file for this
    // session id; fall back to an empty (sidecar-free) export when none
    // exists — the export is still valid, just with empty arrays.
    const receiptsFile = opts.receiptsFile ?? findReceiptsFile(cwd, sessionId) ?? "";
    const notes = receiptsFile ? extractNotes(receiptsFile) : [];
    const skills = receiptsFile ? extractSkills(receiptsFile) : [];
    const files = receiptsFile ? extractFiles(receiptsFile) : [];

    const messages = entries
        .filter((e) => e.type === "message")
        .map((e) => (e as any).message)
        .filter((m) => m !== undefined && m !== null);

    const exportObj: SessionExport = {
        version: SESSION_EXPORT_VERSION,
        manifest: {
            id: sessionId,
            createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            model,
            provider,
            cwd,
        },
        messages,
        todos,
        notes,
        skills,
        files,
    };

    const path = opts.outPath ?? defaultExportPath(sessionId, cwd);
    mkdirSync(dirname(path), { recursive: true });
    const content = JSON.stringify(exportObj, null, 2);
    atomicWriteFileSync(path, content);
    return { path, bytes: Buffer.byteLength(content) };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Rehydrate an exported session file into a NEW session id (so it doesn't
 * collide with the original) under `<cwd>/.unown/sessions/`. The imported
 * session appears in `listSessions()`.
 *
 * Validates: file exists, parses as JSON, has a numeric `version` ≤ the
 * current export version, and has a manifest with a string `id`. Any
 * failure throws with a clear, prefix-tagged message (`importSession: …`).
 */
export async function importSession(filePath: string, opts: ImportOptions = {}): Promise<{ sessionId: string; bytes: number }> {
    if (!existsSync(filePath)) {
        throw new Error(`importSession: file not found: ${filePath}`);
    }
    let raw: string;
    try {
        raw = readFileSync(filePath, "utf8");
    } catch (err: any) {
        throw new Error(`importSession: cannot read ${filePath}: ${err?.message ?? err}`);
    }
    let parsed: SessionExport;
    try {
        parsed = JSON.parse(raw);
    } catch (err: any) {
        throw new Error(`importSession: malformed JSON in ${filePath}: ${err?.message ?? err}`);
    }
    if (typeof parsed.version !== "number" || !Number.isFinite(parsed.version)) {
        throw new Error(`importSession: missing or invalid version field (expected number, got ${typeof parsed.version})`);
    }
    if (parsed.version > SESSION_EXPORT_VERSION) {
        throw new Error(
            `importSession: export version ${parsed.version} is newer than supported (max ${SESSION_EXPORT_VERSION}); ` +
                `upgrade unown to import this file.`,
        );
    }
    if (!parsed.manifest || typeof parsed.manifest.id !== "string" || parsed.manifest.id.length === 0) {
        throw new Error(`importSession: missing or invalid manifest.id (expected non-empty string)`);
    }

    const newId = opts.newId ?? generateSessionId();
    const cwd = opts.cwd ?? process.cwd();
    const targetDir = opts.targetDir ?? join(cwd, ".unown", "sessions");
    mkdirSync(targetDir, { recursive: true });

    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const sessionFile = join(targetDir, `${fileTimestamp}_${newId}.jsonl`);

    // Header with the NEW id, the IMPORTING cwd (not the original) and a
    // parentSession pointer back to the export file for traceability.
    const header = {
        type: "session",
        version: 3, // pi-coding-agent CURRENT_SESSION_VERSION (kept in sync)
        id: newId,
        timestamp,
        cwd,
        parentSession: filePath,
    };
    const lines: string[] = [JSON.stringify(header)];

    // Re-emit the imported messages as a clean root→leaf chain with fresh
    // entry ids. The original entry ids are not preserved (they belong to
    // the source session's tree) — the imported session is a flat replay.
    let parentId: string | null = null;
    let counter = 0;
    for (const msg of parsed.messages ?? []) {
        counter++;
        const entryId = `imp${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const entry = {
            type: "message",
            id: entryId,
            parentId,
            timestamp,
            message: msg,
        };
        lines.push(JSON.stringify(entry));
        parentId = entryId;
    }

    const body = lines.join("\n") + "\n";
    // Atomic: a crash mid-write must never leave a half-written .jsonl that
    // SessionManager.open() would later refuse (atomicWriteFileSync does
    // temp + fsync + rename).
    atomicWriteFileSync(sessionFile, body);
    return { sessionId: newId, bytes: Buffer.byteLength(body) };
}

/** Generate a fresh import session id — `imp-<ts36>-<rand>`, easy to spot. */
function generateSessionId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `imp-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * List every persisted session in `<cwd>/.unown/sessions/`. Returns
 * `{ id, createdAt, messageCount, touchedFiles }[]` sorted newest-first.
 * Tolerates a missing dir (returns `[]`), broken session files (skipped)
 * and partial reads (best-effort per file).
 */
export function listSessions(opts: { cwd?: string; sessionDir?: string } = {}): SessionSummary[] {
    const cwd = opts.cwd ?? process.cwd();
    const dir = opts.sessionDir ?? join(cwd, ".unown", "sessions");
    if (!existsSync(dir)) return [];
    let names: string[];
    try {
        names = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    } catch {
        return [];
    }

    const summaries: SessionSummary[] = [];
    for (const name of names) {
        const fullPath = join(dir, name);
        try {
            const content = readFileSync(fullPath, "utf8");
            const lines = content.split("\n").filter((l) => l.trim().length > 0);
            if (lines.length === 0) continue;
            const header = JSON.parse(lines[0]);
            if (header.type !== "session" || typeof header.id !== "string") continue;
            const createdAtRaw = header.timestamp;
            const createdAt = createdAtRaw ? Date.parse(createdAtRaw) : 0;

            let messageCount = 0;
            const touchedFiles = new Set<string>();
            for (let i = 1; i < lines.length; i++) {
                let entry: any;
                try {
                    entry = JSON.parse(lines[i]);
                } catch {
                    continue;
                }
                if (entry.type === "message") {
                    messageCount++;
                    // Files touched: assistant messages' ToolCall blocks
                    // (write/edit) and toolResult messages' input.path — both
                    // shapes appear across pi's session-entry versions.
                    const msg = entry.message;
                    if (!msg) continue;
                    if (msg.role === "assistant" && Array.isArray(msg.content)) {
                        for (const block of msg.content) {
                            if (block?.type === "toolCall" && (block.name === "write" || block.name === "edit")) {
                                const p = block.arguments?.path;
                                if (typeof p === "string" && p.length > 0) touchedFiles.add(p);
                            }
                        }
                    }
                }
            }

            summaries.push({
                id: header.id,
                createdAt: Number.isFinite(createdAt) ? createdAt : 0,
                messageCount,
                touchedFiles: [...touchedFiles].sort(),
            });
        } catch {
            continue; // broken file — skip, don't fail the whole list
        }
    }

    summaries.sort((a, b) => b.createdAt - a.createdAt);
    return summaries;
}
