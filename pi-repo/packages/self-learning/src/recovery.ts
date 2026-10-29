/**
 * recovery.ts — the recovery surface: what went wrong, and the way back.
 *
 * The observability round (audit flags A3, E6, E7): every failure already
 * names itself where it happens — a tool error line, a deny reason, a
 * dead-letter sidecar — but each scrolls away or hides behind a command,
 * and nothing composes them into "what needs my attention, and what is the
 * fix for each." This module is that composition's pure core:
 *
 *   - classifyToolResult — one place that turns an ended tool call into a
 *     typed recovery event (tool error / verify-test failure / permission
 *     denial), reading the exact markers the producers print
 *     ([unown-permissions], bash-policy "denied", [auto-verify], [auto-test]);
 *   - deriveRecoveryRows — the events, grouped worst-first with their ages
 *     and their FIX PATH per kind (the audit's E6: a failure without its
 *     recovery affordance is a complaint, not a tool);
 *   - renderRecoveryCard — the /recovery surface: counts, recent events,
 *     engine + outbox state, then one fixes line;
 *   - renderHealthChip — the ambient footer chip, non-empty only when
 *     something actually needs attention (a clean session stays quiet).
 *
 * Pure module: no pi imports, no fs. The tools.ts wiring feeds events from
 * tool_execution_end and engine facts from getEngineStatusInfo; subagents
 * never see any of it (display-only surfaces, guarded upstream like every
 * other cosmetic seam).
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type RecoveryEventKind = "tool-error" | "verify-failure" | "denial";

export interface RecoveryEvent {
	kind: RecoveryEventKind;
	/** The tool that produced the result ("bash", "edit", …). */
	tool: string;
	/** One-line reason — the producer's own words, clipped. */
	reason: string;
	ts: number;
}

/** The producer markers (kept in lockstep with permissions.ts, bash-policy.ts, verify.ts). */
const DENIAL_MARKERS = ["[unown-permissions]", "denied by rule", "is denied", "denied at the confirmation prompt"];
const VERIFY_MARKERS = ["[auto-verify]", "[auto-test]"];

const CLIP = 160;

function firstLine(text: string): string {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.slice(0, CLIP);
}

export interface ClassifiedToolResult {
	event: RecoveryEvent | null;
}

/**
 * Classify an ended tool call. isError=false is never an event (a green
 * session stays quiet). Denial beats verify beats plain error — a blocked
 * call is not a failure of the agent, and a verify failure is the gates
 * doing their job; the distinction drives both the confidence signals and
 * the fix path shown next to each row.
 */
