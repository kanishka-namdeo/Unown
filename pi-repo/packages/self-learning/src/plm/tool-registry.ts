/**
 * plm/tool-registry.ts — Tool Lifecycle Management (mission core).
 *
 * Every tool invocation becomes a governed execution: a `tool_invocations`
 * row with name, category, purpose, duration, success, retry count, failure
 * class and owning process — recorded engine-side (runner.ts subscribes to
 * the session's tool_execution_start/end) and reported terminal-side
 * (termhooks batches rows to POST /api/tools/report, the delegation.ts
 * fire-and-forget pattern — a missed report is a dashboard gap, never data
 * loss; the terminal session transcript stays the local truth).
 *
 * Field names align with the OpenTelemetry GenAI semantic conventions
 * (gen_ai.tool.name / gen_ai.tool.call.id / error.type / duration) so an
 * exporter later maps 1:1 — see docs/plm-competitor-research.md.
 *
 * Aggregations (OTel metric shapes, computed from the ledger):
 *   - per-tool reliability: invocations, success rate, avg/p95 duration,
 *     retry count, failure-class breakdown;
 *   - rankings + recommendations: underperforming-tool detection (success
 *     rate below floor with enough samples; latency outliers; retry-heavy
 *     tools) each with a concrete recommendation line.
 *
 * Pure derivation (deriveToolStats / deriveToolRecommendations) is separate
 * from the store-backed recording so tests pin the math without a DB.
 */

import { emit } from "../bus.ts";
import { store } from "../store.ts";
import { classifyFailure, type FailureCategory } from "./failure-taxonomy.ts";
import { plmEnabled } from "./process-registry.ts";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type ToolCategory = "read" | "write" | "exec" | "search" | "net" | "agent" | "learn" | "gov" | "other";

const CATEGORY_BY_TOOL: Record<string, ToolCategory> = {
	read: "read",
	ls: "read",
	find: "search",
	grep: "search",
	glob: "search",
	edit: "write",
	write: "write",
	bash: "exec",
	powershell: "exec",
	task: "agent",
	task_control: "agent",
	todo: "agent",
	ask_user_question: "gov",
	note: "learn",
	web_search: "net",
	webfetch: "net",
	fetch_url: "net",
	browser: "net",
	lsp: "other",
	view_image: "read",
	get_context_remaining: "read",
	routine_list: "learn",
	routine_create: "learn",
	routine_update: "learn",
	routine_run: "learn",
	routine_delete: "learn",
};

