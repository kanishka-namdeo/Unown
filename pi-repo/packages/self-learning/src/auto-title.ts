/**
 * auto-title.ts — session auto-titling (v0.0.7 parity round).
 *
 * Problem: Unown sessions are nameless unless the user types /name, so the
 * /resume picker is a wall of timestamps and first-message snippets. Every
 * competitor (Claude Code, Codex, Gemini CLI, OpenCode) auto-names sessions
 * after the first exchange; Unown is the outlier.
 *
 * Design: one cheap LLM call over a COMPACT context — first user ask, first
 * assistant reply, LAST user ask, LAST assistant reply (deduped; each capped
 * at 1500 chars; 6000 total) — never the whole transcript, asked for a 3-6
 * word plain-text title. The reply is validated hard (non-empty, ≤48 chars,
 * single line, no markdown headers, wrapping quotes stripped) because it
 * lands in a picker UI, not a chat: a bad title is worse than no title. The
 * win is a `session_info` entry — the same entry /name writes — and the
 * picker walks entries in reverse (SessionManager.getSessionName
 * semantics), so a later /name simply overwrites us while a name that
 * already exists blocks us entirely.
 *
 * Guards (maybeAutoTitleSession, in order): no session file (print mode or
 * headless run without a session) → skip; UNOWN_AUTO_TITLES off → skip
 * (env read at CALL time, not module load); sessionName() already set →
 * skip (a user-set /name always wins and is never overwritten); caller's
 * alreadyTitled guard → skip (once per session, before the paid call); not
 * enough material (≥1 user message with 12+ chars of text AND ≥1 assistant
 * message with any text) → skip; invalid or failed generation → skip;
 * re-check sessionName() right before writing (race with a concurrent
 * /name) → skip. The caller keeps the in-memory once-per-session guard
 * keyed by titleAttemptKey(sessionId).
 *
 * Purity: everything is parameterized over deps — env for the flag, an
 * injected chat fn (llm.ts chatText's shape) for the LLM, closures for
 * sessionFile / sessionName / entries — so tests never touch the network or
 * the engine store. The only impure step is the final append through
 * SessionManager (top-level import from @earendil-works/pi-coding-agent),
 * wrapped so a write failure is reported, never thrown. Entries arrive as
 * `unknown[]` and are narrowed defensively: a malformed session must
 * degrade to "no title", never crash the agent loop.
 */
import { existsSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Env flag: auto-titles are ON by default; "0"/"false"/"off" disable. */
const ENABLED_FLAG = "UNOWN_AUTO_TITLES";

/** A user message must carry at least this many chars (trimmed) to count as title material. */
const MIN_USER_CHARS = 12;

/** Per-message cap in the compact title context. */
const PER_MESSAGE_CHAR_CAP = 1500;

/** Default total cap of the compact title context (4 × 1500 — never bites at defaults). */
const DEFAULT_CONTEXT_CAP = 6000;

/** Hard ceiling for a generated title — picker UI real estate. */
const TITLE_MAX_CHARS = 48;

/** Generation call budget — a title is 3-6 words. */
const TITLE_MAX_TOKENS = 32;

/** Generation call timeout. */
const TITLE_TIMEOUT_MS = 20_000;

/** The system prompt for the title call (wording pinned by tests). */
const TITLE_SYSTEM_PROMPT =
    "You title coding sessions. Reply with ONLY a 3-6 word title (max 48 chars), no quotes, no trailing punctuation, single line. Plain text.";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One flattened transcript message in the compact title context. */
export interface TitleMessage {
    role: "user" | "assistant";
    content: string;
}

/**
 * The minimal chat function title generation needs — llm.ts `chatText`'s
 * exact shape, injected by the caller so tests (and the engine's router
 * lanes) can substitute a mock.
 */
export type TitleChatFn = (
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    opts?: { maxTokens?: number; timeoutMs?: number },
) => Promise<string>;

/** Deps for maybeAutoTitleSession — all closures, all caller-owned. */
export interface AutoTitleOptions {
    /** Path of the live session .jsonl; undefined in print mode / headless runs. */
    sessionFile: string | undefined;
    /** Current session display name (latest session_info entry). A user-set /name always wins. */
    sessionName: () => string | undefined;
    /** Snapshot of the session entries (sessionManager.getEntries()). */
    entries: () => unknown[];
    /** The title-generation chat fn (llm.ts chatText). */
    chat: TitleChatFn;
    /** The caller's once-per-session guard — checked before the paid LLM call. */
    alreadyTitled?: () => boolean;
}

/** The outcome of one auto-title attempt. `reason` is a stable snake-case string (pin in tests). */
export interface AutoTitleResult {
    titled: boolean;
    title?: string;
    reason: string;
}

// ---------------------------------------------------------------------------
// Entry narrowing (defensive — entries are unknown[])
// ---------------------------------------------------------------------------

interface EntryLike {
    type?: unknown;
    message?: unknown;
}

interface MessageLike {
    role?: unknown;
    content?: unknown;
}

/**
 * Narrow a raw session entry to `{role, content}` when it is a `message`
 * entry with a string role; anything else (headers, session_info,
 * model_change, malformed shapes) yields undefined. Pure.
 */
function messageOf(entry: unknown): { role: string; content: unknown } | undefined {
    if (typeof entry !== "object" || entry === null) return undefined;
    if ((entry as EntryLike).type !== "message") return undefined;
    const message = (entry as EntryLike).message;
    if (typeof message !== "object" || message === null) return undefined;
    const role = (message as MessageLike).role;
    if (typeof role !== "string") return undefined;
    return { role, content: (message as MessageLike).content };
}

/**
 * Flatten pi message content — a plain string, or an array of content
 * blocks — to visible text. Text blocks are joined with newlines; tool
 * calls, thinking blocks and unknown shapes are skipped. Never throws.
 * Pure.
 */
export function messageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (typeof block !== "object" || block === null) continue;
        const b = block as { type?: unknown; text?: unknown };
        if (b.type !== "text" || typeof b.text !== "string") continue;
        parts.push(b.text);
    }
    return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Flag + material gate
