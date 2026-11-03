/**
 * automation-spend.ts — the automation spend meter + ceilings (S2-11).
 *
 * Automation runs already record tokens_in/tokens_out per run
 * (automation_runs); this module owns the missing two layers:
 *
 *   1. AGGREGATION — windowed SUMs over automation_runs: per-routine AND
 *      global, rolling 24h and 7d, tokens (in+out), run counts and turns.
 *      Pure + SQL over the store, deterministic, no LLM, no network.
 *
 *   2. CEILINGS — both default OFF (the operator's pinned ruling, the
 *      governor's self-initiated-vs-user-initiated asymmetry: the engine's
 *      OWN learning jobs are bounded by default; user-created routine spend
 *      is VISIBLE by default and BOUNDED on request):
 *        - per-routine: a NULLable `spend_cap` column on automations
 *          (INTEGER tokens per rolling 24h; NULL = no ceiling)
 *        - global: PI_AUTOMATION_MAX_TOKENS_DAY (tokens per rolling 24h
 *          across ALL routines; 0 or unset = unlimited) — the governor's
 *          env-knob convention, read at call time (intEnv pattern)
 *
 *      ENFORCEMENT is graduated (the AWS Well-Architected Agentic AI Lens
 *      reading: "cost governance preserves agent autonomy by using
 *      graduated throttling and approval workflows rather than binary
 *      shutdown"): when the dispatcher would spawn a scheduled or event
 *      run at/over a ceiling, the run is NOT spawned — a skipped run row
 *      is recorded (the recordSkip/recordEventSkip precedents, reason
 *      `spend_ceiling` carrying the cap and the window drain time) and the
 *      routine's slot is left in place. The routine is NEVER auto-paused;
 *      when the rolling 24h window drains below the cap it resumes on its
 *      own schedule. Manual `routines run` BYPASSES the gate (a human
 *      initiated it) but its recorded tokens COUNT toward the windows.
 */
import { store } from "./store.ts";

// ---------------------------------------------------------------------------
// Window constants
// ---------------------------------------------------------------------------

