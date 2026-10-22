/**
 * ralph.ts — the Ralph loop (M4): Geoffrey Huntley's "Ralph Wiggum" pattern
 * as goose ships it (https://goose-docs.ai/docs/tutorials/ralph-loop), made
 * a first-class Unown harness surface: `unown ralph "<task>"`.
 *
 * The loop (goose's, kept intact):
 *   1. WORKER run — fresh context (a brand-new headless session, zero
 *      history): do the task, honour the reviewer's feedback file when one
 *      exists, keep `.unown/ralph/<run>/summary.md` current.
 *   2. REVIEWER run — fresh context, ideally a DIFFERENT model
 *      (`--reviewer-model`; cross-model review is the point of the pattern):
 *      read the task, the summary and the diff since the loop started, and
 *      emit `VERDICT: SHIP` or `VERDICT: REVISE` (+ a FEEDBACK section).
 *   3. SHIP ends the loop; REVISE writes `feedback.md` and the next worker
 *      iteration starts — FRESH again, state handed off ONLY through files
 *      (task.md / summary.md / feedback.md), never history.
 *   4. At most N iterations (default 5); exhaustion ends the loop honestly
 *      (`max-iterations`) with every file left for inspection.
 *
 * Layering (the watch.ts contract):
 *   - PURE: parseRalphVerdict, buildWorkerPrompt, buildReviewerPrompt,
 *     capIterations — total over their input, no I/O.
 *   - SEMI-PURE: captureDiffSince runs git through the existing hardened
 *     runGit (injectable for tests).
 *   - ENGINE: runRalphLoop — the orchestrator. Agent runs go through the
 *     automations spawn seam (spawnAutomationRun — the same headless
 *     `unown --mode json -p --no-session` CLI, the same 30-min timeout
 *     routine and watch runs use), never a bespoke spawner. Every worker
 *     and reviewer run is recorded as a `runs` row (`ralph-worker` /
 *     `ralph-reviewer`) — the dashboard Runs pane and /api/runs render
 *     them with no new surface.
 *
 * Reviewer failure semantics (goose's): a reviewer that exits non-zero or
 * fails to emit a parseable VERDICT line defaults to REVISE — the loop may
 * continue, it may never silently ship. The feedback file then carries the
 * raw output plus a harness note, and the worker of the next iteration
 * decides what to do with it.
 *
 * The loop is USER-INITIATED (like `unown watch run`, unlike the scheduled
 * jobs): it runs in-process, spawns its children directly, and records into
 * the shared SQLite store (WAL allows the second short-lived writer).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnAutomationRun, type AutomationRow, type AutomationRunRow } from "./automations.ts";
import { emit } from "./bus.ts";
import { runGit } from "./gittools.ts";
import { store } from "./store.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default iteration budget (goose's tutorial shape: 5 is enough for most
 * tasks; a stubborn task documents itself in the files and exits honestly). */
export const RALPH_DEFAULT_ITERATIONS = 5;

/** Hard cap — `--iterations` above this is a usage error, not a wallet drain. */
export const RALPH_MAX_ITERATIONS = 20;

/** Where the loop's handoff files live, relative to the workspace. */
export const RALPH_DIR = ".unown/ralph";

/** The verdict marker grammar. Case-insensitive, leading whitespace
 * tolerated, must be start-of-line so prose ("the verdict: ship it") never
 * matches. Takes the FIRST match — a reviewer that reconsiders mid-answer
 * is judged by its first call. */
const VERDICT_RE = /^[ \t]*VERDICT:[ \t]*(SHIP|REVISE)\b/im;

/** Reviewer diff budget: `git diff <baseline>` output is capped here — a
 * huge diff is summarized by truncation, never allowed to eat the prompt. */
export const RALPH_DIFF_BUDGET_CHARS = 30_000;

// ---------------------------------------------------------------------------
// PURE: the verdict + prompt layers
// ---------------------------------------------------------------------------

export type RalphVerdict = "ship" | "revise";

/** Parse the reviewer's verdict. A missing/garbled VERDICT line is `null` —
 * the orchestrator treats it as REVISE-with-note (goose semantics). */
export function parseRalphVerdict(output: string): RalphVerdict | null {
        const m = VERDICT_RE.exec(output);
        if (!m) return null;
        return m[1].toUpperCase() === "SHIP" ? "ship" : "revise";
}

/** Validate/cap the iteration budget. Returns the clamped-to-integer value
 * or an error string for the CLI to print. */