// ---------------------------------------------------------------------------

/**
 * Is auto-titling enabled? UNOWN_AUTO_TITLES defaults ON; "0", "false" or
 * "off" (case-insensitive) disable it. Empty string counts as unset (the
 * repo-wide `KEY=` .env convention). Env is read at call time — pass
 * `process.env` implicitly or an explicit object in tests.
 */
export function autoTitlesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env[ENABLED_FLAG];
    if (raw === undefined || raw === "") return true; // unset or set-but-empty → ON
    return !["0", "false", "off"].includes(raw.trim().toLowerCase());
}

/**
 * Enough material to bother the LLM: at least one USER message with ≥12
 * chars of text (trimmed) AND at least one ASSISTANT message with ≥1 char
 * — one real ask plus one real reply, the minimum a title can summarize.
 * Malformed entries are ignored, never fatal. Pure.
 */
export function hasEnoughTitleMaterial(entries: unknown[]): boolean {
    let userOk = false;
    let assistantOk = false;
    for (const entry of entries) {
        const message = messageOf(entry);
        if (!message) continue;
        const text = messageText(message.content).trim();
        if (message.role === "user") {
            if (text.length >= MIN_USER_CHARS) userOk = true;
        } else if (message.role === "assistant") {
            if (text.length >= 1) assistantOk = true;
        }
    }
    return userOk && assistantOk;
}

// ---------------------------------------------------------------------------
// Compact context
// ---------------------------------------------------------------------------

/**
 * Build the compact title context: the FIRST user message, the FIRST
 * assistant reply, the LAST user message and the LAST assistant reply —
 * in that slot order, deduped by entry position (a session with one user
 * ask yields it once), each message's text capped to 1500 chars, the
 * total capped at `cap` (whole messages only: once the budget is spent,
 * later slots are dropped). Empty-text messages are skipped. Pure.
 */
export function buildTitleMessages(entries: unknown[], cap = DEFAULT_CONTEXT_CAP): TitleMessage[] {
    let firstUser = -1;
    let firstAssistant = -1;
    let lastUser = -1;
    let lastAssistant = -1;
    for (let i = 0; i < entries.length; i++) {
        const message = messageOf(entries[i]);
        if (!message) continue;
        if (message.role === "user") {
            if (firstUser === -1) firstUser = i;
            lastUser = i;
        } else if (message.role === "assistant") {
            if (firstAssistant === -1) firstAssistant = i;
            lastAssistant = i;
        }
    }
    const slots = [firstUser, firstAssistant, lastUser, lastAssistant];
    const seen = new Set<number>();
    const out: TitleMessage[] = [];
    let total = 0;
    for (const index of slots) {
        if (index === -1 || seen.has(index)) continue;
        seen.add(index);
        const message = messageOf(entries[index]);
        if (!message) continue;
        const text = messageText(message.content).trim();
        if (!text) continue;
        const content = text.length > PER_MESSAGE_CHAR_CAP ? text.slice(0, PER_MESSAGE_CHAR_CAP) : text;
        if (total + content.length > cap) break; // budget spent — later slots dropped
        total += content.length;
        out.push({ role: message.role === "user" ? "user" : "assistant", content });
    }
    return out;
}

