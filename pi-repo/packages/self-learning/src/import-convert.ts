/**
 * import-convert.ts — foreign session import converters (v0.0.7 parity round).
 *
 * The migration moat: Claude Code (v0.140+) and Codex CLI both ship `/import`
 * for competitors' sessions; Unown accepted only its own format. This module
 * is the receiving end — it detects and converts FOREIGN agent session
 * transcripts into native unown/pi session .jsonl so that `unown sessions
 * import <file>` (and /resume) can pick them up:
 *
 *   Claude Code  ~/.claude/projects/<slug>/*.jsonl — one JSON object per
 *     line; user/assistant lines carry a NESTED `message` {role, content};
 *     user lines whose content holds tool_result blocks are TOOL RESULTS in
 *     pi terms; summary / file-history-snapshot / other meta lines are
 *     skipped.
 *   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl — first line
 *     is a `session_meta` payload; `message` lines carry role + content
 *     directly (NO nested .message wrapper — that nesting is the claude vs
 *     codex discriminator); `function_call` / `function_call_output` items
 *     map to an assistant toolCall + a toolResult; turn_context and other
 *     response items are skipped.
 *
 * Conversion invariants — what makes the output a loadable pi session:
 *   - FRESH ids: the session header id comes from `opts.newId` (default
 *     crypto.randomUUID) and every entry id from crypto.randomUUID — source
 *     tree ids are never reused, so a converted session can never collide
 *     with or alias the session it came from.
 *   - LINEAR parent chain: entry N's parentId is entry N-1's id (the first
 *     entry's is null) — the converted session is a flat root→leaf replay,
 *     mirroring how `importSession` re-emits exported messages.
 *   - Timestamps pass through VERBATIM when parseable (per entry and for the
 *     header), else the ISO epoch — a session with unknown times still
 *     round-trips every Date.parse consumer.
 *   - toolCall blocks keep the SOURCE tool-use ids (tool_use.id / call_id)
 *     and toolResult messages back-reference them via toolCallId, so the
 *     call→result pairing survives pi's context replay.
 *
 * Pure module: only node:crypto / node:fs / node:path, no pi imports, no
 * store.ts side effects — same layering as sessions.ts. Every parser is
 * tolerant of blank / malformed lines (mirrors pi's loadEntriesFromFile).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

export type SessionFormat = "unown" | "claude" | "codex" | "unknown";

/** Parse one JSONL line into a record; null for blank / malformed lines and
 *  for anything that parses to a non-object (numbers, bare strings, arrays). */
function parseJsonLine(line: string): Record<string, unknown> | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;
    try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** A parseable ISO timestamp, or undefined (callers substitute the epoch). */
function parseableIso(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length === 0) return undefined;
    return Number.isFinite(Date.parse(value)) ? value : undefined;
}

const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