export function capIterations(requested: number): { ok: true; iterations: number } | { ok: false; error: string } {
        if (!Number.isInteger(requested) || requested < 1) {
                return { ok: false, error: `--iterations must be a positive integer (got ${requested})` };
        }
        if (requested > RALPH_MAX_ITERATIONS) {
                return { ok: false, error: `--iterations is capped at ${RALPH_MAX_ITERATIONS} (got ${requested})` };
        }
        return { ok: true, iterations: requested };
}

export interface WorkerPromptArgs {
        task: string;
        /** 1-based iteration number (shown; the worker knows where it stands). */
        iteration: number;
        maxIterations: number;
        /** The previous reviewer's feedback (file content), or null on iteration 1. */
        feedback: string | null;
        /** Where summary.md lives (absolute), so the worker can write it. */
        summaryPath: string;
}

/** The worker's prompt — fresh context every iteration (goose's rule: the
 * task is restated verbatim; the ONLY carried state is the feedback file). */
export function buildWorkerPrompt(args: WorkerPromptArgs): string {
        const head =
                `You are the WORKER in a Ralph loop (iteration ${args.iteration} of ${args.maxIterations}) — ` +
                `a repeated worker→reviewer cycle where every iteration starts with a FRESH session: you have NO chat history, ` +
                `state reaches you only through the files named below.\n\n` +
                `TASK (verbatim):\n${args.task}\n\n` +
                `Keep your working summary current at ${args.summaryPath} — what you did, how you verified it, what remains. ` +
                `The reviewer reads that file and the repository diff; a stale summary will read as unfinished work.`;
        if (args.feedback === null) {
                return `${head}\n\nDo the task, verify what you can verify yourself, update the summary file, then finish with a clear report of what was done and what was found.`;
        }
        return (
                `${head}\n\n` +
                `The reviewer's feedback on the previous iteration (address EVERY point — the loop only ends when the reviewer ships):\n` +
                `---\n${args.feedback}\n---\n\n` +
                `Continue the work with that feedback addressed, verify, update the summary file, then finish with a clear report.`
        );
}

export interface ReviewerPromptArgs {
        task: string;
        /** summary.md content as the worker left it ("" when missing). */
        summary: string;
        /** `git diff <baseline>` output (capped), or null outside a git repo. */
        diff: string | null;
        /** Untracked-file note from `git status --porcelain` (null = none/na). */
        untracked: string | null;
}

/** The reviewer's prompt — fresh context, a second opinion on the CURRENT
 * repository state. The VERDICT grammar is contractual (parseRalphVerdict). */
export function buildReviewerPrompt(args: ReviewerPromptArgs): string {
        const diffBlock =
                args.diff === null
                        ? "(not a git repository — review the workspace state directly)"
                        : args.diff.trim() === ""
                                ? "(no tracked changes since the loop started)"
                                : args.diff;
        const untrackedBlock =
                args.untracked && args.untracked.trim() !== "" ? `\n\nUntracked files (new, not in the diff above):\n${args.untracked}` : "";
        return (
                `You are the REVIEWER in a Ralph loop — an independent second pass with a FRESH session (no chat history). ` +
                `The worker claims the task below is done. Review the actual repository state, not just the claims.\n\n` +
                `TASK (verbatim):\n${args.task}\n\n` +
                `WORKER SUMMARY (from summary.md — claims, not facts):\n---\n${args.summary || "(missing — the worker did not write one)"}\n---\n\n` +
                `CHANGES SINCE THE LOOP STARTED:\n---\n${diffBlock}\n---${untrackedBlock}\n\n` +
                `Your LAST line must be exactly one of:\n` +
                `VERDICT: SHIP\n` +
                `VERDICT: REVISE\n\n` +
                `If (and only if) the task is genuinely complete and verified, end with VERDICT: SHIP. ` +
                `Otherwise end with VERDICT: REVISE and include a section titled FEEDBACK: with concrete, actionable items for the next worker iteration. ` +
                `Be strict: a ship verdict ends the loop and the work is taken as done.`
        );
}

// ---------------------------------------------------------------------------
// SEMI-PURE: git capture
// ---------------------------------------------------------------------------

/** The diff state captured for the reviewer: baseline sha + diff + untracked. */
export interface RalphDiff {
        diff: string | null;
        untracked: string | null;
}

