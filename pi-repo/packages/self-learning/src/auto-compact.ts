/**
 * auto-compact.ts — auto-compact on token limit (Milestone 3.7).
 *
 * Reverse-engineered from goose's auto-compact-on-token-limit feature: when
 * a session's token usage approaches the active model's context window,
 * automatically trigger compaction (summarize older turns) BEFORE the model
 * loses early turns or fails with a context-overflow error. A proportional
 * threshold curve avoids both premature compaction (loses hard-won context)
 * and overflow crashes (loses the whole turn):
 *
 *   - below warnThreshold (default 70%):   "none"     — full context available
 *   - warnThreshold ≤ u < compactThreshold: "warn"     — system message: compaction imminent
 *   - compactThreshold ≤ u < hardLimit:    "compact"  — trigger compaction on the next turn
 *   - u ≥ hardLimit (default 95%):          "block"    — hard-block the next model request
 *
 * The thresholds are env-tunable (UNOWN_AUTO_COMPACT_THRESHOLD for the
 * compact trigger; UNOWN_AUTO_COMPACT_HARD_LIMIT for the hard limit). Both
 * default to the goose-derived curve (85 / 95). Explicit `AutoCompactConfig`
 * overrides ALWAYS win over env vars; env vars ALWAYS win over defaults.
 *
 * Pure module: no pi imports, no fs, no network. The runner wires this into
 * the pi session event loop (see `runner.ts:checkAutoCompact` — the
 * `turn_end` handler consults `shouldAutoCompact` against the live context
 * usage and dispatches warn/compact/block accordingly).
 *
 * Standing invariant: no fork of the pi substrate; lands on the existing
 * runner.ts `session.subscribe` seam + (defensively) the pi `getContextUsage`
 * seam that `context-tools.ts` already documents.
 */

// ---------------------------------------------------------------------------
// Env-var names — exported as constants so the runner / cli reference the
// same identifiers (no string drift). Read lazily (per call, not at module
// load) so tests + long-running processes can mutate process.env between calls.
// ---------------------------------------------------------------------------

/** When set, overrides the default COMPACT threshold (percent, default 85).
 *  Goose-derived value: 85% is where auto-compaction kicks in (summarize older
 *  turns). Accepts 0–100; anything else falls back to the default. */
export const AUTO_COMPACT_THRESHOLD_ENV = "UNOWN_AUTO_COMPACT_THRESHOLD";

/** When set, overrides the default HARD LIMIT (percent, default 95). Above
 *  this the next model request is hard-blocked — the session must be compacted
 *  manually or restarted. Accepts 0–100; anything else falls back to default. */
export const AUTO_COMPACT_HARD_LIMIT_ENV = "UNOWN_AUTO_COMPACT_HARD_LIMIT";

// ---------------------------------------------------------------------------
// Defaults (goose-derived proportional threshold curve)
// ---------------------------------------------------------------------------

/** Usage below this is "none" — full context available. */
export const DEFAULT_WARN_THRESHOLD = 70;
/** Usage ≥ this triggers auto-compaction on the next turn. */
export const DEFAULT_COMPACT_THRESHOLD = 85;
/** Usage ≥ this hard-blocks the next model request. */
export const DEFAULT_HARD_LIMIT = 95;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Threshold overrides for the proportional compaction curve.
 *  All fields optional — unset fields fall back to env, then to defaults. */
export interface AutoCompactConfig {
    /** Percent usage at/below which a "warn" decision is issued (default 70). */
    warnThreshold?: number;
    /** Percent usage at/above which "compact" triggers (default 85, or
     *  UNOWN_AUTO_COMPACT_THRESHOLD when set). */
    compactThreshold?: number;
    /** Percent usage at/above which the next model request is "block"-ed
     *  (default 95, or UNOWN_AUTO_COMPACT_HARD_LIMIT when set). */
    hardLimit?: number;
}

/** The decision returned by {@link shouldAutoCompact}. */
export interface AutoCompactDecision {
    /** The action the runner should take before the next turn. */
    action: "none" | "warn" | "compact" | "block";
    /** The percent threshold this decision sits at (warn / compact / hard-limit).
     *  `0` when maxTokens is zero or negative (the curve is disabled). */
    threshold: number;
    /** Human-readable reason (includes the live usage % and the threshold). */
    reason: string;
    /** The percent of the context window currently used (0–100, 1dp).
     *  Mirrored out so callers can log it without recomputing. */
    usagePercent: number;
}

// ---------------------------------------------------------------------------
// Env-var parsing (lazy / safe — never throws)
// ---------------------------------------------------------------------------

/** Parse a percent env var: 0–100 numeric, else `fallback`. Empty/garbage
 *  values do NOT propagate — the curve's defaults stay intact. */
function parsePercentEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (typeof raw !== "string") return fallback;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return fallback;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
    return parsed;
}

/**
 * Resolve an {@link AutoCompactConfig} into a fully-populated shape. Priority:
 *
 *   1. Explicit `cfg` field (when set)
 *   2. Env var override (UNOWN_AUTO_COMPACT_THRESHOLD / _HARD_LIMIT)
 *   3. Hard-coded default (70 / 85 / 95)
 *
 * Pure — exported for tests so the override precedence is assertable without
 * going through {@link shouldAutoCompact}.
 */
export function resolveAutoCompactConfig(cfg?: AutoCompactConfig): Required<AutoCompactConfig> {
    return {
        warnThreshold: cfg?.warnThreshold ?? DEFAULT_WARN_THRESHOLD,
        compactThreshold: cfg?.compactThreshold ?? parsePercentEnv(AUTO_COMPACT_THRESHOLD_ENV, DEFAULT_COMPACT_THRESHOLD),
        hardLimit: cfg?.hardLimit ?? parsePercentEnv(AUTO_COMPACT_HARD_LIMIT_ENV, DEFAULT_HARD_LIMIT),
    };
}