/** Timestamp policy: verbatim when parseable, ISO epoch otherwise. */
function isoOrEpoch(value: unknown): string {
    return parseableIso(value) ?? EPOCH_ISO;
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/**
 * Sniff the session format from the leading lines of a .jsonl file (callers
 * typically pass the whole file — detection only looks at line shapes).
 * Pure and tolerant: blank / malformed lines are skipped, and only the first
 * line that PARSES counts for the unown header check (the session header
 * must lead a unown file).
 *
 *   unown   — first parsed line is {type:"session", id}
 *   claude  — any parsed line is {type:"user"|"assistant"} with the nested
 *             .message wrapper (or a .uuid), or a {type:"summary"} line
 *   codex   — any parsed line is {type:"session_meta"} / "function_call" /
 *             "function_call_output" / "turn_context", or a {type:"message"}
 *             line carrying role+content WITHOUT the claude-style .message
 *             nesting (claude nests, codex flattens — that is the
 *             discriminator)
 *   unknown — none of the above signatures
 */
export function detectSessionFormat(firstLines: string[]): SessionFormat {
    let sawParsedLine = false;
    let claude = false;
    let codex = false;
    for (const line of firstLines) {
        const obj = parseJsonLine(line);
        if (!obj) continue;
        if (!sawParsedLine) {
            sawParsedLine = true;
            if (obj.type === "session" && typeof obj.id === "string") return "unown";
        }
        switch (obj.type) {
            case "session_meta":
            case "function_call":
            case "function_call_output":
            case "turn_context":
                codex = true;
                break;
            case "summary":
                claude = true;
                break;
            case "user":
            case "assistant":
                if (asRecord(obj.message) !== null || typeof obj.uuid === "string") claude = true;
                break;
            case "message":
                if ("role" in obj && "content" in obj && !("message" in obj)) codex = true;
                break;
            default:
                break;
        }
    }
    if (claude) return "claude";
    if (codex) return "codex";
    return "unknown";
}

// ---------------------------------------------------------------------------
// Converted-session shape + shared entry plumbing
// ---------------------------------------------------------------------------

/** The in-memory result of a conversion: a session header plus message
 *  entries, ready for `serializeConverted` / `writeConvertedSession`. */
export interface ConvertedSession {
    header: { type: "session"; id: string; timestamp: string; cwd: string };
    entries: Array<Record<string, unknown>>;
}

/**
 * Accumulates message entries with a strictly linear parent chain and fresh
 * randomUUID() entry ids (source ids are never reused). Also stamps each
 * message with pi's numeric `timestamp` (Unix ms) derived from the entry's
 * ISO timestamp — real pi messages carry both clocks.
 */
class EntryChain {
    readonly entries: Array<Record<string, unknown>> = [];

    push(message: Record<string, unknown>, timestamp: string): void {
        const id = randomUUID();
        const ms = Date.parse(timestamp);
        message.timestamp = Number.isFinite(ms) ? ms : 0;
        this.entries.push({ type: "message", id, parentId: this.parentId, timestamp, message });
        this.parentId = id;
    }

    private parentId: string | null = null;
}

// ---------------------------------------------------------------------------
// Claude Code → unown
// ---------------------------------------------------------------------------

/**
 * Convert a Claude Code session transcript (~/.claude/projects/<slug>/*.jsonl)
 * into a native unown session. Returns null when no usable messages exist
 * (e.g. a summary-only file) — the caller decides how to report that.
 *
 * Mapping:
 *   user line, plain-string content         → user message (content: string)
 *   user line, text blocks                  → user message (texts joined with "\n")
 *   user line, tool_result blocks           → toolResult messages — ONE per
 *                                               tool_result block, so the
 *                                               toolCallId back-reference stays
 *                                               1:1; content [{type:"text"}],
 *                                               toolCallId from tool_use_id,
 *                                               isError from is_error. Stray
 *                                               text blocks in the same line
 *                                               become a trailing user message
 *                                               (rare; kept for losslessness)
 *   assistant line, text + tool_use blocks  → assistant message (text blocks +
 *                                               {type:"toolCall", id, name,
 *                                               arguments: input}); thinking
 *                                               and other exotic blocks drop
 *   summary / file-history-snapshot / meta  → skipped
 *
 * Header: cwd/timestamp come from the first user/assistant line carrying
 * them (claude has no session header line) — else `fallbackCwd` / the ISO
 * epoch. Assistant messages carry `model` when the source line has one.
 */
export function convertClaudeSession(
    lines: string[],
    opts: { newId: () => string; fallbackCwd: string },
): ConvertedSession | null {
    const chain = new EntryChain();
    let cwd: string | undefined;
    let timestamp: string | undefined;
    for (const line of lines) {
        const obj = parseJsonLine(line);
        if (!obj) continue;
        if (obj.type !== "user" && obj.type !== "assistant") continue; // summary / snapshots / meta
        const msg = asRecord(obj.message);
        if (msg === null) continue;
        if (cwd === undefined) cwd = asString(obj.cwd);
        if (timestamp === undefined) timestamp = parseableIso(obj.timestamp);
        if (obj.type === "user") {
            convertClaudeUserLine(msg, chain, isoOrEpoch(obj.timestamp));
        } else {
            convertClaudeAssistantLine(msg, chain, isoOrEpoch(obj.timestamp));
        }
    }
    if (chain.entries.length === 0) return null;
    return {
        header: { type: "session", id: opts.newId(), timestamp: timestamp ?? EPOCH_ISO, cwd: cwd ?? opts.fallbackCwd },
        entries: chain.entries,
    };
}

/** One claude user line → user / toolResult entries (see module docstring). */
function convertClaudeUserLine(msg: Record<string, unknown>, chain: EntryChain, timestamp: string): void {
    const content = msg.content;
    if (typeof content === "string") {
        if (content.length > 0) chain.push({ role: "user", content }, timestamp);
        return;
    }
    const blocks = Array.isArray(content) ? content : [];
    const texts: string[] = [];
    const toolResults: Array<{ toolCallId?: string; text: string; isError: boolean }> = [];
    for (const raw of blocks) {
        const block = asRecord(raw);
        if (block === null) continue;
        if (block.type === "text") {
            const text = asString(block.text);
            if (text !== undefined && text.length > 0) texts.push(text);
        } else if (block.type === "tool_result") {
            toolResults.push({
                toolCallId: asString(block.tool_use_id),
                text: flattenToolResultContent(block.content),
                isError: block.is_error === true,
            });
        }
        // other block kinds (images, …) are dropped — not representable as pi text
    }
    // Tool results FIRST: they answer the pending tool calls and pi's context
    // replay pairs them via toolCallId; any accompanying text trails as a
    // user message (claude never mixes in practice — losslessness only).
    for (const tr of toolResults) {
        const message: Record<string, unknown> = {
            role: "toolResult",
            content: [{ type: "text", text: tr.text }],
            isError: tr.isError,
        };
        if (tr.toolCallId !== undefined) message.toolCallId = tr.toolCallId;
        chain.push(message, timestamp);
    }
    if (texts.length > 0) chain.push({ role: "user", content: texts.join("\n") }, timestamp);
}

/** Claude tool_result.content is a string, a block array ([{type:"text",…}])
 *  or something exotic — flatten to one string for the pi text block. */
function flattenToolResultContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const raw of content) {
            const block = asRecord(raw);
            if (block === null) continue;
            const text = asString(block.text);
            parts.push(text !== undefined ? text : safeJson(block));
        }
        return parts.join("\n");
    }
    if (content === undefined || content === null) return "";
    return safeJson(content);
}

