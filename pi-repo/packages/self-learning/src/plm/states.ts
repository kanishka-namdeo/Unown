/**
 * plm/states.ts — the process lifecycle state machine (pure core).
 *
 * The PLM round (2026-10-30, docs/plm-round-session.md): every significant
 * activity the engine performs becomes a first-class TRACKED PROCESS with an
 * explicit state machine — no activity happens outside the registry, no
 * state changes without a recorded transition.
 *
 * Design (docs/plm-competitor-research.md):
 *   - a small CLOSED status set with mutually exclusive terminals — the
 *     Temporal.io discipline (open/closed with exactly one absorbing state);
 *   - transitions are EVENTS, not mutations — every edge writes a
 *     process_events row (append-only history, never updated in place);
 *   - WAITING is first-class (waiting on a human/external gate — the
 *     OpenHands WAITING_FOR_CONFIRMATION / LangGraph interrupt() lesson);
 *   - RETRYING is an explicit non-terminal (an attempt in flight after a
 *     failure — the recovery engine drives it, never a blind retry);
 *   - VALIDATING gates SUCCEEDED (the harness's own verify-before-ship rule,
 *     generalized to every process).
 *
 * Pure module: no pi imports, no fs, no store — the registry layer
 * (process-registry.ts) owns persistence, this file owns the math.
 */

export const PROCESS_STATES = [
	"CREATED",
	"PLANNED",
	"QUEUED",
	"RUNNING",
	"WAITING",
	"BLOCKED",
	"RETRYING",
	"VALIDATING",
	"SUCCEEDED",
	"FAILED",
	"ABANDONED",
	"ARCHIVED",
] as const;

export type ProcessState = (typeof PROCESS_STATES)[number];

/** States from which no further work transitions exist (history only). */
export const TERMINAL_STATES: ReadonlySet<ProcessState> = new Set(["SUCCEEDED", "FAILED", "ABANDONED"]);

/** The absorbing state — nothing leaves ARCHIVED. */
export const ARCHIVED: ProcessState = "ARCHIVED";

/**
 * The transition table. Rows are the FROM state, values the allowed TO
 * states. Every legal edge in one place — the registry validates every
 * requested transition against this map and refuses anything not listed
 * (mission rule: "No process may bypass lifecycle states").
 */
const TRANSITIONS: Readonly<Record<ProcessState, readonly ProcessState[]>> = {
	CREATED: ["PLANNED", "QUEUED", "ABANDONED"],
	PLANNED: ["QUEUED", "RUNNING", "ABANDONED"],
	QUEUED: ["RUNNING", "BLOCKED", "ABANDONED"],
	RUNNING: ["WAITING", "BLOCKED", "RETRYING", "VALIDATING", "SUCCEEDED", "FAILED", "ABANDONED"],
	WAITING: ["RUNNING", "BLOCKED", "RETRYING", "ABANDONED"],
	BLOCKED: ["RUNNING", "RETRYING", "ABANDONED"],
	RETRYING: ["RUNNING", "FAILED", "ABANDONED"],
	VALIDATING: ["SUCCEEDED", "FAILED", "RETRYING"],
	SUCCEEDED: ["ARCHIVED"],
	FAILED: ["ARCHIVED"],
	ABANDONED: ["ARCHIVED"],
	ARCHIVED: [],
};

/** Is `from → to` a legal edge of the state machine? */
export function isLegalTransition(from: ProcessState, to: ProcessState): boolean {
	return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * The terminal outcome a state represents (for counters and the dashboard):
 *   - "open"    — work may still continue (non-terminal, non-waiting)
 *   - "waiting" — parked on a human/external gate
 *   - "blocked" — cannot proceed without intervention
 *   - "ok"      — completed successfully (terminal)
 *   - "ko"      — completed unsuccessfully (terminal)
 *   - "dropped" — deliberately abandoned (terminal)
 *   - "history" — archived (absorbing)
 */
export type ProcessOutcomeClass = "open" | "waiting" | "blocked" | "ok" | "ko" | "dropped" | "history";

export function outcomeClass(state: ProcessState): ProcessOutcomeClass {
	switch (state) {
		case "CREATED":
		case "PLANNED":
		case "QUEUED":
		case "RUNNING":
		case "RETRYING":
		case "VALIDATING":
			return "open";
		case "WAITING":
			return "waiting";
		case "BLOCKED":
			return "blocked";
		case "SUCCEEDED":
			return "ok";
		case "FAILED":
			return "ko";
		case "ABANDONED":
			return "dropped";
		case "ARCHIVED":
			return "history";
	}
}

/** The process kinds the registry tracks (one per engine activity class). */
export const PROCESS_KINDS = [
	"job", // a router job execution (harness-cycle, auto-dream, ...)
	"run", // a sandboxed agent run (baseline | candidate | regression | interactive)
	"cycle", // a self-improvement cycle (mine → patch → validate)
	"dream", // an AutoDream consolidation pass
	"mint", // a task-minting pass
	"automation", // a scheduled routine execution
	"terminal-session", // a human-driven terminal agent session (reported)
	"delegation", // a subagent delegation (sync | fleet)
	"recovery", // a recovery-engine execution
	"plm-internal", // the PLM system's own maintenance (retention, mining)
] as const;

export type ProcessKind = (typeof PROCESS_KINDS)[number];

/**
 * Guard: is a state string one of ours? (External input — HTTP reports,
 * DB rows from older installs — is parsed through this, never trusted.)
 */
export function isProcessState(value: unknown): value is ProcessState {
	return typeof value === "string" && (PROCESS_STATES as readonly string[]).includes(value);
}

export function isProcessKind(value: unknown): value is ProcessKind {
	return typeof value === "string" && (PROCESS_KINDS as readonly string[]).includes(value);
}
