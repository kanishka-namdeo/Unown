/**
 * output-format.ts — `unown -p --output-format json` (Claude Code port).
 *
 * One-shot headless runs today print the final assistant text (`--mode text`)
 * or a JSONL event stream (`--mode json`). CI pipelines, editor integrations
 * and wrapper scripts want a third thing: ONE final JSON object with the
 * result AND the accounting — text, session id, model, token usage, cost,
 * duration, turns — with a stable shape and a documented exit-code contract.
 * That is Claude Code's `claude -p --output-format json` and this is its port.
 *
 * Shape (stable contract — pinned by test/output-format.test.ts):
 *
 *   {
 *     "type": "result",
 *     "subtype": "success" | "error_during_execution",
 *     "result": "<final assistant text, or the error message>",
 *     "session_id": "<session id or null (--no-session)>",
 *     "model": "<model id or null>",
 *     "usage": {
 *       "input_tokens": n, "output_tokens": n,
 *       "cache_read_input_tokens": n, "cache_creation_input_tokens": n
 *     },
 *     "cost_usd": <number | null>,
 *     "duration_ms": n,
 *     "num_turns": n,
 *     "unown_version": "<version>"
 *   }
 *
 * Exit codes are unchanged: 0 success, 1 error/aborted — the JSON object's
 * `subtype` says which, so `unown -p --output-format json | jq -r .result`
 * composes with `set -o pipefail` exactly like the text mode.
 *
 * Implementation, on documented seams only (the standing invariant):
 * a tiny inline extension factory accumulates session id / model / usage /
 * turns from the standard events (session_start, message_end, agent_end);
 * the text channel is captured by wrapping process.stdout.write for the
 * duration of runPrintMode (mode stays "text" — the final-assistant-text
 * extraction is pi's own, including its error/abort handling), then the
 * wrapper is removed and exactly one JSON line is emitted to the real
 * stdout. Nothing else on stdout: preflight errors stay on stderr, exit 1.
 *
 * Purity: node:process only for the wrapper; the assembly and event
 * reduction are pure functions (the tests drive them without a pi runtime).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Mutable accumulator shared between the extension and the CLI. */
export interface OutputCapture {
	sessionId?: string | null;
	model?: string | null;
	numTurns: number;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
	costUsd: number | null;
}

export function createOutputCapture(): OutputCapture {
	return {
		sessionId: null,
		model: null,
		numTurns: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		costUsd: null,
	};
}

/** Fold one assistant-message usage object into the accumulator (pure). */
export function accumulateUsage(capture: OutputCapture, usage: unknown): void {
	const u = usage as
		| { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } }
		| undefined
		| null;
	if (!u || typeof u !== "object") return;
	capture.usage.input += typeof u.input === "number" ? u.input : 0;
	capture.usage.output += typeof u.output === "number" ? u.output : 0;
	capture.usage.cacheRead += typeof u.cacheRead === "number" ? u.cacheRead : 0;
	capture.usage.cacheWrite += typeof u.cacheWrite === "number" ? u.cacheWrite : 0;
	if (u.cost && typeof u.cost.total === "number") {
		capture.costUsd = (capture.costUsd ?? 0) + u.cost.total;
	}
}

/**
 * The inline extension. Loosely typed like the other unown extensions
 * (termhooks.ts) — the pi event payloads are read defensively.
 */
export function createOutputCaptureExtension(capture: OutputCapture) {
	return {
		name: "unown-output-capture",
		hidden: true,
		factory(pi: ExtensionAPI) {
			pi.on("session_start", ((_event: unknown, ctx: any) => {
				try {
					const sm = ctx?.sessionManager ?? ctx?.session?.sessionManager;
					// ReadonlySessionManager's accessor is getSessionId()
					// (core/session-manager.ts:190); currentSessionId is kept as a
					// defensive fallback for older/newer shapes.
					const id = typeof sm?.getSessionId === "function" ? sm.getSessionId() : sm?.currentSessionId;
					capture.sessionId = typeof id === "string" && id ? id : null;
				} catch {
					capture.sessionId = null;
				}
			}) as any);
			pi.on("model_select", ((event: any) => {
				const id = event?.model?.id ?? event?.modelId;
				if (typeof id === "string" && id) capture.model = id;
			}) as any);
			pi.on("message_end", ((event: any) => {
				const msg = event?.message;
				if (!msg || msg.role !== "assistant") return;
				capture.numTurns += 1;
				if (!capture.model && typeof msg.model === "string") capture.model = msg.model;
				accumulateUsage(capture, msg.usage);
			}) as any);
		},
	};
}

