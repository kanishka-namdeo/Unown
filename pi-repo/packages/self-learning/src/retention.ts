/**
 * retention.ts — bounded data growth for the engine's operational telemetry (M9).
 *
 * WHY: for its first months the engine pruned exactly ONE growing table
 * (governor.ts pruneLedger, 24h) — everything else accumulated forever.
 * Measured on a ~2h-old engine DB (R3 recon, 2026-10-21): hook_log grows
 * ~2 rows per tool call, run rows carry full JSON transcripts (~19KB average
 * — the heaviest column in the DB), and /api/overview COUNT(*)s hook_log on
 * every hit, so growth taxes the hot path, not just disk.
 *
 * The split that makes pruning SAFE (the load-bearing design decision):
 *
 *   OPERATIONAL (pruned past their windows)     PRECIOUS (never pruned)
 *   hook_log, runs, dreams, cycles,             memory_versions, skills,
 *   automation_runs, dreamed notes              skill_versions, tasks,
 *                                               improvements, automations
 *
 * Precious tables have NO predicate in the registry below — the exclusion is
 * structural, not a configuration default, so no aggressive
 * UNOWN_RETENTION_DAYS value can touch them. Undreamed notes (the dream work
 * queue) are excluded the same way: only rows with dream_id set can match.
 *
 * Windows (days; per-table knob > UNOWN_RETENTION_DAYS override > table
 * default; a 0 day-knob disables that table, 0 row-cap = unlimited):
 *
 *   hook_log        UNOWN_RETENTION_HOOK_LOG_DAYS (14) + row-cap backstop
 *                   UNOWN_RETENTION_HOOK_LOG_MAX_ROWS (250000) — whichever
 *                   triggers first (Prometheus' two-limit shape)
 *   runs            UNOWN_RETENTION_RUNS_DAYS (30)         not running
 *   dreams          UNOWN_RETENTION_HISTORY_DAYS (90)      ended_at (or
 *                   started_at when ended_at is null and not running)
 *   cycles          UNOWN_RETENTION_HISTORY_DAYS (90)      ended cycles only
 *   automation_runs UNOWN_RETENTION_HISTORY_DAYS (90)      not running (R3
 *                   suggested 60; one shared knob keeps the history horizon
 *                   simple — see docs/configuration.md)
 *   notes (dreamed) UNOWN_RETENTION_NOTES_DAYS (90)
 *
 * UNOWN_RETENTION_DAYS=0 is the GLOBAL kill switch: nothing is pruned at all.
 *
 * Pacing (rollout safety — Home Assistant recorder's auto_purge shape):
 * deletes run in ≤5,000-row batches, each its own implicit transaction
 * (bun:sqlite runs autocommit; SQLite's DELETE...LIMIT needs
 * SQLITE_ENABLE_UPDATE_DELETE_LIMIT, which bun does not compile in — hence
 * the rowid-subselect form), at most 50,000 rows per table per pass. A pass
 * that hits the cap reports moreRemaining so the db-retention router job
 * self-reschedules in 5 minutes instead of 24h (RETENTION_BACKLOG_RESCHEDULE_MS)
 * — a six-month backlog drains paced over hours, never in one boot. Nothing
 * here runs at startup: only the router job calls it, and it first fires 24h
 * after the job row is seeded — a brand-new DB prunes zero rows.
 *
 * SQLite notes: auto_vacuum stays NONE (the shipped default), so a prune
 * hands pages to the freelist for REUSE — the file size plateaus at the
 * window's high-water mark instead of shrinking — and no VACUUM ever runs on
 * the hot path (it needs ~2x disk and locks the DB; a manual repack is a
 * doctor-time action, if ever).
 */
import { store, type Store } from "./store.ts";

