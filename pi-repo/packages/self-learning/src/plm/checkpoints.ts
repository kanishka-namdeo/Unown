/**
 * plm/checkpoints.ts — the Checkpointing + Execution Replay system.
 *
 * Long-running work persists state at MILESTONES (mission list):
 * planning completion, architecture approval, major implementation
 * milestones, tool execution milestones, testing milestones, deployment
 * milestones, validation milestones (+ the terminal-session kind). A
 * checkpoint is a durable JSON snapshot of everything needed to RESUME or
 * REPLAY the work from that point: objective, prompt, decisions, reasoning
 * artefacts, tool invocation summary, outputs, failures, recovery actions.
 *
 * Replay (the reproducibility lane): `beginReplay` records a replay run
 * against a checkpoint; `finishReplay` compares the replay's outcome with
 * the original and records MATCHED / DIVERGED + a field diff. The
 * reproducibility metric (replayAnalytics) is receipts-only — a process
 * with no replays reports null, never a fabricated score.
 *
 * Both models from the research land here (docs/plm-competitor-research.md):
 *   - snapshot restore (LangGraph checkpointer / Cline shadow-git): the
 *     stored state IS the resume surface;
 *   - deterministic replay (Temporal Event History): the process_events
 *     journal (process-registry.ts) replays the lifecycle; the checkpoint
 *     replay verifies the WORK reproduces.
 *
 * Growth is bounded: UNOWN_PLM_MAX_CHECKPOINTS (default 2,000) keeps the
 * newest N checkpoints per data root; pruning deletes oldest-first and
 * never touches replay_runs rows that reference a kept checkpoint.
 */

import { randomUUID } from "node:crypto";
import { emit } from "../bus.ts";
import { store } from "../store.ts";
import { plmEnabled } from "./process-registry.ts";

// ---------------------------------------------------------------------------
// Kinds + caps
// ---------------------------------------------------------------------------

