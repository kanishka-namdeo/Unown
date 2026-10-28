export type CheckoffDate = string; // `YYYY-MM-DD` local day key

export type HabitFrequency =
  | { kind: "daily" }
  | { kind: "weekly"; target: number }; // target 1–7 days-per-week

export interface Habit {
  id: string;
  name: string;
  /** one-character glyph (emoji-ish), may be "" */
  glyph: string;
  frequency: HabitFrequency;
  createdAt: CheckoffDate;
}

/** Checkoff entries keyed by habit id → list of day keys (unsorted). */
export type EntriesByHabit = Record<string, CheckoffDate[]>;

/** A habit plus its checkoff day list. */
export interface HabitEntry {
  habit: Habit;
  dates: CheckoffDate[];
}

/** Full persisted state. */
export interface CadenceState {
  habits: Habit[];
  entries: EntriesByHabit;
  theme: "dark" | "light";
}

/* ── stats shapes ─────────────────────────────────────────────────── */

export interface CompletionRate {
  /** 0–100, one decimal */
  percent: number;
  done: number;
  total: number;
}

export interface BestDayOfWeek {
  /** 0 = Sunday … 6 = Saturday (local day index) */
  dayIndex: number;
  count: number;
}

export interface WeeklyBar {
  /** YYYY-MM-DD — the Monday of the ISO week */
  weekStart: string;
  count: number;
  target: number;
}

export interface CadenceStats {
  totalCheckoffs: number;
  last7: CompletionRate;
  last30: CompletionRate;
  bestDay: BestDayOfWeek | null;
}

/* ── shared constants ─────────────────────────────────────────────── */
export const WEEKLY_GOAL_MIN = 1;
export const WEEKLY_GOAL_MAX = 7;
export const HABIT_NAME_MAX = 60;
export const HEATMAP_LEVELS = 5; // levels 0–4
export const HEATMAP_BAR_WEEKS = 52;
