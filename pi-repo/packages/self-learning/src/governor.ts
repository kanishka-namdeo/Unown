/**
 * governor.ts — the engine's budget governor + upstream circuit breaker.
 *
 * Detachment contract (docs/detached-engine-architecture.md F5/F7): the
 * self-learning engine runs unattended in auto mode, so it must be its own
 * resource discipline. Two mechanisms, both consulted by the router before
 * any learning job starts:
 *
 *   1. BUDGET GOVERNOR — a rolling spend ledger. Every engine-side LLM call
 *      (llm.ts chat) and every agent-run's tokens (runs table, recorded at
 *      finalize) count against hourly/daily ceilings. Over budget ⇒ learning
 *      jobs skip with `budget:throttled` until the window drains. The knobs:
 *        PI_ENGINE_MAX_CALLS_HOUR   default 60    (0 = unlimited)
 *        PI_ENGINE_MAX_TOKENS_HOUR  default 200000 (0 = unlimited)
 *        PI_ENGINE_MAX_TOKENS_DAY   default 2000000 (0 = unlimited)
 *
 *   2. CIRCUIT BREAKER — consecutive LLM failures trip an exponential,
 *      full-jitter backoff window during which learning jobs skip with
 *      `upstream backoff`. A single success resets the breaker. State is
 *      in-memory: a restart gives the upstream a fresh chance (failures
 *      re-accumulate within one job if it is really down). The knobs:
 *        PI_LLM_BREAKER_THRESHOLD   default 3
 *        PI_LLM_BACKOFF_BASE_MS     default 30000 (capped at 15 min, x4 growth)
 *
 * The engine stays OBSERVABLE while throttled: budgetStatus() and
 * breakerStatus() are surfaced on /api/overview and consumed by `unown
 * doctor`, so "learning paused" is always a queryable fact, never a mystery.
 */
import { store } from "./store.ts";

// ---------------------------------------------------------------------------
// Env knobs (read at call time — tests redirect them after import)
// ---------------------------------------------------------------------------