/** Capture `git diff <baseline>` (tracked changes vs the loop-start commit,
 * staged + unstaged) and the untracked-file list, each capped. Returns
 * {diff: null} when the workspace is not a git repo (reviewer is told so).
 * Never throws — a git failure is reported as an unavailable diff. */
export async function captureDiffSince(workspace: string, baselineSha: string): Promise<RalphDiff> {
        const rev = await runGit(workspace, ["rev-parse", "--verify", `${baselineSha}^{commit}`], { readOnly: true });
        if (rev.code !== 0) return { diff: null, untracked: null };
        const diff = await runGit(workspace, ["diff", baselineSha, "--"], { readOnly: true });
        const status = await runGit(workspace, ["status", "--porcelain"], { readOnly: true });
        const clip = (s: string) =>
                s.length > RALPH_DIFF_BUDGET_CHARS
                        ? `${s.slice(0, RALPH_DIFF_BUDGET_CHARS)}\n… (diff truncated at ${RALPH_DIFF_BUDGET_CHARS} chars — review the rest directly)`
                        : s;
        const untrackedLines = status.stdout
                .split("\n")
                .filter((l) => l.startsWith("??"))
                .map((l) => l.slice(3).trim())
                .filter(Boolean)
                .join("\n");
        return { diff: clip(diff.stdout), untracked: untrackedLines || null };
}

/** The loop-start baseline: current HEAD sha, or null outside a git repo. */
export async function captureBaseline(workspace: string): Promise<string | null> {
        const res = await runGit(workspace, ["rev-parse", "HEAD"], { readOnly: true });
        return res.code === 0 ? res.stdout.trim() : null;
}

// ---------------------------------------------------------------------------
// ENGINE: the spawn seam
// ---------------------------------------------------------------------------

export interface RalphSpawnOutcome {
        exitCode: number;
        output: string;
        turns: number;
        tokensIn: number;
        tokensOut: number;
}

/** The injectable spawn seam — production is spawnRalphRun; tests fake it. */
export type RalphSpawnFn = (args: {
        kind: "worker" | "reviewer";
        iteration: number;
        prompt: string;
        model: string | null;
        workspace: string;
}) => Promise<RalphSpawnOutcome>;

/** Production spawner: the automations seam VERBATIM (the same headless CLI,
 * the same 30-min timeout, UNOWN_AUTOMATION=1). Workers run STANDARD (the
 * task is to change the repo — same trust level as any agent session);
 * reviewers run READ-ONLY (a reviewer that edits the work it judges defeats
 * the pattern). */
export function spawnRalphRun(args: { kind: "worker" | "reviewer"; iteration: number; prompt: string; model: string | null; workspace: string }): Promise<RalphSpawnOutcome> {
        const now = Date.now();
        const automation: AutomationRow = {
                id: `ralph:${args.kind}:${now}`,
                title: `Ralph ${args.kind} (iteration ${args.iteration})`,
                prompt: args.prompt,
                cron_expr: null,
                delay_ms: null,
                schedule_kind: null,
                interval_n: null,
                interval_unit: null,
                interval_at: null,
                timezone: null,
                until_ms: null,
                misfire: null,
                event_kind: null,
                event_filter: null,
                active_hours: null, // ralph runs are user-initiated — no policy gates
                idle_only: 0,
                deliver_url: null,
                jitter_secs: null,
                workspace: args.workspace,
                mode: args.kind === "reviewer" ? "read-only" : "standard",
                model: args.model,
                max_runs: null,
                run_count: 0,
                scheduled_run_count: 0,
                lifecycle: "active",
                next_run_at: null,
                last_run_at: null,
                running: 0,
                claimed_at: null,
                dispatch_status: "idle",
                dispatch_attempts: 0,
                retry_at: null,
                last_error: null,
                created_at: now,
                updated_at: now,
        };
        const run: AutomationRunRow = {
                id: `ralph:${args.kind}:${now}`,
                automation_id: automation.id,
                trigger_kind: "manual",
                scheduled_at: null,
                status: "running",
                started_at: now,
                ended_at: null,
                exit_code: null,
                output: null,
                error: null,
                turns: 0,
                tokens_in: 0,
                tokens_out: 0,
                delivered: null,
        };
        return spawnAutomationRun(automation, run);
}

// ---------------------------------------------------------------------------
// ENGINE: the orchestrator
// ---------------------------------------------------------------------------

