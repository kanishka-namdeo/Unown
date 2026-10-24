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
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { atomicWriteFileSync } from "./atomic.ts";
import { redactSecretsCounted } from "./adversary.ts";
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
    /** Redact known secret shapes from the export before it is written
     *  (default TRUE — a portable transfer artifact routinely changes hands,
     *  and a transcript debugged with a real key must not carry that key
     *  into the file). `--raw` in the CLI opts out for a lossless
     *  self-transfer between machines you own. */
    redact?: boolean;
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
    /** Where the .jsonl lives: "user" = ~/.unown/agent/sessions (real TUI /
     *  print sessions), "project" = <cwd>/.unown/sessions (imports). Omitted
     *  by the legacy project-only `listSessions` for shape compatibility. */
    source?: "project" | "user";
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
 * Assemble the portable `SessionExport` object shared by BOTH export formats
 * (JSON and markdown). Extracted from `exportSession` when markdown landed so
 * the two formats can never drift apart: same manifest, same todos/notes/
 * skills/files sidecars, same message filter.
 */
export function assembleSessionExport(sessionId: string, opts: ExportOptions): {
    exportObj: SessionExport;
    cwd: string;
    receiptsFile: string;
} {
    const sm = opts.sessionManager;
    if (!sm) throw new Error("assembleSessionExport: sessionManager is required (opts.sessionManager)");

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
    return { exportObj, cwd, receiptsFile };
}

/**
 * Serialize a session to a JSON file. Returns `{ path, bytes, redacted }` —
 * `redacted` counts the secrets the default redaction pass replaced (0 when
 * clean or when `redact: false` opted out). Throws on a missing
 * sessionManager, an unreadable session or a write failure.
 */
export async function exportSession(
    sessionId: string,
    opts: ExportOptions = {},
): Promise<{ path: string; bytes: number; redacted: number }> {
    const { exportObj, cwd } = assembleSessionExport(sessionId, opts);
    const path = opts.outPath ?? defaultExportPath(sessionId, cwd);
    mkdirSync(dirname(path), { recursive: true });
    const serialized = JSON.stringify(exportObj, null, 2);
    // Redaction runs on the SERIALIZED form, so every string surface is
    // covered uniformly (message text, tool outputs embedded in messages,
    // note contents) without walking the object tree. JSON round-trip
    // safety is not a concern — the redacted string is what gets written.
    // Escaped-string edge: a secret can never span a JSON escape boundary
    // (keys/PATs/tokens are single-token ASCII runs), so the regexes match
    // the same shapes they would match in the raw text.
    const redact = opts.redact !== false;
    const result = redact ? redactSecretsCounted(serialized) : { text: serialized, count: 0 };
    const content = result.text;
    atomicWriteFileSync(path, content);
    return { path, bytes: Buffer.byteLength(content), redacted: redact ? result.count : 0 };
}

// ---------------------------------------------------------------------------
// Markdown export (the Codex `/export` / goose `session export md` lane)
// ---------------------------------------------------------------------------

/** Default markdown export path: `<cwd>/.unown/sessions/export-<sessionId>.md`. */
export function defaultMarkdownExportPath(sessionId: string, cwd: string): string {
    return join(cwd, ".unown", "sessions", `export-${sessionId}.md`);
}

export interface MarkdownRenderOptions {
    /** Cap on a single tool-result payload inside the transcript (default
     *  2000 chars; the excess is replaced by an explicit truncation marker —
     *  a share artifact should never grow unbounded from one noisy `read`). */
    maxToolResultChars?: number;
}

/** Longest backtick run in `s` (0 when none) — drives fence-length safety. */
function longestBacktickRun(s: string): number {
    let longest = 0;
    let run = 0;
    for (const ch of s) {
        if (ch === "`") {
            run++;
            if (run > longest) longest = run;
        } else {
            run = 0;
        }
    }
    return longest;
}

/** A code fence that can never be broken by content inside it: at least 3
 *  backticks, always one longer than the longest backtick run in the payload
 *  (CommonMark's own rule for fenced-code-block precedence). */
function safeFence(payload: string): string {
    return "`".repeat(Math.max(3, longestBacktickRun(payload) + 1));
}

/** Compact one-line summary of a tool call's arguments for the transcript
 *  bullet: prefer the human-meaningful fields (path / command / url /
 *  pattern / query), else a capped JSON one-liner. Pure. */
