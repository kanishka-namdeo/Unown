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
 *     replayed); recurring tasks reschedule, one-shots complete. The grace
 *     window is env-tunable (PI_AUTOMATION_MISFIRE_GRACE_MS), and
 *     UNOWN_AUTOMATION_MISFIRE_CATCHUP=1 opts into launchd-style catch-up:
 *     a slot missed while the computer slept / the engine was down runs ONCE
 *     on wake (coalesced, rescheduled from now) when the lag is under 24h
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
import { parseCron, type ParsedCron } from "./cron.ts";
import {
        advanceIntervalSlot,
        inferLegacyKind,
        isValidTimezone,
        nextAfterSlot,
        nextCronInZone,
        nextScheduleSlot,
        planRoutineSchedule,
        rowIntervalSpec,
        type ScheduleKind,
} from "./routine-schedule.ts";
import { store } from "./store.ts";

// ---------------------------------------------------------------------------
// Constants (zcode's, transliterated — see module doc)
// ---------------------------------------------------------------------------

export const AUTOMATION_POLL_MS = 20_000;
export const MISFIRE_GRACE_MS = 5 * 60_000;
/** M9 catch-up horizon: with UNOWN_AUTOMATION_MISFIRE_CATCHUP=1, a missed
 * slot newer than this (and past the grace window) runs ONCE on wake —
 * launchd coalesces missed StartCalendarInterval fires the same way. Older
 * than this the slot is stale even for catch-up (cron skips, one-shots
 * complete — the default policy). */
export const MISFIRE_CATCHUP_MAX_LAG_MS = 24 * 60 * 60_000;
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
// Env knobs (read at call time — the governor.ts convention; `||`: an EMPTY
// .env value means unset)
// ---------------------------------------------------------------------------

/** The misfire grace window, env-tunable via PI_AUTOMATION_MISFIRE_GRACE_MS
 *  (default MISFIRE_GRACE_MS above, the zcode constant). */
export function misfireGraceMs(): number {
        const raw = process.env.PI_AUTOMATION_MISFIRE_GRACE_MS || "";
        if (raw === "") return MISFIRE_GRACE_MS;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : MISFIRE_GRACE_MS;
}

/** Opt-in launchd-style catch-up-once (UNOWN_AUTOMATION_MISFIRE_CATCHUP=1;
 *  default off = the cron-classic zcode policy: skip + record
 *  computer_asleep_or_engine_not_running). */
