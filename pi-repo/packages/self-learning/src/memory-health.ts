/**
 * memory-health.ts — the memory health surface (S2-4, ticket SM-2).
 *
 * The memory platform's reconcile pass (memzero.ts reconcileMemories) is
 * MAINTENANCE, not a correctness gate: on two failed LLM attempts it fails
 * OPEN (a `mem0:reconcile-failed` bus event + console.warn, continuing
 * additive-only this round). The pre-SM-2 problem was that the failure was
 * EPHEMERAL — nothing queryable persisted, and no surface showed the
 * accumulated-state degradation of a memory scope (duplicates, unresolved
 * supersede conflicts, a reconcile that stopped running). This module makes
 * all of it queryable, deterministically and without LLM calls:
 *
 *   memoryHealth(scope?) → {
 *     lastReconcile,   // ts of the last SUCCESSFUL reconcile pass (the
 *                      // persistent record's last-success marker; null = never)
 *     duplicateCount,  // memories in normalized-text groups of >1 — the
 *                      // mem0 #4896 lesson: exact-hash dedup misses near-
 *                      // dupes, the normalized-text class is the honest v1
 *     conflictCount,   // supersede links (linked_memory_ids) whose OLD
 *                      // memory is still alive — the contradiction class
 *                      // the reconciler exists to resolve
 *     warnings,        // {kind, detail}[] — reconcile-failing (the durable
 *                      // record, since-ts + error), tier-at-cap,
 *                      // reconcile-stale (no reconcile in >7d AND undreamed
 *                      // notes pending)
 *   }
 *
 * Seams: the platform and the tier-size source are injectable (the
 * memzero.ts setMemoryPlatformForTests / dream.ts platform-injection
 * convention); the store stays out of this module by design — the only
 * durable state is the reconcile-failure/success record below, a small JSON
 * sidecar in the platform's own data dir (survives engine restarts). No LLM,
 * no network.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./store.ts";
import { ENGINE_SCOPE, type MemoryPlatform, type MemoryScope, type PlatformMemory } from "./memzero.ts";
import { undreamedNotes } from "./notes.ts";

// ---------------------------------------------------------------------------
// The persistent reconcile outcome record (the fail-open pass's durable state)
// ---------------------------------------------------------------------------

/** The durable record: written when a reconcile pass FAILS both attempts
 * (the fail-open branch), CLEARED when one succeeds. This is what turns
 * `mem0:reconcile-failed` from an ephemeral bus event into a warning the
 * card/doctor/API can render until a pass succeeds — and it is the source
 * of `lastReconcile` (a dreams-table timestamp would not be honest: the
 * table carries no reconcile outcome, so a zero-op and a failed reconcile
 * dream look identical there). */
interface ReconcileRecord {
        /** ts of the last SUCCESSFUL reconcile pass (null = never succeeded). */
        lastSuccessTs: number | null;
        /** ts of the most recent failure (the warning's "since"). */
        lastFailureTs: number | null;
        /** The failure's own words (the reconcile LLM's error, clipped). */
        lastError: string | null;
}

const RECORD_KEY = "memory-health-reconcile";

/** The mem0 data dir — the record's default home (buildMem0Platform creates
 * it at boot). Read at call time so PI_MEM0_DIR moves with the engine. */
function recordDir(): string {
        return process.env.PI_MEM0_DIR ? (process.env.PI_MEM0_DIR as string) : join(DATA_DIR, "mem0");
}

/** The record's path: a sidecar under the mem0 data dir (which
 * buildMem0Platform creates at boot; tests point it anywhere). */
export function reconcileRecordPath(dir?: string): string {
        return join(dir ?? recordDir(), `${RECORD_KEY}.json`);
}

function readRecord(dir?: string): ReconcileRecord {
        const EMPTY: ReconcileRecord = { lastSuccessTs: null, lastFailureTs: null, lastError: null };
        try {
                const raw = readFileSync(reconcileRecordPath(dir), "utf8");
                const parsed = JSON.parse(raw) as Partial<ReconcileRecord>;
                return {
                        lastSuccessTs: typeof parsed.lastSuccessTs === "number" ? parsed.lastSuccessTs : null,
                        lastFailureTs: typeof parsed.lastFailureTs === "number" ? parsed.lastFailureTs : null,
                        lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
                };
        } catch {
                return EMPTY; // absent/corrupt = "never recorded" — the honest default
        }
}

