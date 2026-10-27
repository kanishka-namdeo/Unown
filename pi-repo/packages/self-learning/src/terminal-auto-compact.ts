/**
 * terminal-auto-compact.ts — LR-2 (2026-10-27 long-run stress round).
 *
 * Found live by the longrun bench's compact-thrash scenario: pi's native
 * auto-compaction is checked ONLY at agent_end / pre-prompt (agent-session.ts
 * tracks the assistant message "for auto-compaction (checked on agent_end)"),
 * so a LONG single-prompt tool exchange (a 150-turn buildout is one agent
 * loop) NEVER compacts mid-exchange. The context grows into the window, the
 * output budget is clamped away (`stop=length` at ~80 output tokens,
 * measured), the retry returns a 1-token empty completion, and the whole
 * long run dies as an upstream-empty error — exactly the claude-code#105086 /
 * codex#14447 "auto-compact never fires / context wedged" family.
 *
 * The engine lane has had its own mid-run curve since M3.7 (runner.ts
 * `checkAutoCompact` on every turn_end, the shipped `shouldAutoCompact`
 * curve in auto-compact.ts). This module gives the TERMINAL lane the same
 * protection on the SAME curve and the SAME env knobs — evaluated in
 * RESERVE-AWARE space:
 *
 *   effectiveWindow = max(contextWindow − reserveTokens, 25% of the window)
 *
 * pi reserves `compaction.reserveTokens` (default 16384, settings.json) for
 * the response and clamps the request's output budget at
 * `window − reserve − used` — the death zone starts at `window − reserve`,
 * which for the default 524k window sits at ~97% (where the plain 85% curve
 * already fired long before), but for a SMALL window (the 24k thrash arm:
 * 24k − 6k = 18k = 75%) sits BELOW the plain 85% mark — the run dies before
 * the percent trigger. The reserve is read from unown's own agent settings
 * file (`<UNOWN_AGENT_DIR>/settings.json`, `compaction.reserveTokens` — the
 * file pi consumes; not a pi-internal seam).
 *
 * Execution model (LR-2b — the second live finding): pi's compact() is
 * stop-the-world BY DESIGN (it opens with `await this.abort()`, and
 * session.prompt() refuses submissions while compaction runs), so an
 * extension CANNOT compact and continue inside one agent loop. The print-mode
 * caller therefore ORCHESTRATES: this extension records a pending
 * compaction at the message_end where the curve says "compact",
 * ctx.compact() runs (aborting the loop — the transcript keeps every
 * completed turn), and cmdPrint — after its runPrintMode round resolves —
 * waits for the compaction to settle, then submits an honest continuation
 * prompt ("continue exactly where you left off") as the next round, in the
 * SAME session (fully resumable). TUI sessions are user-attended and keep
 * the warn-only posture (pi's native pre-prompt compaction covers them).
 *
 *   warn (≥70% of effective)   — one stderr line per crossing
 *   compact (≥85%, UNOWN_AUTO_COMPACT_THRESHOLD) — print mode: compact +
 *                   continuation round (cap 8/session); TUI: warn line only.
 *   block (≥95%, UNOWN_AUTO_COMPACT_HARD_LIMIT) — the SAME compact +
 *                   continuation action (LR-2c, measured live: a single
 *                   large tool result can jump 72% → 116% in one turn,
 *                   leapfrogging the 85% bucket — aborting there kills runs
 *                   pi's own overflow recovery would have saved). Abort is
 *                   the LAST resort, never taken while continuation budget
 *                   remains.
 *
 * Purity: no pi imports; the extension reads only documented ExtensionContext
 * seams (mode / getContextUsage / compact / abort — extensions/types.ts). The
 * decision path is unit-testable through {@link decideTerminalAutoCompact} /
 * {@link effectiveContextWindow}. Kill switch: UNOWN_TERMINAL_AUTO_COMPACT=0
 * (read per event, hot-testable).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	formatCompactionWarning,
	formatContextExhaustedError,
	shouldAutoCompact,
	type AutoCompactDecision,
} from "./auto-compact.ts";
import { UNOWN_AGENT_DIR } from "./term.ts";

/** "0" disables the terminal auto-compact extension entirely. */
export const TERMINAL_AUTO_COMPACT_ENV = "UNOWN_TERMINAL_AUTO_COMPACT";

/** pi's default response reserve (coding-agent settings-manager.ts) — the
 *  fallback when the agent settings file carries no compaction.reserveTokens. */
export const PI_DEFAULT_RESERVE_TOKENS = 16_384;

