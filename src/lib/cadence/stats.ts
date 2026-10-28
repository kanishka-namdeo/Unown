import type {
  BestDayOfWeek,
  CadenceStats,
  CheckoffDate,
  CompletionRate,
  Habit,
  WeeklyBar,
} from "./types";
import { daysBefore, isoWeekStart, isoWeekStarts, weeklyTarget } from "./streaks";

/**
 * Pure completion-rate & chart stats for the Cadence tracker. Explicit
 * `end` parameter, no `Date.now()` at call time, zero DOM.
 */

function toLocalDayKey(d: Date): CheckoffDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDay(day: CheckoffDate): Date {
  return new Date(day + "T00:00:00Z");
}

function rate(done: number, total: number): CompletionRate {
  if (total === 0) return { percent: 0, done: 0, total: 0 };
  return { percent: Math.round((done / total) * 1000) / 10, done, total };
}

/** Total checkoff count across all entries. */
export function totalCheckoffs(entries: Record<string, CheckoffDate[]>): number {
  return Object.values(entries).reduce((n, arr) => n + arr.length, 0);
}

/**
 * Completion rate over the trailing `numDays` days ending at `end`
 * (both day keys / local Dates). Each day counts once if any entry exists
 * on that day.
 */
export function completionRate(
  entries: Record<string, CheckoffDate[]>,
  numDays: number,
  end: CheckoffDate,
): CompletionRate {
  const daySet = new Set<string>();
  for (const arr of Object.values(entries)) for (const d of arr) daySet.add(d);
  let done = 0;
  for (let i = 0; i < numDays; i++) {
    if (daySet.has(daysBefore(end, i))) done++;
  }
  return rate(done, numDays);
}

export function last7Rate(
  entries: Record<string, CheckoffDate[]>,
  end: CheckoffDate,
): CompletionRate {
  return completionRate(entries, 7, end);
}

export function last30Rate(
  entries: Record<string, CheckoffDate[]>,
  end: CheckoffDate,
): CompletionRate {
  return completionRate(entries, 30, end);
}

/** The calendar day-of-week (0=Sun…6=Sat) with the most checkoffs. */
export function bestDayOfWeek(
  entries: Record<string, CheckoffDate[]>,
): BestDayOfWeek | null {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const arr of Object.values(entries)) {
    for (const d of arr) {
      counts[parseDay(d).getUTCDay()]++;
    }
  }
  let best = 0;
  for (let i = 1; i < 7; i++) if (counts[i] > counts[best]) best = i;
  if (counts[best] === 0) return null;
  return { dayIndex: best, count: counts[best] };
}

/**
 * One `WeeklyBar` per ISO week over the trailing `weeks` weeks ending at
 * the week containing `end` (default 52). Used for the 52-week SVG chart.
 * `count` = entries landing in that week; `target` = sum of each habit's
 * weekly target / 7 (its average per-day share), rounded to 1 decimal.
 */
export function toWeeklyBars(
  entries: Record<string, CheckoffDate[]>,
  habits: Habit[],
  end: CheckoffDate,
  weeks = 52,
): WeeklyBar[] {
  const starts = isoWeekStarts(weeks, end);
  // target per week = sum over habits of (weeklyTarget / 7)
  const target =
    Math.round(habits.reduce((n, h) => n + weeklyTarget(h) / 7, 0) * 10) / 10;

  return starts.map((weekStart) => {
    let count = 0;
    for (const arr of Object.values(entries)) {
      for (const d of arr) {
        if (isoWeekStart(d) === weekStart) count++;
      }
    }
    return { weekStart, count, target };
  });
}

/** Combined stats object for the dashboard (explicit `end` day key). */
export function cadenceStats(
  entries: Record<string, CheckoffDate[]>,
  habits: Habit[],
  end: CheckoffDate,
): CadenceStats {
  return {
    totalCheckoffs: totalCheckoffs(entries),
    last7: last7Rate(entries, end),
    last30: last30Rate(entries, end),
    bestDay: bestDayOfWeek(entries),
  };
}