/** Called from the reconcile pass's FAIL-OPEN branch (double LLM failure).
 * Records the failure; any earlier success marker is superseded as the
 * current state — the warning is live until the NEXT success clears it. */
export function recordReconcileFailure(error: string, now: number = Date.now(), dir?: string): void {
        const rec = readRecord(dir);
        writeRecord({ ...rec, lastFailureTs: now, lastError: String(error).slice(0, 500) }, dir);
}

/** Called from the reconcile pass on a SUCCESSFUL verdict (including the
 * zero-op one — "nothing to reconcile" is a healthy pass). Clears the
 * failure lane and stamps the success ts. */
export function recordReconcileSuccess(now: number = Date.now(), dir?: string): void {
        writeRecord({ lastSuccessTs: now, lastFailureTs: null, lastError: null }, dir);
}

function writeRecord(rec: ReconcileRecord, dir?: string): void {
        const path = reconcileRecordPath(dir);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `${JSON.stringify(rec, null, 2)}\n`);
}

/** The raw record for a scope dir (doctor/inspection surface). */
export function reconcileRecord(dir?: string): ReconcileRecord {
        return readRecord(dir);
}

/** The success marker as a timestamp (null = no successful reconcile on
 * record — the card's "last reconcile: never" state). */
export function lastReconcileTs(dir?: string): number | null {
        return readRecord(dir).lastSuccessTs;
}

/** True when a failure record is live (lastFailure present and NEWER than
 * the last success — a cleared record has lastFailureTs null anyway). */
export function reconcileFailing(dir?: string): { since: number; error: string } | null {
        const rec = readRecord(dir);
        if (rec.lastFailureTs === null || rec.lastError === null) return null;
        if (rec.lastSuccessTs !== null && rec.lastSuccessTs > rec.lastFailureTs) return null;
        return { since: rec.lastFailureTs, error: rec.lastError };
}

/** Test/ops seam: drop the record file entirely. */
export function clearReconcileRecord(dir?: string): void {
        try {
                unlinkSync(reconcileRecordPath(dir));
        } catch {
                /* never recorded — nothing to clear */
        }
}

// ---------------------------------------------------------------------------
// The pure health computation
// ---------------------------------------------------------------------------

export interface HealthWarning {
        kind: "reconcile-failing" | "tier-at-cap" | "reconcile-stale" | "review-pending";
        detail: string;
}

export interface MemoryHealth {
        /** The scope this health was computed for. */
        scope: string;
        /** ts of the last SUCCESSFUL reconcile pass, null when never. */
        lastReconcile: number | null;
        /** Memories in normalized-text duplicate groups (count of members in
         * groups of >1 — a group of 3 counts 3, not 2). */
        duplicateCount: number;
        /** Supersede links whose OLD (linked) memory is still alive. */
        conflictCount: number;
        /** Bi-temporal supersede (Memory v2 round): memories carrying
         *  metadata.supersededBy — retained for audit, excluded from recall.
         *  The audit lane depth (Graphiti's invalidated-edge count). */
        supersededCount: number;
        /** Per-type breakdown (Memory v2 round): fact/episode/procedure/preference
         *  counts. The memory model's shape, surfaced on the health card. */
        typeBreakdown: Record<string, number>;
        /** Live warnings (an empty scope with no records has none). */
        warnings: HealthWarning[];
        /** The platform's current memory count for the scope (context). */
        memoryCount: number;
        /** The memory review queue's pending depth (Divertimento CP1): the
         *  human gate's visible counter. The queue is user-level (one inbox
         *  across projects) but the counter rides the health card every
         *  surface already renders. */
        reviewQueueDepth: number;
}

/** Normalize a memory text for duplicate grouping (the v1 near-dupe class):
 * case-fold, strip punctuation, collapse whitespace. "Run X with --flag" and
 * "run x  with --flag!" land in the same group. */
export function normalizeMemoryText(text: string): string {
        return String(text ?? "")
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
}

/** Count memories that sit in normalized-text groups of >1 (the members,
 * not the groups — a scope with A, A, B returns 2). */