/** One claude assistant line → assistant entry (text + toolCall blocks). */
function convertClaudeAssistantLine(msg: Record<string, unknown>, chain: EntryChain, timestamp: string): void {
    const content = msg.content;
    const source: unknown[] =
        typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    const blocks: Array<Record<string, unknown>> = [];
    for (const raw of source) {
        const block = asRecord(raw);
        if (block === null) continue;
        if (block.type === "text") {
            const text = asString(block.text);
            if (text !== undefined && text.length > 0) blocks.push({ type: "text", text });
        } else if (block.type === "tool_use") {
            const id = asString(block.id);
            const name = asString(block.name);
            if (id === undefined || name === undefined) continue; // unpairable tool call
            blocks.push({ type: "toolCall", id, name, arguments: asRecord(block.input) ?? {} });
        }
        // thinking blocks and other exotic kinds are dropped
    }
    if (blocks.length === 0) return;
    const message: Record<string, unknown> = { role: "assistant", content: blocks };
    const model = asString(msg.model);
    if (model !== undefined) message.model = model;
    chain.push(message, timestamp);
}

// ---------------------------------------------------------------------------
// Codex → unown
// ---------------------------------------------------------------------------

/**
 * Convert a Codex CLI rollout (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl)
 * into a native unown session. Returns null when no usable items exist.
 *
 * Mapping:
 *   session_meta payload     → header cwd/timestamp (fallback: `fallbackCwd`
 *                              / the ISO epoch); the payload id is NOT reused
 *   message role=user        → user message (input_text / output_text / text
 *                              blocks all count as text and are joined with
 *                              "\n"; plain-string content passes through)
 *   message role=assistant   → assistant message (same text joining)
 *   function_call            → assistant message with a single
 *                              {type:"toolCall"} block — `arguments` arrives
 *                              as a JSON STRING on the codex wire and is
 *                              parsed here (fallback {raw: <string>} when it
 *                              doesn't parse, so the call is never lost)
 *   function_call_output     → toolResult message (toolCallId from call_id,
 *                              content [{type:"text", text: output}])
 *   turn_context / other     → skipped (response items, event_msg, …)
 */