export interface RalphIterationRecord {
        iteration: number;
        worker: { exitCode: number; turns: number; tokensIn: number; tokensOut: number };
        reviewer: { exitCode: number; turns: number; tokensIn: number; tokensOut: number };
        /** The parsed verdict; null when the reviewer emitted none (recorded as a revise). */
        verdict: RalphVerdict;
        verdictExplicit: boolean;
        /** Wall-clock start/end of the whole iteration pair. */
        startedAt: number;
        endedAt: number;
}

export interface RalphLoopResult {
        runId: string;
        task: string;
        workspace: string;
        maxIterations: number;
        iterations: RalphIterationRecord[];
        /** How the loop ended. */
        final: "ship" | "max-iterations";
        dir: string;
        baseline: string | null;
        startedAt: number;
        endedAt: number;
        tokensIn: number;
        tokensOut: number;
}

const RALPH_SCHEMA = `
CREATE TABLE IF NOT EXISTS ralph_runs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  workspace TEXT NOT NULL,
  max_iterations INTEGER NOT NULL,
  worker_model TEXT,
  reviewer_model TEXT,
  status TEXT NOT NULL,              -- running | ship | max-iterations
  baseline TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  iterations_run INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ralph_runs_started ON ralph_runs (started_at);
`;

export function ensureRalphSchema(): void {
        for (const stmt of RALPH_SCHEMA.split(";")) {
                const trimmed = stmt.trim();
                if (trimmed.length > 0) store.run(trimmed, []);
        }
}

export interface RunRalphOpts {
        task: string;
        workspace: string;
        /** Validated by capIterations upstream; default RALPH_DEFAULT_ITERATIONS. */
        maxIterations?: number;
        workerModel?: string | null;
        reviewerModel?: string | null;
        /** Injectable for tests; default spawnRalphRun. */
        spawn?: RalphSpawnFn;
        /** Injectable diff capture (tests); default captureDiffSince/captureBaseline. */
        capture?: (workspace: string, baseline: string | null) => Promise<RalphDiff>;
}

/** One full Ralph loop. Writes the handoff files, runs the pairs, records
 * every spawn as a `runs` row and the loop as a `ralph_runs` row, emits
 * `ralph:iteration-finished` / `ralph:done` on the bus. */