export function misfireCatchupEnabled(): boolean {
        return (process.env.UNOWN_AUTOMATION_MISFIRE_CATCHUP || "") === "1";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AutomationRow {
        id: string;
        title: string;
        prompt: string;
        cron_expr: string | null;
        delay_ms: number | null; // one-shot: absolute epoch ms
        /** Routines v2 — the recurrence kind + spec (null kind = legacy row:
         *  cron_expr → cron, delay_ms → once; see inferLegacyKind). */
        schedule_kind: string | null; // 'cron' | 'every' | 'after' | 'once'
        interval_n: number | null;
        interval_unit: string | null; // 'm' | 'h' | 'd' | 'w'
        interval_at: string | null; // 'HH:MM' wall time (d/w only)
        timezone: string | null; // IANA name; null = engine-local (floating)
        until_ms: number | null; // inclusive end boundary
        misfire: string | null; // 'skip' | 'catch-up'; null = env default
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
  schedule_kind TEXT,
  interval_n INTEGER,
  interval_unit TEXT,
  interval_at TEXT,
  timezone TEXT,
  until_ms INTEGER,
  misfire TEXT,
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
-- M9: the retention pass (retention.ts) scans automation_runs by started_at.
-- This index lives HERE, not in store.ts migrate(): a fresh install constructs
-- the Store (server.ts quickCheck) BEFORE this schema installs the table, so
-- migrate() cannot index it portably. ensureAutomationsSchema runs at every
-- boot/tick, which makes this the guaranteed-ordered, idempotent home.
CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_runs (started_at);
`;

/** Routines-v2 columns added to an existing `automations` table (pre-v2
 *  installs). Paired with the CREATE TABLE above (fresh installs already
 *  carry them); ALTER TABLE ADD COLUMN is idempotent-guarded via
 *  pragma table_info. */
const ROUTINES_V2_COLUMNS: Array<[name: string, ddl: string]> = [
        ["schedule_kind", "TEXT"],
        ["interval_n", "INTEGER"],
        ["interval_unit", "TEXT"],
        ["interval_at", "TEXT"],
        ["timezone", "TEXT"],
        ["until_ms", "INTEGER"],
        ["misfire", "TEXT"],
];

/** Install the automations schema (idempotent; migrates pre-v2 tables).
 *  Called at engine boot. NOTE: split per-statement — Store.run uses
 *  prepare(), which accepts exactly one statement. */
export function ensureAutomationsSchema(): void {
        for (const stmt of AUTOMATIONS_SCHEMA.split(";")) {
                const trimmed = stmt.trim();
                if (trimmed.length > 0) store.run(trimmed, []);
        }
        // Migration: backfill routines-v2 columns on legacy tables.
        const present = new Set(store.query<{ name: string }>(`PRAGMA table_info(automations)`).map((c) => c.name));
        for (const [name, ddl] of ROUTINES_V2_COLUMNS) {
                if (!present.has(name)) store.run(`ALTER TABLE automations ADD COLUMN ${name} ${ddl}`, []);
        }
}

// ---------------------------------------------------------------------------
// Schedule math (routines v2 — delegated to routine-schedule.ts; the legacy
// planSchedule shape is kept for callers that only carry cron/delayMinutes)
// ---------------------------------------------------------------------------

export interface ScheduleSpec {
        /** 5-field cron (evaluated in the routine's timezone). */
        cron?: string;
        /** One-shot: run once after N minutes (host clock). */
        delayMinutes?: number;
        /** Schedule-anchored interval: "30m" | "6h" | "2d" | "3w" | "2d at 09:00". */
        every?: string;
        /** Completion-anchored interval: "45m" | "2h" | "3d" | "1w". */
        after?: string;
}

export type ScheduleResult =
        | {
                  ok: true;
                  cronExpr: string | null;
                  delayMs: number | null;
                  nextRunAt: number;
                  scheduleKind: ScheduleKind;
                  intervalN: number | null;
                  intervalUnit: string | null;
                  intervalAt: string | null;
          }
        | { ok: false; error: string };

/** Validate + compute the first next_run_at for a schedule (any kind). Pure. */
export function planSchedule(spec: ScheduleSpec, timezone: string | null = null, now: Date = new Date()): ScheduleResult {
        const plan = planRoutineSchedule(spec, timezone, now.getTime());
        if (!plan.ok) return { ok: false, error: plan.error };
        return {
                ok: true,
                cronExpr: plan.schedule.cronExpr,
                delayMs: plan.schedule.delayMs,
                nextRunAt: plan.nextRunAt,
                scheduleKind: plan.schedule.kind,
                intervalN: plan.schedule.intervalN,
                intervalUnit: plan.schedule.intervalUnit,
                intervalAt: plan.schedule.intervalAt,
        };
}

/** Cron pre-parse for validation outside the scheduler (used by tools). */
export function tryParseCron(expr: string): { ok: true; parsed: ParsedCron } | { ok: false; error: string } {
        try {
                return { ok: true, parsed: parseCron(expr) };
        } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
}

/** The routine's effective misfire policy: the row's own choice, else the
 *  env default (UNOWN_AUTOMATION_MISFIRE_CATCHUP=1 → catch-up). */
export function effectiveMisfire(row: Pick<AutomationRow, "misfire">): "skip" | "catch-up" {
        if (row.misfire === "catch-up") return "catch-up";
        if (row.misfire === "skip") return "skip";
        return misfireCatchupEnabled() ? "catch-up" : "skip";
}

/** Validate a misfire policy value. */
export function validMisfire(v: unknown): "skip" | "catch-up" | null {
        return v === "skip" || v === "catch-up" ? v : null;
}

// ---------------------------------------------------------------------------
// CRUD (engine-side; the REST layer and the CLI tools call these)
// ---------------------------------------------------------------------------

export type CreateAutomationInput = {
        title: string;
        prompt: string;
        workspace: string;
        schedule: ScheduleSpec;
        timezone?: string | null;
        untilMs?: number | null;
        misfire?: "skip" | "catch-up" | null;
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
        const timezone = input.timezone?.trim() || null;
        if (!isValidTimezone(timezone)) return { ok: false, error: `unknown timezone "${timezone}" (IANA names, e.g. America/New_York)`, status: 400 };
        if (input.misfire !== undefined && input.misfire !== null && !validMisfire(input.misfire)) {
                return { ok: false, error: "misfire must be skip or catch-up", status: 400 };
        }
        if (input.untilMs !== undefined && input.untilMs !== null && (!Number.isFinite(input.untilMs) || input.untilMs <= 0)) {
                return { ok: false, error: "until must be a positive epoch-ms timestamp", status: 400 };
        }
        const plan = planSchedule(input.schedule, timezone, now);
        if (!plan.ok) return { ok: false, error: plan.error, status: 400 };
        if (input.untilMs !== undefined && input.untilMs !== null && plan.nextRunAt > input.untilMs) {
                return { ok: false, error: `until is before the routine's first occurrence (${new Date(plan.nextRunAt).toISOString()})`, status: 400 };
        }
        const count = store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM automations`);
        if ((count?.c ?? 0) >= AUTOMATION_CREATE_LIMIT) {
                return { ok: false, error: `automation limit reached (${AUTOMATION_CREATE_LIMIT}) — delete one first`, status: 400 };
        }
        const id = `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const ts = now.getTime();
        store.run(
                `INSERT INTO automations (id, title, prompt, cron_expr, delay_ms, schedule_kind, interval_n, interval_unit, interval_at, timezone, until_ms, misfire, workspace, mode, model, max_runs, lifecycle, next_run_at, dispatch_status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 'idle', ?, ?)`,
                [
                        id,
                        title,
                        prompt,
                        plan.cronExpr,
                        plan.delayMs,
                        plan.scheduleKind,
                        plan.intervalN,
                        plan.intervalUnit,
                        plan.intervalAt,
                        timezone,
                        input.untilMs ?? null,
                        input.misfire ?? null,
                        input.workspace,
                        mode,
                        input.model ?? null,
                        input.maxRuns ?? null,
                        plan.nextRunAt,
                        ts,
                        ts,
                ],
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

export type UpdatePatch = Partial<Pick<AutomationRow, "title" | "prompt" | "mode" | "model" | "max_runs" | "lifecycle" | "timezone" | "until_ms" | "misfire">> & {
        cron?: string;
        every?: string;
        after?: string;
        delayMinutes?: number;
};

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
        if (patch.timezone !== undefined) {
                const tz = patch.timezone?.trim() || null;
                if (!isValidTimezone(tz)) return { ok: false, error: `unknown timezone "${tz}" (IANA names, e.g. America/New_York)`, status: 400 };
                sets.push("timezone = ?");
                params.push(tz);
        }
        if (patch.until_ms !== undefined) {
                if (patch.until_ms !== null && (!Number.isFinite(patch.until_ms) || patch.until_ms <= 0)) {
                        return { ok: false, error: "until must be a positive epoch-ms timestamp (or null to clear)", status: 400 };
                }
                sets.push("until_ms = ?");
                params.push(patch.until_ms ?? null);
                // A boundary the pending slot is already past ENDS the routine
                // (the "stop after today" flow) instead of erroring.
                if (patch.until_ms !== null && row.lifecycle === "active" && row.next_run_at !== null && row.next_run_at > patch.until_ms) {
                        sets.push("next_run_at = NULL", "lifecycle = 'completed'");
                }
        }
        if (patch.misfire !== undefined) {
                if (patch.misfire !== null && !validMisfire(patch.misfire)) {
                        return { ok: false, error: "misfire must be skip or catch-up (or null for the default)", status: 400 };
                }
                sets.push("misfire = ?");
                params.push(patch.misfire ?? null);
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
                        const rearm = resumeNextRun(row, now.getTime());
                        if (rearm !== null) {
                                sets.push("next_run_at = ?");
                                params.push(rearm);
                        }
                }
        }
        // Schedule edits (any kind) re-arm the whole spec from now: exactly
        // one of cron/every/after/delayMinutes may ride a patch.
        const scheduleKeys = ["cron", "every", "after", "delayMinutes"].filter((k) => (patch as any)[k] !== undefined);
        if (scheduleKeys.length > 1) {
                return { ok: false, error: `pass only ONE schedule kind (got ${scheduleKeys.join(" + ")})`, status: 400 };
        }
        if (scheduleKeys.length === 1) {
                const spec: ScheduleSpec = {};
                if (patch.cron !== undefined) spec.cron = patch.cron;
                if (patch.every !== undefined) spec.every = patch.every;
                if (patch.after !== undefined) spec.after = patch.after;
                if (patch.delayMinutes !== undefined) spec.delayMinutes = patch.delayMinutes;
                const plan = planSchedule(spec, patch.timezone !== undefined ? patch.timezone?.trim() || null : row.timezone, now);
                if (!plan.ok) return { ok: false, error: plan.error, status: 400 };
                if (row.until_ms !== null && plan.nextRunAt > row.until_ms) {
                        return { ok: false, error: `until (${new Date(row.until_ms).toISOString()}) is before the new schedule's first occurrence`, status: 400 };
                }
                sets.push("cron_expr = ?", "delay_ms = ?", "schedule_kind = ?", "interval_n = ?", "interval_unit = ?", "interval_at = ?", "next_run_at = ?");
                params.push(plan.cronExpr, plan.delayMs, plan.scheduleKind, plan.intervalN, plan.intervalUnit, plan.intervalAt, plan.nextRunAt);
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
                // ALL runs go, running ones included: an in-flight run's final
                // UPDATE simply no-ops against the deleted parent, and keeping
                // them would leave orphan rows lingering until retention.
                store.run(`DELETE FROM automation_runs WHERE automation_id = ?`, [id]);
                emit("automation:deleted", { id });
        }
        return deleted;
}