export function countDuplicates(memories: Array<Pick<PlatformMemory, "id" | "text">>): number {
        const groups = new Map<string, number>();
        for (const m of memories) {
                if (!m?.text?.trim()) continue; // empty-text rows are not memories
                const key = normalizeMemoryText(m.text);
                if (!key) continue;
                groups.set(key, (groups.get(key) ?? 0) + 1);
        }
        let count = 0;
        for (const n of groups.values()) if (n > 1) count += n;
        return count;
}

/** Count supersede links whose OLD memory is still alive: a live memory m
 * whose successor carries `linked_memory_ids` including m.id is an
 * unresolved contradiction (the reconciler's DELETE/UPDATE has not yet
 * retired m). */
export function countConflicts(memories: Array<Pick<PlatformMemory, "id" | "text" | "metadata">>): number {
        const ids = new Set(memories.map((m) => String(m?.id ?? "")).filter(Boolean));
        let count = 0;
        for (const m of memories) {
                const linked = m.metadata?.linked_memory_ids;
                const list: string[] = Array.isArray(linked) ? linked.map((x) => String(x ?? "")) : typeof linked === "string" ? [linked] : [];
                for (const l of list) {
                        const oldId = String(l ?? "");
                        if (oldId && oldId !== m.id && ids.has(oldId)) count++;
                }
        }
        return count;
}

/** Count superseded memories (Memory v2 round): memories carrying
 *  metadata.supersededBy — the audit lane depth. Superseded memories are
 *  retained in the store (excluded from recall by filterLatestOnly) so the
 *  version history can answer "what was true then". This counter surfaces
 *  the audit lane's size on the health card. */
export function countSuperseded(memories: Array<Pick<PlatformMemory, "id" | "metadata">>): number {
        return memories.filter((m) => Boolean(m?.metadata?.supersededBy)).length;
}

/** Count memories by type (Memory v2 round): the per-type breakdown for the
 *  health card — fact/episode/procedure/preference. Reads metadata.type
 *  (default "fact" for backward compat). The breakdown surfaces the memory
 *  model's shape on the health card so the user can see their memory's
 *  composition at a glance. */
export function countByType(memories: Array<Pick<PlatformMemory, "id" | "metadata">>): Record<string, number> {
        const counts: Record<string, number> = { fact: 0, episode: 0, procedure: 0, preference: 0 };
        for (const m of memories) {
                const t = String(m?.metadata?.type ?? "").trim().toLowerCase();
                if (t in counts) counts[t]++;
                else counts.fact++; // unknown type → fact (the default)
        }
        return counts;
}

/** The reconcile-stale horizon: a scope with no reconcile success in more
 * than 7 days AND undreamed notes pending is accumulating backlog it has
 * not reconciled. */
export const RECONCILE_STALE_MS = 7 * 24 * 60 * 60_000;

/** The health object for one scope. Pure + the two injectable seams:
 * `platform` (the memory list) and `tierChars` (the project tier's current
 * size vs its cap — when the tier cannot be read the warning is simply
 * absent, never a throw). The reconcile record is read from the platform
 * data dir unless `recordDir` is injected. */
