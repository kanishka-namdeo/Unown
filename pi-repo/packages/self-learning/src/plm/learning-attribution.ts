/**
 * plm/learning-attribution.ts — the Learning Attribution ledger (mission core).
 *
 * "Avoid learning theatre. Every learning claim must have proof." Every
 * claimed improvement records its full proof chain:
 *
 *   Failure → Improvement → Affected Process → Affected Tool → Benchmark →
 *   Before Score → After Score → Measured Gain → Retained → Regression Check
 *
 * Producers: the harness (a shipped improvement), the spec-gate lane (a
 * learned model spec), the dream lane (a consolidated rule that measurably
 * changed an outcome), and the recovery engine (a recovery that validated).
 * Each producer owns its own trigger; this module only owns the ledger and
 * its derivation:
 *
 *   - attributeLearning: write one proof row;
 *   - markRetained / markRegression: the retention half of the contract
 *     (an improvement that survives a rerun, a regression check result);
 *   - learningAnalytics: the Learning View data — improvements created,
 *     retained, benchmark impact, skill evolution joins (the skills table
 *     is counted alongside, not duplicated).
 *
 * Honesty rules (the house epistemics): scores may be null (not yet
 * measured); `retained` is only ever set by an observed rerun; regression
 * checks are pass | fail | pending | n/a, never guessed.
 */

import { emit } from "../bus.ts";
import { store } from "../store.ts";
import { plmEnabled } from "./process-registry.ts";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface LearningAttributionRow {
	id: number;
	ts: number;
	failure: string | null;
	improvement: string | null;
	improvement_id: string | null;
	process_id: string | null;
	tool: string | null;
	benchmark: string | null;
	score_before: string | null;
	score_after: string | null;
	measured_gain: string | null;
	retained: number | null;
	regression_check: string | null;
}

export interface AttributeLearningInput {
	/** The failure that motivated the improvement (its own words, clipped). */
	failure?: string | null;
	/** What changed — one line. */
	improvement: string;
	/** The improvements row id when it has one. */
	improvementId?: string | null;
	processId?: string | null;
	tool?: string | null;
	/** The benchmark/task that measures it (receipt path or task name). */
	benchmark?: string | null;
	scoreBefore?: string | null;
	scoreAfter?: string | null;
	measuredGain?: string | null;
}

const CLIP = 400;

function clip(text: string | null | undefined): string | null {
	if (text === null || text === undefined) return null;
	const clean = String(text).replace(/\s+/g, " ").trim();
	return clean.length === 0 ? null : clean.slice(0, CLIP);
}

/** Record one claimed improvement with its proof chain. Returns the row id. */
export function attributeLearning(input: AttributeLearningInput): number {
	if (!plmEnabled()) return 0;
	try {
		const info = store.run(
			`INSERT INTO learning_attribution
				(ts, failure, improvement, improvement_id, process_id, tool, benchmark, score_before, score_after, measured_gain, retained, regression_check)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending')`,
			[
				Date.now(),
				clip(input.failure ?? null),
				clip(input.improvement),
				clip(input.improvementId ?? null),
				clip(input.processId ?? null),
				clip(input.tool ?? null),
				clip(input.benchmark ?? null),
				clip(input.scoreBefore ?? null),
				clip(input.scoreAfter ?? null),
				clip(input.measuredGain ?? null),
			],
		);
		emit("learning:attributed", { id: Number(info.lastInsertRowid ?? 0), improvement: clip(input.improvement) });
		return Number(info.lastInsertRowid ?? 0);
	} catch (err: unknown) {
		console.warn(`[plm] learning attribution write failed: ${err instanceof Error ? err.message : String(err)}`);
		return 0;
	}
}

/** Retention check: the improvement survived an observed rerun (1) or not (0). */
export function markRetained(id: number, retained: boolean, evidence: string): boolean {
	if (!id) return false;
	try {
		const info = store.run(`UPDATE learning_attribution SET retained = ?, regression_check = ? WHERE id = ?`, [
			retained ? 1 : 0,
			clip(evidence) ?? "pending",
			id,
		]);
		if (info.changes === 0) return false; // unknown id — refuse honestly
		emit("learning:retention-checked", { id, retained });
		return true;
	} catch {
		return false;
	}
}

/** Record a regression check outcome for an attribution row. */
export function markRegression(id: number, outcome: "pass" | "fail" | "pending" | "n/a", note?: string): boolean {
	if (!id) return false;
	try {
		const info = store.run(`UPDATE learning_attribution SET regression_check = ? WHERE id = ?`, [
			clip(`${outcome}${note ? ` — ${note}` : ""}`) ?? outcome,
			id,
		]);
		return info.changes > 0;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Analytics (the Learning View data)
// ---------------------------------------------------------------------------

export interface LearningAnalytics {
	total: number;
	retained: number;
	regressions: number;
	pending: number;
	/** retained / (retained + regressions) — the retention score; null when unmeasured. */
	retentionRate: number | null;
	withBenchmark: number;
	withMeasuredGain: number;
	/** Skill evolution join (the skills table, counted — never duplicated). */
	skills: { shipped: number; retired: number };
	/** Memory growth join (memory_versions rows, by changer). */
	memoryVersions: number;
	recent: LearningAttributionRow[];
}

export function listAttributions(limit = 50): LearningAttributionRow[] {
	const capped = Math.min(Math.max(1, limit), 200);
	return store.query<LearningAttributionRow>(`SELECT * FROM learning_attribution ORDER BY ts DESC LIMIT ${capped}`);
}

export function getAttribution(id: number): LearningAttributionRow | undefined {
	return store.get<LearningAttributionRow>(`SELECT * FROM learning_attribution WHERE id = ?`, [id]);
}

export function learningAnalytics(): LearningAnalytics {
	const rows = store.query<LearningAttributionRow>(`SELECT * FROM learning_attribution`);
	const total = rows.length;
	const retained = rows.filter((r) => r.retained === 1).length;
	const regressions = rows.filter((r) => r.retained === 0).length;
	const pending = rows.filter((r) => r.retained === null).length;
	const withBenchmark = rows.filter((r) => r.benchmark !== null).length;
	const withMeasuredGain = rows.filter((r) => r.measured_gain !== null).length;
	let skills = { shipped: 0, retired: 0 };
	try {
		const skillRows = store.query<{ status: string; n: number }>(
			`SELECT status, COUNT(*) AS n FROM skills GROUP BY status`,
		);
		skills = {
			shipped: skillRows.find((r) => r.status === "shipped")?.n ?? 0,
			retired: skillRows.find((r) => r.status === "retired")?.n ?? 0,
		};
	} catch {
		/* skills table not present (older install) */
	}
	let memoryVersions = 0;
	try {
		memoryVersions = store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM memory_versions`)?.n ?? 0;
	} catch {
		/* same */
	}
	return {
		total,
		retained,
		regressions,
		pending,
		retentionRate: retained + regressions === 0 ? null : retained / (retained + regressions),
		withBenchmark,
		withMeasuredGain,
		skills,
		memoryVersions,
		recent: rows.slice(0, 10),
	};
}