/** Continuation rounds per print-mode run — a compact/continue storm stops
 *  here and degrades to warn-only (the run still completes or fails on its
 *  own merits; the curve never bricks a session). */
export const TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS = 8;

/** The continuation prompt cmdPrint submits after a mid-run compaction. */
export const TERMINAL_AUTO_COMPACT_CONTINUE_PROMPT =
	"[auto-compact] The session context was just compacted to free room. Continue the task from exactly where you left off — re-issue the last tool call if it was interrupted. When the whole task is finished, reply with your final answer.";

export interface TerminalAutoCompactState {
	/** Last decision bucket seen (for dedup + tests). */
	lastAction: AutoCompactDecision["action"];
	/** How many compactions this extension triggered. */
	compactions: number;
	/** How many warn lines were printed (one per crossing). */
	warnings: number;
	/** A compaction is in flight (set at ctx.compact(), cleared on settle). */
	compactInFlight: boolean;
	/** The most recent compaction completed successfully (onComplete). */
	lastCompactSucceeded: boolean;
	/** Continuation rounds started (the print-mode orchestration cap). */
	continuationRounds: number;
}

// The active instance (the fleetManagers() pattern — a module registry the
// print-mode caller reads after bootRuntime attached the extension). One
// terminal process runs one session at a time; each boot replaces the state.
let activeState: TerminalAutoCompactState | null = null;

/** The most recently booted terminal session's auto-compact state (or null). */
export function activeTerminalAutoCompact(): TerminalAutoCompactState | null {
	return activeState;
}

/**
 * The effective context window: `window − reserve`, floored at 25% of the
 * window (a reserve larger than the window must never zero the budget —
 * the curve degrades to quarter-window space instead of bricking).
 * Pure.
 */
export function effectiveContextWindow(contextWindow: number, reserveTokens: number): number {
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
	const reserve = Number.isFinite(reserveTokens) && reserveTokens > 0 ? reserveTokens : 0;
	return Math.max(contextWindow - reserve, Math.floor(contextWindow * 0.25));
}

/**
 * Read pi's response reserve from unown's agent settings file
 * (`<UNOWN_AGENT_DIR>/settings.json` → compaction.reserveTokens). Defensive:
 * any miss returns the pi default. Hot-reloadable by design (read per event —
 * the file is tiny and sessions have at most hundreds of turns).
 */
export function readCompactionReserveTokens(): number {
	try {
		const p = join(UNOWN_AGENT_DIR, "settings.json");
		if (!existsSync(p)) return PI_DEFAULT_RESERVE_TOKENS;
		const settings = JSON.parse(readFileSync(p, "utf8")) as { compaction?: { reserveTokens?: number } };
		const reserve = settings?.compaction?.reserveTokens;
		return typeof reserve === "number" && Number.isFinite(reserve) && reserve > 0 ? reserve : PI_DEFAULT_RESERVE_TOKENS;
	} catch {
		return PI_DEFAULT_RESERVE_TOKENS;
	}
}

/**
 * Pure decision for one message_end event: the shipped curve over the
 * RESERVE-AWARE effective window. Returns the decision + whether a warn LINE
 * should print (only on the warn-crossing, not on every warn-bucket turn).
 */
export function decideTerminalAutoCompact(
	tokens: number,
	contextWindow: number,
	reserveTokens: number,
	prevAction: AutoCompactDecision["action"],
): { decision: AutoCompactDecision; printWarn: boolean; effectiveWindow: number } {
	const effectiveWindow = effectiveContextWindow(contextWindow, reserveTokens);
	const decision = shouldAutoCompact(tokens, effectiveWindow);
	const printWarn = decision.action === "warn" && prevAction !== "warn";
	return { decision, printWarn, effectiveWindow };
}

/**
 * Start a mid-run compaction on the extension ctx (print mode only): sets
 * the in-flight bookkeeping and calls ctx.compact() with settle callbacks.
 * Exported for the tests; the extension's message_end handler is the only
 * production caller.
 */