function summarizeToolArgs(args: unknown): string {
    const argCap = 160;
    if (!args || typeof args !== "object") return "";
    const a = args as Record<string, unknown>;
    for (const key of ["path", "file", "command", "cmd", "url", "pattern", "query", "prompt", "content", "name"]) {
        const v = a[key];
        if (typeof v === "string" && v.length > 0) {
            const flat = v.replace(/\s+/g, " ").trim();
            return flat.length > argCap ? flat.slice(0, argCap - 1) + "…" : flat;
        }
    }
    try {
        const j = JSON.stringify(a) ?? "";
        return j.length > argCap ? j.slice(0, argCap - 1) + "…" : j;
    } catch {
        return "";
    }
}

/** Render one message's text blocks as prose (user + assistant shapes). */
function renderTextBlocks(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") {
            parts.push(b.text);
        } else if (b.type === "image") {
            parts.push("[image]");
        } else if (b.type === "resource") {
            parts.push("[resource]");
        }
        // `thinking` blocks are deliberately omitted: raw reasoning is noise
        // in a share artifact (and every competitor's markdown export skips
        // it too). The header notes the omission.
    }
    return parts.join("\n\n");
}

/** Extract a toolResult's text payload (content is a text-block array). */
function toolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (block && typeof block === "object") {
            const b = block as Record<string, unknown>;
            if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
            else if (b.type === "image") parts.push("[image]");
        }
    }
    return parts.join("\n");
}

/** Format a todo list as markdown checkboxes (deleted tasks skipped). */
function renderTodos(todos: unknown[]): string {
    const lines: string[] = [];
    for (const t of todos) {
        if (!t || typeof t !== "object") continue;
        const task = t as Record<string, unknown>;
        const subject = typeof task.subject === "string" ? task.subject : typeof task.content === "string" ? task.content : "(task)";
        const status = typeof task.status === "string" ? task.status : "pending";
        if (status === "deleted") continue;
        const box = status === "completed" ? "x" : " ";
        const active = status === "in_progress" ? " *(in progress)*" : "";
        lines.push(`- [${box}] ${subject}${active}`);
    }
    return lines.join("\n");
}

/** Format ISO-ish numbers with thousands separators for the header table. */
function fmtNum(n: number): string {
    return n.toLocaleString("en-US");
}

/**
 * Render a `SessionExport` as a shareable markdown document — the format
 * every competitor's export converges on (Codex `/export`, goose `session
 * export md`, Amp thread `.md`, Gemini `/chat share`). Pure: no I/O, no
 * clocks (pass `generatedAt` if you want a timestamp line).
 */
