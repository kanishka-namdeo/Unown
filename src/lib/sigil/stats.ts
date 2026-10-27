import type { Task } from "./types";

export interface DayStat {
  date: string; // YYYY-MM-DD (local)
  completedTasks: number;
  focusMinutes: number;
}

export interface StreakResult {
  streak: number;
  /** True if the streak chain extends back to a day with no activity (i.e. streak would be 0 unless today/yesterday has activity). */
  broken: boolean;
}

export function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse an ISO timestamp into its local day key. Invalid dates fall back to now. */
export function dayKeyOf(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return toLocalDayKey(now);
  return toLocalDayKey(d);
}

export function dayKeyNDaysAgo(n: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return toLocalDayKey(d);
}

export interface CompletedPerDayInput {
  completedAt: string | null;
}

/** Count tasks completed per local day over the last `days` days (inclusive of today). */
export function completedTasksPerDay(
  tasks: CompletedPerDayInput[],
  days: number,
  now: Date = new Date(),
): DayStat[] {
  const counts = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    counts.set(dayKeyNDaysAgo(i, now), 0);
  }
  for (const t of tasks) {
    if (!t.completedAt) continue;
    const key = dayKeyOf(t.completedAt, now);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, completedTasks]) => ({
    date,
    completedTasks,
    focusMinutes: 0,
  }));
}

export interface FocusInput {
  startedAt: string;
  durationMin: number;
}

/** Sum focus minutes per local day over the last `days` days. */
export function focusMinutesPerDay(
  log: FocusInput[],
  days: number,
  now: Date = new Date(),
): DayStat[] {
  const sums = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    sums.set(dayKeyNDaysAgo(i, now), 0);
  }
  for (const entry of log) {
    const key = dayKeyOf(entry.startedAt, now);
    if (sums.has(key)) sums.set(key, (sums.get(key) ?? 0) + entry.durationMin);
  }
  return [...sums.entries()].map(([date, focusMinutes]) => ({
    date,
    completedTasks: 0,
    focusMinutes,
  }));
}

/** Merge both aggregations into per-day rows. */
export function dailyStats(
  tasks: Task[],
  focusLog: FocusInput[],
  days: number,
  now: Date = new Date(),
): DayStat[] {
  const completed = new Map(completedTasksPerDay(tasks, days, now).map((d) => [d.date, d.completedTasks]));
  const focus = new Map(focusMinutesPerDay(focusLog, days, now).map((d) => [d.date, d.focusMinutes]));
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = dayKeyNDaysAgo(i, now);
    out.push({
      date,
      completedTasks: completed.get(date) ?? 0,
      focusMinutes: focus.get(date) ?? 0,
    });
  }
  return out;
}

/**
 * Current streak: consecutive days (ending today, or yesterday if today has
 * no activity yet) with at least one completed task.
 */
export function currentStreak(
  completedAts: Array<string | null>,
  now: Date = new Date(),
): number {
  const active = new Set<string>();
  for (const iso of completedAts) {
    if (iso) active.add(dayKeyOf(iso, now));
  }
  let streak = 0;
  // If today has no activity, the streak may still be alive via yesterday.
  let offset = active.has(toLocalDayKey(now)) ? 0 : 1;
  while (active.has(dayKeyNDaysAgo(offset, now))) {
    streak++;
    offset++;
  }
  return streak;
}

/** Total completed tasks and focus minutes (all time). */
export function totals(
  tasks: CompletedPerDayInput[],
  focusLog: FocusInput[],
): { completed: number; focusMinutes: number } {
  let completed = 0;
  for (const t of tasks) if (t.completedAt) completed++;
  let focusMinutes = 0;
  for (const e of focusLog) focusMinutes += e.durationMin;
  return { completed, focusMinutes };
}