export async function runRalphLoop(opts: RunRalphOpts): Promise<RalphLoopResult> {
        const maxIterations = opts.maxIterations ?? RALPH_DEFAULT_ITERATIONS;
        const spawn = opts.spawn ?? spawnRalphRun;
        const task = opts.task.trim();
        if (task.length === 0) throw new Error("ralph: the task must not be empty");
        ensureRalphSchema();
        const runId = `ralph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const dir = join(opts.workspace, RALPH_DIR, runId);
        mkdirSync(dir, { recursive: true });
        const taskPath = join(dir, "task.md");
        const summaryPath = join(dir, "summary.md");
        const feedbackPath = join(dir, "feedback.md");
        const verdictPath = join(dir, "verdict.md");
        // The frozen task + the empty summary the worker fills.
        writeFileSync(taskPath, `${task}\n`);
        writeFileSync(summaryPath, "");

        const capture = opts.capture ?? ((ws: string, baseline: string | null) => (baseline ? captureDiffSince(ws, baseline) : Promise.resolve({ diff: null, untracked: null })));
        const baseline = await captureBaseline(opts.workspace);
        const startedAt = Date.now();
        store.run(
                `INSERT INTO ralph_runs (id, task, workspace, max_iterations, worker_model, reviewer_model, status, baseline, started_at)
                 VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
                [runId, task, opts.workspace, maxIterations, opts.workerModel ?? null, opts.reviewerModel ?? null, baseline, startedAt],
        );

        const result: RalphLoopResult = {
                runId,
                task,
                workspace: opts.workspace,
                maxIterations,
                iterations: [],
                final: "max-iterations",
                dir,
                baseline,
                startedAt,
                endedAt: 0,
                tokensIn: 0,
                tokensOut: 0,
        };

        let feedback: string | null = null;
        let i = 0;
        while (i < maxIterations) {
                i++;
                const iterStart = Date.now();
                // 1) WORKER — fresh context, feedback (if any) as the only carried state.
                const workerPrompt = buildWorkerPrompt({ task, iteration: i, maxIterations, feedback, summaryPath });
                const worker = await spawn({ kind: "worker", iteration: i, prompt: workerPrompt, model: opts.workerModel ?? null, workspace: opts.workspace });
                recordRunsRow(runId, "ralph-worker", i, worker, workerPrompt, iterStart);
                // 2) REVIEWER — fresh context, judges the repository state.
                const { diff, untracked } = await capture(opts.workspace, baseline);
                const summary = safeRead(summaryPath);
                const reviewerPrompt = buildReviewerPrompt({ task, summary, diff, untracked });
                const reviewer = await spawn({ kind: "reviewer", iteration: i, prompt: reviewerPrompt, model: opts.reviewerModel ?? null, workspace: opts.workspace });
                const parsed = parseRalphVerdict(reviewer.output);
                const verdict: RalphVerdict = parsed ?? "revise"; // the goose default: never silently ship
                const verdictExplicit = parsed !== null;
                const iterEnd = Date.now();
                recordRunsRow(runId, "ralph-reviewer", i, reviewer, reviewerPrompt, iterStart);
                const record: RalphIterationRecord = {
                        iteration: i,
                        worker: { exitCode: worker.exitCode, turns: worker.turns, tokensIn: worker.tokensIn, tokensOut: worker.tokensOut },
                        reviewer: { exitCode: reviewer.exitCode, turns: reviewer.turns, tokensIn: reviewer.tokensIn, tokensOut: reviewer.tokensOut },
                        verdict,
                        verdictExplicit,
                        startedAt: iterStart,
                        endedAt: iterEnd,
                };
                result.iterations.push(record);
                result.tokensIn += worker.tokensIn + reviewer.tokensIn;
                result.tokensOut += worker.tokensOut + reviewer.tokensOut;
                store.run(`UPDATE ralph_runs SET iterations_run = ?, tokens_in = ?, tokens_out = ? WHERE id = ?`, [
                        i,
                        result.tokensIn,
                        result.tokensOut,
                        runId,
                ]);
                emit("ralph:iteration-finished", { runId, iteration: i, verdict, verdictExplicit, workerExit: worker.exitCode, reviewerExit: reviewer.exitCode });

                if (verdict === "ship") {
                        writeFileSync(verdictPath, `VERDICT: SHIP (iteration ${i})\n\nReviewer:\n${reviewer.output.slice(0, 20_000)}\n`);
                        result.final = "ship";
                        break;
                }
                // REVISE (explicit or defaulted): the feedback file IS the handoff.
                const note = verdictExplicit
                        ? ""
                        : "> (the reviewer emitted no parseable VERDICT line — defaulted to REVISE; its full output follows)\n\n";
                feedback = `${note}${reviewer.output.slice(0, 20_000)}`;
                writeFileSync(feedbackPath, feedback);
        }

        result.endedAt = Date.now();
        if (result.final !== "ship") {
                writeFileSync(verdictPath, `VERDICT: REVISE — iteration budget (${maxIterations}) exhausted, the work is NOT shipped.\n\nLast reviewer feedback is in feedback.md; inspect summary.md for where the worker stood.\n`);
        }
        store.run(
                `UPDATE ralph_runs SET status = ?, ended_at = ?, iterations_run = ?, tokens_in = ?, tokens_out = ? WHERE id = ?`,
                [result.final, result.endedAt, result.iterations.length, result.tokensIn, result.tokensOut, runId],
        );
        emit("ralph:done", { runId, final: result.final, iterations: result.iterations.length });
        return result;
}

/** One `runs` row per spawn — the dashboard Runs pane renders these with no
 * new surface (kind ralph-worker / ralph-reviewer, task_id = the loop id). */
function recordRunsRow(runId: string, kind: "ralph-worker" | "ralph-reviewer", iteration: number, outcome: RalphSpawnOutcome, prompt: string, startedAt: number): void {
        try {
                store.run(
                        `INSERT OR REPLACE INTO runs (id, task_id, kind, status, started_at, ended_at, prompt, tokens_in, tokens_out, turns, error)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                                `${runId}:${kind}:${iteration}`,
                                runId,
                                kind,
                                outcome.exitCode === 0 ? "passed" : "failed",
                                startedAt,
                                Date.now(),
                                prompt.slice(0, 2_000),
                                outcome.tokensIn,
                                outcome.tokensOut,
                                outcome.turns,
                                outcome.exitCode === 0 ? null : `exit ${outcome.exitCode}`,
                        ],
                );
        } catch {
                /* the runs table is observability, never a gate */
        }
}

function safeRead(path: string): string {
        try {
                return readFileSync(path, "utf8");
        } catch {
                return "";
        }
}
