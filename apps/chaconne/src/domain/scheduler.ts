/**
 * Chaconne schedule decisions — pure, deterministic, clock-injected
 * (PLAN §1: "scheduler.ts (pure (schedule, now) → due-skip-record)";
 * P0 #3: one-shot/interval schedules, the misfire policy
 * "missed-while-down → skip-and-record, never silent-double-run",
 * run-history dedup).
 *
 * Ostinato injected-clock law: the clock is a NUMBER argument
 * (`nowMs`), never `Date.now()`. This module imports nothing — no
 * Date, no timers, no DOM, no Node (the boundary pin + the eslint
 * chaconne domain config enforce that).
 *
 * The two policies this module encodes:
 *
 *   MISFIRE (skip-and-record): an interval schedule missed one or
 *   more periods while the machine slept (nowMs − due > everyMs,
 *   i.e. a whole period boundary was crossed) NEVER catch-up-fires
 *   the missed periods. The loop records ONE skip (the run record
 *   carries the reason) and advances `nextDue` forward to the first
 *   period boundary strictly after `nowMs` — the next tick starts
 *   clean, one fire at most. A due that is ≤ 1 period late still
 *   fires ONCE (late is not a misfire).
 *
 *   DEDUP: a due instant records exactly once. Firing sets
 *   `lastFiredIso` to the DUE instant (never `nowMs` — a late due
 *   still counts as the due it was, so a restart cannot re-fire it);
 *   any due instant ≤ `lastFiredIso` is a no-op, not a re-fire.
 */
import type { Recipe, RunRecord, Schedule } from "./types.js";
import { DomainInvariantError } from "./types.js";

/** The skip reasons the misfire policy records (closed set). */
export type SkipReason =
  | "misfire"
  | "one-shot-already-fired"
  | "interval-already-fired";

/** One due/skip decision for a single schedule. */
export type ScheduleDecision = {
  /** The Schedule state AFTER this decision (null = retired). */
  next: Schedule | null;
  /** True when a recipe execution should run now. */
  fire: boolean;
  /** Set when a due was skipped instead of fired (misfire / re-fire). */
  skip: { reason: SkipReason } | null;
  /** The run record to record for the fire or the skip (null = none). */
  record: RunRecord | null;
};

/** ISO-8601 → epoch ms (pure arithmetic; the clock stays injected). */
export function isoToMs(iso: string): number {
  return Date.parse(iso);
}

/**
 * Decide what happens to `recipe.schedule` at the injected instant
 * `nowMs` (epoch ms). Pure: same inputs → same decision; the recipe
 * and schedule are never mutated.
 *
 * Boundary instants: `due == now` FIRES (a due is due at the instant);
 * `due > now` waits; a late due of ≤ 1 period fires ONCE; a gap of
 * > 1 period is a misfire (skip-and-record, `next` jumps forward).
 *
 * @throws {DomainInvariantError} on an unknown kind, a missing
 *   `everyMs` on an interval schedule, or a missing `nextDueIso`.
 */
