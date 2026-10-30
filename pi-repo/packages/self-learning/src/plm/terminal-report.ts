/**
 * plm/terminal-report.ts — the terminal agent's PLM reporting lane.
 *
 * The detachment contract (docs/detached-engine-architecture.md): the
 * terminal agent NEVER opens the engine's database — the two halves share
 * nothing but files and HTTP. So the terminal side of the PLM round
 * reports its telemetry the same way the delegation round reports
 * delegations: fire-and-forget POST batches with a short timeout, one
 * attempt per batch, never awaited by the caller (the tool-result path
 * must not pay engine latency). A down engine drops the AGGREGATE only —
 * the terminal session transcript stays the local truth, and the next
 * session's reports rebuild the dashboard view going forward.
 *
 * Two surfaces ride this lane:
 *   - tool invocations: every tool_call/tool_result pair becomes a
 *     ToolReportItem (name, purpose line, duration, success, error clip)
 *     batched to POST /api/tools/report;
 *   - the terminal session itself: on shutdown (reason "quit") a
 *     terminal-session process is reported to POST /api/processes/report
 *     (objective, prompts/tool counts, duration, outcome) so the engine's
 *     Process View covers human-driven work, not just engine work.
 *
 * Env: UNOWN_PLM=0 kills this lane together with the whole PLM round.
 */

import { engineFetch } from "../engine-auth.ts";
import { ENGINE_URL } from "../term.ts";
import { plmEnabled } from "./process-registry.ts";

// ---------------------------------------------------------------------------
// The tool invocation buffer
// ---------------------------------------------------------------------------

export interface PendingToolCall {
	tool: string;
	startedAt: number;
	purpose: string | null;
}

const TOOL_REPORT_BATCH_CAP = 200;
const PENDING_ITEMS: Array<Record<string, unknown>> = [];
let reportInFlight = false;

/** The in-flight tool calls of the CURRENT terminal session (id → start). */
const activeCalls = new Map<string, PendingToolCall>();

/**
 * Begin tracking a tool call (the PreToolUse lane). Keyed by the pi event's
 * tool call id when present, else the tool name (the same fallback the
 * engine's live-run registry uses).
 */
export function beginTerminalToolCall(key: string, tool: string, argsSummary: string | null): void {
	if (!plmEnabled()) return;
	if (activeCalls.size > 64) activeCalls.clear(); // unbounded-growth guard (a runaway loop)
	activeCalls.set(key, { tool, startedAt: Date.now(), purpose: argsSummary });
}

/**
 * Complete a tracked tool call → queue the report item. `success` and the
 * error clip come from the tool_result event. Returns the duration (ms) so
 * in-session surfaces can show it without a second clock.
 */
export function endTerminalToolCall(
	key: string,
	tool: string,
	success: boolean,
	errorText: string | null,
	outputBytes: number | null = null,
): number | null {
	if (!plmEnabled()) return null;
	const pending = activeCalls.get(key);
	activeCalls.delete(key);
	const durationMs = pending ? Math.max(0, Date.now() - pending.startedAt) : null;
	PENDING_ITEMS.push({
		tool,
		ts: Date.now(),
		purpose: pending?.purpose ?? null,
		durationMs,
		success,
		retryCount: 0,
		error: errorText ? String(errorText).slice(0, 200) : null,
		outputBytes,
	});
	if (PENDING_ITEMS.length >= TOOL_REPORT_BATCH_CAP) void flushToolReports();
	return durationMs;
}

// ---------------------------------------------------------------------------
// The engine POST (fire-and-forget, the delegation-report contract)
// ---------------------------------------------------------------------------

export async function flushToolReports(sessionId?: string | null, projectSlug?: string | null): Promise<boolean> {
	if (!plmEnabled() || PENDING_ITEMS.length === 0) return true;
	const batch = PENDING_ITEMS.splice(0, PENDING_ITEMS.length);
	if (reportInFlight) {
		// A batch is already on the wire — re-queue this one behind it; the
		// in-flight flush's finally picks it up (same chain as delegations).
		PENDING_REPORTS_QUEUE.push(...batch);
		return false;
	}
	reportInFlight = true;
	try {
		await engineFetch(`${ENGINE_URL}/api/tools/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				schema: 1,
				items: batch,
				sessionId: sessionId ?? null,
				projectSlug: projectSlug ?? null,
			}),
			signal: AbortSignal.timeout(1500),
		});
		return true;
	} catch {
		return false; // best effort — the transcript is the local truth
	} finally {
		reportInFlight = false;
		if (PENDING_REPORTS_QUEUE.length > 0) {
			const queued = PENDING_REPORTS_QUEUE.splice(0, PENDING_REPORTS_QUEUE.length);
			PENDING_ITEMS.push(...queued);
			void flushToolReports(sessionId, projectSlug);
		}
	}
}

const PENDING_REPORTS_QUEUE: Array<Record<string, unknown>> = [];

// ---------------------------------------------------------------------------
// The terminal-session process report
// ---------------------------------------------------------------------------

export interface TerminalSessionReportInput {
	sessionId: string;
	cwd: string;
	projectSlug: string;
	prompts: number;
	toolCalls: number;
	toolErrors: number;
	durationMs: number;
	/** The final outcome line (the session note's own summary). */
	outcome: string;
}

/**
 * Report the terminal session as a process (the Process View's human-work
 * lane). Fire-and-forget like the tool batch — a down engine means the
 * aggregate misses this session, never that the session is disturbed.
 */
export function reportTerminalSession(input: TerminalSessionReportInput): void {
	if (!plmEnabled()) return;
	void (async () => {
		try {
			await engineFetch(`${ENGINE_URL}/api/processes/report`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ schema: 1, session: input }),
				signal: AbortSignal.timeout(1500),
			});
		} catch {
			/* best effort */
		}
	})();
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

export function resetTerminalReportForTest(): void {
	PENDING_ITEMS.length = 0;
	PENDING_REPORTS_QUEUE.length = 0;
	activeCalls.clear();
	reportInFlight = false;
}

/** Diagnostics: the unreported backlog size (the health chip's data). */
export function pendingToolReportCount(): number {
	return PENDING_ITEMS.length + PENDING_REPORTS_QUEUE.length;
}
