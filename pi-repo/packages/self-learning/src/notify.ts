/**
 * notify.ts — M3 OSC-9 desktop notifications for long-running print answers.
 *
 * THE PROBLEM: a `unown -p` run that takes minutes finishes while the user is
 * in another window — the answer lands unseen. Terminals already have a wire
 * for exactly this: OSC 9 (iTerm2's "post a desktop notification", since
 * adopted by WezTerm/Ghostty/Kitty in varying dialects) rides the session's
 * own pty, needs no helper binary, no permissions dialog and no network — the
 * cross-platform story (macOS/Linux/Windows) the doctor/CI matrix can
 * actually rely on.
 *
 * THE PAYLOAD: `\x1b]9;unown: <first 80 chars of the answer>\x07` followed by
 * one bare BEL. The BEL is the fallback half of the contract: OSC-unaware
 * emulators swallow unknown sequences whole (the OSC spec), so without a
 * trailing BEL a terminal that ignores OSC 9 stays silent — with it,
 * everything that can ring, rings. Supporting terminals show the notification
 * AND may ring once; one extra beep on a 2+ minute run is the acceptable price
 * of the fallback.
 *
 * THE GATES (notifyGated, pure — pinned by tests):
 *   - stdout must be a TTY (piped/redirected/CI runs get no escapes — a
 *     consumer parsing our stdout must never see them);
 *   - UNOWN_NOTIFY=0 (the user kill switch, same spelling family as the
 *     engine autostart one) and DO_NOT_TRACK=1 (the ecosystem
 *     nonessential-traffic opt-out, consoledonottrack.com) both silence every
 *     emission — a notification is telemetry-shaped, so the standard
 *     no-tracking signal is honored as such.
 *
 * PRINT MODE ONLY. The TUI is deliberately skipped: the user is present by
 * definition — the session is interactive, the terminal has (or will have)
 * focus when they return, and pi's own UI already owns the moment an answer
 * lands (scrollback, completion flash). There is also a hard technical reason
 * to stay out of that lane: the TUI redraws stdout through a frame loop, and
 * a raw OSC escape written mid-frame can tear the render. cmdPrint emits the
 * ping only AFTER runPrintMode resolves — the answer is printed and flushed
 * (print-mode's finally awaits flushRawStdout), so the escape lands on a
 * quiet stream. The JSON lanes (`--mode json`, `--output-format json`) never
 * reach the emission site at all — they own stdout byte-for-byte.
 *
 * Purity contract: the formatters and both decision functions are pure and
 * unit-tested; only emitOsc9 touches the process, and the actual escape
 * emission is deliberately NOT under test against the real stdout (control
 * bytes in a test runner's output corrupt its own reporting) — tests inject a
 * recorder stream.
 */

/** The long-run threshold: a print session at least this long earns a ping.
 *  Default 120s, env UNOWN_NOTIFY_MS (any finite value ≥ 0 — tests use 0).
 *  An unset OR EMPTY value means the default: bun auto-loads the repo .env,
 *  whose optional vars ship as `KEY=` (the repo-wide `||`, never `??`
 *  convention — see term.ts resolveUnownHome), and `Number("")` is 0, not
 *  NaN — without the explicit empty check every fresh install would ping on
 *  instant answers. */
export function notifyThresholdMs(env: Record<string, string | undefined> = process.env): number {
	const raw = env.UNOWN_NOTIFY_MS;
	if (raw === undefined || raw === "") return 120_000;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 120_000;
}

/** The opt-out + channel gates (pure — takes flags, never touches the process).
 *
 * `opts.env` is a plain record so tests (and any future non-process caller)
 * can assert the matrix without env mutations. */
export function notifyGated(isTty: boolean, opts: { env?: Record<string, string | undefined> } = {}): boolean {
	const env = opts.env ?? process.env;
	// Same spelling family as the engine autostart kill switch (engine-supervisor.ts).
	if (/^(0|false|off|no)$/i.test(env.UNOWN_NOTIFY ?? "")) return false;
	// DO_NOT_TRACK=1 is the ecosystem standard for "no nonessential traffic";
	// a desktop ping is nonessential in exactly that sense. 1/true/yes (the
	// spellings seen in the wild) all count; =0 means unset for our purposes.
	if (/^(1|true|yes)$/i.test(env.DO_NOT_TRACK ?? "")) return false;
	return isTty;
}

/** Collapse an answer to one notification-friendly line (pure): newlines and
 *  runs of whitespace become single spaces, capped at max chars with an
 *  ellipsis when truncation actually happened. The first 80 chars carry the
 *  news; the rest is in the terminal when the user comes back. Collapsing is
 *  not cosmetic: a raw newline inside an OSC string terminates the sequence
 *  in several emulators, so a multi-line answer would emit a broken escape. */
export function truncateForNotify(text: string, max = 80): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, max)}…`;
}

/** The full OSC-9 payload + BEL fallback (pure — pinned byte-for-byte).
 *
 * Title and body ride INSIDE the one OSC string ("title: body"), matching
 * the widely-implemented single-argument form; terminals that only support
 * the argument-less progress dialect (OSC 9;4) ignore it, which the BEL
 * backstops. The first \x07 terminates the OSC string; the second is the
 * bare-BEL fallback. */
export function formatOsc9(title: string, body: string): string {
	return `\x1b]9;${title}: ${body}\x07\x07`;
}

/** The answer-arrival decision for a print session (pure). Parameters are the
 *  facts cmdPrint already has at the emission site:
 *    - elapsedMs: session wall clock (cmdPrint entry → the final agent_end —
 *      "the answer lands"), not the post-answer shutdown tail;
 *    - thresholdMs: notifyThresholdMs();
 *    - gated: notifyGated(process.stdout.isTTY === true) — TTY + opt-outs;
 *    - answer: the final assistant message shape ({stopReason, text}).
 *      error/aborted endings and empty answers are not "the answer landed"
 *      (print mode prints nothing for them — exit 1 — and a ping about an
 *      answer that never printed would be a lie). */
export function shouldNotifyOnAnswer(args: {
	elapsedMs: number;
	thresholdMs: number;
	gated: boolean;
	answer?: { stopReason?: string; text?: string } | null;
}): boolean {
	if (!args.gated) return false;
	if (args.elapsedMs < args.thresholdMs) return false;
	const a = args.answer;
	if (!a || !a.text) return false; // nothing to announce
	if (a.stopReason === "error" || a.stopReason === "aborted") return false; // retries/aborts are not arrivals
	return true;
}

/** Emit the notification (the ONE side effect). Writes to stdout — the
 *  session's own terminal — only after the caller's gates passed; wrapped
 *  wholesale in try/catch because a ping must never break the run it pings
 *  about. Synchronous single write: the escape is consumed by the emulator,
 *  never rendered, and cmdPrint calls this after the answer stream has
 *  flushed, so there is nothing to coordinate. */
export function emitOsc9(title: string, body: string, stream: { write(s: string): boolean } = process.stdout): void {
	try {
		stream.write(formatOsc9(title, body));
	} catch {
		/* cosmetic best-effort — see above */
	}
}