function intEnv(name: string, fallback: number): number {
        const raw = process.env[name];
        if (raw === undefined || raw === "") return fallback;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function maxCallsHour(): number {
        return intEnv("PI_ENGINE_MAX_CALLS_HOUR", 60);
}
export function maxTokensHour(): number {
        return intEnv("PI_ENGINE_MAX_TOKENS_HOUR", 200_000);
}
export function maxTokensDay(): number {
        return intEnv("PI_ENGINE_MAX_TOKENS_DAY", 2_000_000);
}
export function breakerThreshold(): number {
        return Math.max(1, intEnv("PI_LLM_BREAKER_THRESHOLD", 3));
}
export function backoffBaseMs(): number {
        return Math.max(1_000, intEnv("PI_LLM_BACKOFF_BASE_MS", 30_000));
}
const BACKOFF_CAP_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Ledger (engine-side LLM calls; agent-run tokens come from the runs table)
// ---------------------------------------------------------------------------

/**
 * Record one engine-side LLM call outcome in the llm_ledger table.
 * Failures land with ok=0 and null tokens — they count against the CALL
 * budget (a failing call still burns upstream attempts and wall clock) but
 * not the token budgets.
 */
export function recordLlmCall(ok: boolean, promptTokens: number | null, completionTokens: number | null, model: string): void {
        try {
                store.run(`INSERT INTO llm_ledger (ts, ok, prompt_tokens, completion_tokens, model) VALUES (?, ?, ?, ?, ?)`, [
                        Date.now(),
                        ok ? 1 : 0,
                        promptTokens ?? null,
                        completionTokens ?? null,
                        model,
                ]);
        } catch {
                /* the ledger must never break the caller — budgeting is best-effort */
        }
}

/** Prune ledger rows older than 24h + a margin (bounded growth; cheap, called rarely). */
export function pruneLedger(): void {
        try {
                store.run(`DELETE FROM llm_ledger WHERE ts < ?`, [Date.now() - 25 * 60 * 60 * 1000]);
        } catch {
                /* best-effort */
        }
}

export interface BudgetStatus {
        /** Engine-side LLM calls in the last hour (ledger). */
        callsHour: number;
        /** Engine-side LLM calls in the last 24h (ledger). */
        callsDay: number;
        /** All tokens (ledger + runs) in the last hour. */
        tokensHour: number;
        /** All tokens (ledger + runs) in the last 24h. */
        tokensDay: number;
        limits: { callsHour: number; tokensHour: number; tokensDay: number };
        overBudget: boolean;
        reason: string | null;
}

function sumLedger(sinceMs: number): { calls: number; tokens: number } {
        const row = store.get<{ calls: number | null; tokens: number | null }>(
                `SELECT COUNT(*) AS calls,
                        SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) AS tokens
                 FROM llm_ledger WHERE ts >= ?`,
                [sinceMs],
        );
        return { calls: row?.calls ?? 0, tokens: row?.tokens ?? 0 };
}

function sumRuns(sinceMs: number): number {
        const row = store.get<{ tokens: number | null }>(
                `SELECT SUM(COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0)) AS tokens
                 FROM runs WHERE ended_at >= ?`,
                [sinceMs],
        );
        return row?.tokens ?? 0;
}

export function budgetStatus(): BudgetStatus {
        const now = Date.now();
        const hour = sumLedger(now - 60 * 60_000);
        const day = sumLedger(now - 24 * 60 * 60_000);
        const tokensHour = hour.tokens + sumRuns(now - 60 * 60_000);
        const tokensDay = day.tokens + sumRuns(now - 24 * 60 * 60_000);
        const limits = { callsHour: maxCallsHour(), tokensHour: maxTokensHour(), tokensDay: maxTokensDay() };
        let reason: string | null = null;
        if (limits.callsHour > 0 && hour.calls >= limits.callsHour)
                reason = `budget:throttled ${hour.calls} engine LLM calls in the last hour (limit ${limits.callsHour})`;
        else if (limits.tokensHour > 0 && tokensHour >= limits.tokensHour)
                reason = `budget:throttled ${tokensHour} tokens in the last hour (limit ${limits.tokensHour})`;
        else if (limits.tokensDay > 0 && tokensDay >= limits.tokensDay)
                reason = `budget:throttled ${tokensDay} tokens in the last 24h (limit ${limits.tokensDay})`;
        return {
                callsHour: hour.calls,
                callsDay: day.calls,
                tokensHour,
                tokensDay,
                limits,
                overBudget: reason !== null,
                reason,
        };
}

// ---------------------------------------------------------------------------
// Circuit breaker (in-memory; a restart = fresh chance)
// ---------------------------------------------------------------------------

let consecutiveFailures = 0;
let backoffUntil = 0;

/** Full-jitter exponential backoff for the Nth trip (AWS-style: jitter prevents synchronized retry storms). */
function backoffForTrip(trips: number): number {
        const growth = Math.min(BACKOFF_CAP_MS, backoffBaseMs() * Math.pow(4, Math.max(0, trips - 1)));
        return Math.round(growth * (0.5 + Math.random() * 0.5)); // 50–100% of the growth window
}

export function recordLlmSuccess(): void {
        consecutiveFailures = 0;
        if (backoffUntil !== 0) backoffUntil = 0;
}

export function recordLlmFailure(): void {
        consecutiveFailures++;
        if (consecutiveFailures >= breakerThreshold()) {
                const trips = consecutiveFailures - breakerThreshold() + 1;
                backoffUntil = Date.now() + backoffForTrip(trips);
        }
}

export interface BreakerStatus {
        open: boolean;
        consecutiveFailures: number;
        threshold: number;
        retryInMs: number;
}

export function breakerStatus(): BreakerStatus {
        const now = Date.now();
        return {
                open: backoffUntil > now,
                consecutiveFailures,
                threshold: breakerThreshold(),
                retryInMs: Math.max(0, backoffUntil - now),
        };
}

// ---------------------------------------------------------------------------
// The router's gate: may a learning job start right now?
// ---------------------------------------------------------------------------

export interface GuardDecision {
        allowed: boolean;
        reason: string | null;
}

/**
 * Consulted by the router before every learning job (harness-cycle,
 * auto-dream, dream-check, task-mint, regression-on-ship). Returns
 * { allowed: true } or the skip reason. Non-learning jobs (note-sync,
 * sandbox-gc) never consult the guard: they are local, cheap and must always
 * run — sync and GC are how the engine catches up after a throttle window.
 */
export function guardLearningJob(jobId: string): GuardDecision {
        const breaker = breakerStatus();
        if (breaker.open) {
                return {
                        allowed: false,
                        reason: `upstream backoff: ${breaker.consecutiveFailures} consecutive LLM failures, retry in ${Math.ceil(breaker.retryInMs / 1000)}s`,
                };
        }
        const budget = budgetStatus();
        if (budget.overBudget) return { allowed: false, reason: budget.reason };
        return { allowed: true, reason: null };
}

/** Test seam: reset breaker state between cases. */
export function resetBreakerForTest(): void {
        consecutiveFailures = 0;
        backoffUntil = 0;
}