export function convertCodexSession(
    lines: string[],
    opts: { newId: () => string; fallbackCwd: string },
): ConvertedSession | null {
    const chain = new EntryChain();
    let cwd: string | undefined;
    let timestamp: string | undefined;
    for (const line of lines) {
        const obj = parseJsonLine(line);
        if (!obj) continue;
        switch (obj.type) {
            case "session_meta": {
                const payload = asRecord(obj.payload);
                if (payload !== null) {
                    if (cwd === undefined) cwd = asString(payload.cwd);
                    if (timestamp === undefined) timestamp = parseableIso(payload.timestamp);
                }
                break;
            }
            case "message":
                convertCodexMessageLine(obj, chain, isoOrEpoch(obj.timestamp));
                break;
            case "function_call":
                convertCodexFunctionCall(obj, chain, isoOrEpoch(obj.timestamp));
                break;
            case "function_call_output":
                convertCodexFunctionOutput(obj, chain, isoOrEpoch(obj.timestamp));
                break;
            default:
                break; // turn_context, response items, event_msg, …
        }
    }
    if (chain.entries.length === 0) return null;
    return {
        header: { type: "session", id: opts.newId(), timestamp: timestamp ?? EPOCH_ISO, cwd: cwd ?? opts.fallbackCwd },
        entries: chain.entries,
    };
}

/** One codex `message` item → user/assistant entry; roles other than
 *  user/assistant (system, developer, …) are skipped. */
function convertCodexMessageLine(obj: Record<string, unknown>, chain: EntryChain, timestamp: string): void {
    const role = obj.role;
    if (role !== "user" && role !== "assistant") return;
    const text = flattenCodexText(obj.content);
    if (text.length === 0) return;
    chain.push({ role, content: text }, timestamp);
}

/** Codex message content: a plain string, or a block array whose text-ish
 *  blocks (input_text / output_text / text) are joined with "\n". */
function flattenCodexText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const raw of content) {
        const block = asRecord(raw);
        if (block === null) continue;
        if (block.type === "input_text" || block.type === "output_text" || block.type === "text") {
            const text = asString(block.text);
            if (text !== undefined && text.length > 0) parts.push(text);
        }
    }
    return parts.join("\n");
}

/** One codex `function_call` item → assistant entry with a toolCall block.
 *  `arguments` arrives as a JSON STRING (the wire format) and is parsed into
 *  an object; an already-object value passes through; anything else degrades
 *  to {raw: <string>} instead of losing the call. */
function convertCodexFunctionCall(obj: Record<string, unknown>, chain: EntryChain, timestamp: string): void {
    const name = asString(obj.name) ?? "unknown";
    const callId = asString(obj.call_id) ?? randomUUID();
    const raw = asString(obj.arguments);
    let argumentsObj: Record<string, unknown>;
    if (raw !== undefined) {
        argumentsObj = asRecord(parseJsonLine(raw)) ?? { raw };
    } else {
        argumentsObj = asRecord(obj.arguments) ?? {};
    }
    chain.push(
        { role: "assistant", content: [{ type: "toolCall", id: callId, name, arguments: argumentsObj }] },
        timestamp,
    );
}