export const SPEND_WINDOW_DAY_MS = 24 * 60 * 60_000;
export const SPEND_WINDOW_7D_MS = 7 * 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Env knob — read at call time (the governor.ts intEnv convention; an EMPTY
// .env value means unset)
// ---------------------------------------------------------------------------

function intEnv(name: string, fallback: number): number {
        const raw = process.env[name] ?? "";
        if (raw === "") return fallback;
        const n = Number.parseInt(raw, 10);
        return Number.isNaN(n) ? fallback : n;
}

/** Global ceiling: max tokens per rolling 24h across ALL automation
 * routines. 0 or unset = unlimited (the default — user-created routine
 * spend is bounded on request, never by default). */
export function globalSpendCapTokensDay(): number {
        return intEnv("PI_AUTOMATION_MAX_TOKENS_DAY", 0);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface SpendWindow {
        /** tokens_in + tokens_out summed over the window. */
        tokens: number;
        /** run count in the window (every trigger kind; skipped rows carry
         *  zero tokens and are counted — they are in history). */
        runs: number;
        /** turns summed over the window. */
        turns: number;
}

export interface RoutineSpend {
        automationId: string;
        title: string;
        /** The routine's per-routine ceiling (NULL = none; 24h window). */
        cap: number | null;
        day: SpendWindow;
        week: SpendWindow;
        /** Cap in effect for THIS routine: the per-routine cap, else the
         *  global one; null when neither is set. */
        effectiveCap: number | null;
        /** True when the day window is at/over the effective cap — the
         *  dispatcher will record skips until the window drains. */
        throttledNow: boolean;
        /** When the 24h window's tokens fall back below the cap: the
         *  oldest contributing run's started_at + 24h (null = not
         *  throttled or the cap is unset). */
        drainAt: number | null;
}

export interface AutomationSpendReport {
        now: number;
        routines: RoutineSpend[];
        /** Global windows over ALL routines. */
        total: {
                day: SpendWindow;
                week: SpendWindow;
                cap: number; // 0 = unlimited
                throttledNow: boolean;
                drainAt: number | null;
        };
}

function zeroWindow(): SpendWindow {
        return { tokens: 0, runs: 0, turns: 0 };
}

/** One windowed SUM. Pure SQL over automation_runs; the window is
 * `started_at >= now - windowMs` — a run exactly on the edge counts
 * (>= boundary, pinned in the tests). */
function windowSum(whereClause: string, params: any[], now: number, windowMs: number): SpendWindow {
        const row = store.get<{ tokens: number | null; runs: number | null; turns: number | null }>(
                `SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
                        COALESCE(COUNT(*), 0) AS runs,
                        COALESCE(SUM(turns), 0) AS turns
                 FROM automation_runs
                 WHERE ${whereClause ? `(${whereClause}) AND ` : ""}started_at >= ?`,
                [...params, now - windowMs],
        );
        return {
                tokens: Number(row?.tokens ?? 0),
                runs: Number(row?.runs ?? 0),
                turns: Number(row?.turns ?? 0),
        };
}

/** When the 24h window drains below `cap`: the moment the oldest run
 * contributing to the current day-window leaves it (its started_at + 24h),
 * i.e. started_at of the oldest contributing run. null when not throttled
 * or the cap is unset/unreached. */
function drainTimeAt(now: number, cap: number, tokensDay: number): number | null {
        if (cap <= 0 || tokensDay < cap) return null;
        const oldest = store.get<{ s: number | null }>(
                `SELECT MIN(started_at) AS s FROM automation_runs WHERE started_at >= ? AND (tokens_in + tokens_out) > 0`,
                [now - SPEND_WINDOW_DAY_MS],
        );
        const s = oldest?.s;
        if (typeof s !== "number") return null; // all-zero-token rows: the cap is over counts only via real spend
        return s + SPEND_WINDOW_DAY_MS;
}

/** Per-routine + global report (the engine API and the CLI render this). */
export function automationSpendReport(now: number = Date.now()): AutomationSpendReport {
        const routines: RoutineSpend[] = [];
        const globalDay = zeroWindow();
        const globalWeek = zeroWindow();
        const caps = globalSpendCapTokensDay();
        const rows = store.query<{ id: string; title: string; spend_cap: number | null }>(
                `SELECT id, title, spend_cap FROM automations ORDER BY created_at`,
        );
        for (const r of rows) {
                const cap = r.spend_cap !== null ? Number(r.spend_cap) : null;
                const effectiveCap = cap !== null ? cap : caps > 0 ? caps : null;
                const day = windowSum(`automation_id = ?`, [r.id], now, SPEND_WINDOW_DAY_MS);
                const week = windowSum(`automation_id = ?`, [r.id], now, SPEND_WINDOW_7D_MS);
                globalDay.tokens += day.tokens;
                globalDay.runs += day.runs;
                globalDay.turns += day.turns;
                globalWeek.tokens += week.tokens;
                globalWeek.runs += week.runs;
                globalWeek.turns += week.turns;
                const throttledNow = effectiveCap !== null && day.tokens >= effectiveCap;
                routines.push({
                        automationId: r.id,
                        title: r.title,
                        cap,
                        day,
                        week,
                        effectiveCap,
                        throttledNow,
                        drainAt: throttledNow ? drainTimeAt(now, effectiveCap!, day.tokens) : null,
                });
        }
        const totalThrottled = caps > 0 && globalDay.tokens >= caps;
        return {
                now,
                routines,
                total: {
                        day: globalDay,
                        week: globalWeek,
                        cap: caps,
                        throttledNow: totalThrottled,
                        drainAt: totalThrottled ? drainTimeAt(now, caps, globalDay.tokens) : null,
                },
        };
}

// ---------------------------------------------------------------------------
// Ceiling check (the dispatcher gate calls this)
// ---------------------------------------------------------------------------

export interface SpendGateResult {
        /** False = dispatch allowed. */
        allow: boolean;
        /** The recorded skip's reason string (the cap + drain time). */
        reason: string | null;
}

/** The gate: may `automationId` spawn a NEW run at `now`? Checks the
 * per-routine spend_cap first (it is the tighter, explicit bound), then the
 * global one. The check is the routine's own 24h window for the per-routine
 * cap and the GLOBAL 24h window for the global cap — a routine at its global
 * ceiling is throttled by every routine's spend, and resumes as ANY window
 * drains. Skipped rows carry zero tokens and never count against the cap.
 * MANUAL runs never call this (the bypass) but their tokens count toward
 * the windows (they land in automation_runs like everything else). */
export function spendGate(automationId: string, now: number = Date.now()): SpendGateResult {
        const cap = store.get<{ spend_cap: number | null }>(`SELECT spend_cap FROM automations WHERE id = ?`, [
                automationId,
        ]);
        const capTokens = cap?.spend_cap !== null && cap?.spend_cap !== undefined ? Number(cap.spend_cap) : null;
        const dayTokens = windowSum(`automation_id = ?`, [automationId], now, SPEND_WINDOW_DAY_MS).tokens;
        if (capTokens !== null && dayTokens >= capTokens) {
                const drain = drainTimeAt(now, capTokens, dayTokens);
                return {
                        allow: false,
                        reason: `spend_ceiling: ${dayTokens} tokens in the last 24h >= this routine's cap ${capTokens} — the window drains ~${
                                drain ? new Date(drain).toISOString() : "soon"
                        }; the routine resumes on its own schedule`,
                };
        }
        const globalCap = globalSpendCapTokensDay();
        if (globalCap > 0) {
                const globalTokens = windowSum("", [], now, SPEND_WINDOW_DAY_MS).tokens;
                if (globalTokens >= globalCap) {
                        const drain = drainTimeAt(now, globalCap, globalTokens);
                        return {
                                allow: false,
                                reason: `spend_ceiling: ${globalTokens} tokens across all routines in the last 24h >= the global cap ${globalCap} (PI_AUTOMATION_MAX_TOKENS_DAY) — the window drains ~${
                                        drain ? new Date(drain).toISOString() : "soon"
                                }; routines resume on their own schedules`,
                        };
                }
        }
        return { allow: true, reason: null };
}