// ---------------------------------------------------------------------------
// Skip + snooze (routines controls — Things' skip-this-occurrence, Todoist's
// postpone, without the modal)
// ---------------------------------------------------------------------------

/** The fresh next_run_at a paused routine gets on resume, per kind:
 *  cron recomputes from now; every re-arms phase-preserving (the next FUTURE
 *  slot on the old rhythm — firstIntervalSlot of the stale chain); after
 *  starts a fresh N-window from now (the pause consumed the wait). */
function resumeNextRun(row: AutomationRow, nowMs: number): number | null {
        const kind = (row.schedule_kind as ScheduleKind | null) ?? inferLegacyKind(row);
        if (row.max_runs !== null && row.scheduled_run_count >= row.max_runs) return null;
        if (kind === "cron") {
                return nextCronInZone(row.cron_expr ?? "", nowMs, row.timezone);
        }
        if (kind === "every") {
                const spec = rowIntervalSpec(row);
                const stale = row.next_run_at ?? nowMs;
                let next = advanceIntervalSlot(stale, spec, row.timezone);
                let guard = 0;
                while (next <= nowMs && guard < 53 * 100) {
                        next = advanceIntervalSlot(next, spec, row.timezone);
                        guard++;
                }
                return next;
        }
        if (kind === "after") {
                return nextAfterSlot(row, nowMs).nextRunAt;
        }
        return null; // once: no re-arm
}