function startCompaction(ctx: any, state: TerminalAutoCompactState, reason: string): void {
	state.compactions += 1;
	state.compactInFlight = true;
	state.lastCompactSucceeded = false;
	state.continuationRounds += 1;
	console.error(`unown: [auto-compact] ${reason} — compacting older turns (the run continues on the compacted context)`);
	try {
		ctx?.compact?.({
			onComplete: () => {
				state.compactInFlight = false;
				state.lastCompactSucceeded = true;
			},
			onError: (error: Error) => {
				state.compactInFlight = false;
				state.lastCompactSucceeded = false;
				console.error(`unown: [auto-compact] compaction failed: ${error?.message ?? error}`);
			},
		});
	} catch (err) {
		state.compactInFlight = false;
		console.error(`unown: [auto-compact] compaction could not start: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * The terminal auto-compact extension. Attach once per session boot
 * (cli.ts bootRuntime wires it for TUI, print mode and subagent children —
 * engine runs keep their own runner.ts curve, so no double-wiring).
 *
 * The compact/block actions only FIRE in print mode (`ctx.mode === "print"`)
 * — the continuation orchestration lives in cmdPrint; TUI sessions get the
 * warn line and keep pi's native pre-prompt compaction (the user is present
 * and in control).
 */
export function createTerminalAutoCompactExtension(): {
	extension: { name: string; hidden: boolean; factory: (pi: any) => void };
	state: TerminalAutoCompactState;
} {
	const state: TerminalAutoCompactState = {
		lastAction: "none",
		compactions: 0,
		warnings: 0,
		compactInFlight: false,
		lastCompactSucceeded: false,
		continuationRounds: 0,
	};
	activeState = state;
	return {
		state,
		extension: {
			name: "unown-terminal-auto-compact",
			hidden: true,
			factory(pi: any) {
				pi.on("message_end", ((event: any, ctx: any) => {
					try {
						if (process.env[TERMINAL_AUTO_COMPACT_ENV] === "0") return;
						const msg = event?.message;
						if (!msg || msg.role !== "assistant") return;
						// Error/aborted messages carry no valid usage; the engine curve
						// skips them for the same reason (compaction.ts getAssistantUsage).
						if (msg.stopReason === "error" || msg.stopReason === "aborted") return;
						const usage = typeof ctx?.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
						const tokens = usage?.tokens;
						const contextWindow = usage?.contextWindow;
						if (
							typeof tokens !== "number" ||
							!Number.isFinite(tokens) ||
							tokens <= 0 ||
							typeof contextWindow !== "number" ||
							!Number.isFinite(contextWindow) ||
							contextWindow <= 0
						) {
							return;
						}
						const { decision, printWarn, effectiveWindow } = decideTerminalAutoCompact(
							tokens,
							contextWindow,
							readCompactionReserveTokens(),
							state.lastAction,
						);
						state.lastAction = decision.action;
						if (decision.action === "warn") {
							if (printWarn) {
								state.warnings += 1;
								console.error(`unown: ${formatCompactionWarning(tokens, effectiveWindow)}`);
							}
							return;
						}
						if (decision.action === "compact" || decision.action === "block") {
							// LR-2c: the 95% bucket takes the same compact+continue action
							// as 85% — a single large tool result can jump the context past
							// both buckets in one turn (measured live: 72.7% → 116.4%), and
							// aborting there kills runs pi's own overflow recovery would
							// have saved. Abort is the LAST resort, never taken while
							// continuation budget remains.
							if (decision.action === "block") {
								console.error(`unown: ${formatContextExhaustedError(tokens, effectiveWindow)}`);
							}
							// TUI sessions are user-attended: warn and rely on pi's
							// native pre-prompt compaction — never abort a human's run.
							if (ctx?.mode !== "print") {
								console.error(
									`unown: [auto-compact] ${decision.reason} — run /compact when convenient (interactive session)`,
								);
								return;
							}
							if (state.continuationRounds >= TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS) {
								console.error(
									`unown: [auto-compact] ${decision.reason} — continuation cap reached (${TERMINAL_AUTO_COMPACT_MAX_CONTINUATIONS}); degrading to warn-only`,
								);
								return;
							}
							startCompaction(ctx, state, decision.reason);
							return;
						}
					} catch {
						/* a guard extension must never break the session */
					}
				}) as any);
			},
		},
	};
}

/**
 * Wait (bounded) for an in-flight terminal auto-compact to settle — the
 * print-mode orchestration calls this between runPrintMode rounds so the
 * continuation prompt never races the summarization (pi's session.prompt
 * refuses submissions while compaction is in progress).
 */
export function waitTerminalAutoCompactSettled(
	state: TerminalAutoCompactState,
	timeoutMs = 180_000,
): Promise<void> {
	const startedAt = Date.now();
	return new Promise((resolve) => {
		const poll = () => {
			if (!state.compactInFlight || Date.now() - startedAt >= timeoutMs) {
				resolve();
				return;
			}
			setTimeout(poll, 250);
		};
		poll();
	});
}
