/**
 * plm/process-registry.ts — the Process Registry (mission core).
 *
 * Every significant activity the engine performs becomes a first-class
 * tracked process: a `processes` row created at inception, an append-only
 * `process_events` journal for every state transition, and a terminal
 * write (outcome + lessons + usage) when it ends. The registry is the ONLY
 * writer of process state — domain code (router, runner, dream, …) calls
 * beginProcess / transitionProcess / finishProcess and never touches the
 * tables directly, so the state machine (plm/states.ts) is enforced in
 * exactly one place.
 *
 * Traceability contract (the mission's Process Registry table):
 *   Process ID · Parent Process · Objective · Owner · Task · Start · End ·
 *   Status · Tool Usage · Token Usage · Cost · Outcome · Lessons Learned.
 *
 * Every mutation emits a bus event (process:created / process:transition /
 * process:finished) — the SSE stream forwards them to the dashboard
 * automatically, and the event jobs can react (e.g. recovery on FAILED).
 *
 * Kill switch: UNOWN_PLM=0 disables the registry entirely (beginProcess
 * returns a null handle whose transitions are no-ops — callers never
 * branch). Retention: the db-retention job prunes old ARCHIVED processes
 * (retention.ts owns the windows; precious rows are never pruned).
 */

import { randomUUID } from "node:crypto";
import { emit } from "../bus.ts";
import { store } from "../store.ts";
import {
	ARCHIVED,
	isLegalTransition,
	isProcessKind,
	isProcessState,
	type ProcessKind,
	type ProcessState,
	TERMINAL_STATES,
} from "./states.ts";

// ---------------------------------------------------------------------------
// Kill switch + row caps
// ---------------------------------------------------------------------------

/** PLM telemetry master switch (default ON — the mission wants it always-on;
 *  the switch exists for the "no telemetry writes ever" posture, like every
 *  other Unown surface). */
export function plmEnabled(): boolean {
	return (process.env.UNOWN_PLM || "1") !== "0";
}

const CLIP = 400;

function clip(text: string | null | undefined): string | null {
	if (text === null || text === undefined) return null;
	const clean = String(text).replace(/\s+/g, " ").trim();
	return clean.length === 0 ? null : clean.slice(0, CLIP);
}

// ---------------------------------------------------------------------------
// The process row shape
// ---------------------------------------------------------------------------

export interface ProcessRow {
	id: string;
	parent_id: string | null;
	kind: string;
	objective: string;
	owner: string | null;
	task_ref: string | null;
	status: string;
	status_reason: string | null;
	created_at: number;
	started_at: number | null;
	ended_at: number | null;
	duration_ms: number | null;
	attempt: number;
	tool_usage: string | null;
	token_usage: string | null;
	cost_usd: number | null;
	outcome: string | null;
	lessons: string | null;
	checkpoint_id: string | null;
}

export interface ProcessEventRow {
	id: number;
	process_id: string;
	from_status: string | null;
	to_status: string;
	reason: string | null;
	ts: number;
}

export interface BeginProcessInput {
	/** Who owns this process (the emitting subsystem or agent name). */
	owner: string;
	/** One line: what this process exists to do. Required — no anonymous work. */
	objective: string;
	kind: ProcessKind | string;
	/** The domain row this process mirrors (job id, run id, automation id, …). */
	taskRef?: string | null;
	/** Parent process id for nested work (run → job, cycle → job). */
	parentId?: string | null;
	/** Already past creation? (a late-attaching caller can birth a process straight into RUNNING). */
	started?: boolean;
}

/**
 * A live handle for a tracked process. All methods are safe on the null
 * handle (UNOWN_PLM=0): domain code never branches on telemetry.
 */