// ---------------------------------------------------------------------------
// shouldAutoCompact — the curve
// ---------------------------------------------------------------------------

/**
 * Decide what to do given the session's current token usage.
 *
 * Curve (all bounds are inclusive at the lower edge — exactly at a threshold
 * is treated as "in" that bucket):
 *
 *   - usage <  warnThreshold        → "none"     (full context available)
 *   - warnThreshold ≤ u < compact   → "warn"     (system message)
 *   - compactThreshold ≤ u < hard    → "compact"  (trigger compaction)
 *   - usage ≥ hardLimit              → "block"    (hard-block the request)
 *
 * Edge cases:
 *   - `maxTokens === 0` or negative → "none" with `threshold: 0` (the curve
 *     is disabled — there is no context budget to track). The runner treats
 *     this as a no-op.
 *   - `tokensUsed === 0`            → "none" (session just started).
 *   - `tokensUsed < 0`               → coerced to 0 (defensive — never throws).
 *   - exactly at `warnThreshold`    → "warn".
 *   - exactly at `compactThreshold` → "compact".
 *   - exactly at `hardLimit`        → "block".
 *
 * Out-of-order thresholds (e.g. compact < warn): the check order is block →
 * compact → warn, so the most-aggressive matching bucket wins. A
 * misconfiguration never silently picks the less-aggressive action.
 *
 * Pure — exported for tests + the runner's `turn_end` handler.
 */
export function shouldAutoCompact(
    tokensUsed: number,
    maxTokens: number,
    cfg?: AutoCompactConfig,
): AutoCompactDecision {
    const { warnThreshold, compactThreshold, hardLimit } = resolveAutoCompactConfig(cfg);

    // Disabled: no context budget to track. The runner treats this as a no-op
    // (do not block, do not compact) so a misconfigured maxTokens can never
    // brick a session.
    if (typeof maxTokens !== "number" || !Number.isFinite(maxTokens) || maxTokens <= 0) {
        return {
            action: "none",
            threshold: 0,
            reason: "maxTokens is zero or negative; context-usage tracking disabled (no-op)",
            usagePercent: 0,
        };
    }

    // Defensive: a NaN / negative tokensUsed is coerced to 0 (session just
    // started). Never throws.
    const used = typeof tokensUsed === "number" && Number.isFinite(tokensUsed) && tokensUsed > 0 ? tokensUsed : 0;
    // The bucket comparisons use the RAW percentage so the curve is honest at
    // the boundaries: 84.999% is "warn" (not "compact"), 94.999% is "compact"
    // (not "block"). The rounded value is for display (reason + usagePercent).
    const usagePercentRaw = (used / maxTokens) * 100;
    const pct = Number(usagePercentRaw.toFixed(1));

    if (usagePercentRaw >= hardLimit) {
        return {
            action: "block",
            threshold: hardLimit,
            reason: `usage ${pct}% ≥ hard limit ${hardLimit}% — context exhausted, next model request blocked`,
            usagePercent: pct,
        };
    }
    if (usagePercentRaw >= compactThreshold) {
        return {
            action: "compact",
            threshold: compactThreshold,
            reason: `usage ${pct}% ≥ compact threshold ${compactThreshold}% — auto-compaction triggered`,
            usagePercent: pct,
        };
    }
    if (usagePercentRaw >= warnThreshold) {
        return {
            action: "warn",
            threshold: warnThreshold,
            reason: `usage ${pct}% ≥ warn threshold ${warnThreshold}% — compaction imminent`,
            usagePercent: pct,
        };
    }
    return {
        action: "none",
        threshold: warnThreshold,
        reason: `usage ${pct}% < warn threshold ${warnThreshold}% — full context available`,
        usagePercent: pct,
    };
}

// ---------------------------------------------------------------------------
// Formatters — system message + error message text
// ---------------------------------------------------------------------------

/**
 * The system message text injected into the session when the "warn" decision
 * fires. Tells the model (in plain language) that compaction is imminent and
 * it should wind down long-running sub-tasks / avoid spawning massive tool
 * results — without forcing it.
 *
 * Includes the percentage so the model can self-pace.
 */
export function formatCompactionWarning(tokensUsed: number, maxTokens: number): string {
    const pct = maxTokens > 0 ? Number(((tokensUsed / maxTokens) * 100).toFixed(1)) : 0;
    const used = (tokensUsed | 0).toLocaleString();
    const max = (maxTokens | 0).toLocaleString();
    return (
        `[auto-compact] Context window is filling up: ${used} / ${max} tokens used (${pct}%). ` +
        `Compaction will trigger on the next turn if usage keeps growing. ` +
        `Wind down long-running sub-tasks, avoid producing large tool results, and prefer concise replies until the window is summarized.`
    );
}

/**
 * The error message surfaced to the model (and the user) when the "block"
 * decision fires. The runner returns this from the model request path so the
 * failure mode is unambiguous: the model did NOT time out, the bridge did NOT
 * 5xx — the local auto-compact guard refused to send the request because the
 * session is at the hard limit.
 */
export function formatContextExhaustedError(tokensUsed: number, maxTokens: number): string {
    const pct = maxTokens > 0 ? Number(((tokensUsed / maxTokens) * 100).toFixed(1)) : 0;
    const used = (tokensUsed | 0).toLocaleString();
    const max = (maxTokens | 0).toLocaleString();
    return (
        `Context exhausted: ${used} / ${max} tokens used (${pct}%). ` +
        `The session has reached the auto-compact hard limit and the next model request was blocked to prevent a context-overflow failure. ` +
        `Run /compact manually to summarize older turns, or start a new session.`
    );
}
