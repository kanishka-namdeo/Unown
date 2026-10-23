/**
 * btw.ts — /btw: side questions that never touch the session (the 2026
 * consensus feature — Claude Code, Codex/Antigravity and OpenCode all ship
 * one, because "what does this function do again?" should not cost you a
 * turn of context or a line of history).
 *
 * THE SHAPE: /btw <question> takes the session's recent turns (text only,
 * capped), asks the model ONE side-channel completion with tools disabled,
 * and renders the answer in a dismissible overlay. The session tree, the
 * receipts ledger, the notes outbox and the compaction state are all
 * untouched — the question and its answer die with the overlay. The
 * transcript pollution problem is the whole point: a mid-session aside
 * that rode the main context would (a) consume the window, (b) steer every
 * later turn, (c) leak into AutoDream's note mining.
 *
 * TRANSPORT: the learning layer's chatText (llm.ts) — the same bridge lane
 * AutoDream uses, thinking disabled, one non-streaming call. maxTokens is
 * generous (answers that cite file:line run long) but the CONTEXT is tight:
 * the last BTW_CONTEXT_MESSAGES turns, each clipped to BTW_MESSAGE_CAP
 * chars, whole thing under BTW_TOTAL_CAP — a side question must be cheaper
 * than the turn it interrupts.
 *
 * FAILURE POSTURE: bridge down / empty completion → a clear error naming
 * the fix (the doctor lane), never a silent decline. No answer is ever
 * written anywhere.
 */
import type { ChatMsg } from "./llm.ts";
import { chatText } from "./llm.ts";

/** How many recent session entries feed the side-channel context. */
export const BTW_CONTEXT_MESSAGES = 12;
/** Per-message character cap (long tool dumps would crowd out the question). */
export const BTW_MESSAGE_CAP = 1500;
/** Total context character cap across all messages. */
export const BTW_TOTAL_CAP = 12000;
/** Answer cap: enough for a cited explanation, short enough to read in an overlay. */
export const BTW_MAX_ANSWER_CHARS = 4000;

/** The system prompt for the side-channel call. No tools exist on this lane. */
export const BTW_SYSTEM_PROMPT = [
    "You are the side-channel of a coding agent session: you answer ONE quick question",
    "about the ongoing conversation or codebase without joining it. Answer directly and",
    "concisely (under 250 words). Cite file:line or the exact prior message when it helps.",
    "You have no tools; if the answer is genuinely not derivable from the context, say so",
    "in one sentence and suggest what the main agent should be asked instead. Never",
    "address the user's next steps beyond the question asked.",
].join(" ");

/** Flatten a pi message content (string | block array) to plain text, best-effort. */
export function btwMessageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === "text" && typeof b.text === "string") {
            parts.push(b.text);
        } else if (b.type === "toolCall" && b && typeof b === "object") {
            const name = (b as { name?: unknown }).name;
            if (typeof name === "string") parts.push(`[tool: ${name}]`);
        }
    }
    return parts.join("\n");
}

/** Clip one text to its cap INCLUDING the marker (a cap that overflows by
 *  its own ellipsis is not a cap). */
function clip(text: string, cap: number): string {
    const clean = text.trim();
    if (clean.length <= cap) return clean;
    const marker = "… [clipped]";
    const room = Math.max(0, cap - marker.length);
    return `${clean.slice(0, room)}${marker}`;
}

/**
 * Build the side-channel message list from session entries: system prompt,
 * the recent turns (user/assistant text only, tool noise elided to markers),
 * then the question as the final user message. Pure, defensive against
 * malformed entries, deterministic.
 */
export function buildBtwMessages(
    entries: unknown[],
    question: string,
    opts: { contextMessages?: number; messageCap?: number; totalCap?: number } = {},
): ChatMsg[] {
    const contextMessages = opts.contextMessages ?? BTW_CONTEXT_MESSAGES;
    const messageCap = opts.messageCap ?? BTW_MESSAGE_CAP;
    const totalCap = opts.totalCap ?? BTW_TOTAL_CAP;

    const recent: ChatMsg[] = [];
    // Walk backwards over message entries, keep user/assistant text only.
    for (let i = entries.length - 1; i >= 0 && recent.length < contextMessages; i--) {
        const entry = entries[i] as { type?: unknown; message?: { role?: unknown; content?: unknown } } | null;
        if (!entry || entry.type !== "message" || !entry.message) continue;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;
        const text = btwMessageText(entry.message.content);
        if (!text.trim()) continue;
        recent.push({ role, content: clip(text, messageCap) });
    }
    // chronological order for the model
    recent.reverse();

    // Enforce the total cap from the OLDEST side (the newest turns + the
    // question itself are the load-bearing context).
    let budget = totalCap;
    const kept: ChatMsg[] = [];
    for (let i = recent.length - 1; i >= 0; i--) {
        const msg = recent[i];
        if (msg.content.length <= budget) {
            kept.unshift(msg);
            budget -= msg.content.length;
        } else if (budget > 200) {
            kept.unshift({ role: msg.role, content: clip(msg.content, budget) });
            budget = 0;
        } else {
            break;
        }
    }

    return [
        { role: "system", content: BTW_SYSTEM_PROMPT },
        ...kept,
        { role: "user", content: `Side question (the main conversation continues separately; this exchange is invisible to it):\n${question.trim()}` },
    ];
}

/** The rendered overlay title line. */
export function btwHeader(question: string): string {
    const short = question.trim().replace(/\s+/g, " ");
    return `btw · ${short.length > 60 ? `${short.slice(0, 57)}…` : short}`;
}

/** Prepare an answer for display: clip + collapse whitespace runs > 2. */
export function formatBtwAnswer(answer: string, cap = BTW_MAX_ANSWER_CHARS): string {
    const clean = answer.trim();
    const clipped = clean.length > cap ? `${clean.slice(0, cap)}…` : clean;
    return clipped.replace(/\n{3,}/g, "\n\n");
}

/**
 * Answer a side question: build the context, make the single bridge call,
 * format the answer. Returns {answer} on success or {error} with a
 * user-actionable message on failure. Never throws.
 */
export async function answerBtw(
    entries: unknown[],
    question: string,
    chat: (messages: ChatMsg[], opts?: { maxTokens?: number; timeoutMs?: number }) => Promise<string> = chatText,
): Promise<{ answer?: string; error?: string }> {
    const trimmed = question.trim();
    if (!trimmed) return { error: "usage: /btw <question> — ask anything about the session; it never enters the transcript" };
    try {
        const messages = buildBtwMessages(entries, trimmed);
        const raw = await chat(messages, { maxTokens: 1024, timeoutMs: 60_000 });
        const answer = formatBtwAnswer(raw);
        if (!answer) return { error: "the model returned an empty answer — try rephrasing, or ask the main agent" };
        return { answer };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { error: `side question failed (${msg}) — the bridge may be down; unown doctor checks it` };
    }
}
