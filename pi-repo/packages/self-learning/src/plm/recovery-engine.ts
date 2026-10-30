/**
 * plm/recovery-engine.ts — the Autonomous Recovery Engine (mission core).
 *
 * The mission's sequence, made explicit and persisted:
 *
 *   Failure → Classification → Root Cause → Recovery Planning →
 *   Recovery Execution → Validation → Benchmark Update
 *
 * Every failure the engine observes (a job error, a watchdog kill, a run
 * error, a reported tool failure, a dead-lettered note) becomes a
 * `recovery_events` row: classified by the taxonomy (failure-taxonomy.ts),
 * diagnosed with a deterministic root-cause hint, planned with a concrete
 * action, then EXECUTED (where an automatic recovery exists and is safe),
 * VALIDATED (did the work actually resume/complete?), and closed. The
 * engine NEVER blindly retries: retryable categories plan backoff-retry,
 * non-retryable categories plan a change or an escalation.
 *
 * What "execution" means here (v1, deliberately bounded):
 *   - job failures: the router's own scheduling IS the retry — the engine
 *     records the plan, lets the next interval tick re-run the job, and
 *     VALIDATES by observing the job's next outcome (job:finished ok).
 *   - watchdog kills / orphaned rows: healed rows (router.recoverRunningRows,
 *     boot recoverOrphans) are recorded here as executed+validated.
 *   - terminal-side tool failures: recorded via the report lane; execution
 *     is "monitor" (the terminal agent owns its own retries) — escalations
 *     surface in the dashboard's Recovery view.
 *
 * Recovery effectiveness is measured, not asserted: recoveryAnalytics()
 * reports attempts, executions, validations, the success rate and the
 * recurring failure categories — the mission's Recovery View data.
 *
 * The pure derivation (planRecovery / deriveRecoveryAnalytics) is separated
 * from the store-backed ledger for test pinning without a DB.
 */

import { emit } from "../bus.ts";
import { store } from "../store.ts";
import {
	classifyFailure,
	type FailureCategory,
	isFailureCategory,
	isRetryable,
	type RecoveryAction,
	recoveryActionFor,
	rootCauseHint,
} from "./failure-taxonomy.ts";
import { plmEnabled } from "./process-registry.ts";

// ---------------------------------------------------------------------------
// The pure planning core
// ---------------------------------------------------------------------------

export interface RecoveryPlan {
	category: FailureCategory;
	retryable: boolean;
	rootCause: string;
	action: RecoveryAction;
	/** The deterministic next-step line the dashboard shows. */
	nextStep: string;
}

/**
 * Plan a recovery for a failure. Deterministic — no LLM in the critical
 * path (the mission's own discipline: classify and plan from evidence;
 * LLM mining happens later in the harness loop, if ever).
 */
export function planRecovery(failureText: string, tool?: string): RecoveryPlan {
	const category = classifyFailure(failureText, tool);
	const action = recoveryActionFor(category);
	const retryable = isRetryable(category);
	const rootCause = rootCauseHint(category);
	const nextStep = nextStepFor(action, retryable);
	return { category, retryable, rootCause, action, nextStep };
}

