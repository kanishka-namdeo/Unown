/**
 * model-health.ts — cross-process model-health marks + provider-failure
 * classification for subagent fallback models.
 *
 * Ported from pi-cciotti's src/runs/shared/model-health.ts (~100 lines,
 * atomic-JSON-only) and adapted to Unown's conventions:
 *
 *   - Shared store: a single JSON file under ~/.unown/agent/model-health.json
 *     read+written by every unown process (terminal sessions AND spawned
 *     subagents — the whole point is that a model that hard-failed in one
 *     process is skipped by the others for the TTL window).
 *   - 30-minute TTL: a mark auto-expires; the outage is tried once per window
 *     instead of once per launch (cciotti's exact semantics).
 *   - Fail-closed on corruption: an unreadable store behaves as EMPTY, never
 *     as "everything unhealthy".
 *
 * Provider-failure classification (when a fallback may advance) follows
 * cciotti: only failures that look like the PROVIDER being unhappy — auth,
 * quota, rate limits, 5xx, timeouts, empty responses — and only when the
 * child had not yet done any work (toolResults === 0). A context overflow or
 * a mid-task crash never rotates the model.
 *
 * Public surface:
 *   - MODEL_HEALTH_TTL_MS (30 min) / modelHealthPath(home)
 *   - loadModelHealth / saveModelHealth (atomic, Windows-safe rename)
 *   - markModelUnhealthy(model, now) / isModelUnhealthy(model, now)
 *   - pruneModelHealth(store, now) — drop expired marks
 *   - trimUnhealthyLeading(models, store, now) — skip leading marked models
 *   - isProviderStyleFailure(result) — classify a SubagentRunResult
 *
 * Standing invariant: no fork of the pi substrate; no pi imports.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A mark lives 30 minutes (cciotti's measured window: long enough to skip a
 *  hard outage, short enough that a recovered model is retried soon). */
export const MODEL_HEALTH_TTL_MS = 30 * 60 * 1000;

/** Shape on disk: { version, marks: { [modelId]: lastFailureEpochMs } }. */
export interface ModelHealthStore {
        version: 1;
        marks: Record<string, number>;
}

export const EMPTY_MODEL_HEALTH: ModelHealthStore = { version: 1, marks: {} };

/** Where the store lives: <home>/model-health.json (home is UNOWN_AGENT_DIR). */
export function modelHealthPath(home: string): string {
        return join(home, "model-health.json");
}

/** Load + prune in one pass. Unreadable/corrupt ⇒ empty store (fail-closed to
 *  "try the model", never to "skip everything"). Pure I/O, no throws. */
export function loadModelHealth(home: string, now = Date.now()): ModelHealthStore {
        try {
                const raw = readFileSync(modelHealthPath(home), "utf8");
                const parsed = JSON.parse(raw) as Partial<ModelHealthStore>;
                if (!parsed || typeof parsed !== "object" || typeof parsed.marks !== "object") return { ...EMPTY_MODEL_HEALTH };
                const marks: Record<string, number> = {};
                for (const [model, ts] of Object.entries(parsed.marks)) {
                        if (typeof ts === "number" && Number.isFinite(ts) && now - ts < MODEL_HEALTH_TTL_MS) {
                                marks[model] = ts;
                        }
                }
                return { version: 1, marks };
        } catch {
                return { ...EMPTY_MODEL_HEALTH };
        }
}

/**
 * Atomic write (temp + rename). On Windows, rename onto an existing file can
 * fail with EPERM/EACCES under scanner contention — the ladder from cciotti,
 * shrunk to the two moves that matter for a file this small: retry the rename
 * a few times, then unlink + rename. Never throws (health marks are advisory).
 */
