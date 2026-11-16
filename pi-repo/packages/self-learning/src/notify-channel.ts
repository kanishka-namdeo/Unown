/**
 * notify-channel.ts — the notification channel resolver + the needs-input
 * ping (the Da capo round, 2026-11-16, R13).
 *
 * THE RESEARCH: Claude Code exposes `preferredNotifChannel`
 * (iterm2|kitty|ghostty|terminal_bell — official terminal-config.md, fetched
 * 2026-11-16) and the community runs OSC 777 (title;body) as the
 * Ghostty/iTerm2/rxvt toast lane (keyhell.org/posts/2026-03-26, issue
 * #92830); users want "needs input" distinct from "done" (issue #73384 —
 * the come-back-and-answer moment CC's blue tab badge signals).
 *
 * UNOWN'S FORM:
 *   - The channel resolver is TERMINAL-DETECTED by default: TERM_PROGRAM
 *     ghostty / iterm.app / wezterm → OSC 777 (`ESC ] 777 ; notify ;
 *     <title> ; <body> BEL`), everything else keeps the OSC 9 + BEL pair.
 *     `UNOWN_TUI_NOTIFY_CHANNEL=osc9|osc777` pins it explicitly.
 *   - The needs-input ping fires when an attention dialog OPENS (a
 *     permission ask, a plan approval, a questionnaire) — immediately in
 *     meaning, deferred 300 ms in the write (the same frame-tear law
 *     notify-tui.ts obeys: never a raw OSC inside a render frame), one
 *     ping per ask (a new ask replaces a still-pending ping, resolved
 *     asks cancel it — no stacking, no double-pings).
 *   - Gates: the TTY gate + the family kill switches (UNOWN_NOTIFY=0,
 *     DO_NOT_TRACK=1, UNOWN_TUI_NOTIFY=0) + the input-specific
 *     UNOWN_TUI_NOTIFY_INPUT=0 (default ON — the turn-end ping stays
 *     duration-gated at UNOWN_NOTIFY_MS, but an ask is always worth a
 *     ping: the session is BLOCKED without the user).
 *
 * Purity contract: the resolver, the gate and the payload builders are pure
 * and unit-tested; only the schedule function touches the process, and
 * tests inject the clock + a recorder stream.
 */

/** The channels a TUI notification can ride. */
export type NotifyChannel = "osc9" | "osc777";

/** Terminal programs whose toast lane is OSC 777 (case-insensitive substring match). */
const OSC_777_TERM_PROGRAMS = ["ghostty", "iterm", "wezterm"];

/**
 * Resolve the notification channel: the env pin wins, then the terminal
 * program detection, then OSC 9. Pure.
 */
export function resolveNotifyChannel(
    env: Record<string, string | undefined> = process.env,
    termProgram: string | undefined = env.TERM_PROGRAM,
): NotifyChannel {
    const pinned = (env.UNOWN_TUI_NOTIFY_CHANNEL ?? "").trim().toLowerCase();
    if (pinned === "osc9") return "osc9";
    if (pinned === "osc777") return "osc777";
    const program = (termProgram ?? "").toLowerCase();
    if (OSC_777_TERM_PROGRAMS.some((candidate) => program.includes(candidate))) return "osc777";
    return "osc9";
}

/** Is the needs-input ping enabled? UNOWN_TUI_NOTIFY_INPUT default ON. Pure. */
export function inputNotifyEnabled(env: Record<string, string | undefined> = process.env): boolean {
    const raw = (env.UNOWN_TUI_NOTIFY_INPUT ?? "").trim().toLowerCase();
    if (raw === "" || raw === "1" || raw === "true" || raw === "on") return true;
    return false;
}

/** Every gate at once for an input ping: TTY + family switches + the input switch. Pure. */
export function inputNotifyGated(
    isTty: boolean,
    env: Record<string, string | undefined> = process.env,
): boolean {
    if (!isTty) return false;
    if (!inputNotifyEnabled(env)) return false;
    // The family kill switches (the notify.ts spelling family): the input
    // ping is a notification in exactly the same sense.
    if (/^(0|false|off|no)$/i.test(env.UNOWN_NOTIFY ?? "")) return false;
    if (/^(0|false|off|no)$/i.test(env.UNOWN_TUI_NOTIFY ?? "")) return false;
    if (/^(1|true|yes)$/i.test(env.DO_NOT_TRACK ?? "")) return false;
    return true;
}

/** Build the needs-input payload for the resolved channel. Pure. */
export function inputNeededPayload(reason: string, channel: NotifyChannel): string {
    const preview = reason.trim().replace(/\s+/g, " ").slice(0, 80);
    const body = preview ? `unown needs your input — ${preview}` : "unown needs your input";
    if (channel === "osc777") {
        // OSC 777: ] 777 ; notify ; title ; body BEL — the Ghostty/iTerm2/WezTerm toast.
        return `\x1b]777;notify;unown;${body}\x07`;
    }
    // OSC 9 + BEL: the same belt-and-braces pair the turn-end ping sends.
    return `\x1b]9;${body}\x07\x07`;
}

type Deferred = { cancel(): void };

/**
 * Schedule the deferred needs-input ping (one live ping at most — a new ask
 * cancels a still-pending one; the handle's cancel() is what a resolved ask
 * calls). The write goes through the injected writer (tests record;
 * production passes a stdout wrapper).
 */
export function scheduleInputNeededPing(
    reason: string,
    opts: {
        isTty: boolean;
        env?: Record<string, string | undefined>;
        deferMs?: number;
        write?: (s: string) => void;
        setTimeoutFn?: (fn: () => void, ms: number) => { cancel(): void };
    },
): Deferred | null {
    const env = opts.env ?? process.env;
    if (!inputNotifyGated(opts.isTty, env)) return null;
    const write =
        opts.write ??
        ((s: string) => {
            try {
                process.stdout.write(s);
            } catch {
                /* best-effort — a failed ping must never surface */
            }
        });
    const payload = inputNeededPayload(reason, resolveNotifyChannel(env));
    const deferMs = opts.deferMs ?? 300;
    if (opts.setTimeoutFn) {
        return opts.setTimeoutFn(() => write(payload), deferMs);
    }
    const timer = setTimeout(() => write(payload), deferMs);
    return {
        cancel: () => clearTimeout(timer),
    };
}
