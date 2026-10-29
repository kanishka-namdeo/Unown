/**
 * recap.ts — the session recap: what happened while you were away.
 *
 * The 2026-10 convergence round (Claude Code parity, 2026-10-24 shipped in
 * Claude Code's interactive mode): when a session sits idle and you come
 * back, the raw transcript tail is a bad "welcome home" — you scan walls of
 * tool output to reconstruct state. Claude Code answers with a one-line
 * recap after ≥3 minutes away, plus `/recap` on demand. Unown had the
 * *materials* (auto-title names the session; /insights aggregates across
 * sessions) but no at-the-moment, in-session recap.
 *
 * Two layers, one module:
 *
 *   1. AUTO-RECAP — on the first prompt after an idle gap
 *      (UNOWN_RECAP_IDLE_MINUTES, default 3 — Claude Code's threshold), the
 *      deterministic digest line renders instantly through the notify pane.
 *      No LLM on the prompt path: a recap must never add latency to the
 *      moment you actually sent work.
 *
 *   2. `/recap [n]` — the on-demand summary: the last-n-turns digest plus an
 *      LLM one-liner through the same /btw side-question lane (never entering
 *      the transcript, receipts ledger, or AutoDream note mining), degrading
 *      to the digest when the model lane is unavailable.
 *
 * Pure module: no pi imports. The tools.ts wiring passes session entries in
 * (ctx.sessionManager.getEntries() — the same read-only surface /usage
 * uses); the LLM lane is injectable for tests.
 */

export const RECAP_IDLE_MINUTES_ENV = "UNOWN_RECAP_IDLE_MINUTES";
export const DEFAULT_RECAP_IDLE_MINUTES = 3;

export interface RecapConfig {
        minutes?: number;
}

export interface RecapDecision {
        action: "show" | "skip";
        reason: string;
        idleMinutes: number;
}

export function resolveRecapConfig(cfg?: RecapConfig): Required<RecapConfig> {
        const raw = process.env[RECAP_IDLE_MINUTES_ENV];
        const envMinutes = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
        const minutes = Number.isFinite(envMinutes) && envMinutes >= 0 ? envMinutes : (cfg?.minutes ?? DEFAULT_RECAP_IDLE_MINUTES);
        return { minutes };
}

/** Should the auto-recap fire for this idle gap? (0 = the kill switch.) Pure. */
export function shouldRecap(idleMs: number, cfg?: RecapConfig): RecapDecision {
        const { minutes } = resolveRecapConfig(cfg);
        const idleMinutes = Number((Math.max(0, idleMs) / 60_000).toFixed(1));
        if (minutes <= 0) return { action: "skip", reason: "auto-recap disabled (UNOWN_RECAP_IDLE_MINUTES=0)", idleMinutes };
        if (idleMinutes < minutes) {
                return { action: "skip", reason: `idle ${idleMinutes}m < ${minutes}m threshold`, idleMinutes };
        }
        return { action: "show", reason: `idle ${idleMinutes}m ≥ ${minutes}m`, idleMinutes };
}

// ---------------------------------------------------------------------------
// The deterministic digest — session entries since a timestamp
// ---------------------------------------------------------------------------

export interface RecapDigest {
        turns: number;
        userMessages: number;
        assistantMessages: number;
        toolCalls: number;
        toolsUsed: string[];
        filesTouched: string[];
        /** Idle span the digest covers (minutes, 1dp). */
        idleMinutes: number;
        lastUserPreview: string;
        lastAssistantPreview: string;
}

const FILE_ARG_KEYS = ["file", "path", "file_path", "filename", "target_file", "filePath"];
const PREVIEW_CHARS = 72;

function textOf(content: unknown): string {
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
                return content
                        .map((b: any) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
                        .filter(Boolean)
                        .join(" ")
                        .trim();
        }
        return "";
}

function collectToolFacts(message: any, tools: Map<string, number>, files: Set<string>): number {
        let calls = 0;
        const blocks = Array.isArray(message?.content) ? message.content : [];
        for (const block of blocks) {
                if (block?.type !== "toolCall") continue;
                calls++;
                // Live events carry toolName; PERSISTED entries carry name (the
                // observability round's brief surfaced the mismatch — every
                // persisted digest printed "unknown"; pinned by test).
                const rawName = block.toolName ?? block.name;
                const name = typeof rawName === "string" && rawName ? rawName : "unknown";
                tools.set(name, (tools.get(name) ?? 0) + 1);
                const args = block.arguments ?? {};
                for (const key of FILE_ARG_KEYS) {
                        const v = (args as any)[key];
                        if (typeof v === "string" && v.trim()) files.add(v.trim());
                }
        }
        return calls;
}