const DAY_MS = 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Env knobs (read at call time — tests redirect them after import; the
// governor.ts convention). `||`: an EMPTY .env value means unset.
// ---------------------------------------------------------------------------

/** The knob as a SET day value, or null (unset/empty/invalid → fallback). */
function setDays(name: string): number | null {
        const raw = process.env[name] || ""; // `||`: empty .env value means unset
        if (raw === "") return null;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : null;
}

function daysEnv(name: string, fallback: number): number {
        return setDays(name) ?? fallback;
}

/** UNOWN_RETENTION_DAYS as a SET value or null. 0 = the global kill switch;
 *  N > 0 = every table's day window becomes N (per-table knobs still win). */
function globalDaysOverride(): number | null {
        return setDays("UNOWN_RETENTION_DAYS");
}

/** True unless the global kill switch is set (UNOWN_RETENTION_DAYS=0). */
export function retentionEnabled(): boolean {
        return globalDaysOverride() !== 0;
}

/** A table's effective day window: its own knob when set, else the global
 *  override when set, else the table's default. */
function windowDays(knob: string, fallback: number): number {
        return setDays(knob) ?? globalDaysOverride() ?? fallback;
}

export function hookLogDays(): number {
        return windowDays("UNOWN_RETENTION_HOOK_LOG_DAYS", 14);
}
export function hookLogMaxRows(): number {
        return daysEnv("UNOWN_RETENTION_HOOK_LOG_MAX_ROWS", 250_000);
}
export function runsDays(): number {
        return windowDays("UNOWN_RETENTION_RUNS_DAYS", 30);
}
export function historyDays(): number {
        return windowDays("UNOWN_RETENTION_HISTORY_DAYS", 90);
}
export function notesDays(): number {
        return windowDays("UNOWN_RETENTION_NOTES_DAYS", 90);
}

// ---------------------------------------------------------------------------
// The operational table registry (table-driven — the predicates ARE the policy)
// ---------------------------------------------------------------------------

/** One prunable-row predicate: [WHERE fragment, params]. */
type Predicate = [string, any[]];

interface TableSpec {
        table: string;
        /** The ACTIVE rules for this pass (a 0 day-knob / 0-unlimited cap disables
         *  its rule by omission). */
        predicates: (now: number) => Predicate[];
}

const TABLES: TableSpec[] = [
        {
                table: "hook_log",
                predicates: (now) => {
                        const rules: Predicate[] = [];
                        const days = hookLogDays();
                        if (days > 0) rules.push([`ts < ?`, [now - days * DAY_MS]]);
                        const cap = hookLogMaxRows();
                        if (cap > 0) {
                                // Row-cap backstop: keep the newest `cap` rows by id (AUTOINCREMENT
                                // id = insert order); everything older is prunable EVEN WHEN RECENT —
                                // a busy engine must not grow without bound inside the time window
                                // (Prometheus prunes on time OR size, whichever triggers first).
                                // OFFSET cap lands on the id just BELOW the kept set (the cap+1-th
                                // newest); `id <= NULL` (fewer rows than the cap) matches nothing.
                                // (Off-by-one caught by test: OFFSET cap-1 would keep only ONE row.)
                                rules.push([`id <= (SELECT id FROM hook_log ORDER BY id DESC LIMIT 1 OFFSET ?)`, [cap]]);
                        }
                        return rules;
                },
        },
        {
                table: "runs",
                predicates: (now) => {
                        const days = runsDays();
                        if (days <= 0) return [];
                        // A run still marked running is never pruned — it may be a live
                        // session (or an orphan recoverOrphans will heal at boot).
                        return [[`status != 'running' AND ended_at < ?`, [now - days * DAY_MS]]];
                },
        },
        {
                table: "dreams",
                predicates: (now) => {
                        const days = historyDays();
                        if (days <= 0) return [];
                        const cutoff = now - days * DAY_MS;
                        // Ended dreams age on ended_at; a null ended_at is prunable only when
                        // the dream is NOT running (a crashed dream still has started_at as
                        // its age — the same rows recoverOrphans heals).
                        return [[`(ended_at IS NOT NULL AND ended_at < ?) OR (ended_at IS NULL AND status != 'running' AND started_at < ?)`, [cutoff, cutoff]]];
                },
        },
        {
                table: "cycles",
                predicates: (now) => {
                        const days = historyDays();
                        if (days <= 0) return [];
                        // Only FINISHED cycles age out; an open cycle (ended_at null) may be
                        // mid-iteration.
                        return [[`created_at < ? AND ended_at IS NOT NULL`, [now - days * DAY_MS]]];
                },
        },
        {
                table: "automation_runs",
                predicates: (now) => {
                        const days = historyDays();
                        if (days <= 0) return [];
                        return [[`status != 'running' AND started_at < ?`, [now - days * DAY_MS]]];
                },
        },
        {
                table: "notes",
                predicates: (now) => {
                        const days = notesDays();
                        if (days <= 0) return [];
                        // ONLY dreamed notes. Undreamed notes are AutoDream's work queue —
                        // excluded structurally (the predicate cannot match them), not by config.
                        return [[`dream_id IS NOT NULL AND created_at < ?`, [now - days * DAY_MS]]];
                },
        },
];

/** The operational tables, in registry order (diagnostics + tests). */
export const RETENTION_TABLES = TABLES.map((t) => t.table);

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface RetentionPassResult {
        /** Rows deleted this pass, per operational table (0 entries included). */
        pruned: Record<string, number>;
        /** True when any table still has prunable rows (a batch cap was hit) —
         *  the db-retention job then re-runs sooner than its 24h cadence. */
        moreRemaining: boolean;
}

/** While a backlog remains, the db-retention job reschedules at this interval
 *  instead of its 24h cadence (the HA recorder paced-drain pattern). */
export const RETENTION_BACKLOG_RESCHEDULE_MS = 5 * 60_000;

const BATCH_ROWS = 5_000;
const MAX_ROWS_PER_TABLE_PER_PASS = 50_000;
/** First-contact loudness: the first pass on a long-lived install can delete
 *  six figures of rows; a silent shrink of the history views would look like
 *  data loss, so one explanatory line is printed above this total. */
const LOUD_TOTAL_ROWS = 10_000;

/**
 * Batched DELETE by rowid-subselect: `DELETE FROM t WHERE rowid IN (SELECT
 * rowid FROM t WHERE <pred> LIMIT n)` looped until the predicate is
 * exhausted or the per-table budget is spent. Each statement is its own
 * implicit transaction (autocommit), so a pass never holds a long write
 * lock and every batch is independently durable.
 */
function pruneByPredicate(s: Store, table: string, where: string, params: any[], budget: number): number {
        let total = 0;
        while (total < budget) {
                const info = s.run(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${where} LIMIT ${BATCH_ROWS})`, params);
                const deleted = Number((info as any).changes ?? 0);
                total += deleted;
                if (deleted < BATCH_ROWS) break; // predicate exhausted
        }
        return total;
}

/** Does any active predicate still match a row? (LIMIT 1 — cheap by design.) */
function hasPrunable(s: Store, table: string, predicates: Predicate[]): boolean {
        for (const [where, params] of predicates) {
                if (s.get(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`, params)) return true;
        }
        return false;
}

