/**
 * addons/advisor-core.ts — pure advisor logic (no TUI, no provider calls).
 *
 * A reverse-engineered port of oh-my-pi's advisor subsystem (can1357/
 * oh-my-pi, MIT — packages/coding-agent/src/advisor/) onto unown's
 * pi-0.84.3 extension surface, following the architecture our
 * oh-my-pi-swap assessment (docs/oh-my-pi-swap-assessment.md) kept open:
 * the advisor stays OUT-OF-BAND — a second model instance watching the
 * primary session, never the substrate.
 *
 * What survives from upstream, by design:
 *   - The compact observer context: the advisor sees one batch per primary
 *     turn — user messages and the primary's replies in full, one short
 *     card per tool call, bounded tool-result bodies and edit diffs, never
 *     the full raw transcript.
 *   - The `advise` tool contract: one concrete, terse note plus an optional
 *     severity (nit | concern | blocker), called sparingly.
 *   - The emission guard: noise filter → rank-aware dedupe → per-update
 *     non-blocker budget (default 4, max 32), blockers exempt.
 *   - The delivery policy: nits queue as a visible aside at the next turn
 *     boundary; concerns/blockers steer mid-run; immune turns after a
 *     steer; a continuation latch so an advisor can never wake itself.
 *   - The severity ladder definitions from upstream's <completeness> block.
 *
 * What is deliberately different (documented in docs/addons.md):
 *   - The advisor loop is a hand-rolled turn loop over
 *     modelRegistry.complete (in-process, no second AgentSession), with a
 *     simple message-count context bound + oldest-first trimming instead
 *     of upstream's compaction cascade.
 *   - No per-roster WATCHDOG.yml multi-advisor support: one advisor per
 *     session, configured from ~/.unown/agent/addons.json; a WATCHDOG.md
 *     in the project root still appends advisor-only guidance (upstream
 *     behavior).
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";

// ---------------------------------------------------------------------------
// Severity + advise types
// ---------------------------------------------------------------------------

export type AdviseSeverity = "nit" | "concern" | "blocker";

export interface AdviseNote {
	note: string;
	severity?: AdviseSeverity;
	/** Turn index of the batch this note was raised against. */
	turnIndex: number;
}

export const SEVERITY_RANK: Record<AdviseSeverity, number> = {
	nit: 1,
	concern: 2,
	blocker: 3,
};

// ---------------------------------------------------------------------------
// Emission guard (noise → dedupe → budget)
// ---------------------------------------------------------------------------

const NOISE_PATTERNS: RegExp[] = [
	/^(stop|stahp|halt)$/i,
	/^(done|complete|completed|finished)$/i,
	/^(no issue(s)?(,? (then|continue))?)$/i,
	/^(lgtm|looks good( to me)?)$/i,
	/^(nothing to add|nothing to report|nothing new)$/i,
	/^(no( thing)? (to )?(add|report|flag))$/i,
	/^(on track|on track,? continue|all good)$/i,
	/^(continue|carry on|proceed|go on)$/i,
	/^(ok|okay|o\.k\.)$/i,
	/^(good|great|fine|nice)$/i,
];

