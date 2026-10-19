/**
 * automations.ts — scheduled recurring agent runs (the zcode Automations
 * port; the feature the parity record deferred with "deferred, not declined:
 * a scheduled actor needs its own trust story").
 *
 * The trust story, in full (zcode's, adapted to our terminal-first shape):
 *
 *   1. CONFIG LIVES IN THE ENGINE'S DATABASE, NOT THE REPO — automation
 *      definitions are created by the user (terminal tools, CLI, REST);
 *      a cloned repository carries no automation config, so the
 *      cloned-repo-RCE vector that gates .unown/mcp.json does not exist here.
 *   2. PERMISSION IS PER-TASK — `read-only` (the default) runs the unattended
 *      agent with a read-only toolset (no bash, no write/edit); `standard`
 *      (the full session toolset) must be chosen EXPLICITLY at creation.
 *   3. NO RECURSION — automation runs carry UNOWN_AUTOMATION=1, which hides
 *      the automation mutation tools inside the run (zcode's turn-scoped
 *      denylist); an automation cannot create or schedule automations.
 *   4. NOTHING AUTO-MERGES — runs are recorded with their output; any file
 *      changes a standard-mode run makes are in the user's working tree,
 *      reviewable through git before anything happens to them.
 *
 * Scheduling model (zcode's proven constants, transliterated):
 *   - a 20s poll loop, not timers
 *   - single-flight per automation: an atomic running 0->1 claim (a run in
 *     progress rejects further dispatch; "run now" during a run errors)
 *   - misfire grace: a first attempt older than 5 minutes is SKIPPED (never
 *     replayed); recurring tasks reschedule, one-shots complete
 *   - dispatch retry: 30s * 2^(n-1), capped at 15 min, max 5 attempts, same
 *     run id (scheduledAt frozen)
 *   - zombie claims (engine died mid-run) are reclaimed after 10 minutes and
 *     the orphaned run record is closed as failed
 *   - a global cap of 2 CONCURRENT automation runs (the engine box is small;
 *     further due automations wait for the next tick)
 *   - 20 automations total (zcode's AUTOMATION_CREATE_LIMIT)
 *
 * A run is a REAL unown session in the automation's workspace:
 *   `unown --mode json -p --no-session [--tools <read-only set>] <prompt>`
 * spawned with UNOWN_AUTOMATION=1 (+ PI_MODEL_ID when the automation pins a
 * model). Read-only mode toolset: read, grep, find, ls, todo, note,
 * fetch_url, web_search, webfetch, lsp — no bash, no write, no edit. The
 * web tools are read-only network reads (the same classification plan
 * mode gives them) and an unattended "morning brief" that cannot search
 * the web would be half a product — so they join the allowlist alongside
 * fetch_url. The run's note tool still works, so scheduled sessions feed
 * the learning loop like any other.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emit } from "./bus.ts";
import { nextRun, parseCron, CronParseError, type ParsedCron } from "./cron.ts";
import { store } from "./store.ts";

// ---------------------------------------------------------------------------
// Constants (zcode's, transliterated — see module doc)
// ---------------------------------------------------------------------------

export const AUTOMATION_POLL_MS = 20_000;
export const MISFIRE_GRACE_MS = 5 * 60_000;
export const CLAIM_STALE_MS = 10 * 60_000;
export const DISPATCH_RETRY_BASE_MS = 30_000;
export const DISPATCH_RETRY_CAP_MS = 15 * 60_000;
export const DISPATCH_MAX_ATTEMPTS = 5;
export const AUTOMATION_CREATE_LIMIT = 20;
export const MAX_CONCURRENT_AUTOMATION_RUNS = 2;
export const AUTOMATION_RUN_TIMEOUT_MS = 30 * 60_000;

/** The read-only toolset for unattended runs (no bash/write/edit). The web
 * tools are read-only network reads (same classification plan mode gives
 * them) — without them an unattended "check upstream for new releases"
 * automation could not do its job. */