/** One codex `function_call_output` item → toolResult entry. */
function convertCodexFunctionOutput(obj: Record<string, unknown>, chain: EntryChain, timestamp: string): void {
    const output = asString(obj.output) ?? "";
    const message: Record<string, unknown> = {
        role: "toolResult",
        content: [{ type: "text", text: output }],
        isError: false,
    };
    const callId = asString(obj.call_id);
    if (callId !== undefined) message.toolCallId = callId;
    chain.push(message, timestamp);
}

// ---------------------------------------------------------------------------
// Serialization + writing
// ---------------------------------------------------------------------------

/** Serialize to session .jsonl: the header line plus one line per entry,
 *  each JSON.stringify'd, "\n"-joined with a trailing newline — byte-shape
 *  identical to what `importSession` writes for portable imports. */
export function serializeConverted(converted: ConvertedSession): string {
    const lines = [JSON.stringify(converted.header), ...converted.entries.map((entry) => JSON.stringify(entry))];
    return lines.join("\n") + "\n";
}

/**
 * Write the converted session as `<targetDir>/<ts>_<id>.jsonl`, mirroring
 * pi's on-disk naming exactly (`2026-10-23T21-13-48-051Z_<uuid>.jsonl` — the
 * header timestamp with `:` and `.` swapped for `-`, so `sessions list`
 * ordering keeps the SOURCE session's date). Creates targetDir recursively
 * and returns the absolute path plus the byte count.
 */
export function writeConvertedSession(converted: ConvertedSession, targetDir: string): { path: string; bytes: number } {
    mkdirSync(targetDir, { recursive: true });
    const content = serializeConverted(converted);
    const fileTimestamp = converted.header.timestamp.replace(/[:.]/g, "-");
    const path = join(targetDir, `${fileTimestamp}_${converted.header.id}.jsonl`);
    writeFileSync(path, content);
    return { path, bytes: Buffer.byteLength(content) };
}

// ---------------------------------------------------------------------------
// One-shot: detect → convert → write
// ---------------------------------------------------------------------------

/**
 * Detect, convert and persist a foreign session in one call — the entry
 * point `unown sessions import` uses. An explicit `format` wins over
 * auto-detection; `unown` input is skipped (a native .jsonl pi session is
 * directly resumable and needs no conversion); `unknown` input is skipped
 * with a reason. NEVER throws — every failure mode, including I/O errors
 * from the write, is a skipped result with a reason string.
 */
export function convertAndWriteSession(
    lines: string[],
    opts: { format?: "auto" | SessionFormat; targetDir: string; newId?: () => string; fallbackCwd: string },
): { format: SessionFormat; path?: string; bytes?: number; skipped: boolean; reason?: string } {
    let format: SessionFormat = "unknown";
    try {
        const requested = opts.format ?? "auto";
        format = requested === "auto" ? detectSessionFormat(lines) : requested;
        if (format === "unown") {
            return {
                format,
                skipped: true,
                reason: "already a unown session — use `unown sessions import` (a .jsonl pi session is directly resumable)",
            };
        }
        if (format === "unknown") {
            return {
                format,
                skipped: true,
                reason: "unrecognized session format (expected a Claude Code or Codex session .jsonl)",
            };
        }
        const newId = opts.newId ?? randomUUID;
        const converted =
            format === "claude"
                ? convertClaudeSession(lines, { newId, fallbackCwd: opts.fallbackCwd })
                : convertCodexSession(lines, { newId, fallbackCwd: opts.fallbackCwd });
        if (converted === null) {
            return { format, skipped: true, reason: `no usable messages found in the ${format} session` };
        }
        const written = writeConvertedSession(converted, opts.targetDir);
        return { format, path: written.path, bytes: written.bytes, skipped: false };
    } catch (err) {
        return {
            format,
            skipped: true,
            reason: `conversion failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