// ---------------------------------------------------------------------------
// Title generation
// ---------------------------------------------------------------------------

/**
 * Sanitize + validate a raw model reply into a displayable title:
 * surrounding whitespace stripped, wrapping quotes (straight or curly,
 * possibly repeated rounds) stripped, then rejected if empty, longer than
 * 48 chars, multi-line, or containing a markdown header (any line starting
 * with '#'). Returns undefined on any rejection. Pure.
 */
function cleanTitleReply(raw: unknown): string | undefined {
    if (typeof raw !== "string") return undefined;
    let title = raw.trim();
    // Strip wrapping quote pairs — models love decorating titles with them.
    for (;;) {
        if (title.length < 2) break;
        const first = title[0];
        const last = title[title.length - 1];
        const isQuote = (c: string) => c === '"' || c === "'" || c === "`" || c === "\u201c" || c === "\u201d";
        if (isQuote(first) && isQuote(last)) {
            title = title.slice(1, -1).trim();
            continue;
        }
        break;
    }
    if (title.length === 0 || title.length > TITLE_MAX_CHARS) return undefined;
    if (/[\r\n]/.test(title)) return undefined; // single line only — pickers clip
    if (/^#/m.test(title)) return undefined; // markdown headers leak into pickers
    return title;
}

/**
 * Generate a session title from the entries via the injected chat fn: the
 * pinned system prompt + one user message ("Title this session:" + the
 * compact transcript), maxTokens 32, timeoutMs 20s. Returns the validated
 * title, or undefined on ANY failure — empty context, chat error, invalid
 * reply. Never throws (the caller treats a failed title as "leave the
 * session unnamed", not an error to surface).
 */
export async function generateSessionTitle(entries: unknown[], chat: TitleChatFn): Promise<string | undefined> {
    const messages = buildTitleMessages(entries);
    if (messages.length === 0) return undefined; // nothing to title — skip the paid call
    const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    let raw: string;
    try {
        raw = await chat(
            [
                { role: "system", content: TITLE_SYSTEM_PROMPT },
                { role: "user", content: `Title this session:\n\n${transcript}` },
            ],
            { maxTokens: TITLE_MAX_TOKENS, timeoutMs: TITLE_TIMEOUT_MS },
        );
    } catch {
        return undefined;
    }
    return cleanTitleReply(raw);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Trivial stable key for the caller's in-memory once-per-session guard
 * (a `Set<string>` of attempted session ids): "unown:auto-title:<id>".
 * Pure, deterministic, distinct per session.
 */
export function titleAttemptKey(sessionId: string): string {
    return `unown:auto-title:${sessionId}`;
}

/**
 * The full auto-title attempt with every guard in order (see the module
 * header). Returns `{titled, title?, reason}` — `reason` is a stable
 * snake-case string: no-session-file, disabled, already-named,
 * already-attempted, not-enough-material, no-valid-title,
 * named-during-generation, write-failed, titled. Reads env at call time.
 * The write goes through SessionManager.open(sessionFile)
 * .appendSessionInfo(title) — the same entry /name writes — wrapped so a
 * SessionManager failure (unreadable/corrupt file) is reported as
 * write-failed, never thrown into the agent loop.
 */
export async function maybeAutoTitleSession(opts: AutoTitleOptions): Promise<AutoTitleResult> {
    if (opts.sessionFile === undefined || !existsSync(opts.sessionFile)) {
        return { titled: false, reason: "no-session-file" };
    }
    if (!autoTitlesEnabled()) {
        return { titled: false, reason: "disabled" };
    }
    if (opts.sessionName() !== undefined) {
        return { titled: false, reason: "already-named" };
    }
    if (opts.alreadyTitled?.()) {
        return { titled: false, reason: "already-attempted" };
    }
    const entries = opts.entries();
    if (!hasEnoughTitleMaterial(entries)) {
        return { titled: false, reason: "not-enough-material" };
    }
    const title = await generateSessionTitle(entries, opts.chat);
    if (title === undefined) {
        return { titled: false, reason: "no-valid-title" };
    }
    // Race guard: a /name may have landed while the LLM was thinking —
    // re-read before writing; the user's name always wins.
    if (opts.sessionName() !== undefined) {
        return { titled: false, reason: "named-during-generation" };
    }
    try {
        SessionManager.open(opts.sessionFile).appendSessionInfo(title);
    } catch {
        return { titled: false, reason: "write-failed" };
    }
    return { titled: true, title, reason: "titled" };
}
