/**
 * plm/failure-taxonomy.ts — the failure classification taxonomy (pure core).
 *
 * The mission's recovery sequence is Classification → Root Cause →
 * Recovery Planning → Recovery Execution → Validation → Benchmark Update,
 * and the first step needs a CLOSED vocabulary. This module owns it:
 *
 *   tool          — the tool itself errored (exit code, bad args, parse)
 *   planning      — the plan was wrong before execution started
 *   context       — context lost / overflowed / compacted away
 *   logic         — the agent's own reasoning produced an invalid output
 *   memory        — a memory read/write/regression failure
 *   dependency    — an external dependency failed (network, upstream API, FS)
 *   model         — the model endpoint failed (rate limit, auth, degenerate)
 *   infrastructure — the host/sandbox/process layer failed
 *   workflow      — the orchestration failed (busy mutex, watchdog, dead-letter)
 *
 * `classifyFailure` maps an arbitrary error string onto the taxonomy with
 * deterministic marker matching (the recovery.ts discipline: read the
 * producers' OWN markers, never invent). `rootCauseHint` derives the
 * root-cause line and `recoveryActionFor` the planned action — the same
 * table drives the recovery engine so classification and planning can never
 * drift apart.
 *
 * Pure module: no pi imports, no fs, no store.
 */

export const FAILURE_CATEGORIES = [
	"tool",
	"planning",
	"context",
	"logic",
	"memory",
	"dependency",
	"model",
	"infrastructure",
	"workflow",
] as const;

export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

export function isFailureCategory(value: unknown): value is FailureCategory {
	return typeof value === "string" && (FAILURE_CATEGORIES as readonly string[]).includes(value);
}

// Deterministic markers, most-specific first (the first match wins).
const MARKERS: ReadonlyArray<{ category: FailureCategory; patterns: readonly string[] }> = [
	{
		category: "model",
		patterns: [
			"rate limit",
			"429",
			"quota",
			"401",
			"403",
			"unauthorized",
			"api key",
			"degenerate",
			"empty completion",
			"model unavailable",
			"context length",
			"maximum context",
			"insufficient_quota",
			"finish_reason",
		],
	},
	{
		category: "infrastructure",
		patterns: [
			"watchdog",
			"timed out",
			"timeout",
			"eacces",
			"eperm",
			"enospc",
			"spawn",
			"enoent",
			"econnrefused",
			"econnreset",
			"enotfound",
			"port",
			"oom",
			"killed",
			"sandbox",
			"bwrap",
			"seatbelt",
		],
	},
	{
		category: "dependency",
		patterns: [
			"econnaborted",
			"socket hang up",
			"fetch failed",
			"network",
			"dns",
			"tls",
			"certificate",
			"upstream",
			"502",
			"503",
			"504",
			"robots",
			"blocked by",
			"captcha",
		],
	},
	{
		category: "context",
		patterns: ["compact", "condens", "context window", "context exceeded", "truncat", "token budget", "max tokens"],
	},
	{
		category: "memory",
		patterns: [
			"memory version",
			"rollback",
			"un-ship",
			"unshipped",
			"regression sweep",
			"mem0",
			"dream rollback",
			"canary",
		],
	},
	{
		category: "workflow",
		patterns: [
			"router is busy",
			"router is draining",
			"dead-letter",
			"dead letter",
			"outbox",
			"busy mutex",
			"engine is busy",
			"409",
			"conflict",
			"zombie",
			"orphan",
		],
	},
	{
		category: "logic",
		patterns: [
			"schema",
			"invalid json",
			"parse error",
			"syntaxerror",
			"assert",
			"expected",
			"mismatch",
			"validation failed",
			"verify failed",
			"failed to parse",
		],
	},
	{
		category: "planning",
		patterns: ["no such task", "unknown job", "not found", "missing file", "no plan", "unresolved"],
	},
];

/** Classify a failure from its error text (+ optional tool hint). */
export function classifyFailure(errorText: string, tool?: string): FailureCategory {
	const text = (errorText ?? "").toLowerCase();
	for (const entry of MARKERS) {
		for (const pattern of entry.patterns) {
			if (text.includes(pattern)) return entry.category;
		}
	}
	// Tool hint: a failed exec-shaped tool with no markers is a tool failure;
	// everything else defaults to infrastructure (the conservative bucket —
	// it means "the environment, not the agent, needs a look").
	if (tool === "bash" || tool === "powershell") return "tool";
	return "infrastructure";
}

/** Is a retry plausibly useful for this category? (drives recovery planning) */
export function isRetryable(category: FailureCategory): boolean {
	switch (category) {
		case "dependency":
		case "model":
		case "infrastructure":
		case "workflow":
			return true;
		case "tool":
			// A tool error is retryable only sometimes (bad args are not); the
			// planner marks these "retry once with backoff, then escalate".
			return true;
		case "context":
		case "memory":
			// Both need a CHANGE (compact / rollback), not a repeat.
			return false;
		case "planning":
		case "logic":
			return false;
	}
}

export type RecoveryAction =
	| "retry"
	| "backoff-retry"
	| "re-plan"
	| "re-run"
	| "escalate-human"
	| "rollback"
	| "monitor"
	| "ignore";

/** The default planned action per category (the planner may override). */
export function recoveryActionFor(category: FailureCategory): RecoveryAction {
	switch (category) {
		case "tool":
			return "retry";
		case "planning":
			return "re-plan";
		case "context":
			return "re-plan";
		case "logic":
			return "re-run";
		case "memory":
			return "rollback";
		case "dependency":
			return "backoff-retry";
		case "model":
			return "backoff-retry";
		case "infrastructure":
			return "monitor";
		case "workflow":
			return "retry";
	}
}

/** The root-cause hint line for a category (deterministic, no LLM). */
export function rootCauseHint(category: FailureCategory): string {
	switch (category) {
		case "tool":
			return "tool errored on its own contract (args/exit/parse) — inspect the invocation transcript";
		case "planning":
			return "the plan referenced something that does not exist — re-plan against the current state";
		case "context":
			return "context was lost or exceeded — compact/restate before retrying, a blind repeat fails the same way";
		case "logic":
			return "the agent's output failed its own verification — re-run with the failure fed back";
		case "memory":
			return "a memory-layer operation failed or a shipped patch regressed — rollback to the last good version";
		case "dependency":
			return "an external dependency failed — retry with backoff after the dependency recovers";
		case "model":
			return "the model endpoint failed (rate/auth/degenerate) — backoff-retry or rotate provider";
		case "infrastructure":
			return "the host/sandbox layer failed — monitor and heal (watchdog/repair) before retrying";
		case "workflow":
			return "orchestration conflict (busy/timeout/dead-letter) — re-queue the work";
	}
}