function nextStepFor(action: RecoveryAction, retryable: boolean): string {
	switch (action) {
		case "retry":
			return retryable ? "retry once, then escalate" : "do not retry — fix the cause";
		case "backoff-retry":
			return "retry with backoff after the dependency recovers";
		case "re-plan":
			return "restate the plan against current state, then re-run";
		case "re-run":
			return "re-run with the failure text fed back into the prompt";
		case "rollback":
			return "roll back to the last good version, then re-validate";
		case "escalate-human":
			return "surface in the Recovery view — human decision needed";
		case "monitor":
			return "watch the next occurrence; heal infrastructure before retrying";
		case "ignore":
			return "recorded only (benign)";
	}
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

export interface RecoveryEventRow {
	id: number;
	ts: number;
	process_id: string | null;
	run_id: string | null;
	job_id: string | null;
	tool: string | null;
	category: string;
	failure_summary: string | null;
	retryable: number;
	root_cause: string | null;
	recovery_action: string | null;
	status: string;
	attempt: number;
	detail: string | null;
	executed_at: number | null;
	validated_at: number | null;
	outcome: string | null;
}

const CLIP = 400;

function clip(text: string | null | undefined): string | null {
	if (text === null || text === undefined) return null;
	const clean = String(text).replace(/\s+/g, " ").trim();
	return clean.length === 0 ? null : clean.slice(0, CLIP);
}

export interface RecordFailureInput {
	/** The failure's own words (error message, deny reason, …). */
	failure: string;
	/** Owning process id (when known). */
	processId?: string | null;
	runId?: string | null;
	jobId?: string | null;
	tool?: string | null;
	/** Pre-classified category (when the producer already knows it). */
	category?: FailureCategory | null;
}

/**
 * Record + plan a recovery for an observed failure. Returns the ledger row
 * id (0 when disabled/failed). Status starts at 'planned'.
 */
export function recordFailure(input: RecordFailureInput): number {
	if (!plmEnabled()) return 0;
	const failureText = clip(input.failure) ?? "(unspecified failure)";
	const plan = planRecovery(failureText, input.tool ?? undefined);
	const category = input.category && isFailureCategory(input.category) ? input.category : plan.category;
	try {
		const info = store.run(
			`INSERT INTO recovery_events
                                (ts, process_id, run_id, job_id, tool, category, failure_summary, retryable, root_cause, recovery_action, status, attempt, detail)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', 1, ?)`,
			[
				Date.now(),
				input.processId ?? null,
				input.runId ?? null,
				input.jobId ?? null,
				clip(input.tool ?? null),
				category,
				failureText,
				plan.retryable ? 1 : 0,
				plan.rootCause,
				plan.action,
				JSON.stringify({ plannedNextStep: plan.nextStep }),
			],
		);
		emit("recovery:planned", {
			id: Number(info.lastInsertRowid ?? 0),
			category,
			action: plan.action,
			tool: input.tool ?? null,
		});
		return Number(info.lastInsertRowid ?? 0);
	} catch (err: unknown) {
		console.warn(`[plm] recovery ledger write failed: ${err instanceof Error ? err.message : String(err)}`);
		return 0;
	}
}

export interface RecoveryExecutionInput {
	/** What the execution actually did (the action taken, clipped). */
	outcome: string;
	/** Detail JSON merged into the row (planned steps, evidence). */
	detail?: Record<string, unknown>;
}

/** Mark a planned recovery as executed. */
export function markExecuted(id: number, input: RecoveryExecutionInput): boolean {
	return markRecovery(id, "executed", input.outcome, input.detail ?? {}, { executed_at: Date.now() });
}

/** Mark an executed recovery as validated (the work verifiably resumed). */
export function markValidated(id: number, evidence: string): boolean {
	return markRecovery(id, "validated", evidence, { validationEvidence: evidence }, { validated_at: Date.now() });
}

/** Mark a recovery as failed (the attempted recovery itself failed). */
export function markFailed(id: number, reason: string): boolean {
	return markRecovery(id, "failed", reason, { failureReason: reason }, {});
}

/** Abandon a planned recovery (e.g. the work was superseded). */
export function markAbandoned(id: number, reason: string): boolean {
	return markRecovery(id, "abandoned", reason, { abandonReason: reason }, {});
}

function markRecovery(
	id: number,
	status: "executed" | "validated" | "failed" | "abandoned",
	outcome: string,
	detail: Record<string, unknown>,
	timestamps: { executed_at?: number; validated_at?: number },
): boolean {
	if (!id) return false;
	try {
		const existing = store.get<RecoveryEventRow>(`SELECT * FROM recovery_events WHERE id = ?`, [id]);
		if (!existing) return false;
		const mergedDetail = mergeDetail(existing.detail, detail);
		store.run(
			`UPDATE recovery_events SET status = ?, outcome = ?, detail = ?, executed_at = COALESCE(?, executed_at), validated_at = COALESCE(?, validated_at) WHERE id = ?`,
			[status, clip(outcome), mergedDetail, timestamps.executed_at ?? null, timestamps.validated_at ?? null, id],
		);
		emit("recovery:updated", { id, status });
		return true;
	} catch {
		return false;
	}
}

function mergeDetail(existing: string | null, add: Record<string, unknown>): string {
	let base: Record<string, unknown> = {};
	try {
		base = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
	} catch {
		base = {};
	}
	return JSON.stringify({ ...base, ...add });
}

// ---------------------------------------------------------------------------
// Analytics (the Recovery View data)
// ---------------------------------------------------------------------------

export interface RecoveryAnalytics {
	total: number;
	byStatus: Record<string, number>;
	byCategory: Array<{ name: string; count: number }>;
	/** executed / planned — how many plans became actions. */
	executionRate: number | null;
	/** validated / executed — how many recoveries verifiably worked. */
	validationRate: number | null;
	/** validated+executed-only-monitor / total — the headline recovery score. */
	recoverySuccessRate: number | null;
	/** The recurring failure categories (count desc). */
	recurring: Array<{ name: string; count: number }>;
	/** The most-seen action plans. */
	topActions: Array<{ name: string; count: number }>;
	windowDays: number;
}

const STATUS_BY_SEVERITY: Record<string, number> = { planned: 0, executed: 1, validated: 2, failed: 3, abandoned: 4 };

export function listRecoveryEvents(limit = 100): RecoveryEventRow[] {
	const capped = Math.min(Math.max(1, limit), 500);
	const rows = store.query<RecoveryEventRow>(`SELECT * FROM recovery_events ORDER BY ts DESC LIMIT ${capped}`);
	return rows;
}

export function recoveryAnalytics(windowDays = 14): RecoveryAnalytics {
	const since = Date.now() - windowDays * 24 * 60 * 60_000;
	const rows = store.query<RecoveryEventRow>(`SELECT * FROM recovery_events WHERE ts >= ?`, [since]);
	const total = rows.length;
	const byStatus: Record<string, number> = {};
	for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
	const byCategory = countBy(rows, (r) => r.category);
	const topActions = countBy(rows, (r) => r.recovery_action ?? "(none)");
	const planned = rows.filter((r) => r.status !== "planned").length + (byStatus["planned"] ?? 0);
	const executed = rows.filter(
		(r) => r.status === "executed" || r.status === "validated" || r.status === "failed",
	).length;
	const validated = rows.filter((r) => r.status === "validated").length;
	const monitorOnly = rows.filter((r) => r.recovery_action === "monitor" && r.status === "executed").length;
	return {
		total,
		byStatus,
		byCategory,
		executionRate: planned === 0 ? null : executed / planned,
		validationRate: executed === 0 ? null : validated / executed,
		recoverySuccessRate: total === 0 ? null : (validated + monitorOnly) / total,
		recurring: byCategory.filter((c) => c.count > 1),
		topActions,
		windowDays,
	};
}

function countBy<T>(rows: T[], key: (row: T) => string): Array<{ name: string; count: number }> {
	const map = new Map<string, number>();
	for (const row of rows) {
		const k = key(row) || "(none)";
		map.set(k, (map.get(k) ?? 0) + 1);
	}
	return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Validation hook: the router reports job outcomes here
// ---------------------------------------------------------------------------

/**
 * When a job finishes after a recorded failure, validate its open recovery
 * rows: an ok finish validates them (the work resumed); another failure
 * increments the attempt and keeps them open (bounded at 3 attempts, then
 * the row fails honestly).
 */
export function validateJobRecovery(jobId: string, ok: boolean, error?: string | null): void {
	if (!plmEnabled()) return;
	try {
		const open = store.query<RecoveryEventRow>(
			`SELECT * FROM recovery_events WHERE job_id = ? AND status IN ('planned','executed') ORDER BY ts DESC LIMIT 10`,
			[jobId],
		);
		for (const row of open) {
			if (ok) {
				markValidated(row.id, `job ${jobId} finished ok after failure — recovery confirmed`);
			} else {
				if (row.attempt >= 3) {
					markFailed(row.id, `job ${jobId} failed again after ${row.attempt} attempts — recovery exhausted`);
				} else {
					// the repeat failure's own words ride along (the diagnosis lane)
					const reason = error ? ` — ${String(error).slice(0, 200)}` : "";
					store.run(
						`UPDATE recovery_events SET attempt = attempt + 1, detail = COALESCE(detail, '{}') WHERE id = ?`,
						[row.id],
					);
					markRecovery(row.id, "executed", `attempt ${row.attempt + 1} pending${reason}`, { repeatFailure: reason || "no error text" }, {});
				}
			}
		}
	} catch {
		/* telemetry invariant */
	}
}

/** Severity rank for the dashboard's worst-first ordering. */
export function recoverySeverityRank(status: string): number {
	return STATUS_BY_SEVERITY[status] ?? 5;
}