/**
 * Assemble the final result object (pure — pinned by tests).
 *
 * `forced_exit` (2026-10-29, the parley round's F3): the print watchdog's
 * boundedness nets (the +15s post-answer hard-exit grace, the 180s stall
 * guard) used to call process.exit() bare — when post-answer teardown hung
 * past the grace, an unattended caller's whole result vanished with the
 * process (measured live: 59-tool-call UI build session, envelope 0 bytes,
 * receipt ended at the drain sentinel). The watchdog now writes a
 * last-resort envelope before those exits; this subtype is its honest label.
 */
export function assembleResultJson(opts: {
	capture: OutputCapture;
	text: string;
	subtype: "success" | "error_during_execution" | "forced_exit";
	durationMs: number;
	version: string;
}): Record<string, unknown> {
	const { capture, text, subtype, durationMs, version } = opts;
	return {
		type: "result",
		subtype,
		result: text,
		session_id: capture.sessionId ?? null,
		model: capture.model ?? null,
		usage: {
			input_tokens: capture.usage.input,
			output_tokens: capture.usage.output,
			cache_read_input_tokens: capture.usage.cacheRead,
			cache_creation_input_tokens: capture.usage.cacheWrite,
		},
		cost_usd: capture.costUsd,
		duration_ms: durationMs,
		num_turns: capture.numTurns,
		unown_version: version,
	};
}

/**
 * Wrap process.stdout.write so text output is captured instead of printed.
 * Returns the unwrap function. Errors in the wrapper never break the run
 * (fail-open to passthrough).
 */
export function captureStdout(): { unwrap: () => string; captured: () => string } {
	let text = "";
	const stream = process.stdout as unknown as { write: (...args: unknown[]) => boolean };
	// Keep the property value itself (NOT a .bind copy) so unwrap restores
	// the exact original function object — identity checks hold.
	const original = stream.write;
	stream.write = ((chunk: unknown, ...rest: unknown[]) => {
		if (typeof chunk === "string") {
			text += chunk;
			// Preserve callback invocation for waiters (drain listeners pass functions).
			const cb = rest.find((r) => typeof r === "function") as (() => void) | undefined;
			if (cb) cb();
			return true;
		}
		return original.apply(stream, [chunk, ...rest] as unknown as []);
	}) as any;
	return {
		captured: () => text,
		unwrap: () => {
			stream.write = original as any;
			return text;
		},
	};
}

/**
 * F35 (the delegation round, measured live 2026-10-30): when an async fleet
 * child's result is delivered AFTER the main print loop settled, the
 * answering turn runs — the session records the final synthesis — but pi's
 * text channel never prints it (the "final assistant text extraction" is
 * pi's own, performed once at the main loop's end). The captured stdout
 * then holds the INTERIM answer ("I'll report the number when it lands")
 * and the envelope ships stale text while the session's last message
 * carries the real answer.
 *
 * The envelope's contract is the FINAL assistant text, so the answer
 * watch's last completed assistant message wins when it is newer than what
 * the text channel captured. Error paths keep the captured text (pi's
 * error/abort handling prints there); an equal or empty watcher text
 * changes nothing.
 */
export function preferFinalAssistantText(
	capturedText: string,
	lastCompletedText: string | undefined | null,
	exitCode: number,
): string {
	const final = (lastCompletedText ?? "").trim();
	if (exitCode !== 0) return capturedText;
	if (!final || final === capturedText) return capturedText;
	return final;
}