export function renderSessionMarkdown(exportObj: SessionExport, opts: MarkdownRenderOptions = {}): string {
    const maxToolResultChars = opts.maxToolResultChars ?? 2000;
    const m = exportObj.manifest;
    const messages = exportObj.messages ?? [];

    // -- stats pass ----------------------------------------------------------
    let userCount = 0;
    let assistantCount = 0;
    let toolResultCount = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        const mm = msg as Record<string, any>;
        if (mm.role === "user") userCount++;
        else if (mm.role === "assistant") assistantCount++;
        else if (mm.role === "toolResult") toolResultCount++;
        const usage = mm.usage;
        if (usage && typeof usage === "object") {
            if (typeof usage.input === "number") tokensIn += usage.input;
            if (typeof usage.output === "number") tokensOut += usage.output;
        }
    }

    const date = Number.isFinite(m.createdAt) ? new Date(m.createdAt).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "unknown";
    const modelLine = m.model ? `${m.model}${m.provider ? ` (${m.provider})` : ""}` : "unknown";

    const out: string[] = [];
    out.push(`# Unown session — ${m.id}`);
    out.push("");
    out.push("| Field | Value |");
    out.push("|---|---|");
    out.push(`| Date | ${date} |`);
    out.push(`| Model | ${modelLine} |`);
    out.push(`| Project | ${m.cwd} |`);
    out.push(`| Messages | ${fmtNum(userCount + assistantCount + toolResultCount)} — ${fmtNum(userCount)} user, ${fmtNum(assistantCount)} assistant, ${fmtNum(toolResultCount)} tool results |`);
    if (tokensIn > 0 || tokensOut > 0) {
        out.push(`| Tokens | ${fmtNum(tokensIn)} in · ${fmtNum(tokensOut)} out |`);
    }
    if (exportObj.files.length > 0) {
        out.push(`| Files touched | ${exportObj.files.map((f) => f.split(/[\\/]/).pop() ?? f).join(", ")} |`);
    }
    if (exportObj.skills.length > 0) {
        out.push(`| Tools used | ${exportObj.skills.join(", ")} |`);
    }
    out.push("");

    if (exportObj.todos.length > 0) {
        const todoMd = renderTodos(exportObj.todos);
        if (todoMd) {
            out.push("## Todos");
            out.push("");
            out.push(todoMd);
            out.push("");
        }
    }

    if (exportObj.notes.length > 0) {
        out.push("## Notes");
        out.push("");
        for (const n of exportObj.notes) {
            if (!n || typeof n !== "object") continue;
            const note = n as Record<string, unknown>;
            const preview = typeof note.preview === "string" ? note.preview : "";
            const ts = typeof note.ts === "number" ? new Date(note.ts).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "";
            out.push(`> ${ts ? `${ts} — ` : ""}${preview.replace(/\n/g, " ")}`);
            out.push(">");
        }
        out.push("");
    }

    out.push("## Transcript");
    out.push("");

    for (const msg of messages) {
        if (!msg || typeof msg !== "object") continue;
        const mm = msg as Record<string, any>;
        const role = mm.role;

        if (role === "user") {
            out.push("**User:**");
            out.push("");
            out.push(renderTextBlocks(mm.content).trim() || "*(empty)*");
            out.push("");

        } else if (role === "assistant") {
            const modelTag = typeof mm.model === "string" && mm.model ? ` (${mm.model})` : "";
            out.push(`**Assistant${modelTag}:**`);
            out.push("");
            const blocks = Array.isArray(mm.content) ? mm.content : [];
            const toolBullets: string[] = [];
            const proseParts: string[] = [];
            for (const block of blocks) {
                if (!block || typeof block !== "object") continue;
                const b = block as Record<string, unknown>;
                if (b.type === "toolCall" && typeof b.name === "string") {
                    const args = summarizeToolArgs(b.arguments);
                    toolBullets.push(`- \`${b.name}\`${args ? ` → ${args}` : ""}`);
                } else if (b.type === "text" && typeof b.text === "string" && b.text.trim().length > 0) {
                    proseParts.push(b.text);
                }
            }
            if (toolBullets.length > 0) {
                out.push(toolBullets.join("\n"));
                out.push("");
            }
            const prose = proseParts.join("\n\n").trim();
            if (prose) {
                out.push(prose);
                out.push("");
            }
            if (toolBullets.length === 0 && !prose) {
                out.push("*(empty)*");
                out.push("");
            }

        } else if (role === "toolResult") {
            const toolName = typeof mm.toolName === "string" ? mm.toolName : "tool";
            const isError = mm.isError === true;
            let payload = toolResultText(mm.content).trim();
            if (payload.length > maxToolResultChars) {
                const omitted = payload.length - maxToolResultChars;
                payload = payload.slice(0, maxToolResultChars) + `\n… [truncated ${fmtNum(omitted)} chars]`;
            }
            const status = isError ? "error" : "ok";
            out.push(`**Tool result — \`${toolName}\`** (${status})`);
            out.push("");
            if (payload) {
                const fence = safeFence(payload);
                out.push(fence);
                out.push(payload);
                out.push(fence);
            } else {
                out.push("*(no output)*");
            }
            out.push("");
        }
    }

    out.push("---");
    out.push("");
    out.push(
        "Exported from unown · thinking blocks omitted · secrets redacted by default " +
            "(`--raw` keeps them verbatim; redaction markers appear as `[REDACTED:<type>]`).",
    );
    out.push("");
    return out.join("\n");
}

/**
 * Serialize a session to a markdown file (the share/transfer format). Same
 * contract as `exportSession`: same options (including the default-on
 * redaction pass — here applied to the final rendered markdown), same
 * `{ path, bytes, redacted }` return.
 */