/**
 * One retention pass. Pure SQL — no LLM, no I/O beyond the store — so it is
 * safe to run as the LLM-free db-retention router job even while the
 * governor throttles learning (the note-sync/sandbox-gc class of always-run
 * housekeeping). Never throws for a missing table (best-effort per table,
 * pruneLedger's contract): automation_runs does not exist until the
 * automations schema installs.
 */
export function runRetentionPass(now: number = Date.now(), storeOverride?: Store): RetentionPassResult {
        const s = storeOverride ?? store;
        const pruned: Record<string, number> = {};
        let moreRemaining = false;
        for (const spec of TABLES) pruned[spec.table] = 0;
        if (!retentionEnabled()) return { pruned, moreRemaining }; // UNOWN_RETENTION_DAYS=0 — off
        for (const spec of TABLES) {
                let deleted = 0;
                try {
                        const predicates = spec.predicates(now);
                        let budget = MAX_ROWS_PER_TABLE_PER_PASS;
                        for (const [where, params] of predicates) {
                                if (budget <= 0) break;
                                const d = pruneByPredicate(s, spec.table, where, params, budget);
                                deleted += d;
                                budget -= d;
                        }
                        if (hasPrunable(s, spec.table, predicates)) moreRemaining = true;
                } catch (err: any) {
                        console.warn(`[retention] skipping ${spec.table}: ${err?.message ?? err}`);
                }
                pruned[spec.table] = deleted;
        }
        const total = Object.values(pruned).reduce((a, b) => a + b, 0);
        if (total > LOUD_TOTAL_ROWS) {
                console.log(
                        `[retention] pruned ${total.toLocaleString()} operational rows (old hook_log / runs / dreams / cycles / automation_runs / dreamed-note history) — history views will look smaller from here on. ` +
                                `This is the db-retention job keeping telemetry inside its windows (docs/configuration.md, UNOWN_RETENTION_*); it never touches memory, skills, tasks, improvements or automations.`,
                );
        }
        return { pruned, moreRemaining };
}