/**
 * Build the deterministic digest from session entries (the read-only
 * `ctx.sessionManager.getEntries()` surface — same contract as
 * sessionUsageSummary): counts + tool/file facts + previews for the messages
 * that landed after `sinceTs`. Defensive against malformed entries; never
 * throws.
 */
export function buildRecapDigest(entries: unknown[], sinceTs: number, idleMs: number): RecapDigest {
        const digest: RecapDigest = {
                turns: 0,
                userMessages: 0,
                assistantMessages: 0,
                toolCalls: 0,
                toolsUsed: [],
                filesTouched: [],
                idleMinutes: Number((Math.max(0, idleMs) / 60_000).toFixed(1)),
                lastUserPreview: "",
                lastAssistantPreview: "",
        };
        const tools = new Map<string, number>();
        const files = new Set<string>();
        try {
                for (const entry of entries ?? []) {
                        try {
                                if (!entry || (entry as any).type !== "message") continue;
                                const message = (entry as any).message;
                                if (!message || typeof (message as any).role !== "string") continue;
                                const ts = typeof (entry as any).ts === "number" ? (entry as any).ts : 0;
                                if (sinceTs > 0 && ts > 0 && ts < sinceTs) continue;
                                const text = textOf((message as any).content);
                                if ((message as any).role === "user") {
                                        digest.userMessages++;
                                        if (text) digest.lastUserPreview = text.slice(0, PREVIEW_CHARS);
                                } else if ((message as any).role === "assistant") {
                                        digest.assistantMessages++;
                                        digest.toolCalls += collectToolFacts(message, tools, files);
                                        if (text) digest.lastAssistantPreview = text.slice(0, PREVIEW_CHARS);
                                }
                        } catch {
                                /* malformed entry — best-effort digest */
                        }
                }
                digest.turns = Math.min(digest.userMessages, digest.assistantMessages);
                digest.toolsUsed = [...tools.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => (n > 1 ? `${name}×${n}` : name));
                digest.filesTouched = [...files].slice(0, 8);
        } catch {
                /* never throw from a digest */
        }
        return digest;
}

function quote(preview: string): string {
        const clean = preview.replace(/\s+/g, " ").trim();
        return clean ? ` ("${clean}${clean.length >= PREVIEW_CHARS ? "…" : ""}")` : "";
}

/**
 * Render the auto-recap line — the deterministic welcome-home. One notify
 * line: the span, the shape of the work, and where it stopped. ASCII only
 * (console output contract).
 */
export function renderRecapDigestLine(digest: RecapDigest): string {
        const parts: string[] = [];
        parts.push(`while you were away (~${digest.idleMinutes}m idle):`);
        const shape: string[] = [];
        if (digest.turns > 0) shape.push(`${digest.turns} turn${digest.turns === 1 ? "" : "s"}`);
        if (digest.toolCalls > 0) shape.push(`${digest.toolCalls} tool call${digest.toolCalls === 1 ? "" : "s"}`);
        if (digest.filesTouched.length > 0) {
                shape.push(`${digest.filesTouched.length} file${digest.filesTouched.length === 1 ? "" : "s"} touched`);
        }
        parts.push(shape.length ? shape.join(", ") : "no new turns");
        if (digest.lastAssistantPreview) parts.push(`last answer${quote(digest.lastAssistantPreview)}`);
        parts.push("(/recap for the fuller summary)");
        return parts.join(" ");
}

// ---------------------------------------------------------------------------
// The /recap command — digest + the LLM one-liner through the /btw lane
// ---------------------------------------------------------------------------

/** The question handed to the side-question lane (btw.ts answerBtw). */
export function buildRecapQuestion(turns: number): string {
        const n = Number.isFinite(turns) && turns > 0 ? Math.min(turns, 12) : 6;
        return `Write a ONE-sentence recap of what happened in this session's last ${n} turns: what was asked, what was changed (files/tools), and where things stand. Plain text, no markdown headers.`;
}