export function decideSchedule(
  recipe: Recipe,
  nowMs: number,
  opts: { nowIso?: string; clockMs?: number } = {},
): ScheduleDecision {
  const schedule = recipe.schedule;
  if (schedule === undefined) {
    return { next: null, fire: false, skip: null, record: null };
  }
  const dueMs = isoToMs(schedule.nextDueIso ?? "");
  if (!Number.isFinite(dueMs)) {
    throw new DomainInvariantError(
      `decideSchedule: recipe ${recipe.id} schedule has no parseable nextDueIso`,
    );
  }
  // The schedule's OWN anchor: lastFiredIso when it exists, else the
  // original nextDueIso — the period grid is the schedule's, not the
  // wall clock's (clockMs is the clock read; the grid is domain state).
  const anchorMs =
    schedule.lastFiredIso !== undefined ? isoToMs(schedule.lastFiredIso) : dueMs;
  const nowIso = opts.nowIso;
  const lastFiredMs = schedule.lastFiredIso !== undefined ? isoToMs(schedule.lastFiredIso) : undefined;

  if (dueMs > nowMs) {
    // Not due yet — nothing happens, state carries forward.
    return { next: schedule, fire: false, skip: null, record: null };
  }

  // dueMs <= nowMs: it IS due. Dedup first (the restart law: a due
  // that already fired — recorded by `lastFiredIso` — never fires twice).
  if (lastFiredMs !== undefined && dueMs <= lastFiredMs) {
    if (schedule.kind === "one-shot") {
      // A fired one-shot retires; the runner persists the retirement.
      return { next: schedule, fire: false, skip: { reason: "one-shot-already-fired" }, record: null };
    }
    // INTERVAL dedup-heal: a crashed-persistence window (lastFiredIso
    // recorded, nextDue advance NOT persisted) bricks the schedule
    // forever — every future tick sees due <= lastFired and no-ops on
    // the STALE state. Heal it: advance nextDue to the next period
    // boundary strictly after now, exactly like the misfire branch.
    const everyMs = schedule.everyMs;
    if (everyMs === undefined) {
      throw new DomainInvariantError(`decideSchedule: recipe ${recipe.id} interval schedule has no everyMs`);
    }
    const periods = Math.floor((nowMs - lastFiredMs) / everyMs) + 1;
    const nextDueMs = lastFiredMs + periods * everyMs; // > nowMs
    return {
      next: { ...schedule, nextDueIso: msToIso(nextDueMs) },
      fire: false,
      skip: { reason: "interval-already-fired" },
      record: null,
    };
  }

  if (schedule.kind === "one-shot") {
    // Fires exactly once, then retires. The fire record carries the
    // finished stamp; a one-shot that misfired (due long past) still
    // fires once, late — one-shot has no period to skip-and-record.
    const record = mkRunRecord(recipe, nowIso);
    return { next: null, fire: true, skip: null, record };
  }

  const everyMs = schedule.everyMs;
  if (everyMs === undefined) {
    throw new DomainInvariantError(`decideSchedule: recipe ${recipe.id} interval schedule has no everyMs`);
  }

  if (nowMs - dueMs > everyMs) {
    // MISFIRE: the machine was down across ≥ 1 missed period
    // (now − due > P means a whole period boundary was crossed). Skip
    // and record the miss; advance to the next period boundary —
    // NO catch-up storm (one skip record, ever, per gap).
    const periods = Math.floor((nowMs - anchorMs) / everyMs) + 1;
    const nextDueMs = anchorMs + periods * everyMs; // > nowMs
    const next: Schedule = {
      ...schedule,
      nextDueIso: msToIso(nextDueMs),
    };
    return { next, fire: false, skip: { reason: "misfire" }, record: skipRecord(recipe, dueMs, nextDueMs) };
  }

  // On time (≤ 1 period late): ONE fire. `nextDue` advances to the
  // next period boundary after now (anchor-relative) and `lastFiredIso`
  // stamps the DUE instant (dedup law).
  const periods = Math.max(1, Math.floor((nowMs - anchorMs) / everyMs) + 1);
  const next: Schedule = {
    ...schedule,
    nextDueIso: msToIso(anchorMs + periods * everyMs),
    lastFiredIso: msToIso(dueMs),
  };
  return { next, fire: true, skip: null, record: mkRunRecord(recipe, nowIso) };
}

/**
 * The fire/skip's run record (C-4's honest-history contract: every
 * schedule event lands in run history, so the UI can dedup and the
 * misfire is visible, never silent). The runner owns `id` and the
 * timestamp fields; this builder supplies the decision-shaped body.
 */
function mkRunRecord(recipe: Recipe, nowIso: string | undefined): RunRecord {
  return {
    id: 0, // the runner assigns the real id before persisting
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    status: "ok",
    startedAt: nowIso ?? "", // the runner stamps the real clock before persisting
    committedPrefix: 0,
    artifacts: [],
  };
}

/** A misfire's skip record — the due that DIDN'T fire, with the stamped window. */
function skipRecord(recipe: Recipe, dueMs: number, nextDueMs: number): RunRecord {
  const rec: RunRecord = {
    id: 0,
    recipeId: recipe.id,
    recipeVersion: recipe.version,
    status: "ok",
    startedAt: msToIso(dueMs),
    finishedAt: msToIso(nextDueMs),
    committedPrefix: 0,
    artifacts: [],
  };
  return rec;
}

/** epoch ms → ISO-8601 (the domain's timestamp shape; pure). */
export function msToIso(ms: number): string {
  // No `new Date().getTime()` wall read — the clock stays the argument;
  // this is only the pure ms→ISO-8601 UTC conversion the domain's
  // timestamp shape requires.
  return new Date(ms).toISOString();
}