export interface ProcessHandle {
	readonly id: string | null;
	/** Request a state transition (refused — with a console receipt — when illegal). */
	transition(to: ProcessState, reason?: string): void;
	/** Terminal helpers with usage rollups. */
	succeed(outcome?: string, usage?: ProcessUsage): void;
	fail(outcome?: string, usage?: ProcessUsage): void;
	abandon(reason?: string): void;
	/** Attach the usage rollup + lessons without terminating (milestone writes). */
	setUsage(usage: ProcessUsage): void;
	setLessons(lessons: string): void;
	/** Latest checkpoint pointer (checkpoints.ts writes through this). */
	setCheckpoint(checkpointId: string): void;
}

export interface ProcessUsage {
	toolCalls?: number;
	toolErrors?: number;
	tokensIn?: number;
	tokensOut?: number;
	costUsd?: number;
}

// ---------------------------------------------------------------------------
// Registry core
// ---------------------------------------------------------------------------

export function beginProcess(input: BeginProcessInput): ProcessHandle {
	const nullHandle: ProcessHandle = {
		id: null,
		transition: () => {},
		succeed: () => {},
		fail: () => {},
		abandon: () => {},
		setUsage: () => {},
		setLessons: () => {},
		setCheckpoint: () => {},
	};
	if (!plmEnabled()) return nullHandle;

	const id = randomUUID();
	const kind = isProcessKind(input.kind) ? input.kind : "plm-internal";
	const now = Date.now();
	try {
		store.run(
			`INSERT INTO processes (id, parent_id, kind, objective, owner, task_ref, status, status_reason, created_at, started_at, attempt)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
			[
				id,
				input.parentId ?? null,
				kind,
				clip(input.objective) ?? "(unnamed)",
				clip(input.owner),
				input.taskRef ?? null,
				"CREATED",
				null,
				now,
				input.started ? now : null,
			],
		);
		store.run(
			`INSERT INTO process_events (process_id, from_status, to_status, reason, ts) VALUES (?, NULL, 'CREATED', ?, ?)`,
			[id, clip(input.objective), now],
		);
		if (input.started) {
			// A late-attaching caller: birth straight through to RUNNING.
			store.run(`UPDATE processes SET status = 'RUNNING' WHERE id = ?`, [id]);
			store.run(
				`INSERT INTO process_events (process_id, from_status, to_status, reason, ts) VALUES (?, 'CREATED', 'RUNNING', ?, ?)`,
				[id, "attached while running", now],
			);
		}
		emit("process:created", {
			id,
			kind,
			objective: clip(input.objective),
			owner: input.owner,
			taskRef: input.taskRef ?? null,
		});
	} catch (err: unknown) {
		// Telemetry invariant: registry failure must NEVER break the work it
		// observes (the runner's own subscribe() discipline).
		console.warn(`[plm] process registry write failed: ${err instanceof Error ? err.message : String(err)}`);
		return nullHandle;
	}
	return {
		id,
		transition: (to, reason) => transitionProcess(id, to, reason),
		succeed: (outcome, usage) => finishProcess(id, "SUCCEEDED", outcome, usage),
		fail: (outcome, usage) => finishProcess(id, "FAILED", outcome, usage),
		abandon: (reason) => finishProcess(id, "ABANDONED", reason, undefined),
		setUsage: (usage) => applyUsage(id, usage),
		setLessons: (lessons) => {
			try {
				store.run(`UPDATE processes SET lessons = ? WHERE id = ?`, [clip(lessons), id]);
			} catch {
				/* telemetry invariant */
			}
		},
		setCheckpoint: (checkpointId) => {
			try {
				store.run(`UPDATE processes SET checkpoint_id = ? WHERE id = ?`, [checkpointId, id]);
			} catch {
				/* telemetry invariant */
			}
		},
	};
}

/**
 * The single transition choke point. Refuses illegal edges (state machine
 * discipline) with a console receipt; legal edges append a process_events
 * row, update the row's status + first-start/terminal timestamps, and emit
 * the transition event.
 */
export function transitionProcess(id: string, to: ProcessState, reason?: string): boolean {
	if (!isProcessState(to)) return false;
	const row = store.get<ProcessRow>(`SELECT * FROM processes WHERE id = ?`, [id]);
	if (!row) return false;
	const from = row.status as ProcessState;
	if (from === to) return false;
	if (!isLegalTransition(from, to)) {
		console.warn(`[plm] refusing process transition ${id}: ${from} → ${to} is not a legal edge`);
		return false;
	}
	const now = Date.now();
	try {
		store.run(`UPDATE processes SET status = ?, status_reason = ? WHERE id = ?`, [to, clip(reason), id]);
		store.run(`INSERT INTO process_events (process_id, from_status, to_status, reason, ts) VALUES (?, ?, ?, ?, ?)`, [
			id,
			from,
			to,
			clip(reason),
			now,
		]);
		if (to === "RUNNING" && row.started_at === null) {
			store.run(`UPDATE processes SET started_at = ? WHERE id = ?`, [now, id]);
		}
		if (TERMINAL_STATES.has(to) && row.ended_at === null) {
			store.run(`UPDATE processes SET ended_at = ? WHERE id = ?`, [now, id]);
			const started = row.started_at ?? now;
			store.run(`UPDATE processes SET duration_ms = ? WHERE id = ?`, [Math.max(0, now - started), id]);
		}
		if (to === "RETRYING") {
			store.run(`UPDATE processes SET attempt = attempt + 1 WHERE id = ?`, [id]);
		}
		emit("process:transition", { id, from, to, reason: clip(reason) });
		if (TERMINAL_STATES.has(to)) emit("process:finished", { id, from, to, outcome: clip(reason) });
		return true;
	} catch (err: unknown) {
		console.warn(`[plm] process transition write failed: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

function applyUsage(id: string, usage: ProcessUsage): void {
	try {
		// MERGE semantics: a later rollup that omits a field keeps the earlier
		// value (setUsage mid-flight then succeed() with the final counters must
		// not zero the fields only the mid-flight write knew).
		const row = store.get<ProcessRow>(`SELECT tool_usage, token_usage, cost_usd FROM processes WHERE id = ?`, [id]);
		const priorTools = row?.tool_usage ? (JSON.parse(row.tool_usage) as { calls?: number; errors?: number }) : {};
		const priorTokens = row?.token_usage ? (JSON.parse(row.token_usage) as { in?: number; out?: number }) : {};
		const toolUsage = JSON.stringify({
			calls: usage.toolCalls ?? priorTools.calls ?? 0,
			errors: usage.toolErrors ?? priorTools.errors ?? 0,
		});
		const tokenUsage = JSON.stringify({
			in: usage.tokensIn ?? priorTokens.in ?? 0,
			out: usage.tokensOut ?? priorTokens.out ?? 0,
		});
		store.run(`UPDATE processes SET tool_usage = ?, token_usage = ?, cost_usd = COALESCE(?, cost_usd) WHERE id = ?`, [
			toolUsage,
			tokenUsage,
			usage.costUsd ?? null,
			id,
		]);
	} catch {
		/* telemetry invariant */
	}
}

/** Terminal write: transition + usage + outcome in one call. */
export function finishProcess(
	id: string,
	to: "SUCCEEDED" | "FAILED" | "ABANDONED",
	outcome?: string,
	usage?: ProcessUsage,
): boolean {
	if (usage) applyUsage(id, usage);
	// A process finishing while never having been RUNNING (e.g. skipped at the
	// gate) still needs a legal path: CREATED → ABANDONED exists; for the
	// success/fail terminals from CREATED the honest edge is ABANDONED. A
	// process ALREADY in a terminal state refuses every late finalize — the
	// sticky-finalize discipline (a zombie's late write must be a no-op).
	const row = store.get<ProcessRow>(`SELECT status FROM processes WHERE id = ?`, [id]);
	if (!row) return false;
	const from = row.status as ProcessState;
	if (TERMINAL_STATES.has(from) || from === ARCHIVED) return false;
	let target: ProcessState = to;
	if (!isLegalTransition(from, target)) {
		if (isLegalTransition(from, "ABANDONED")) target = "ABANDONED";
		else return false;
	}
	const ok = transitionProcess(id, target, outcome);
	if (ok) {
		try {
			store.run(`UPDATE processes SET outcome = ? WHERE id = ?`, [clip(outcome), id]);
		} catch {
			/* telemetry invariant */
		}
	}
	return ok;
}

// ---------------------------------------------------------------------------
// Queries (API + dashboard)
// ---------------------------------------------------------------------------

export interface ProcessQuery {
	status?: string;
	kind?: string;
	limit?: number;
}

export function listProcesses(query: ProcessQuery = {}): ProcessRow[] {
	const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
	const where: string[] = [];
	const params: unknown[] = [];
	if (query.status && isProcessState(query.status)) {
		where.push(`status = ?`);
		params.push(query.status);
	}
	if (query.kind && isProcessKind(query.kind)) {
		where.push(`kind = ?`);
		params.push(query.kind);
	}
	const sql = `SELECT * FROM processes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ${limit}`;
	return store.query<ProcessRow>(sql, params as unknown[]);
}

export function getProcess(id: string): ProcessRow | undefined {
	return store.get<ProcessRow>(`SELECT * FROM processes WHERE id = ?`, [id]);
}

export function getProcessEvents(id: string): ProcessEventRow[] {
	return store.query<ProcessEventRow>(`SELECT * FROM process_events WHERE process_id = ? ORDER BY ts ASC, id ASC`, [
		id,
	]);
}

export function getProcessChildren(id: string): ProcessRow[] {
	return store.query<ProcessRow>(`SELECT * FROM processes WHERE parent_id = ? ORDER BY created_at ASC`, [id]);
}

/**
 * State-transition analytics: how many processes ever entered each state,
 * plus the current census. (Transition counts come from process_events —
 * historical, not just current rows.)
 */
export interface ProcessAnalytics {
	current: Record<string, number>;
	entered: Record<string, number>;
	transitionCounts: Array<{ from: string; to: string; count: number }>;
	total: number;
	avgDurationMs: number | null;
	byKind: Array<{ kind: string; count: number; ok: number; failed: number }>;
}

export function processAnalytics(): ProcessAnalytics {
	const current: Record<string, number> = {};
	for (const row of store.query<{ status: string; n: number }>(
		`SELECT status, COUNT(*) AS n FROM processes GROUP BY status`,
	)) {
		current[row.status] = row.n;
	}
	const entered: Record<string, number> = {};
	for (const row of store.query<{ to_status: string; n: number }>(
		`SELECT to_status, COUNT(*) AS n FROM process_events GROUP BY to_status`,
	)) {
		entered[row.to_status] = row.n;
	}
	const transitionCounts = store.query<{ from: string; to: string; count: number }>(
		`SELECT COALESCE(from_status, '(birth)') AS "from", to_status AS "to", COUNT(*) AS count FROM process_events GROUP BY from_status, to_status ORDER BY count DESC`,
	);
	const total = store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM processes`)?.n ?? 0;
	const avg = store.get<{ avg: number | null }>(
		`SELECT AVG(duration_ms) AS avg FROM processes WHERE duration_ms IS NOT NULL`,
	);
	const byKind = store.query<{ kind: string; count: number; ok: number; failed: number }>(
		`SELECT kind, COUNT(*) AS count,
			SUM(CASE WHEN status IN ('SUCCEEDED','ARCHIVED') AND outcome IS NOT NULL AND outcome != '' THEN 1 ELSE 0 END) AS ok,
			SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed
		 FROM processes GROUP BY kind ORDER BY count DESC`,
	);
	return { current, entered, transitionCounts, total, avgDurationMs: avg?.avg ?? null, byKind };
}

/**
 * Boot-time orphan recovery (the sticky-finalize discipline generalized):
 * any process left in a non-terminal state by a crashed boot is moved to
 * FAILED with an honest reason, its events row appended. Called from
 * server.ts's recoverOrphans lane so the registry never shows phantom
 * live work after a restart.
 */
export function recoverOrphanProcesses(now: number = Date.now()): number {
	let healed = 0;
	try {
		const rows = store.query<{ id: string; status: string }>(
			`SELECT id, status FROM processes WHERE status NOT IN ('SUCCEEDED','FAILED','ABANDONED','ARCHIVED')`,
		);
		for (const row of rows) {
			// State-aware healing, every edge legal in the machine: work that was
			// actively running/retrying/validating FAILED; work that never got
			// started (created) or was parked (waiting/blocked) is ABANDONED —
			// the honest verdict for a crash's orphans.
			const target: ProcessState =
				row.status === "RUNNING" || row.status === "RETRYING" || row.status === "VALIDATING"
					? "FAILED"
					: "ABANDONED";
			if (transitionProcess(row.id, target, "engine boot: process orphaned by an interrupted engine")) healed++;
		}
		// Anything already terminal-but-unarchived stays — archiving is a
		// separate, deliberate act (never automatic on boot).
		return healed;
	} catch {
		return healed;
	}
}

/** Archive a finished process (history compaction is explicit, never silent). */
export function archiveProcess(id: string): boolean {
	return transitionProcess(id, ARCHIVED, "archived");
}

// ---------------------------------------------------------------------------
// Terminal-session process reports (the POST /api/processes/report lane)
// ---------------------------------------------------------------------------

export interface TerminalSessionReport {
	sessionId: string;
	cwd?: string | null;
	projectSlug?: string | null;
	prompts?: number;
	toolCalls?: number;
	toolErrors?: number;
	tokensIn?: number;
	okensOut?: number;
	durationMs?: number;
	outcome?: string;
	startedAt?: number;
}

/**
 * Ingest a terminal session's process report (the human-work lane of the
 * Process View). Untrusted input parsed defensively; the row is birthed
 * straight into SUCCEEDED with its full event chain written in order
 * (CREATED → RUNNING → SUCCEEDED) so the history is complete even though
 * the process only arrives at its terminal state. Returns the process id
 * (null when refused).
 */
export function ingestTerminalSessionReport(report: unknown): string | null {
	if (!plmEnabled() || typeof report !== "object" || report === null) return null;
	const r = report as Record<string, unknown>;
	const sessionId = typeof r.sessionId === "string" ? r.sessionId.slice(0, 80) : "";
	if (!sessionId) return null;
	const num = (v: unknown, max = 10_000_000): number | null => {
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
	};
	const outcome = typeof r.outcome === "string" ? r.outcome.slice(0, 400) : null;
	const startedAt = num(r.startedAt);
	const durationMs = num(r.durationMs);
	const handle = beginProcess({
		owner: "terminal",
		kind: "terminal-session",
		objective: `terminal session ${sessionId}${typeof r.cwd === "string" ? ` in ${String(r.cwd).slice(0, 120)}` : ""}`,
		taskRef: sessionId,
		started: true,
	});
	if (!handle.id) return null;
	handle.setUsage({
		toolCalls: num(r.toolCalls) ?? 0,
		toolErrors: num(r.toolErrors) ?? 0,
		tokensIn: num(r.tokensIn) ?? 0,
		tokensOut: num(r.tokensOut) ?? 0,
	});
	handle.succeed(outcome ?? "session ended");
	// The reported duration is authoritative (the engine never saw the start).
	try {
		store.run(`UPDATE processes SET duration_ms = ? WHERE id = ?`, [durationMs, handle.id]);
		if (startedAt) store.run(`UPDATE processes SET started_at = ? WHERE id = ?`, [startedAt, handle.id]);
	} catch {
		/* telemetry invariant */
	}
	return handle.id;
}
