/**
 * plm/index.ts — the PLM facade: one import surface for the whole
 * Process Lifecycle Management round.
 *
 * The engine-side wiring lives in the producers (router.ts, runner.ts,
 * harness.ts, server.ts) — they call beginProcess/recordToolInvocation/
 * recordFailure/createCheckpoint/attributeLearning directly at their own
 * lifecycle seams. This module adds the CROSS-CUTTING listeners:
 *
 *   - bus → recovery: run:finished(error) and job failures observed
 *     anywhere become classified recovery_events;
 *   - bus → learning attribution: improvement:shipped /
 *     improvement:regressed write the proof chain rows;
 *   - boot heal: recoverOrphanProcesses rides server.ts's recoverOrphans.
 *
 * It also exports plmSummary() — the one-call KPI rollup the dashboard's
 * overview and /api/plm serve (process census, tool stats, recovery
 * analytics, learning analytics, replay analytics).
 */

import { onAsync } from "../bus.ts";
import { store } from "../store.ts";
import { replayAnalytics } from "./checkpoints.ts";
import { attributeLearning, learningAnalytics, markRetained } from "./learning-attribution.ts";
import { type ProcessAnalytics, processAnalytics, recoverOrphanProcesses } from "./process-registry.ts";
import { type RecoveryAnalytics, recordFailure, recoveryAnalytics, validateJobRecovery } from "./recovery-engine.ts";
import { type ToolRecommendation, type ToolStats, toolSummary } from "./tool-registry.ts";

export {
	beginReplay,
	type CheckpointRow,
	type CheckpointState,
	compareReplay,
	createCheckpoint,
	finishReplay,
	getCheckpoint,
	listCheckpoints,
	listCheckpointsForProcess,
	listReplayRuns,
	type ReplayRunRow,
	replayAnalytics,
} from "./checkpoints.ts";
export {
	classifyFailure,
	FAILURE_CATEGORIES,
	type FailureCategory,
	isFailureCategory,
	isRetryable,
	type RecoveryAction,
	recoveryActionFor,
	rootCauseHint,
} from "./failure-taxonomy.ts";
export {
	attributeLearning,
	type LearningAttributionRow,
	learningAnalytics,
	listAttributions,
	markRegression,
	markRetained,
} from "./learning-attribution.ts";
export {
	archiveProcess,
	beginProcess,
	getProcess,
	getProcessChildren,
	getProcessEvents,
	listProcesses,
	type ProcessHandle,
	type ProcessQuery,
	type ProcessRow,
	type ProcessUsage,
	plmEnabled,
	processAnalytics,
	recoverOrphanProcesses,
} from "./process-registry.ts";
export {
	listRecoveryEvents,
	markAbandoned,
	markExecuted,
	markFailed,
	markValidated,
	planRecovery,
	type RecoveryEventRow,
	type RecoveryPlan,
	recordFailure,
	recoveryAnalytics,
	validateJobRecovery,
} from "./recovery-engine.ts";
export * from "./states.ts";
export {
	deriveToolRecommendations,
	deriveToolStats,
	ingestToolReport,
	listToolInvocations,
	type RecordToolInvocationInput,
	recordToolInvocation,
	type ToolInvocationRow,
	type ToolReportItem,
	type ToolStatsInput,
	toolCategory,
	toolStats,
	toolSummary,
} from "./tool-registry.ts";

// ---------------------------------------------------------------------------
// Cross-cutting listeners
// ---------------------------------------------------------------------------

let wired = false;

/**
 * Subscribe the PLM listeners to the bus (idempotent — the engine boots
 * once, but the same-process restart path startServer() takes must not
 * double-register).
 */
export function wirePlm(): void {
	if (wired) return;
	wired = true;

	// A run that errored is an observed failure — classify + plan, and let
	// the harness's own next cycle (or the human) execute the plan.
	onAsync("run:finished", (payload: Record<string, unknown>) => {
		try {
			if (payload && payload.status === "error") {
				const runId = typeof payload.id === "string" ? payload.id : null;
				const run = runId
					? store.get<{ error: string | null; task_id: string | null }>(
							`SELECT error, task_id FROM runs WHERE id = ?`,
							[runId],
						)
					: undefined;
				recordFailure({
					failure: run?.error ?? "run errored (no error text)",
					runId,
					category: "infrastructure",
				});
			}
		} catch {
			/* telemetry invariant */
		}
	});

	// Improvement shipped → the proof chain's first half (before/after come
	// from the cycle's own records; retention lands on the rerun).
	onAsync("improvement:shipped", (payload: Record<string, unknown>) => {
		try {
			const improvementId =
				typeof payload?.id === "string"
					? payload.id
					: typeof payload?.improvementId === "string"
						? payload.improvementId
						: null;
			const row = improvementId
				? store.get<{
						diagnosis: string | null;
						patch: string | null;
						task_id: string | null;
						score_before: string | null;
						score_after: string | null;
					}>(`SELECT diagnosis, patch, task_id, score_before, score_after FROM improvements WHERE id = ?`, [
						improvementId,
					])
				: undefined;
			attributeLearning({
				failure: row?.diagnosis ?? null,
				improvement: row?.patch ?? "improvement shipped (no patch text)",
				improvementId,
				benchmark: row?.task_id ?? null,
				scoreBefore: row?.score_before ?? null,
				scoreAfter: row?.score_after ?? null,
			});
		} catch {
			/* telemetry invariant */
		}
	});

	// Improvement regressed → the retention verdict (un-shipped).
	onAsync("improvement:regressed", (payload: Record<string, unknown>) => {
		try {
			const improvementId =
				typeof payload?.id === "string"
					? payload.id
					: typeof payload?.improvementId === "string"
						? payload.improvementId
						: null;
			if (!improvementId) return;
			const attr = store.get<{ id: number }>(
				`SELECT id FROM learning_attribution WHERE improvement_id = ? ORDER BY ts DESC LIMIT 1`,
				[improvementId],
			);
			if (attr) markRetained(attr.id, false, "regressed on a later run — auto-unshipped");
		} catch {
			/* telemetry invariant */
		}
	});
}

// ---------------------------------------------------------------------------
// The KPI rollup
// ---------------------------------------------------------------------------

export interface PlmSummary {
	enabled: boolean;
	processes: ProcessAnalytics;
	tools: {
		tools: ToolStats[];
		recommendations: ToolRecommendation[];
		totals: { invocations: number; successRate: number; byCategory: Array<{ category: string; count: number }> };
	};
	recovery: RecoveryAnalytics;
	learning: ReturnType<typeof learningAnalytics>;
	replay: ReturnType<typeof replayAnalytics>;
}

/** One call for /api/plm and the dashboard's PLM screens. */
export function plmSummary(windowDays = 14): PlmSummary {
	return {
		enabled: (process.env.UNOWN_PLM || "1") !== "0",
		processes: processAnalytics(),
		tools: toolSummary(windowDays),
		recovery: recoveryAnalytics(windowDays),
		learning: learningAnalytics(),
		replay: replayAnalytics(),
	};
}

export { validateJobRecovery as _validateJobRecovery };