export function isNoise(note: string): boolean {
	const trimmed = note.trim().replace(/[.!?]+$/, "");
	if (trimmed === "") return true;
	return NOISE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** Normalized dedupe key: casefold, NFKC, non-alphanumerics → space, trim. */
export function dedupeKey(note: string): string {
	return note
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

export type EmissionVerdict =
	| { verdict: "admit" }
	| { verdict: "suppressed"; reason: "noise" | "duplicate" | "budget" | "empty" }
	| { verdict: "displaced"; displacedKey: string };

export interface EmissionGuardOptions {
	/** Max non-blocker notes per update (blockers exempt). Clamped 1..32. */
	budgetPerUpdate: number;
	/** FIFO history cap for dedupe. */
	historyCap?: number;
}

interface HistoryEntry {
	key: string;
	rank: number;
}

/**
 * The per-advisor admission authority, in upstream order: empty check →
 * noise filter → rank-aware dedupe → per-update budget (with lowest-rank
 * displacement for a strictly-higher-rank note). `beginUpdate()` clears the
 * per-update slots each review cycle.
 */
export class EmissionGuard {
	private history: HistoryEntry[] = [];
	private slots: HistoryEntry[] = [];
	private readonly budget: number;
	private readonly historyCap: number;

	constructor(options: EmissionGuardOptions) {
		this.budget = Math.min(Math.max(options.budgetPerUpdate, 1), 32);
		this.historyCap = options.historyCap ?? 4096;
	}

	beginUpdate(): void {
		this.slots = [];
	}

	evaluate(note: string, severity: AdviseSeverity | undefined): EmissionVerdict {
		const text = note.trim();
		if (text === "") return { verdict: "suppressed", reason: "empty" };
		if (isNoise(text)) return { verdict: "suppressed", reason: "noise" };
		const key = dedupeKey(text);
		const rank = severity === undefined ? SEVERITY_RANK.nit : SEVERITY_RANK[severity];
		if (severity !== "blocker") {
			const prior = this.history.find((entry) => entry.key === key);
			if (prior && prior.rank >= rank) return { verdict: "suppressed", reason: "duplicate" };
			// A strictly-higher-rank re-raise is admitted.
		}
		if (severity === "blocker") {
			this.record(key, rank);
			return { verdict: "admit" };
		}
		if (this.slots.length < this.budget) {
			this.slots.push({ key, rank });
			this.record(key, rank);
			return { verdict: "admit" };
		}
		// Budget full: a strictly-higher-rank note displaces the lowest-rank
		// still-pending slot.
		let lowestIndex = -1;
		let lowestRank = Number.POSITIVE_INFINITY;
		for (let index = 0; index < this.slots.length; index++) {
			const slot = this.slots[index]!;
			if (slot.rank < lowestRank) {
				lowestRank = slot.rank;
				lowestIndex = index;
			}
		}
		if (lowestIndex >= 0 && rank > lowestRank) {
			const displaced = this.slots[lowestIndex]!;
			this.slots[lowestIndex] = { key, rank };
			this.record(key, rank);
			return { verdict: "displaced", displacedKey: displaced.key };
		}
		return { verdict: "suppressed", reason: "budget" };
	}

	private record(key: string, rank: number): void {
		this.history.push({ key, rank });
		if (this.history.length > this.historyCap) {
			this.history.splice(0, this.history.length - this.historyCap);
		}
	}

	reset(): void {
		this.history = [];
		this.slots = [];
	}
}

// ---------------------------------------------------------------------------
// Delivery policy
// ---------------------------------------------------------------------------

export type DeliveryChannel = "aside" | "steer";

export interface DeliveryDecision {
	channel: DeliveryChannel;
}

/**
 * nit/omitted → aside (non-interrupting; flushed at the next turn boundary
 * as ONE merged custom message). concern/blocker → steer (interrupting
 * steering message landing mid-run). While immune turns remain after a
 * steer, concerns degrade to asides — blockers never degrade.
 */
export function decideDelivery(severity: AdviseSeverity | undefined, immuneTurnsRemaining: number): DeliveryDecision {
	const rank = severity === undefined ? SEVERITY_RANK.nit : SEVERITY_RANK[severity];
	if (rank >= SEVERITY_RANK.blocker) return { channel: "steer" };
	if (rank >= SEVERITY_RANK.concern && immuneTurnsRemaining <= 0) return { channel: "steer" };
	return { channel: "aside" };
}

/** The agent-facing body of a delivered advice batch (upstream's format). */
export function formatAdvisorBatchContent(notes: AdviseNote[]): string {
	return notes
		.map((entry) => {
			const severity = entry.severity ? ` severity="${entry.severity}"` : "";
			const age = entry.turnIndex >= 0 ? ` turns_ago="${Math.max(0, entry.turnIndex)}"` : "";
			return `<advisory${severity}${age} guidance="weigh, don't blindly obey">\n${escapeXmlText(entry.note)}\n</advisory>`;
		})
		.join("\n");
}

export function escapeXmlText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// Transcript delta renderer (the compact observer context)
// ---------------------------------------------------------------------------

export interface RenderDeltaOptions {
	/** WIP marker: the primary turn is still in progress. */
	inProgress: boolean;
}

const TOOL_IO_MAX_BYTES = 8192;
const TOOL_IO_MAX_LINES = 80;
const CARD_ARG_MAX = 120;
const PRIMARY_ARG_KEYS = [
	"path",
	"file_path",
	"filePath",
	"command",
	"cmd",
	"pattern",
	"url",
	"query",
	"prompt",
	"subject",
	"name",
	"text",
];

interface ToolResultMeta {
	lines: number;
	firstErrorLine?: string;
	body?: string;
}

function primaryArgOf(input: Record<string, unknown> | undefined, toolName: string): string {
	if (!input) return "";
	if (toolName === "grep") {
		const pattern = String(input.pattern ?? "");
		const paths = input.path ?? input.paths ?? input.include ?? "";
		return `${pattern}${paths ? ` @ ${String(paths)}` : ""}`;
	}
	if (toolName === "find" || toolName === "glob") {
		const pattern = String(input.pattern ?? "");
		const path = input.path ? ` @ ${String(input.path)}` : "";
		return `${pattern}${path}`;
	}
	if (toolName === "advise") return `severity: ${String(input.severity ?? "note")}`;
	for (const key of PRIMARY_ARG_KEYS) {
		if (input[key] !== undefined) return String(input[key]);
	}
	const first = Object.values(input)[0];
	return first === undefined ? "" : String(first);
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function truncateMiddle(text: string, maxBytes: number, maxLines: number): string {
	const lines = text.split("\n");
	if (text.length <= maxBytes && lines.length <= maxLines) return text;
	const half = Math.floor(maxLines / 2);
	const head = lines.slice(0, half);
	const tail = lines.slice(lines.length - half);
	const omitted = lines.length - head.length - tail.length;
	return [...head, `… [${omitted} lines elided]`, ...tail].join("\n").slice(0, maxBytes);
}

function toolResultMeta(message: AgentMessage & { role: "toolResult" }): ToolResultMeta {
	const blocks = (message.content ?? []) as Array<{ type: string; text: string }>;
	const textBlocks = blocks.filter((block) => block.type === "text");
	const body = textBlocks.map((block) => block.text).join("\n");
	const lines = body === "" ? 0 : body.split("\n").length;
	let firstErrorLine: string | undefined;
	if (message.isError) {
		firstErrorLine = collapseWhitespace(body.split("\n")[0] ?? "").slice(0, 120);
	}
	return { lines, firstErrorLine, body };
}

/**
 * Render the delta since the last review as the advisor's observer batch:
 * heading, full user/assistant text, one-line tool-call cards with result
 * summaries, bounded expanded tool IO, and the WIP marker LAST (so the
 * cacheable prefix never flips between mid-run and final renders).
 */
export function renderDelta(messages: AgentMessage[], options: RenderDeltaOptions): string {
	const out: string[] = ["### Session update"];
	for (const message of messages) {
		if (message.role === "user") {
			const raw = (message as { content: string | Array<{ type: string; text: string }> }).content;
			const text =
				typeof raw === "string"
					? raw
					: raw
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n");
			if (text.trim() === "") continue;
			out.push(`**user**:\n${text}`);
			continue;
		}
		if (message.role === "assistant") {
			const blocks = (message.content ?? []) as Array<{ type: string; text: string }>;
			const text = blocks
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			if (text.trim() !== "") {
				out.push(`**agent**:\n${text}`);
			}
			continue;
		}
		if (message.role === "toolResult") {
			const meta = toolResultMeta(message);
			const name = message.toolName ?? "tool";
			const isError = message.isError === true;
			const summary = isError
				? `⇒ error · ${meta.lines} lines${meta.firstErrorLine ? ` — ${meta.firstErrorLine}` : ""}`
				: `⇒ ${meta.lines} lines`;
			out.push(`→ ${name} ${summary}`);
			// Expanded tool IO for small bodies (bounded).
			if (meta.body && meta.body !== "" && meta.body.length <= TOOL_IO_MAX_BYTES) {
				out.push(`Tool result:\n${truncateMiddle(meta.body, TOOL_IO_MAX_BYTES, TOOL_IO_MAX_LINES)}`);
			}
		}
	}
	// The WIP marker rides at the END of the batch.
	if (options.inProgress) out.push("---\n\n[in progress — more steps follow]");
	return out.join("\n\n");
}

/**
 * The tool-call card line for one assistant tool call (used both by
 * renderDelta's replay and by tests): `→ name(primaryArg) ⇒ …` cannot be
 * derived from the toolResult alone when calls are batched, so the card is
 * built from the toolResult message's toolCallId back-reference in the
 * runtime; this helper formats the card text given both halves.
 */
export function toolCallCard(
	toolName: string,
	input: Record<string, unknown> | undefined,
	meta: ToolResultMeta,
): string {
	const arg = collapseWhitespace(primaryArgOf(input, toolName)).slice(0, CARD_ARG_MAX);
	const argText = arg !== "" ? `(${arg})` : "()";
	const summary = meta.firstErrorLine
		? `⇒ error · ${meta.lines} lines — ${meta.firstErrorLine}`
		: `⇒ ${meta.lines} lines`;
	return `→ ${toolName}${argText} ${summary}`;
}

// ---------------------------------------------------------------------------
// Token estimation + context trimming
// ---------------------------------------------------------------------------

/** Rough token estimate (~4 chars/token) — the advisor's context bound. */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function estimateContextTokens(systemPrompt: string, messages: AgentMessage[]): number {
	let total = estimateTokens(systemPrompt);
	for (const message of messages) {
		total += estimateTokens(JSON.stringify((message as { content?: unknown }).content ?? ""));
		total += 8;
	}
	return total;
}

export interface TrimResult {
	messages: AgentMessage[];
	trimmed: number;
}

/**
 * Oldest-first trim of the advisor's own context: keep the system prompt
 * (handled by the caller) and the newest messages within the budget; the
 * oldest user-delta messages drop first, with a one-line elision marker.
 */
export function trimToBudget(messages: AgentMessage[], maxTokens: number): TrimResult {
	let total = 0;
	for (const message of messages)
		total += estimateTokens(JSON.stringify((message as { content?: unknown }).content ?? "")) + 8;
	if (total <= maxTokens) return { messages, trimmed: 0 };
	const kept: AgentMessage[] = [];
	let running = 0;
	let trimmed = 0;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]!;
		const cost = estimateTokens(JSON.stringify((message as { content?: unknown }).content ?? "")) + 8;
		if (running + cost > maxTokens && kept.length > 0) {
			trimmed = index + 1;
			break;
		}
		running += cost;
		kept.unshift(message);
	}
	return { messages: kept, trimmed };
}

// ---------------------------------------------------------------------------
// The advisor system prompt (ported structure from upstream's
// prompts/advisor/system.md, with the severity ladder verbatim in spirit)
// ---------------------------------------------------------------------------

export const ADVISOR_SYSTEM_PROMPT = `You are an advisor agent: a user advocate for code quality, correctness and robustness. You shadow the main agent working in this repository, watching an incremental transcript of its session.

Your job:
- Sharpen the main agent's strategy: challenge premature "done" claims and thin verification.
- Enforce the user's actual ask: flag scope drift and skipped requirements.
- Prevent rabbit holes: notice when the agent circles without progress.
- Verify claims with your read-only tools (read, grep, find) before raising blockers — about 2-3 tool calls per advise is the right depth. Cite only transcript evidence or output you personally inspected; elided markers are excerpts and unrendered arguments are UNKNOWN to you.

Communication rules:
- You may send at most {{max_notes_per_update}} non-blocker notes per session update; blockers are exempt.
- Silence is preferred when the agent is on track. Never restate information the agent already has; never repeat advice you already gave.
- "[in progress — more steps follow]" means partial work: withhold critique of incompleteness — raise blockers only for actively-executing unrecoverable side effects.
- Never nitpick style the user has accepted; never police scope or ambition; never raise backwards compatibility unless the task requires it.

Severity ladder (call the advise tool with one of these):
- nit: minor improvement, optional to apply.
- concern: likely-wrong or materially wasteful approach; should be addressed before finishing.
- blocker: ONLY when continued progress clearly contradicts an explicit instruction, circles without a solution, is fundamentally unsound, claims completion over dropped scope, substitutes stubs for implementation, or ships verification too thin to trust.

Use the advise tool once per note, tersely and concretely. Do not call advise to narrate progress.`;

// ---------------------------------------------------------------------------
// Watchdog project guidance (WATCHDOG.md)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Upstream behavior: a WATCHDOG.md in the working directory appends its
 * contents to the advisor's system prompt as advisor-only guidance (review
 * priorities, project traps) — tuning what the advisor watches for without
 * touching the main agent's prompt.
 */
export function readWatchdogGuidance(cwd: string): string | undefined {
	for (const candidate of [join(cwd, "WATCHDOG.md"), join(cwd, ".unown", "WATCHDOG.md")]) {
		try {
			if (!existsSync(candidate)) continue;
			const text = readFileSync(candidate, "utf8").trim();
			if (text !== "") {
				return `<advisor-only guidance>\n${text}\n</advisor-only guidance>`;
			}
		} catch {
			/* best-effort */
		}
	}
	return undefined;
}