export function saveModelHealth(home: string, store: ModelHealthStore): void {
        const target = modelHealthPath(home);
        const tmp = `${target}.tmp-${process.pid}-${Date.now().toString(36)}`;
        try {
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(tmp, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
                let ok = false;
                for (let attempt = 0; attempt < 3 && !ok; attempt++) {
                        try {
                                renameSync(tmp, target);
                                ok = true;
                        } catch {
                                if (attempt === 2) {
                                        try {
                                                rmSync(target, { force: true });
                                                renameSync(tmp, target);
                                                ok = true;
                                        } catch {
                                                /* give up silently */
                                        }
                                } else {
                                        // brief synchronous backoff (~4ms total) — mirrors
                                        // cciotti's Atomics.wait parking, bounded
                                        const until = Date.now() + 2;
                                        while (Date.now() < until) {}
                                }
                        }
                }
                if (!ok) {
                        try {
                                rmSync(tmp, { force: true });
                        } catch {
                                /* best effort */
                        }
                }
        } catch {
                /* best effort — health marks are advisory */
        }
}

/** Record a failure for `model` (now = epoch ms). Returns the updated store. */
export function markModelUnhealthy(model: string, now = Date.now(), base?: ModelHealthStore): ModelHealthStore {
        const store: ModelHealthStore = base ? { version: 1, marks: { ...base.marks } } : { ...EMPTY_MODEL_HEALTH };
        store.marks[model] = now;
        return store;
}

/** Is `model` currently marked (within the TTL)? */
export function isModelUnhealthy(model: string, store: ModelHealthStore, now = Date.now()): boolean {
        const ts = store.marks[model];
        return typeof ts === "number" && now - ts < MODEL_HEALTH_TTL_MS;
}

/** Drop expired marks (returns a NEW store; loadModelHealth already prunes). */
export function pruneModelHealth(store: ModelHealthStore, now = Date.now()): ModelHealthStore {
        const marks: Record<string, number> = {};
        for (const [model, ts] of Object.entries(store.marks)) {
                if (now - ts < MODEL_HEALTH_TTL_MS) marks[model] = ts;
        }
        return { version: 1, marks };
}

/**
 * The cciotti lead-trim: a fallback CHAIN advances from its head, so leading
 * marked models are dropped — but a marked model later in the chain stays
 * (the chain may still reach it after the head succeeds... no: cciotti drops
 * only LEADING candidates, keeping the rest so the chain never empties below
 * one candidate when possible).
 */
export function trimUnhealthyLeading(models: string[], store: ModelHealthStore, now = Date.now()): string[] {
        const out = [...models];
        while (out.length > 1 && isModelUnhealthy(out[0], store, now)) {
                out.shift();
        }
        return out;
}

// ---------------------------------------------------------------------------
// Provider-failure classification
// ---------------------------------------------------------------------------

/** The failure shape the fallback loop consumes (SubagentRunResult subset). */
export interface FallbackFailureInput {
        exitCode: number;
        stderr: string;
        output: string;
        /** Tool calls the child made before dying (0 ⇒ nothing happened yet). */
        toolResults: number;
}

/** Signatures of provider unhappiness (cciotti's set, regex-joined). Auth,
 *  quota, rate limits, 5xx, timeouts, connection resets, empty replies. */
const PROVIDER_FAILURE_PATTERNS: RegExp[] = [
        /\b(401|403|407)\b/, // auth
        /\b429\b/, // rate / quota
        /\b5\d\d\b/, // 5xx (coarse — stderr only ever carries provider text here)
        /quota/i,
        /rate.?limit/i,
        /timeout|timed out/i,
        /connection (error|reset|refused|closed)/i,
        /econn(refused|reset|aborted)/i,
        /fetch failed/i,
        /service unavailable/i,
        /overloaded/i,
        /internal server error/i,
];

/**
 * True when a failed subagent run looks like a PROVIDER problem that a
 * different model might survive, AND the child had done no work yet
 * (toolResults === 0 — cciotti's "before any tool use" rule; rotating the
 * model mid-task would discard real work). Context overflow, aborted runs
 * and crashes after work started never rotate.
 */
export function isProviderStyleFailure(result: FallbackFailureInput): boolean {
        if (result.exitCode === 0) return false;
        if (result.toolResults > 0) return false;
        const haystack = `${result.stderr}\n${result.output}`.slice(0, 4000);
        if (PROVIDER_FAILURE_PATTERNS.some((re) => re.test(haystack))) return true;
        // Empty everything + non-zero exit: the classic "provider said
        // nothing" shape (the preflight-probe failure mode).
        return !result.stderr.trim() && !result.output.trim();
}

/** True when a health-store file exists at the expected path (doctor probe). */
export function modelHealthExists(home: string): boolean {
        return existsSync(modelHealthPath(home));
}