export function classifyToolResult(
	toolName: string,
	isError: boolean,
	resultText: string,
	now: number = Date.now(),
): RecoveryEvent | null {
	if (!isError) return null;
	const text = resultText ?? "";
	if (VERIFY_MARKERS.some((m) => text.includes(m))) {
		return { kind: "verify-failure", tool: toolName, reason: firstLine(text), ts: now };
	}
	if (DENIAL_MARKERS.some((m) => text.includes(m))) {
		return { kind: "denial", tool: toolName, reason: firstLine(text), ts: now };
	}
	return { kind: "tool-error", tool: toolName, reason: firstLine(text), ts: now };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface RecoveryEngineFacts {
	/** The six-state machine (unknown/up/starting/down/paused/blocked). */
	state?: string;
	/** Notes queued in the outbox. */
	queued?: number;
	/** Dead-lettered notes (terminal outbox failures). */
	dead?: number;
}

export interface DeriveRecoveryRowsInputs {
	events: RecoveryEvent[];
	engine?: RecoveryEngineFacts;
	/** Injectable clock (tests). */
	now?: number;
}

export interface RecoveryRow {
	/** Worst-first ordering key: 0 = engine/outbox, 1 = verify, 2 = denial, 3 = error. */
	rank: number;
	glyph: string;
	label: string;
	detail: string;
	fix: string;
	ts?: number;
}

const FIX_BY_KIND: Record<RecoveryEventKind, string> = {
	"verify-failure": "/undo n reverts the last n edit turns",
	denial: "the rule source is in the reason (docs/permissions.md)",
	"tool-error": "full output in the transcript (ctrl+o to expand)",
};

function formatAge(ageMs: number): string {
	const s = Math.max(0, Math.floor(ageMs / 1000));
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

const KIND_GLYPH: Record<RecoveryEventKind, string> = {
	"verify-failure": "✗",
	denial: "⏸",
	"tool-error": "✗",
};

const KIND_LABEL: Record<RecoveryEventKind, string> = {
	"verify-failure": "verify failed",
	denial: "blocked",
	"tool-error": "tool error",
};

const KIND_RANK: Record<RecoveryEventKind, number> = {
	"verify-failure": 1,
	denial: 2,
	"tool-error": 3,
};

/**
 * Compose the rows: engine/outbox state first (a down engine outranks any
 * single tool error), then the session's events newest-first within their
 * kind rank. Only the first `maxEvents` (default 6) survive — /recovery is
 * a triage card, not a log (the transcript stays the log, audit IA rule:
 * summaries over token streams).
 */
export function deriveRecoveryRows(inputs: DeriveRecoveryRowsInputs): RecoveryRow[] {
	const now = inputs.now ?? Date.now();
	const rows: RecoveryRow[] = [];
	const engine = inputs.engine ?? {};
	if (engine.state === "down" || engine.state === "blocked" || engine.state === "paused") {
		const why =
			engine.state === "down"
				? "engine down — learning paused"
				: engine.state === "blocked"
					? "engine blocked — auto-start refused"
					: "engine crash-loop paused — learning halted";
		const queued = (engine.queued ?? 0) > 0 ? ` · ${engine.queued} note${engine.queued === 1 ? "" : "s"} queued` : "";
		rows.push({ rank: 0, glyph: "⏸", label: "engine", detail: `${why}${queued}`, fix: "/engine — actions" });
	}
	if ((engine.dead ?? 0) > 0) {
		rows.push({
			rank: 0,
			glyph: "✗",
			label: "dead letters",
			detail: `${engine.dead} note${engine.dead === 1 ? "" : "s"} dead-lettered — never deleted`,
			fix: "$UNOWN_HOME/notes/dead — mv back to retry",
		});
	}
	const events = [...inputs.events].sort((a, b) => b.ts - a.ts).slice(0, 6);
	for (const event of events) {
		rows.push({
			rank: KIND_RANK[event.kind],
			glyph: KIND_GLYPH[event.kind],
			label: KIND_LABEL[event.kind],
			detail: `${event.tool} — ${event.reason}${event.ts ? ` (${formatAge(now - event.ts)})` : ""}`,
			fix: FIX_BY_KIND[event.kind],
			ts: event.ts,
		});
	}
	return rows.sort((a, b) => a.rank - b.rank);
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface RenderRecoveryCardInputs {
	rows: RecoveryRow[];
	/** Counts for the header. */
	totals: { toolErrors: number; verifyFailures: number; denials: number };
}

/**
 * The /recovery card — triage shape: header count, worst-first rows with
 * the fix path under each, then the standing fixes line (the always-true
 * recovery affordances: undo, checkpoints, doctor). An empty rows list is
 * a clean bill: "nothing needs attention" plus the standing line, because
 * /recovery is also where a returning user checks "did anything break".
 */
export function renderRecoveryCard(inputs: RenderRecoveryCardInputs): string {
	const lines: string[] = [];
	if (inputs.rows.length === 0) {
		lines.push("recovery — nothing needs attention");
		lines.push("  ✓ no tool errors · no verify failures · nothing blocked this session");
	} else {
		lines.push(`recovery — ${inputs.rows.length} item${inputs.rows.length === 1 ? "" : "s"} needing attention`);
		for (const row of inputs.rows) {
			lines.push(`  ${row.glyph} ${row.label}: ${row.detail}`);
			lines.push(`    fix: ${row.fix}`);
		}
	}
	const t = inputs.totals;
	lines.push(
		`counts: ${t.toolErrors} error${t.toolErrors === 1 ? "" : "s"} · ${t.verifyFailures} verify fail${t.verifyFailures === 1 ? "" : "s"} · ${t.denials} blocked`,
	);
	lines.push("standing: /undo n (revert) · /checkpoints (restore) · /receipts (audit) · unown doctor (environment)");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The health chip
// ---------------------------------------------------------------------------

/**
 * The ambient footer chip — non-empty ONLY when something needs attention
 * (audit E7: denials leave no ambient trace). `✗ 2 to fix · /recovery` —
 * the count is rows-not-events (engine state counts once), and the command
 * rides the chip so the next action is one keystroke away.
 */
export function renderHealthChip(rows: RecoveryRow[]): string | undefined {
	if (rows.length === 0) return undefined;
	return `✗ ${rows.length} to fix · /recovery`;
}