export type SkipResult = { ok: true; automation: AutomationRow } | { ok: false; error: string; status: number };

/** Skip the NEXT occurrence: record a skipped run (reason: user), advance
 *  exactly ONE slot (the chain keeps its phase), finalize exhausted plans.
 *  Skipping a one-shot's only occurrence completes it. */
export function skipNextOccurrence(id: string, now: Date = new Date()): SkipResult {
        const row = getAutomation(id);
        if (!row) return { ok: false, error: `unknown automation ${id}`, status: 404 };
        if (row.lifecycle !== "active") return { ok: false, error: `only an active routine can be skipped (this one is ${row.lifecycle})`, status: 400 };
        if (row.running) return { ok: false, error: "a run is already in progress", status: 409 };
        const slot = row.next_run_at ?? now.getTime();
        recordSkip(row, now.getTime(), "skipped_by_user");
        const kind = (row.schedule_kind as ScheduleKind | null) ?? inferLegacyKind(row);
        let next: number | null;
        if (kind === "cron") {
                next = nextCronInZone(row.cron_expr ?? "", now.getTime(), row.timezone);
        } else if (kind === "every" || kind === "after") {
                next = advanceIntervalSlot(slot, rowIntervalSpec(row), row.timezone);
        } else {
                next = null; // once: the skipped occurrence was the only one
        }
        if (next !== null && row.until_ms !== null && next > row.until_ms) next = null;
        if (next === null) {
                store.run(`UPDATE automations SET next_run_at = NULL, lifecycle = 'completed', updated_at = ? WHERE id = ?`, [now.getTime(), id]);
                emit("automation:completed", { id });
        } else {
                store.run(`UPDATE automations SET next_run_at = ?, updated_at = ? WHERE id = ?`, [next, now.getTime(), id]);
        }
        const updated = getAutomation(id)!;
        emit("automation:skipped", { id, reason: "skipped_by_user" });
        return { ok: true, automation: updated };
}

