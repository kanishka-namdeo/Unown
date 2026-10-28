import type { CheckoffDate, Habit } from "./types";

/**
 * Pure streak & heatmap math for the Cadence tracker. Every function takes
 * an explicit `asOf` (a `YYYY-MM-DD` day key) — no `Date.now()` at call
 * time, zero DOM — so results are deterministic and unit-testable.
 */

/** Parse a YYYY-MM-DD day key into a UTC Date (stable, timezone-free). */
function parseDay(day: CheckoffDate): Date {
  return new Date(day + "T00:00:00Z");
}

function dayKey(d: Date): CheckoffDate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The day key `n` days before `asOf`. */
export function daysBefore(asOf: CheckoffDate, n: number): CheckoffDate {
  const d = parseDay(asOf);
  d.setUTCDate(d.getUTCDate() - n);
  return dayKey(d);
}

export function weeklyTarget(habit: Habit): number {
  return habit.frequency.kind === "weekly" ? habit.frequency.target : 7;
}

/**
 * Current streak in days, as of `asOf`: the run of consecutive days ending
 * at `asOf` (or `asOf-1`, for weekly habits, when `asOf` has no entry yet).
 * Returns 0 when neither day is active.
 */
export function currentStreak(habit: Habit, entries: CheckoffDate[], asOf: CheckoffDate): number {
  const active = new Set(entries);
  let offset = active.has(asOf) ? 0 : 1;
  let streak = 0;
  while (active.has(daysBefore(asOf, offset))) {
    streak++;
    offset++;
  }
  return streak;
}

/** Best (longest) streak in days over the whole entry list. */
export function bestStreak(entries: CheckoffDate[]): number {
  if (entries.length === 0) return 0;
  const sorted = [...entries].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDay(sorted[i - 1]);
    const diff = (parseDay(sorted[i]).getTime() - prev.getTime()) / 86_400_000;
    if (diff === 1) run += 1;
    else if (diff > 1) run = 1;
    best = Math.max(best, run);
  }
  return best;
}

/** ISO week start (Monday) of the week that contains `day`. */
export function isoWeekStart(day: CheckoffDate): CheckoffDate {
  const d = parseDay(day);
  const dow = d.getUTCDay(); // 0 = Sunday
  const isoDow = dow === 0 ? 7 : dow;
  d.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return dayKey(d);
}

/**
 * Is a weekly habit on track as of `asOf`? A week counts when the per-week
 * goal is met: number of entries in the current ISO week (ending at `asOf`)
 * ≥ the weekly target. Daily habits are on track when the current or prior
 * day has an entry.
 */
export function isOnTrack(habit: Habit, entries: CheckoffDate[], asOf: CheckoffDate): boolean {
  const target = weeklyTarget(habit);
  if (target === 7) {
    // daily: on track when asOf or asOf-1 has an entry
    const active = new Set(entries);
    return active.has(asOf) || active.has(daysBefore(asOf, 1));
  }
  // weekly: count entries in the current ISO week containing asOf
  const weekStart = isoWeekStart(asOf);
  const inWeek = entries.filter((d) => isoWeekStart(d) === weekStart);
  return inWeek.length >= target;
}

/**
 * Heatmap intensity bucket 0–4 for a single day given its entry count and
 * the habit's weekly target. 0 = none, 4 = ≥ 80% of a daily-equivalent.
 */
export function heatmapLevel(count: number, habit: Habit): number {
  if (count <= 0) return 0;
  const target = weeklyTarget(habit);
  const dailyShare = target / 7; // average target per day
  if (dailyShare <= 0) return 1;
  const ratio = count / Math.max(dailyShare, 1 / 7);
  // buckets: 1 = <50%, 2 = 50–75%, 3 = 75–100%, 4 = >100%
  if (ratio >= 1.0) return 4;
  if (ratio >= 0.75) return 3;
  if (ratio >= 0.5) return 2;
  return 1;
}

/**
 * ISO week starts (Mondays) for the trailing `weeks` weeks ending at the
 * week that contains `asOf`. Used to lay out the 52-week grid.
 */
export function isoWeekStarts(weeks: number, asOf: CheckoffDate): CheckoffDate[] {
  const curWeek = isoWeekStart(asOf);
  const base = parseDay(curWeek);
  const out: CheckoffDate[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() - i * 7);
    out.push(dayKey(d));
  }
  return out;
}

/* re-export the count helpers for the stats layer */
export function entryCountForDay(entries: CheckoffDate[], day: CheckoffDate): number {
  return entries.filter((e) => e === day).length;
}

export function totalEntries(entries: CheckoffDate[]): number {
  return entries.length;
}
