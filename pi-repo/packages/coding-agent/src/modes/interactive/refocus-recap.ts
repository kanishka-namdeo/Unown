/**
 * refocus-recap.ts — the fullscreen refocus recap (Da capo R16, Claude
 * Code's automatic `/recap` lane: "after ≥3 minutes away + ≥3 turns" the
 * terminal greets you with a one-line summary on refocus).
 *
 * Claude Code regenerates a model-written one-liner (capped at 400 chars).
 * Unown's fork deliberately renders a DETERMINISTIC line — the upstream is
 * metered, and a refocus greeting must never spend tokens or add latency to
 * the moment you come back. The line carries the same facts CC's does:
 * how long you were away, the session's turn count, and where the
 * conversation stopped (an 80-char preview of the last assistant reply).
 * The model-written form stays the roadmap item for an unmetered lane.
 *
 * The threshold knob is shared with the prompt-path auto-brief lane
 * (self-learning's recap.ts): UNOWN_RECAP_IDLE_MINUTES (minutes, may be
 * fractional for tests; 0 = the kill switch) governs BOTH recap surfaces,
 * so one switch turns the whole "while you were away" family off.
 *
 * Pure module: no TUI, no session types — the caller passes numbers and
 * strings, which keeps the decision matrix trivially testable.
 */

export const RECAP_IDLE_MINUTES_ENV = "UNOWN_RECAP_IDLE_MINUTES";
export const DEFAULT_IDLE_MINUTES = 3;
/** Claude Code's "≥3 turns" gate — a session without history has nothing to recap. */
export const MIN_TURNS = 3;
/** The preview length — the whole line stays far under CC's 400-char cap. */
export const PREVIEW_CHARS = 80;

export interface RefocusRecapDecision {
        action: "show" | "skip";
        reason: string;
        /** The away span in whole minutes (min 1 when shown). */
        awayMinutes: number;
}

export interface RefocusRecapConfig {
        minutes?: number;
        turns?: number;
}

/** Resolve the idle threshold (minutes) from the shared env knob. */
export function resolveIdleMinutes(env: NodeJS.ProcessEnv = process.env): number {
        const raw = env[RECAP_IDLE_MINUTES_ENV];
        const parsed = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_IDLE_MINUTES;
}

/**
 * Should the refocus recap fire for this away span + session shape?
 * (0 minutes = the kill switch; the turns gate is Claude Code's contract.)
 */
export function shouldShowRefocusRecap(
        awayMs: number,
        completedTurns: number,
        config?: RefocusRecapConfig,
): RefocusRecapDecision {
        const minutes = config?.minutes ?? resolveIdleMinutes();
        const minTurns = config?.turns ?? MIN_TURNS;
        const awayMinutes = Math.max(1, Math.round(Math.max(0, awayMs) / 60_000));
        if (minutes <= 0) {
                return { action: "skip", reason: `disabled (${RECAP_IDLE_MINUTES_ENV}=0)`, awayMinutes };
        }
        if (Math.max(0, awayMs) < minutes * 60_000) {
                return { action: "skip", reason: `away ${awayMinutes}m < ${minutes}m threshold`, awayMinutes };
        }
        if (completedTurns < minTurns) {
                return {
                        action: "skip",
                        reason: `${completedTurns} turn${completedTurns === 1 ? "" : "s"} < ${minTurns} turns`,
                        awayMinutes,
                };
        }
        return { action: "show", reason: `away ${awayMinutes}m ≥ ${minutes}m and ${completedTurns} ≥ ${minTurns} turns`, awayMinutes };
}

function preview(text: string): string {
        const clean = text.replace(/\s+/g, " ").trim();
        if (!clean) return "";
        const cut = clean.slice(0, PREVIEW_CHARS);
        return cut + (clean.length > PREVIEW_CHARS ? "…" : "");
}

/**
 * Render the dim status line — `back after N min · N turns · last: <preview>`.
 * ASCII-only apart from the ellipsis, one line, well under 400 chars.
 */
export function renderRefocusRecapLine(
        awayMs: number,
        completedTurns: number,
        lastAssistantText: string | undefined,
): string {
        const awayMinutes = Math.max(1, Math.round(Math.max(0, awayMs) / 60_000));
        const parts = [
                `back after ${awayMinutes} min`,
                `${completedTurns} turn${completedTurns === 1 ? "" : "s"} this session`,
        ];
        const last = preview(lastAssistantText ?? "");
        if (last) parts.push(`last: ${last}`);
        return parts.join(" · ");
}