export function toolCategory(tool: string): ToolCategory {
	return CATEGORY_BY_TOOL[tool] ?? "other";
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface RecordToolInvocationInput {
	lane?: "engine" | "terminal";
	tool: string;
	processId?: string | null;
	runId?: string | null;
	sessionId?: string | null;
	projectSlug?: string | null;
	/** A clipped one-line purpose derived from the arguments (never raw args). */
	purpose?: string | null;
	durationMs?: number | null;
	success: boolean;
	retryCount?: number;
	error?: string | null;
	argsBytes?: number | null;
	outputBytes?: number | null;
}

export interface ToolInvocationRow {
	id: number;
	ts: number;
	lane: string;
	process_id: string | null;
	run_id: string | null;
	session_id: string | null;
	project_slug: string | null;
	tool: string;
	category: string | null;
	purpose: string | null;
	duration_ms: number | null;
	success: number;
	retry_count: number;
	failure_type: string | null;
	error: string | null;
	args_bytes: number | null;
	output_bytes: number | null;
}

const CLIP = 240;

function clip(text: string | null | undefined): string | null {
	if (text === null || text === undefined) return null;
	const clean = String(text).replace(/\s+/g, " ").trim();
	return clean.length === 0 ? null : clean.slice(0, CLIP);
}

/**
 * Record one completed tool invocation. Returns the row id (0 when PLM is
 * disabled or the write fails — telemetry never breaks the caller).
 */
export function recordToolInvocation(input: RecordToolInvocationInput): number {
	if (!plmEnabled()) return 0;
	const failureType: FailureCategory | null = input.success ? null : classifyFailure(input.error ?? "", input.tool);
	try {
		const info = store.run(
			`INSERT INTO tool_invocations
				(ts, lane, process_id, run_id, session_id, project_slug, tool, category, purpose, duration_ms, success, retry_count, failure_type, error, args_bytes, output_bytes)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				Date.now(),
				input.lane ?? "engine",
				input.processId ?? null,
				input.runId ?? null,
				input.sessionId ?? null,
				input.projectSlug ?? null,
				input.tool,
				toolCategory(input.tool),
				clip(input.purpose),
				input.durationMs ?? null,
				input.success ? 1 : 0,
				input.retryCount ?? 0,
				failureType,
				clip(input.error),
				input.argsBytes ?? null,
				input.outputBytes ?? null,
			],
		);
		emit("tool:invocation", {
			tool: input.tool,
			lane: input.lane ?? "engine",
			success: input.success,
			durationMs: input.durationMs ?? null,
			failureType,
		});
		return Number(info.lastInsertRowid ?? 0);
	} catch (err: unknown) {
		console.warn(`[plm] tool invocation write failed: ${err instanceof Error ? err.message : String(err)}`);
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Aggregation (pure derivation over rows)
// ---------------------------------------------------------------------------

export interface ToolStats {
	tool: string;
	category: string | null;
	invocations: number;
	successes: number;
	failures: number;
	successRate: number;
	avgDurationMs: number | null;
	p95DurationMs: number | null;
	retries: number;
	failureClasses: Array<{ type: string; count: number }>;
	lastSeenTs: number | null;
	/** Terminal + engine lanes split (admission-lane visibility). */
	lanes: { engine: number; terminal: number };
}

export interface ToolStatsInput {
	tool: string;
	category: string | null;
	rows: Array<{
		success: number;
		duration_ms: number | null;
		retry_count: number;
		failure_type: string | null;
		ts: number;
		lane: string;
	}>;
}

export function deriveToolStats(input: ToolStatsInput): ToolStats {
	const rows = input.rows;
	const total = rows.length;
	const successes = rows.filter((r) => r.success === 1).length;
	const failures = total - successes;
	const durations = rows.map((r) => r.duration_ms).filter((d): d is number => typeof d === "number" && d >= 0);
	durations.sort((a, b) => a - b);
	const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
	const p95 =
		durations.length > 0 ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] : null;
	const failureMap = new Map<string, number>();
	for (const r of rows) {
		if (r.success !== 1 && r.failure_type) failureMap.set(r.failure_type, (failureMap.get(r.failure_type) ?? 0) + 1);
	}
	const lanes = {
		engine: rows.filter((r) => r.lane === "engine").length,
		terminal: rows.filter((r) => r.lane === "terminal").length,
	};
	return {
		tool: input.tool,
		category: input.category,
		invocations: total,
		successes,
		failures,
		successRate: total === 0 ? 0 : successes / total,
		avgDurationMs: avg === null ? null : Math.round(avg),
		p95DurationMs: p95 ?? null,
		retries: rows.reduce((a, r) => a + (r.retry_count ?? 0), 0),
		failureClasses: [...failureMap.entries()]
			.map(([type, count]) => ({ type, count }))
			.sort((a, b) => b.count - a.count),
		lastSeenTs: rows.length > 0 ? (rows[rows.length - 1]?.ts ?? null) : null,
		lanes,
	};
}

export interface ToolRecommendation {
	tool: string;
	severity: "high" | "medium" | "low";
	finding: string;
	recommendation: string;
}

const SUCCESS_FLOOR = 0.9;
const MIN_SAMPLES = 8;
const LATENCY_WARN_MS = 30_000;

/** Underperforming-tool detection: concrete findings + recommendations. */
export function deriveToolRecommendations(stats: ToolStats[]): ToolRecommendation[] {
	const out: ToolRecommendation[] = [];
	for (const s of stats) {
		if (s.invocations >= MIN_SAMPLES && s.successRate < SUCCESS_FLOOR) {
			out.push({
				tool: s.tool,
				severity: s.successRate < 0.7 ? "high" : "medium",
				finding: `${s.tool}: success ${(s.successRate * 100).toFixed(0)}% over ${s.invocations} calls (${s.failures} failures)`,
				recommendation:
					s.failureClasses[0]?.type === "dependency" || s.failureClasses[0]?.type === "infrastructure"
						? "check the tool's external dependency health before the next delegation"
						: "mine a recent failing invocation's transcript and mint a regression task (unown task mint)",
			});
		}
		if (s.p95DurationMs !== null && s.p95DurationMs > LATENCY_WARN_MS && s.invocations >= MIN_SAMPLES) {
			out.push({
				tool: s.tool,
				severity: "low",
				finding: `${s.tool}: p95 ${Math.round(s.p95DurationMs / 1000)}s (avg ${s.avgDurationMs === null ? "?" : Math.round(s.avgDurationMs / 1000)}s)`,
				recommendation: "budget for the tail (turn caps / timeouts) or split the work",
			});
		}
		if (s.retries > s.invocations && s.invocations >= MIN_SAMPLES) {
			out.push({
				tool: s.tool,
				severity: "medium",
				finding: `${s.tool}: ${s.retries} retries over ${s.invocations} calls — retry-heavy`,
				recommendation: "retry storms starve the admission lanes; check the failure classes",
			});
		}
	}
	return out.sort((a, b) => {
		const rank = { high: 0, medium: 1, low: 2 };
		return rank[a.severity] - rank[b.severity];
	});
}

// ---------------------------------------------------------------------------
// Store-backed queries (API + dashboard)
// ---------------------------------------------------------------------------

export function toolStats(window: "all" | number = 14): ToolStats[] {
	const since = typeof window === "number" ? `WHERE ts >= ${Date.now() - window * 24 * 60 * 60_000}` : "";
	const rows = store.query<ToolInvocationRow>(`SELECT * FROM tool_invocations ${since} ORDER BY ts ASC`);
	const byTool = new Map<string, ToolInvocationRow[]>();
	for (const row of rows) {
		const list = byTool.get(row.tool) ?? [];
		list.push(row);
		byTool.set(row.tool, list);
	}
	const stats: ToolStats[] = [];
	for (const [tool, toolRows] of byTool) {
		stats.push(
			deriveToolStats({
				tool,
				category: toolRows[0]?.category ?? null,
				rows: toolRows.map((r) => ({
					success: r.success,
					duration_ms: r.duration_ms,
					retry_count: r.retry_count,
					failure_type: r.failure_type,
					ts: r.ts,
					lane: r.lane,
				})),
			}),
		);
	}
	return stats.sort((a, b) => b.invocations - a.invocations);
}

export function listToolInvocations(limit = 100): ToolInvocationRow[] {
	const capped = Math.min(Math.max(1, limit), 500);
	return store.query<ToolInvocationRow>(`SELECT * FROM tool_invocations ORDER BY ts DESC LIMIT ${capped}`);
}

export function toolSummary(window: "all" | number = 14): {
	tools: ToolStats[];
	recommendations: ToolRecommendation[];
	totals: { invocations: number; successRate: number; byCategory: Array<{ category: string; count: number }> };
} {
	const tools = toolStats(window);
	const invocations = tools.reduce((a, t) => a + t.invocations, 0);
	const successes = tools.reduce((a, t) => a + t.successes, 0);
	const catMap = new Map<string, number>();
	for (const t of tools) {
		const key = t.category ?? "other";
		catMap.set(key, (catMap.get(key) ?? 0) + t.invocations);
	}
	return {
		tools,
		recommendations: deriveToolRecommendations(tools),
		totals: {
			invocations,
			successRate: invocations === 0 ? 0 : successes / invocations,
			byCategory: [...catMap.entries()]
				.map(([category, count]) => ({ category, count }))
				.sort((a, b) => b.count - a.count),
		},
	};
}

// ---------------------------------------------------------------------------
// Terminal-lane batch report (server side of POST /api/tools/report)
// ---------------------------------------------------------------------------

export interface ToolReportItem {
	tool: string;
	ts?: number;
	sessionId?: string | null;
	projectSlug?: string | null;
	purpose?: string | null;
	durationMs?: number | null;
	success?: boolean;
	retryCount?: number;
	error?: string | null;
	argsBytes?: number | null;
	outputBytes?: number | null;
}

/**
 * Ingest a terminal-session tool report batch. Untrusted input is parsed
 * defensively (tool name required and clipped; booleans coerced; timestamps
 * sane). Returns the number of rows written.
 */
export function ingestToolReport(items: unknown, sessionId?: string | null, projectSlug?: string | null): number {
	if (!Array.isArray(items)) return 0;
	let written = 0;
	for (const item of items.slice(0, 200)) {
		const tool = typeof (item as ToolReportItem)?.tool === "string" ? (item as ToolReportItem).tool.slice(0, 80) : "";
		if (!tool) continue;
		const success = (item as ToolReportItem).success !== false;
		const ts = Number((item as ToolReportItem).ts);
		const when = Number.isFinite(ts) && ts > 0 && ts <= Date.now() + 60_000 ? ts : Date.now();
		const failureType = success ? null : classifyFailure((item as ToolReportItem).error ?? "", tool);
		try {
			store.run(
				`INSERT INTO tool_invocations
					(ts, lane, session_id, project_slug, tool, category, purpose, duration_ms, success, retry_count, failure_type, error, args_bytes, output_bytes)
				 VALUES (?, 'terminal', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					when,
					clip(
						typeof (item as ToolReportItem).sessionId === "string"
							? (item as ToolReportItem).sessionId
							: sessionId,
					) ?? null,
					clip(
						typeof (item as ToolReportItem).projectSlug === "string"
							? (item as ToolReportItem).projectSlug
							: projectSlug,
					) ?? null,
					tool,
					toolCategory(tool),
					clip((item as ToolReportItem).purpose ?? null),
					Number.isFinite(Number((item as ToolReportItem).durationMs))
						? Math.max(0, Math.round(Number((item as ToolReportItem).durationMs)))
						: null,
					success ? 1 : 0,
					Number.isFinite(Number((item as ToolReportItem).retryCount))
						? Math.max(0, Math.min(9, Math.round(Number((item as ToolReportItem).retryCount))))
						: 0,
					failureType,
					clip((item as ToolReportItem).error ?? null),
					Number.isFinite(Number((item as ToolReportItem).argsBytes))
						? Math.max(0, Math.round(Number((item as ToolReportItem).argsBytes)))
						: null,
					Number.isFinite(Number((item as ToolReportItem).outputBytes))
						? Math.max(0, Math.round(Number((item as ToolReportItem).outputBytes)))
						: null,
				],
			);
			written++;
		} catch {
			/* telemetry invariant: one bad row never rejects the batch */
		}
	}
	if (written > 0) emit("tool:report-ingested", { written });
	return written;
}