export async function memoryHealth(
        scope: MemoryScope,
        opts: {
                platform?: MemoryPlatform;
                /** The tier-size source (injectable): current chars in the
                 * project tier + the cap. null/undefined = not measurable. */
                tierSize?: { chars: number; cap: number } | null;
                /** The mem0 data dir to read the reconcile record from. */
                recordDir?: string;
                /** Undreamed notes pending in the scope (0 = none). */
                undreamedNotes?: number;
                /** The memory review queue's pending depth (injected by the
                 *  engine form; 0/undefined = no warning). */
                reviewQueueDepth?: number;
                now?: number;
        } = {},
): Promise<MemoryHealth> {
        const { getMemoryPlatform } = await import("./memzero.ts");
        const platform = opts.platform ?? (await getMemoryPlatform());
        const memories = await platform.getAll(scope);
        const warnings: HealthWarning[] = [];

        // 1 — the durable failure lane: a live reconcile failure renders
        // until a success clears it (since-ts + the error's own words).
        const failing = reconcileFailing(opts.recordDir);
        if (failing) {
                warnings.push({
                        kind: "reconcile-failing",
                        detail: `reconcile has failed since ${new Date(failing.since).toISOString()} (${failing.error}); the pass is running additive-only — the backlog is growing`,
                });
        }

        // 2 — the tier cap: a project tier at its write cap stops accepting
        // dream renders (the throw-on-cap loop the render ceiling prevents).
        const tier = opts.tierSize;
        if (tier && tier.cap > 0 && tier.chars >= tier.cap) {
                warnings.push({
                        kind: "tier-at-cap",
                        detail: `project memory tier is at its cap (${tier.chars}/${tier.cap} chars) — dreams stop shipping until it is consolidated`,
                });
        }

        // 3 — reconcile staleness: no successful reconcile in >7d AND notes
        // are still undreamed — the backlog will keep piling up.
        const now = opts.now ?? Date.now();
        const last = lastReconcileTs(opts.recordDir);
        const undreamed = opts.undreamedNotes ?? 0;
        if (undreamed > 0 && (last === null || now - last > RECONCILE_STALE_MS)) {
                warnings.push({
                        kind: "reconcile-stale",
                        detail: `${undreamed} undreamed note(s) pending with no successful reconcile${
                                last === null ? " on record" : ` since ${new Date(last).toISOString()}`
                        }`,
                });
        }

        // 4 — the review queue (Divertimento CP1): pending candidates are the
        // one warning class that is a FEATURE waiting for a human, not a fault —
        // but it must be VISIBLE until decided (the scrutable-memory research:
        // invisible decisions are the #1 trust killer). Amber, never rose.
        const reviewDepth = opts.reviewQueueDepth ?? 0;
        if (reviewDepth > 0) {
                warnings.push({
                        kind: "review-pending",
                        detail: `${reviewDepth} memory review candidate(s) awaiting your decision — /memory review (or unown memory review)`,
                });
        }

        const label =
                scope.agentId ?? (scope.userId ? `user:${scope.userId}` : scope.runId ? `run:${scope.runId}` : "default");
        return {
                scope: label,
                lastReconcile: last,
                duplicateCount: countDuplicates(memories),
                conflictCount: countConflicts(memories),
                supersededCount: countSuperseded(memories),
                typeBreakdown: countByType(memories),
                warnings,
                memoryCount: memories.length,
                reviewQueueDepth: opts.reviewQueueDepth ?? 0,
        };
}

/** The engine's undreamed benchmark-lane notes (the reconcile-stale warning's
 * input for the engine scope; 0 = an empty queue, never an error).
 *
 * The Memory Encore round fix (2026-11-12): this used to return
 * `(undreamedNotes ?? 0).length` — the imported FUNCTION's `.length` (its
 * arity, always 2), never the queue — so the reconcile-stale warning
 * reported a phantom "2 undreamed note(s) pending" whenever the 7-day
 * horizon tripped. The fix calls the function (the same
 * `undreamedNotes(50, "benchmark").length` shape router.ts and server.ts
 * use); the catch stays for a store that cannot answer. */
function engineUndreamedNotes(): number {
        try {
                return undreamedNotes(50, "benchmark").length;
        } catch {
                return 0;
        }
}

/**
 * The convenience form the engine API and hub card use: the engine scope's
 * health, with the project tier's live size vs its cap and the undreamed
 * notes (the engine's benchmark-lane queue). Best-effort enrichment: a tier
 * read that throws (absent file, pre-swap install) degrades to no
 * tier-at-cap warning instead of failing the whole surface.
 */
export async function engineMemoryHealth(
        opts: { platform?: MemoryPlatform; recordDir?: string; undreamedNotes?: number; reviewQueueDepth?: number } = {},
): Promise<MemoryHealth> {
        let tierSize: { chars: number; cap: number } | null = null;
        try {
                const { readTier, maxTierChars } = await import("./memory.ts");
                const chars = readTier("project").length;
                tierSize = { chars, cap: maxTierChars() };
        } catch {
                tierSize = null; // not measurable — the warning simply is absent
        }
        const pending = opts.undreamedNotes ?? engineUndreamedNotes();
        // The review queue's depth is user-level (one inbox across projects);
        // a failed read is 0, never a thrown health card.
        let reviewDepth = opts.reviewQueueDepth ?? 0;
        try {
                const { memoryReviewQueueDepth } = await import("./memory-review.ts");
                reviewDepth = opts.reviewQueueDepth ?? memoryReviewQueueDepth();
        } catch {
                reviewDepth = opts.reviewQueueDepth ?? 0;
        }
        return memoryHealth(ENGINE_SCOPE, { ...opts, tierSize, undreamedNotes: pending, reviewQueueDepth: reviewDepth });
}