export type SnoozeResult = { ok: true; automation: AutomationRow } | { ok: false; error: string; status: number };

/** Push the next occurrence out by N minutes (1..525600). The skipped-slot
 *  gap stays visible in history: scheduled_at keeps the original slot. */
export function snoozeNextOccurrence(id: string, minutes: number, now: Date = new Date()): SnoozeResult {
        const row = getAutomation(id);
        if (!row) return { ok: false, error: `unknown automation ${id}`, status: 404 };
        if (row.lifecycle !== "active") return { ok: false, error: `only an active routine can be snoozed (this one is ${row.lifecycle})`, status: 400 };
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525_600) {
                return { ok: false, error: "snooze minutes must be 1..525600", status: 400 };
        }
        const base = row.next_run_at ?? now.getTime();
        const next = base + minutes * 60_000;
        if (row.until_ms !== null && next > row.until_ms) {
                return { ok: false, error: `snoozing past until (${new Date(row.until_ms).toISOString()}) would end the routine — skip or edit instead`, status: 400 };
        }
        store.run(`UPDATE automations SET next_run_at = ?, updated_at = ? WHERE id = ?`, [next, now.getTime(), id]);
        const updated = getAutomation(id)!;
        emit("automation:updated", { id, snoozedTo: next });
        return { ok: true, automation: updated };
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
                        // The claimed slot was consumed by the dead run — advance
                        // from it (schedule kinds) or re-arm from now (after).
                        const next = orphanNextRun(row, now);
                        if (next === null) {
                                store.run(`UPDATE automations SET next_run_at = NULL, lifecycle = 'completed' WHERE id = ?`, [row.id]);
                        } else {
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
                        // Misfire policy: a due slot older than the grace window is
                        // stale. The routine's own `misfire` field picks the policy
                        // (skip = cron-classic: record + advance, never replay;
                        // catch-up = launchd-style: run ONCE when the lag is under
                        // 24h, rescheduling from the run's end). Older than 24h
                        // even catch-up gives up: slots skip, one-shots complete.
                        const lag = ts - due.next_run_at;
                        const misfired = lag > misfireGraceMs();
                        const catchUp = misfired && effectiveMisfire(due) === "catch-up" && lag <= MISFIRE_CATCHUP_MAX_LAG_MS;
                        const claimed = claim(due.id, ts);
                        if (!claimed) continue; // raced with another claim — next tick
                        if (misfired && !catchUp) {
                                recordSkip(due, ts, "computer_asleep_or_engine_not_running");
                                reschedule(due, { trigger: "schedule", slotMs: due.next_run_at!, fromMs: ts });
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
                        if (updated) reschedule(updated, { trigger, slotMs: scheduledAt, fromMs: endedAt });
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
                                if (updated) reschedule(updated, { trigger: "schedule", slotMs: scheduledAt, fromMs: Date.now() }); // recurring: next slot; one-shot: completed
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

        /** "Run now": manual trigger — fails when a run is already in progress
         *  (this routine's own, or the engine-wide 2-run concurrency cap —
         *  manual runs never bypass it). */
        async runNow(id: string): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
                const automation = getAutomation(id);
                if (!automation) return { ok: false, error: `unknown automation ${id}`, status: 404 };
                if (automation.running || this.inFlight.has(id)) {
                        return { ok: false, error: "a run is already in progress", status: 409 };
                }
                if (this.inFlight.size >= MAX_CONCURRENT_AUTOMATION_RUNS) {
                        return { ok: false, error: `the engine is already running ${this.inFlight.size} routine runs (cap ${MAX_CONCURRENT_AUTOMATION_RUNS}) — try again shortly`, status: 429 };
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

/** Post-run/post-skip scheduling — kind-routed (routine-schedule.ts):
 *
 *  - once: exhausted, finalize
 *  - after: re-arm N units from the completion instant for BOTH triggers
 *    (Todoist after-semantics — measured from when the work finished;
 *    a manual run re-arms an after-routine too)
 *  - cron + manual: recompute from now (idempotent — the pending slot is
 *    untouched; manual runs never consume schedule slots)
 *  - every + manual: the pending slot is left alone entirely
 *  - cron/every + schedule trigger (or misfire skip): advance from the
 *    consumed slot, coalescing fully-elapsed slots into the next future one
 */
function reschedule(row: AutomationRow, opts: { trigger: "schedule" | "manual"; slotMs: number; fromMs: number }): void {
        const kind = (row.schedule_kind as ScheduleKind | null) ?? inferLegacyKind(row);
        let next: number | null;
        if (kind === "after") {
                next = nextAfterSlot(row, opts.fromMs).nextRunAt;
        } else if (kind === "once") {
                next = null;
        } else if (opts.trigger === "manual" && kind === "every") {
                return; // pending slot untouched — manual runs never consume it
        } else {
                const r = nextScheduleSlot(row, opts.slotMs, opts.fromMs);
                next = r.nextRunAt;
        }
        if (next === null) {
                store.run(`UPDATE automations SET next_run_at = NULL, lifecycle = 'completed' WHERE id = ?`, [row.id]);
                emit("automation:completed", { id: row.id });
                return;
        }
        store.run(`UPDATE automations SET next_run_at = ? WHERE id = ?`, [next, row.id]);
}

/** Orphan recovery re-arm: the claimed slot died mid-run — schedule kinds
 *  advance from it, after re-arms from now, once finalizes. */
function orphanNextRun(row: AutomationRow, nowMs: number): number | null {
        const kind = (row.schedule_kind as ScheduleKind | null) ?? inferLegacyKind(row);
        if (kind === "after") return nextAfterSlot(row, nowMs).nextRunAt;
        if (kind === "once") return null;
        return nextScheduleSlot(row, row.next_run_at ?? nowMs, nowMs).nextRunAt;
}

/** Pending in-process runs (diagnostics/tests). */
export function schedulerInFlight(scheduler: AutomationsScheduler): string[] {
        return [...(scheduler as any).inFlight as Set<string>];
}