export const CHECKPOINT_KINDS = [
	"planning",
	"architecture",
	"implementation",
	"tool",
	"testing",
	"deployment",
	"validation",
	"session",
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export function isCheckpointKind(value: unknown): value is CheckpointKind {
	return typeof value === "string" && (CHECKPOINT_KINDS as readonly string[]).includes(value);
}

export function maxCheckpoints(): number {
	const raw = Number(process.env.UNOWN_PLM_MAX_CHECKPOINTS);
	return Number.isFinite(raw) && raw >= 10 ? Math.floor(raw) : 2_000;
}

const STATE_BYTES_CAP = 256 * 1024; // 256 KB per snapshot — clip, never fail

function capState(state: Record<string, unknown>): string {
	let json = JSON.stringify(state ?? {});
	if (json.length > STATE_BYTES_CAP) {
		// Clip the heaviest fields first (outputs/transcripts), keep identity.
		const clipped = { ...state, outputs: undefined, transcript: undefined, __clipped: true };
		json = JSON.stringify(clipped).slice(0, STATE_BYTES_CAP);
	}
	return json;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface CheckpointRow {
	id: string;
	process_id: string;
	kind: string;
	label: string | null;
	ts: number;
	state: string;
}

export interface ReplayRunRow {
	id: string;
	checkpoint_id: string;
	process_id: string | null;
	ts: number;
	reproduces: string | null;
	status: string; // running | matched | diverged | error
	diff: string | null;
}

/** The canonical snapshot payload (the replay contract). */
export interface CheckpointState {
	objective: string;
	prompt?: string;
	decisions?: Array<string>;
	reasoning?: string;
	toolInvocations?: Array<{ tool: string; success: boolean }>;
	outputs?: Record<string, unknown>;
	failures?: Array<string>;
	recoveryActions?: Array<string>;
	/** Anything the caller needs for a faithful resume. */
	extra?: Record<string, unknown>;
}

export interface CreateCheckpointInput {
	processId: string;
	kind: CheckpointKind | string;
	label?: string | null;
	state: CheckpointState | Record<string, unknown>;
}

/**
 * Persist a milestone checkpoint. Returns the checkpoint id (null when
 * disabled/failed — callers never branch, the telemetry invariant).
 */
export function createCheckpoint(input: CreateCheckpointInput): string | null {
	if (!plmEnabled()) return null;
	const kind = isCheckpointKind(input.kind) ? input.kind : "implementation";
	try {
		const id = randomUUID();
		store.run(`INSERT INTO checkpoints (id, process_id, kind, label, ts, state) VALUES (?, ?, ?, ?, ?, ?)`, [
			id,
			input.processId,
			kind,
			input.label ? String(input.label).slice(0, 200) : null,
			Date.now(),
			capState(input.state as Record<string, unknown>),
		]);
		// The owning process keeps a pointer to its latest checkpoint.
		try {
			store.run(`UPDATE processes SET checkpoint_id = ? WHERE id = ?`, [id, input.processId]);
		} catch {
			/* process row may not exist (external reporter) */
		}
		emit("checkpoint:created", { id, processId: input.processId, kind });
		pruneCheckpoints();
		return id;
	} catch (err: unknown) {
		console.warn(`[plm] checkpoint write failed: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

function pruneCheckpoints(): void {
	try {
		const cap = maxCheckpoints();
		const count = store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM checkpoints`)?.n ?? 0;
		if (count <= cap) return;
		const excess = count - cap;
		// Oldest-first, never a checkpoint a replay_run still references.
		store.run(
			`DELETE FROM checkpoints WHERE id IN (
				SELECT c.id FROM checkpoints c
				LEFT JOIN replay_runs r ON r.checkpoint_id = c.id
				WHERE r.id IS NULL
				ORDER BY c.ts ASC LIMIT ${excess}
			)`,
		);
	} catch {
		/* telemetry invariant */
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function listCheckpoints(limit = 100): CheckpointRow[] {
	const capped = Math.min(Math.max(1, limit), 500);
	return store.query<CheckpointRow>(`SELECT * FROM checkpoints ORDER BY ts DESC LIMIT ${capped}`);
}

export function getCheckpoint(id: string): CheckpointRow | undefined {
	return store.get<CheckpointRow>(`SELECT * FROM checkpoints WHERE id = ?`, [id]);
}

export function listCheckpointsForProcess(processId: string): CheckpointRow[] {
	return store.query<CheckpointRow>(`SELECT * FROM checkpoints WHERE process_id = ? ORDER BY ts ASC`, [processId]);
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface BeginReplayInput {
	checkpointId: string;
	/** What this replay claims to reproduce (one line). */
	reproduces: string;
}

/** Start a replay run against a checkpoint (status 'running'). */
export function beginReplay(input: BeginReplayInput): string | null {
	if (!plmEnabled()) return null;
	const checkpoint = getCheckpoint(input.checkpointId);
	if (!checkpoint) return null;
	try {
		const id = randomUUID();
		store.run(
			`INSERT INTO replay_runs (id, checkpoint_id, process_id, ts, reproduces, status) VALUES (?, ?, ?, ?, ?, 'running')`,
			[id, input.checkpointId, checkpoint.process_id, Date.now(), input.reproduces.slice(0, 240)],
		);
		emit("checkpoint:replay-started", { id, checkpointId: input.checkpointId });
		return id;
	} catch {
		return null;
	}
}

export interface ReplayComparison {
	/** Field-by-field comparison keys. */
	fieldsCompared: string[];
	/** The original values, per field (JSON-encoded). */
	original: Record<string, unknown>;
	/** The replay's values, per field. */
	replay: Record<string, unknown>;
	/** Fields whose values differ. */
	diverged: string[];
}

/**
 * Compare a replay's outcome against the checkpoint state — deterministic
 * field comparison over the snapshot's scalar fields (objective, prompt,
 * decision count, tool invocation count, failure count). Returns the
 * comparison; MATCHED means zero diverged fields.
 */
export function compareReplay(checkpointState: string, replayOutcome: Record<string, unknown>): ReplayComparison {
	let state: Record<string, unknown> = {};
	try {
		state = JSON.parse(checkpointState) as Record<string, unknown>;
	} catch {
		state = {};
	}
	const fields: string[] = [];
	const original: Record<string, unknown> = {};
	const replay: Record<string, unknown> = {};
	const diverged: string[] = [];
	const consider = (field: string, orig: unknown, rep: unknown): void => {
		fields.push(field);
		original[field] = orig === undefined ? null : orig;
		replay[field] = rep === undefined ? null : rep;
		const norm = (v: unknown): string =>
			v === undefined || v === null ? "null" : typeof v === "object" ? JSON.stringify(v) : String(v);
		if (norm(orig) !== norm(rep)) diverged.push(field);
	};
	consider("objective", state.objective, replayOutcome.objective);
	if (state.prompt !== undefined || replayOutcome.prompt !== undefined) {
		consider("prompt", state.prompt, replayOutcome.prompt);
	}
	const decisions = Array.isArray(state.decisions) ? (state.decisions as unknown[]).length : null;
	consider(
		"decisionCount",
		decisions,
		Array.isArray(replayOutcome.decisions) ? (replayOutcome.decisions as unknown[]).length : null,
	);
	const tools = Array.isArray(state.toolInvocations) ? (state.toolInvocations as unknown[]).length : null;
	consider(
		"toolInvocationCount",
		tools,
		Array.isArray(replayOutcome.toolInvocations) ? (replayOutcome.toolInvocations as unknown[]).length : null,
	);
	const failures = Array.isArray(state.failures) ? (state.failures as unknown[]).length : null;
	consider(
		"failureCount",
		failures,
		Array.isArray(replayOutcome.failures) ? (replayOutcome.failures as unknown[]).length : null,
	);
	return { fieldsCompared: fields, original, replay, diverged };
}

/** Finish a replay run: MATCHED / DIVERGED / ERROR with its diff. */
export function finishReplay(id: string, replayOutcome: Record<string, unknown>, error?: string): boolean {
	if (!id) return false;
	try {
		const row = store.get<ReplayRunRow>(`SELECT * FROM replay_runs WHERE id = ?`, [id]);
		if (!row) return false;
		const checkpoint = getCheckpoint(row.checkpoint_id);
		if (error) {
			store.run(`UPDATE replay_runs SET status = 'error', diff = ? WHERE id = ?`, [
				JSON.stringify({ error: String(error).slice(0, 400) }),
				id,
			]);
		} else if (checkpoint) {
			const comparison = compareReplay(checkpoint.state, replayOutcome);
			const status = comparison.diverged.length === 0 ? "matched" : "diverged";
			store.run(`UPDATE replay_runs SET status = ?, diff = ? WHERE id = ?`, [
				status,
				JSON.stringify(comparison),
				id,
			]);
			emit("checkpoint:replay-finished", { id, checkpointId: row.checkpoint_id, status });
			return true;
		} else {
			store.run(`UPDATE replay_runs SET status = 'error', diff = ? WHERE id = ?`, [
				JSON.stringify({ error: "checkpoint pruned before replay finished" }),
				id,
			]);
		}
		emit("checkpoint:replay-finished", { id, status: error ? "error" : "error" });
		return true;
	} catch {
		return false;
	}
}

export function listReplayRuns(limit = 50): ReplayRunRow[] {
	const capped = Math.min(Math.max(1, limit), 200);
	return store.query<ReplayRunRow>(`SELECT * FROM replay_runs ORDER BY ts DESC LIMIT ${capped}`);
}

export interface ReplayAnalytics {
	total: number;
	matched: number;
	diverged: number;
	errors: number;
	/** matched / total — the reproducibility score; null when never measured. */
	reproducibility: number | null;
}

export function replayAnalytics(): ReplayAnalytics {
	const rows = store.query<{ status: string }>(`SELECT status FROM replay_runs`);
	const total = rows.length;
	const matched = rows.filter((r) => r.status === "matched").length;
	const diverged = rows.filter((r) => r.status === "diverged").length;
	const errors = rows.filter((r) => r.status === "error").length;
	return { total, matched, diverged, errors, reproducibility: total === 0 ? null : matched / total };
}
