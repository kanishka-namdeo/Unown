/**
 * run-progress.ts — in-memory live progress for in-flight agent runs
 * (audit M4-c D4 / M6-2): REST consumers could see a run start and finish
 * but NOTHING in between — turns/tokens/tool calls only landed in SQLite at
 * finalize, so the only live signal was the SSE stream. A polling client
 * (curl, scripts, down-SSE dashboards) had no way to answer "what is the
 * engine doing RIGHT NOW".
 *
 * Design: an in-memory Map keyed by run id, updated from the SAME
 * session.subscribe telemetry that already feeds the SSE events and the
 * final DB row (single instrumentation point in runner.ts — the numbers
 * here are the same numbers finalize persists, observed mid-flight).
 *
 * Why not the DB: the run row's finalize writes the full transcript and
 * counters atomically at the end; mirroring every tool call into SQLite
 * would add WAL churn for data that is ephemeral by definition. The engine
 * is a single process (single-instance lock at boot), so in-process state
 * is authoritative for live runs; after finalize — or a crash, where
 * recoverOrphans heals the rows — the DB is the source of truth and the
 * map is empty. Coherent on both paths.
 *
 * Safety: every update runs inside try/catch at the call site boundary
 * (touch never throws — telemetry must not break a run), and a stale-entry
 * sweep drops anything not updated for 30 minutes (the run watchdog caps
 * runs well below that; the sweep only guards against a leaked entry from
 * a future code path that skips finalize).
 */

/** Live snapshot of an in-flight run. Mirrors the runAgent counters
 * (turns/tokensIn/tokensOut/toolCalls) plus the last observable signals
 * (current tool, last assistant text preview, live context size). */
export interface LiveRunProgress {
        id: string;
        taskId: string | null;
        kind: string;
        cycleId: string | null;
        improvementId: string | null;
        label: string | null;
        startedAt: number;
        /** Completed turns (turn_end events) — the LLM is often mid-turn. */
        turns: number;
        tokensIn: number;
        tokensOut: number;
        toolCalls: number;
        toolsUsed: string[];
        lastTool: { tool: string; phase: "start" | "end"; isError?: boolean; at: number } | null;
        /** First 240 chars of the most recent assistant text (same cut as the SSE preview). */
        lastTextPreview: string;
        /** Live context window size (latest usage.input — see runner.ts §3.7). */
        contextTokens: number;
        updatedAt: number;
}

/** What REST consumers see — LiveRunProgress plus the derived elapsed. */
export type LiveRunView = LiveRunProgress & { elapsedMs: number };

const live = new Map<string, LiveRunProgress>();

/** Entries with no update for this long are dropped on read (watchdog caps
 * real runs far below this; the sweep only guards leaked entries). */
const STALE_MS = 30 * 60 * 1000;

function isStale(p: LiveRunProgress, now: number): boolean {
        return now - p.updatedAt > STALE_MS;
}

/** Register a run at INSERT time (runner.ts). Re-registering the same id
 * (retry paths reuse nothing — ids are fresh per runAgent call) resets it. */
export function beginLiveRun(info: {
        id: string;
        taskId: string | null;
        kind: string;
        cycleId: string | null;
        improvementId: string | null;
        label?: string | null;
        startedAt: number;
}): void {
        live.set(info.id, {
                id: info.id,
                taskId: info.taskId,
                kind: info.kind,
                cycleId: info.cycleId,
                improvementId: info.improvementId,
                label: info.label ?? null,
                startedAt: info.startedAt,
                turns: 0,
                tokensIn: 0,
                tokensOut: 0,
                toolCalls: 0,
                toolsUsed: [],
                lastTool: null,
                lastTextPreview: "",
                contextTokens: 0,
                updatedAt: info.startedAt,
        });
}

/** Mutate a live entry. NEVER throws: unknown ids (already finalized) and
 * mutator errors are swallowed — progress telemetry must not break a run. */
export function touchLiveRun(runId: string, fn: (p: LiveRunProgress) => void): void {
        try {
                const p = live.get(runId);
                if (!p) return;
                fn(p);
                p.updatedAt = Date.now();
        } catch {
                /* never let telemetry break the run */
        }
}

/** Drop a live entry — finalize (all paths) and the outer finally both call
 * this; once a run is finished the DB row is the source of truth. */
export function finishLiveRun(runId: string): void {
        live.delete(runId);
}

function viewOf(p: LiveRunProgress, now: number): LiveRunView {
        return { ...p, elapsedMs: now - p.startedAt };
}

/** One run's live progress (null when not in flight — finished, unknown,
 * or pre-boot runs; the DB row serves those). */
export function getLiveRun(id: string): LiveRunView | null {
        const p = live.get(id);
        if (!p) return null;
        const now = Date.now();
        if (isStale(p, now)) {
                live.delete(id);
                return null;
        }
        return viewOf(p, now);
}

/** All in-flight runs, oldest first (stable poll order for consumers that
 * diff consecutive polls). */
export function listLiveRuns(): LiveRunView[] {
        const now = Date.now();
        const out: LiveRunView[] = [];
        for (const p of live.values()) {
                if (isStale(p, now)) {
                        live.delete(p.id);
                        continue;
                }
                out.push(viewOf(p, now));
        }
        out.sort((a, b) => a.startedAt - b.startedAt);
        return out;
}
