import { HABIT_NAME_MAX, WEEKLY_GOAL_MAX, WEEKLY_GOAL_MIN } from "./types";

/**
 * Pure validators for the Cadence habit form. Each returns null when valid,
 * or a short, actionable message (WCAG 3.3.3 error suggestion) otherwise.
 */

export interface HabitDraft {
  name: string;
  /** per-week goal; 0 means daily */
  weeklyTarget: number;
  glyph: string;
}

export type HabitDraftErrors = Partial<Record<keyof HabitDraft, string>>;

/** Validate the habit name: trimmed, 1–60 characters. */
export function validateHabitName(name: string): string | null {
  const v = name.trim();
  if (v.length === 0) return "Please enter a habit name.";
  if (v.length > HABIT_NAME_MAX)
    return `Habit names are ${HABIT_NAME_MAX} characters or fewer — this one has ${v.length}.`;
  return null;
}

/** Validate the weekly goal: a whole number in 1–7 (or 0 for daily). */
export function validateHabitGoal(goal: number): string | null {
  if (!Number.isInteger(goal) || goal < 0)
    return "Enter a whole number of days per week.";
  if (goal === 0) return null; // daily
  if (goal > WEEKLY_GOAL_MAX || goal < WEEKLY_GOAL_MIN)
    return `The weekly goal must be ${WEEKLY_GOAL_MIN}–${WEEKLY_GOAL_MAX} days.`;
  return null;
}

/** Validate the glyph: 0 or 1 emoji-ish character. */
export function validateGlyph(glyph: string): string | null {
  const chars = Array.from(glyph);
  if (chars.length === 0) return null; // empty glyph allowed
  if (chars.length === 1) return null; // a single emoji-ish char
  return "Choose a single glyph (one emoji or symbol), or leave it blank.";
}

/** Composite validator: all habit-form fields at once. */
export function habitErrors(draft: HabitDraft): HabitDraftErrors {
  const errors: HabitDraftErrors = {};
  const name = validateHabitName(draft.name);
  if (name) errors.name = name;
  const goal = validateHabitGoal(draft.weeklyTarget);
  if (goal) errors.weeklyTarget = goal;
  const glyph = validateGlyph(draft.glyph);
  if (glyph) errors.glyph = glyph;
  return errors;
}