export const READ_ONLY_TOOLS = "read,grep,find,ls,todo,note,fetch_url,web_search,webfetch,lsp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutomationRow {
        id: string;
        title: string;
        prompt: string;
        cron_expr: string | null;
        delay_ms: number | null; // one-shot: absolute epoch ms
        workspace: string;
        mode: "read-only" | "standard";
        model: string | null;
        max_runs: number | null;
        run_count: number;
        scheduled_run_count: number;
        lifecycle: "active" | "paused" | "completed" | "failed";
        next_run_at: number | null;
        last_run_at: number | null;
        running: number;
        claimed_at: number | null;
        dispatch_status: string;
        dispatch_attempts: number;
        retry_at: number | null;
        last_error: string | null;
        created_at: number;
        updated_at: number;
}

export interface AutomationRunRow {
        id: string;
        automation_id: string;
        trigger_kind: "schedule" | "manual";
        scheduled_at: number | null;
        status: "running" | "succeeded" | "failed" | "skipped";
        started_at: number;
        ended_at: number | null;
        exit_code: number | null;
        output: string | null;
        error: string | null;
        turns: number;
        tokens_in: number;
        tokens_out: number;
}

// ---------------------------------------------------------------------------
// Schema (added to the engine's DB; CREATE IF NOT EXISTS is idempotent)
// ---------------------------------------------------------------------------

export const AUTOMATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  cron_expr TEXT,
  delay_ms INTEGER,
  workspace TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'read-only',
  model TEXT,
  max_runs INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  scheduled_run_count INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'active',
  next_run_at INTEGER,
  last_run_at INTEGER,
  running INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  dispatch_status TEXT NOT NULL DEFAULT 'idle',
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_due ON automations (lifecycle, next_run_at);
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL DEFAULT 'schedule',
  scheduled_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER,
  output TEXT,
  error TEXT,
  turns INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_automation_runs ON automation_runs (automation_id, started_at);
