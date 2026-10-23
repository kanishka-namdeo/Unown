/**
 * notify-tui.ts — turn-complete attention for interactive sessions (the
 * OpenCode/Crush/Aider "attention" gap: print mode pinged, the TUI stayed
 * silent through a 20-minute turn).
 *
 * WHY THIS IS SAFE WHERE notify.ts REFUSED: notify.ts documents why it stays
 * out of the TUI lane — a raw OSC escape written mid-frame can tear the
 * render, and the TUI owns stdout. This module respects that contract:
 * it never writes synchronously inside an event handler. The write is
 * DEFERRED (NOTIFY_DEFER_MS after the turn ends — the final frame has
 * flushed and the render loop is idle in every observed case), gated on a
 * minimum turn duration (UNOWN_NOTIFY_MS, default 120s — quick turns stay
 * silent; the ping means "the long thing you walked away from is done"),
 * and idempotent per turn (a scheduled ping is cancelled by the next
 * turn_start, so overlapping turns never stack notifications).
 *
 * THE GATES (mirroring notify.ts exactly):
 *   - UNOWN_TUI_NOTIFY=0 (default ON) is the TUI-specific kill switch;
 *   - UNOWN_NOTIFY=0 and DO_NOT_TRACK=1 silence every emission (the shared
 *     family kill switches — a notification is telemetry-shaped);
 *   - stdout must be a TTY (piped RPC/ACP stays byte-clean).
 *
 * THE PAYLOAD: OSC-9 ("unown: <status line>") + one BEL — the same
 * belt-and-braces pair print mode sends; OSC-unaware terminals swallow the
 * escape and the BEL still rings.
 *
 * Purity contract: every decision function is pure and unit-tested
 * (tuiNotifyGated, shouldPingOnTurnEnd); only scheduleTurnEndPing touches
 * the process, and tests inject a fake clock + recorder stream.
 */
import { notifyGated } from "./notify.ts";

/** Default minimum turn duration (ms) before a turn-end ping is earned. */
export const TUI_NOTIFY_DEFAULT_MS = 120_000;
/** Defer between turn end and the escape write (frame-flush margin). */
export const NOTIFY_DEFER_MS = 300;

/** TUI notify enabled? UNOWN_TUI_NOTIFY default ON; 0/false/off disables. */
export function tuiNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
    const raw = (env.UNOWN_TUI_NOTIFY ?? "").trim().toLowerCase();
    if (raw === "" || raw === "1" || raw === "true" || raw === "on") return true;
    return false;
}

/** Every gate at once: TTY + the shared notify gates + the TUI switch. Pure. */
export function tuiNotifyGated(
    isTty: boolean,
    env: Record<string, string | undefined> = process.env,
): boolean {
    if (!isTty) return false;
    if (!tuiNotifyEnabled(env)) return false;
    return notifyGated(isTty, { env });
}

/** The long-turn threshold (shared spelling with print mode). Pure. */
export function turnNotifyThresholdMs(env: Record<string, string | undefined> = process.env): number {
    const raw = env.UNOWN_NOTIFY_MS;
    const trimmed = raw === undefined ? "" : String(raw).trim();
    if (trimmed === "") return TUI_NOTIFY_DEFAULT_MS;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : TUI_NOTIFY_DEFAULT_MS;
}

/** Did this turn earn a ping? Pure. */
export function shouldPingOnTurnEnd(
    turnDurationMs: number,
    isTty: boolean,
    env: Record<string, string | undefined> = process.env,
): boolean {
    if (!tuiNotifyGated(isTty, env)) return false;
    return turnDurationMs >= turnNotifyThresholdMs(env);
}

/** Format the OSC-9 + BEL pair for a turn-end ping. Pure. */
export function turnEndPingPayload(answerPreview: string): string {
    const preview = answerPreview.trim().replace(/\s+/g, " ").slice(0, 80);
    const body = preview ? `done — ${preview}` : "done — waiting for your next message";
    return `\x1b]9;unown: ${body}\x07\x07`;
}

type Deferred = { cancel(): void };

/**
 * Schedule the deferred turn-end ping. Returns a handle whose cancel() the
 * next turn_start calls (never stacked pings). The write goes through the
 * injected writer (tests record; production passes a thin stdout wrapper).
 */
export function scheduleTurnEndPing(
    turnDurationMs: number,
    answerPreview: string,
    opts: {
        isTty: boolean;
        env?: Record<string, string | undefined>;
        deferMs?: number;
        write?: (s: string) => void;
        setTimeoutFn?: (fn: () => void, ms: number) => { cancel(): void };
    },
): Deferred | null {
    const env = opts.env ?? process.env;
    if (!shouldPingOnTurnEnd(turnDurationMs, opts.isTty, env)) return null;
    const write = opts.write ?? ((s: string) => {
        try {
            process.stdout.write(s);
        } catch {
            /* best-effort — a failed ping must never surface */
        }
    });
    const payload = turnEndPingPayload(answerPreview);
    const deferMs = opts.deferMs ?? NOTIFY_DEFER_MS;
    if (opts.setTimeoutFn) {
        return opts.setTimeoutFn(() => write(payload), deferMs);
    }
    const timer = setTimeout(() => write(payload), deferMs);
    return {
        cancel: () => clearTimeout(timer),
    };
}