export async function exportSessionMarkdown(
    sessionId: string,
    opts: ExportOptions & MarkdownRenderOptions = {},
): Promise<{ path: string; bytes: number; redacted: number }> {
    const { exportObj, cwd } = assembleSessionExport(sessionId, opts);
    const path = opts.outPath ?? defaultMarkdownExportPath(sessionId, cwd);
    mkdirSync(dirname(path), { recursive: true });
    const rendered = renderSessionMarkdown(exportObj, { maxToolResultChars: opts.maxToolResultChars });
    // Same serialized-form redaction posture as the JSON export: the whole
    // document (message text, tool payloads, notes) is one string surface.
    const redact = opts.redact !== false;
    const result = redact ? redactSecretsCounted(rendered) : { text: rendered, count: 0 };
    atomicWriteFileSync(path, result.text);
    return { path, bytes: Buffer.byteLength(result.text), redacted: redact ? result.count : 0 };
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
        throw new Error(`importSession: cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    let parsed: SessionExport;
    try {
        parsed = JSON.parse(raw);
    } catch (err: any) {
        throw new Error(`importSession: malformed JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
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

/** Generate a fresh import session id — `imp-<ts36>-<rand>`, easy to spot.
 * The rand half is CSPRNG-sourced (randomBytes, not Math.random): the id
 * names/keys the on-disk .jsonl session file, so a predictable id would let
 * an attacker enumerate other sessions' files (js/insecure-randomness). */
function generateSessionId(): string {
    const ts = Date.now().toString(36);
    const rand = randomBytes(4).toString("hex").slice(0, 6);
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
                source: opts.sessionDir ? undefined : "project",
            });
        } catch {
            continue; // broken file — skip, don't fail the whole list
        }
    }

    summaries.sort((a, b) => b.createdAt - a.createdAt);
    return summaries;
}

/**
 * List sessions from the USER session store (`~/.unown/agent/sessions/` —
 * where the TUI and print mode actually persist every real session), keeping
 * only sessions whose header cwd resolves to `opts.cwd` (pi's own
 * `sessionCwdMatches` semantics: resolve both sides, compare exactly).
 *
 * This is the storage-side half of the 2026-10-24 session-workflow fix: the
 * CLI previously listed ONLY `<cwd>/.unown/sessions/` (the import lane), so
 * every session the agent itself wrote was invisible to
 * `unown sessions list` / `export`. Pure fs scan; tolerant per-file.
 */
export function listUserSessions(opts: { cwd?: string; userSessionDir: string; allProjects?: boolean }): SessionSummary[] {
    const cwd = opts.cwd ?? process.cwd();
    const dir = opts.userSessionDir;
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
            // cwd filter — resolve() both sides so `/tmp/x` vs `/tmp/x/` and
            // (on Windows) case/slash variants compare equal. Sessions with
            // no cwd header (foreign imports) never match a specific cwd.
            // `allProjects: true` skips the filter entirely (the `--all` lane).
            if (!opts.allProjects) {
                const headerCwd = typeof header.cwd === "string" ? header.cwd : "";
                if (!headerCwd || resolve(headerCwd) !== resolve(cwd)) continue;
            }
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
                if (entry.type !== "message") continue;
                messageCount++;
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

            summaries.push({
                id: header.id,
                createdAt: Number.isFinite(createdAt) ? createdAt : 0,
                messageCount,
                touchedFiles: [...touchedFiles].sort(),
                source: "user",
            });
        } catch {
            continue; // broken file — skip, don't fail the whole list
        }
    }

    summaries.sort((a, b) => b.createdAt - a.createdAt);
    return summaries;
}

/**
 * The merged listing the CLI and `/sessions list` surface: real sessions
 * from the user store (cwd-filtered) UNION imports from the project dir,
 * deduped by id (the project copy wins — it is the deliberate, newer
 * rehydration), sorted newest-first. Each summary carries its `source`.
 */
export function listAllSessions(opts: { cwd?: string; userSessionDir: string; projectSessionDir?: string }): SessionSummary[] {
    const cwd = opts.cwd ?? process.cwd();
    const project = listSessions({ cwd, sessionDir: opts.projectSessionDir });
    const user = listUserSessions({ cwd, userSessionDir: opts.userSessionDir });
    const byId = new Map<string, SessionSummary>();
    for (const s of user) byId.set(s.id, s);
    for (const s of project) byId.set(s.id, s); // project (import) wins on collision
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Find a session .jsonl by id under the USER store (flat
 * `~/.unown/agent/sessions/` layout — filenames are `<timestamp>_<id>.jsonl`
 * but the id may also appear via a caller-supplied export name). Returns the
 * full path or null. Mirrors `findSessionFile`'s filename-contains match.
 */
export function findUserSessionFile(userSessionDir: string, sessionId: string): string | null {
    if (!existsSync(userSessionDir)) return null;
    let files: string[];
    try {
        files = readdirSync(userSessionDir).filter((f) => f.endsWith(".jsonl"));
    } catch {
        return null;
    }
    const byName = files.find((f) => f.includes(sessionId));
    return byName ? join(userSessionDir, byName) : null;
}