`;

/** Install the automations schema (idempotent). Called at engine boot.
 *  NOTE: split per-statement — Store.run uses prepare(), which accepts
 *  exactly one statement. */
export function ensureAutomationsSchema(): void {
        for (const stmt of AUTOMATIONS_SCHEMA.split(";")) {
                const trimmed = stmt.trim();
                if (trimmed.length > 0) store.run(trimmed, []);
        }
}

// ---------------------------------------------------------------------------
// Schedule math
// ---------------------------------------------------------------------------

export interface ScheduleSpec {
        /** 5-field cron, local time. */
        cron?: string;
        /** One-shot: run once after N minutes (host clock). */
        delayMinutes?: number;
}

export type ScheduleResult =
        | { ok: true; cronExpr: string | null; delayMs: number | null; nextRunAt: number }
        | { ok: false; error: string };

/** Validate + compute the first next_run_at for a schedule. Pure. */
export function planSchedule(spec: ScheduleSpec, now: Date = new Date()): ScheduleResult {
        if (spec.cron !== undefined && spec.delayMinutes !== undefined) {
                return { ok: false, error: "pass either cron or delayMinutes, not both" };
        }
        if (spec.delayMinutes !== undefined) {
                if (!Number.isFinite(spec.delayMinutes) || spec.delayMinutes < 1 || spec.delayMinutes > 525_600) {
                        return { ok: false, error: "delayMinutes must be 1..525600" };
                }
                const at = now.getTime() + spec.delayMinutes * 60_000;
                return { ok: true, cronExpr: null, delayMs: at, nextRunAt: at };
        }
        if (spec.cron !== undefined) {
                try {
                        const first = nextRun(spec.cron, now);
                        if (first === null) return { ok: false, error: `cron "${spec.cron}" has no occurrence in the next 4 years` };
                        return { ok: true, cronExpr: spec.cron.trim(), delayMs: null, nextRunAt: first.getTime() };
                } catch (err) {
                        if (err instanceof CronParseError) return { ok: false, error: err.message };
                        return { ok: false, error: String(err) };
                }
        }
        return { ok: false, error: "pass cron or delayMinutes" };
}

/** The next fire after a completed run; null when the plan is exhausted
 *  (one-shot done or maxRuns reached — callers finalize lifecycle). */
export function planNextRun(row: Pick<AutomationRow, "cron_expr" | "delay_ms" | "max_runs" | "scheduled_run_count">, now: Date = new Date()): number | null {
        if (row.delay_ms !== null) return null; // one-shot: no recurrence
        if (row.max_runs !== null && row.scheduled_run_count >= row.max_runs) return null;
        const next = nextRun(row.cron_expr ?? "", now);
        return next ? next.getTime() : null;
}

/** Cron pre-parse for validation outside the scheduler (used by tools). */
export function tryParseCron(expr: string): { ok: true; parsed: ParsedCron } | { ok: false; error: string } {
        try {
                return { ok: true, parsed: parseCron(expr) };
        } catch (err) {
                return { ok: false, error: err instanceof CronParseError ? err.message : String(err) };
        }
}

// ---------------------------------------------------------------------------
// CRUD (engine-side; the REST layer and the CLI tools call these)
// ---------------------------------------------------------------------------

export type CreateAutomationInput = {
        title: string;
        prompt: string;
        workspace: string;
        schedule: ScheduleSpec;
        mode?: "read-only" | "standard";
        model?: string | null;
        maxRuns?: number | null;
};

export type CreateResult = { ok: true; automation: AutomationRow } | { ok: false; error: string; status?: number };

export function createAutomation(input: CreateAutomationInput, now: Date = new Date()): CreateResult {
        ensureAutomationsSchema();
        const title = input.title.trim();
        const prompt = input.prompt.trim();
        if (!title) return { ok: false, error: "title required", status: 400 };
        if (!prompt) return { ok: false, error: "prompt required (the unattended task to run)", status: 400 };
        if (prompt.length > 20_000) return { ok: false, error: "prompt too long (max 20000 chars)", status: 400 };
        const mode = input.mode ?? "read-only";
        if (mode !== "read-only" && mode !== "standard") return { ok: false, error: `mode must be read-only or standard`, status: 400 };
        if (!existsSync(input.workspace)) return { ok: false, error: `workspace does not exist: ${input.workspace}`, status: 400 };
        const plan = planSchedule(input.schedule, now);
        if (!plan.ok) return { ok: false, error: plan.error, status: 400 };
        const count = store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM automations`);
        if ((count?.c ?? 0) >= AUTOMATION_CREATE_LIMIT) {
                return { ok: false, error: `automation limit reached (${AUTOMATION_CREATE_LIMIT}) — delete one first`, status: 400 };
        }
        const id = `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const ts = now.getTime();
        store.run(
                `INSERT INTO automations (id, title, prompt, cron_expr, delay_ms, workspace, mode, model, max_runs, lifecycle, next_run_at, dispatch_status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'idle', ?, ?)`,
                [id, title, prompt, plan.cronExpr, plan.delayMs, input.workspace, mode, input.model ?? null, input.maxRuns ?? null, plan.nextRunAt, ts, ts],
        );
        const row = getAutomation(id);
        if (!row) return { ok: false, error: "insert failed", status: 500 };
        emit("automation:created", { id, title });
        return { ok: true, automation: row };
}

export function getAutomation(id: string): AutomationRow | undefined {
        return store.get<AutomationRow>(`SELECT * FROM automations WHERE id = ?`, [id]);
}

export function listAutomations(): AutomationRow[] {
        return store.query<AutomationRow>(`SELECT * FROM automations ORDER BY created_at DESC`);
}

export function listRuns(automationId: string, limit = 20): AutomationRunRow[] {
        return store.query<AutomationRunRow>(
                `SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?`,
                [automationId, Math.max(1, Math.min(200, limit))],
        );
}

export type UpdatePatch = Partial<Pick<AutomationRow, "title" | "prompt" | "mode" | "model" | "max_runs" | "lifecycle">> & { cron?: string };

export function updateAutomation(id: string, patch: UpdatePatch, now: Date = new Date()): CreateResult {
        const row = getAutomation(id);
        if (!row) return { ok: false, error: `unknown automation ${id}`, status: 404 };
        const sets: string[] = [];
        const params: any[] = [];
        if (patch.title !== undefined) {
                if (!String(patch.title).trim()) return { ok: false, error: "title cannot be empty", status: 400 };
                sets.push("title = ?");
                params.push(String(patch.title).trim());
        }
        if (patch.prompt !== undefined) {
                if (!String(patch.prompt).trim()) return { ok: false, error: "prompt cannot be empty", status: 400 };
                sets.push("prompt = ?");
                params.push(String(patch.prompt).trim());
        }
        if (patch.mode !== undefined) {
                if (patch.mode !== "read-only" && patch.mode !== "standard") return { ok: false, error: "mode must be read-only or standard", status: 400 };
                sets.push("mode = ?");
                params.push(patch.mode);
        }
        if (patch.model !== undefined) {
                sets.push("model = ?");
                params.push(patch.model ?? null);
        }
        if (patch.max_runs !== undefined) {
                sets.push("max_runs = ?");
                params.push(patch.max_runs ?? null);
        }
        if (patch.lifecycle !== undefined) {
                if (!["active", "paused", "completed", "failed"].includes(patch.lifecycle)) {
                        return { ok: false, error: "lifecycle must be active | paused | completed | failed", status: 400 };
                }
                // zcode: completed is terminal (endAt/maxRuns exhausted) and never restartable.
                if (row.lifecycle === "completed" && patch.lifecycle !== "completed") {
                        return { ok: false, error: "a completed automation is terminal — create a new one instead", status: 400 };
                }
                // Resuming needs a fresh next_run_at when the old one fell inside the pause.
                sets.push("lifecycle = ?");
                params.push(patch.lifecycle);
                if (patch.lifecycle === "active") {
                        const plan = planSchedule({ cron: row.cron_expr ?? undefined }, now);
                        if (plan.ok) {
                                sets.push("next_run_at = ?");
                                params.push(plan.nextRunAt);
                        }
                }
        }
        if (patch.cron !== undefined) {
                const plan = planSchedule({ cron: patch.cron }, now);
                if (!plan.ok) return { ok: false, error: plan.error, status: 400 };
                sets.push("cron_expr = ?", "delay_ms = ?", "next_run_at = ?");
                params.push(plan.cronExpr, null, plan.nextRunAt);
        }
        if (sets.length === 0) return { ok: false, error: "nothing to update", status: 400 };
        sets.push("updated_at = ?");
        params.push(now.getTime());
        params.push(id);
        store.run(`UPDATE automations SET ${sets.join(", ")} WHERE id = ?`, params);
        const updated = getAutomation(id);
        if (!updated) return { ok: false, error: "update failed", status: 500 };
        emit("automation:updated", { id, patch: { ...patch, prompt: undefined } });
        return { ok: true, automation: updated };
}

export function deleteAutomation(id: string): boolean {
        ensureAutomationsSchema();
        const res = store.run(`DELETE FROM automations WHERE id = ?`, [id]);
        const deleted = (res as any).changes > 0;
        if (deleted) {
                store.run(`DELETE FROM automation_runs WHERE automation_id = ? AND status != 'running'`, [id]);
                emit("automation:deleted", { id });
        }
        return deleted;
}

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

/** How a run is dispatched — overridable for tests; production spawns the CLI. */
export type RunDispatcher = (automation: AutomationRow, run: AutomationRunRow) => Promise<{ exitCode: number; output: string; turns: number; tokensIn: number; tokensOut: number }>;

/** Real dispatcher: spawn `unown --mode json -p --no-session` in the workspace. */
export function spawnAutomationRun(automation: AutomationRow, run: AutomationRunRow): Promise<{ exitCode: number; output: string; turns: number; tokensIn: number; tokensOut: number }> {
        return new Promise((resolve) => {
                const args = ["--mode", "json", "-p", "--no-session"];
                if (automation.mode === "read-only") args.push("--tools", READ_ONLY_TOOLS);
                // The unattended-run contract (zcode's): nobody answers questions.
                args.push(
                        `You are running as an UNATTENDED scheduled automation ("${automation.title}") in the repository at ${automation.workspace}. ` +
                                `Nobody can answer questions during this run. Do the work, verify what you can verify yourself, and finish with a clear report of what was done and what was found.\n\nTask:\n${automation.prompt}`,
                );
                // Resolve the CLI the same way the task tool does (works from the
                // engine process: walk up from this module to the repo's bin/unown).
                let command = "unown";
                let commandArgs = args;
                let dir = new URL(".", import.meta.url).pathname;
                for (;;) {
                        const candidate = join(dir, "bin", "unown");
                        if (existsSync(candidate)) {
                                command = process.execPath;
                                commandArgs = [candidate, ...args];
                                break;
                        }
                        const parent = join(dir, "..");
                        if (parent === dir) break;
                        dir = parent;
                }
                const env: Record<string, string> = { ...process.env, UNOWN_AUTOMATION: "1" };
                if (automation.model) env.PI_MODEL_ID = automation.model;
                const child = spawn(command, commandArgs, {
                        cwd: automation.workspace,
                        shell: false,
                        stdio: ["ignore", "pipe", "pipe"],
                        env,
                });
                let buffer = "";
                let lastText = "";
                let turns = 0;
                let tokensIn = 0;
                let tokensOut = 0;
                let settled = false;
                const finish = (exitCode: number) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timer);
                        resolve({ exitCode, output: lastText.slice(0, 20_000), turns, tokensIn, tokensOut });
                };
                const processLine = (line: string) => {
                        if (!line.trim()) return;
                        let event: any;
                        try {
                                event = JSON.parse(line);
                        } catch {
                                return;
                        }
                        if (event?.type === "message_end" && event.message) {
                                const msg = event.message;
                                if (msg.role === "assistant") {
                                        turns++;
                                        if (msg.usage) {
                                                tokensIn += msg.usage.input || 0;
                                                tokensOut += msg.usage.output || 0;
                                        }
                                        const content = msg.content;
                                        const text = typeof content === "string"
                                                ? content
                                                : Array.isArray(content)
                                                        ? content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("\n")
                                                        : "";
                                        if (text.trim()) lastText = text;
                                }
                        }
                };
                child.stdout.on("data", (d) => {
                        buffer += d.toString();
                        const lines = buffer.split("\n");
                        buffer = lines.pop() || "";
                        for (const line of lines) processLine(line);
                });
                let stderrTail = "";
                child.stderr.on("data", (d) => {
                        stderrTail = (stderrTail + d.toString()).slice(-2000);
                });
                child.on("close", (code) => {
                        if (buffer.trim()) processLine(buffer);
                        if (lastText === "" && stderrTail.trim()) lastText = `(no output; stderr: ${stderrTail.trim().slice(0, 1000)})`;
                        finish(code ?? 1);
                });
                child.on("error", () => finish(1));
                const timer = setTimeout(() => {
                        try {
                                child.kill("SIGKILL");
                        } catch {
                                /* already gone */
                        }
                }, AUTOMATION_RUN_TIMEOUT_MS);
        });
}

export class AutomationsScheduler {
        private timer: any = null;
        private dispatch: RunDispatcher;
        private tickMs: number;
        private inFlight = new Set<string>();

        constructor(dispatch: RunDispatcher = spawnAutomationRun, tickMs = AUTOMATION_POLL_MS) {
                this.dispatch = dispatch;
                this.tickMs = tickMs;
        }

        start(): void {
                ensureAutomationsSchema();
                this.recoverOrphans();
                if (this.timer) clearInterval(this.timer);
                this.timer = setInterval(() => void this.tick(), this.tickMs);
                emit("automations:started", { pollMs: this.tickMs });
        }

        stop(): void {
                if (this.timer) clearInterval(this.timer);
                this.timer = null;
        }

        /** Engine restarted: close zombie claims + their orphaned run records. */
        private recoverOrphans(): void {
                const now = Date.now();
                const stale = store.query<AutomationRow>(
                        `SELECT * FROM automations WHERE running = 1 AND claimed_at IS NOT NULL AND claimed_at < ?`,
                        [now - CLAIM_STALE_MS],
                );
                for (const row of stale) {
                        store.run(`UPDATE automations SET running = 0, claimed_at = NULL, dispatch_status = 'idle' WHERE id = ?`, [row.id]);
                        store.run(
                                `UPDATE automation_runs SET status = 'failed', ended_at = ?, error = 'engine restarted mid-run (claim reclaimed)' WHERE automation_id = ? AND status = 'running'`,
                                [now, row.id],
                        );
                        const next = planNextRun(row, new Date(now));
                        if (next === null && row.delay_ms !== null) {
                                store.run(`UPDATE automations SET lifecycle = 'completed' WHERE id = ?`, [row.id]);
                        } else if (next !== null) {
                                store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [next, row.id]);
                        }
                        emit("automation:recovered", { id: row.id });
                }
        }

        /** One scheduler tick — public for tests. */
        async tick(now: Date = new Date()): Promise<void> {
                ensureAutomationsSchema();
                const ts = now.getTime();
                // 1) Retries whose backoff elapsed go back to due.
                store.run(
                        `UPDATE automations SET dispatch_status = 'idle', retry_at = NULL
                         WHERE lifecycle = 'active' AND dispatch_status = 'retry' AND retry_at IS NOT NULL AND retry_at <= ?`,
                        [ts],
                );
                // 2) Due automations (retry_at precedence via the idle flip above).
                while (this.inFlight.size < MAX_CONCURRENT_AUTOMATION_RUNS) {
                        const due = store.get<AutomationRow>(
                                `SELECT * FROM automations
                                 WHERE lifecycle = 'active' AND running = 0 AND dispatch_status = 'idle'
                                   AND next_run_at IS NOT NULL AND next_run_at <= ?
                                 ORDER BY next_run_at LIMIT 1`,
                                [ts],
                        );
                        if (!due) break;
                        // Misfire: the first attempt is too old to be useful — skip it.
                        const misfired = ts - due.next_run_at > MISFIRE_GRACE_MS;
                        const claimed = claim(due.id, ts);
                        if (!claimed) continue; // raced with another claim — next tick
                        if (misfired) {
                                recordSkip(due, ts, "computer_asleep_or_engine_not_running");
                                reschedule(due, now, { skip: true });
                                continue;
                        }
                        this.inFlight.add(due.id);
                        // scheduledAt is the SLOT (due.next_run_at), frozen across dispatch
                        // retries — the retry chain reuses one run record (zcode contract).
                        void this.executeClaimed(due, due.next_run_at!, "schedule").finally(() => this.inFlight.delete(due.id));
                }
        }

        /** Dispatch + record one claimed run (shared by schedule + manual). */
        private async executeClaimed(automation: AutomationRow, scheduledAt: number, trigger: "schedule" | "manual"): Promise<void> {
                const runId = `${automation.id}:${trigger === "manual" ? `manual:${Math.random().toString(36).slice(2, 8)}` : scheduledAt}`;
                const startedAt = Date.now();
                // OR REPLACE: a dispatch RETRY (same slot, frozen run id) resets this row
                // to running instead of tripping the primary key.
                store.run(
                        `INSERT OR REPLACE INTO automation_runs (id, automation_id, trigger_kind, scheduled_at, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)`,
                        [runId, automation.id, trigger, trigger === "schedule" ? scheduledAt : null, startedAt],
                );
                emit("automation:run-started", { id: automation.id, runId, trigger });
                try {
                        const current = getAutomation(automation.id) ?? automation;
                        const result = await this.dispatch(current, {
                                id: runId,
                                automation_id: automation.id,
                                trigger_kind: trigger,
                                scheduled_at: trigger === "schedule" ? scheduledAt : null,
                                status: "running",
                                started_at: startedAt,
                                ended_at: null,
                                exit_code: null,
                                output: null,
                                error: null,
                                turns: 0,
                                tokens_in: 0,
                                tokens_out: 0,
                        });
                        const endedAt = Date.now();
                        const ok = result.exitCode === 0;
                        store.run(
                                `UPDATE automation_runs SET status = ?, ended_at = ?, exit_code = ?, output = ?, turns = ?, tokens_in = ?, tokens_out = ? WHERE id = ?`,
                                [ok ? "succeeded" : "failed", endedAt, result.exitCode, result.output, result.turns, result.tokensIn, result.tokensOut, runId],
                        );
                        store.run(
                                `UPDATE automations SET run_count = run_count + 1${trigger === "schedule" ? ", scheduled_run_count = scheduled_run_count + 1" : ""}, last_run_at = ?, running = 0, claimed_at = NULL, dispatch_status = 'idle', dispatch_attempts = 0, retry_at = NULL, last_error = ? WHERE id = ?`,
                                [endedAt, ok ? null : `last run exited ${result.exitCode}`, automation.id],
                        );
                        const updated = getAutomation(automation.id);
                        if (updated) reschedule(updated, new Date(endedAt), { skip: false });
                        emit(ok ? "automation:run-succeeded" : "automation:run-failed", { id: automation.id, runId, exitCode: result.exitCode });
                } catch (err: any) {
                        // Dispatch failure — retry with backoff (zcode: same run id, frozen scheduledAt).
                        const attempts = (getAutomation(automation.id)?.dispatch_attempts ?? 0) + 1;
                        const backoff = Math.min(DISPATCH_RETRY_BASE_MS * 2 ** (attempts - 1), DISPATCH_RETRY_CAP_MS);
                        const retryAt = Date.now() + backoff;
                        const exhausted = attempts >= DISPATCH_MAX_ATTEMPTS;
                        store.run(
                                `UPDATE automation_runs SET status = 'failed', ended_at = ?, error = ? WHERE id = ?`,
                                [Date.now(), `dispatch attempt ${attempts}: ${String(err?.message ?? err).slice(0, 500)}`, runId],
                        );
                        if (exhausted) {
                                store.run(
                                        `UPDATE automations SET running = 0, claimed_at = NULL, dispatch_status = 'idle', dispatch_attempts = 0, retry_at = NULL, last_error = ? WHERE id = ?`,
                                        [`dispatch failed after ${attempts} attempts`, automation.id],
                                );
                                const updated = getAutomation(automation.id);
                                if (updated) reschedule(updated, new Date(), { skip: true }); // recurring: next slot; one-shot: completed
                                emit("automation:dispatch-exhausted", { id: automation.id, attempts });
                        } else {
                                store.run(
                                        `UPDATE automations SET running = 0, claimed_at = NULL, dispatch_status = 'retry', dispatch_attempts = ?, retry_at = ? WHERE id = ?`,
                                        [attempts, retryAt, automation.id],
                                );
                                emit("automation:dispatch-retry", { id: automation.id, attempts, retryAt });
                        }
                }
        }

        /** "Run now": manual trigger — fails when a run is already in progress. */
        async runNow(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
                const automation = getAutomation(id);
                if (!automation) return { ok: false, error: `unknown automation ${id}`, status: 404 };
                if (automation.running || this.inFlight.has(id)) {
                        return { ok: false, error: "a run is already in progress", status: 409 };
                }
                const claimed = claim(id, Date.now());
                if (!claimed) return { ok: false, error: "a run is already in progress", status: 409 };
                this.inFlight.add(id);
                void this.executeClaimed(automation, Date.now(), "manual").finally(() => this.inFlight.delete(id));
                return { ok: true };
        }
}

function claim(id: string, ts: number): boolean {
        const res = store.run(`UPDATE automations SET running = 1, claimed_at = ?, dispatch_status = 'claimed' WHERE id = ? AND running = 0`, [ts, id]);
        return (res as any).changes > 0;
}

function recordSkip(automation: AutomationRow, ts: number, reason: string): void {
        const runId = `${automation.id}:${automation.next_run_at}:skip`;
        store.run(
                `INSERT OR IGNORE INTO automation_runs (id, automation_id, trigger_kind, scheduled_at, status, started_at, ended_at, error) VALUES (?, ?, 'schedule', ?, 'skipped', ?, ?, ?)`,
                [runId, automation.id, automation.next_run_at, ts, ts, reason],
        );
        emit("automation:skipped", { id: automation.id, reason });
}

/** Post-run/post-skip scheduling: advance next_run_at; finalize exhausted plans. */
function reschedule(row: AutomationRow, now: Date, opts: { skip: boolean }): void {
        const next = planNextRun(row, now);
        if (next === null) {
                store.run(`UPDATE automations SET next_run_at = NULL, lifecycle = 'completed' WHERE id = ?`, [row.id]);
                emit("automation:completed", { id: row.id });
                return;
        }
        store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [next, row.id]);
}

/** Pending in-process runs (diagnostics/tests). */
export function schedulerInFlight(scheduler: AutomationsScheduler): string[] {
        return [...(scheduler as any).inFlight as Set<string>];
}
