/**
 * Ostinato stats — pure per-day review aggregation (R-1).
 *
 * The domain's activity-log reader: `reviewsPerDay` turns the
 * append-only `ReviewEvent[]` into a zero-filled, calendar-aligned
 * array the UI's heatmap band can render. Same purity contract as
 * the scheduler: the clock is INJECTED as an ISO "yyyy-mm-dd" string
 * (`today`), the function never calls `Date.now()`, and day
 * arithmetic is UTC-midnight millisecond math over the date prefix
 * only (no timezone, no `Date` object, no month rollover logic —
 * a review counts on its `reviewedAt`'s `yyyy-mm-dd` slice).
 *
 * Window semantics: the `windowDays` calendar days ENDING at
 * `today` INCLUSIVE. Every day in the window appears exactly once
 * (zero-filled); a review whose `reviewedAt` falls on a day outside
 * the window is dropped.
 */
import type { ReviewEvent } from "./types.js";

/** Milliseconds in one calendar day (UTC-midnight delta). */
const MS_PER_DAY = 86_400_000;

/** Parse "yyyy-mm-dd" into a UTC-midnight epoch (no timezone logic). */
function dayKeyMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Inverse of `dayKeyMs`: epoch → "yyyy-mm-dd" via the Date parts. */
function msToDayKey(ms: number): string {
  const dt = new Date(ms);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Aggregate a review log into one count per calendar day over the
 * trailing `windowDays`-day window ending at `today` inclusive.
 *
 * @param reviews the append-only review log (read-only; never mutated)
 * @param windowDays number of calendar days in the window (≥ 1)
 * @param today ISO "yyyy-mm-dd" — the injected clock, the window's last day
 * @returns exactly `windowDays` entries, oldest first, each
 *   `{ date: "yyyy-mm-dd", count: n }` (zero-filled; off-window events dropped)
 */
export function reviewsPerDay(
  reviews: ReviewEvent[],
  windowDays: number,
  today: string,
): Array<{ date: string; count: number }> {
  const todayMs = dayKeyMs(today);
  const counts = new Map<string, number>();
  for (const event of reviews) {
    // A review counts on its reviewedAt's yyyy-mm-dd prefix (the
    // ISO-8601 timestamp's first 10 characters — day granularity
    // only, timezone-naive by contract).
    const day = event.reviewedAt.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const out: Array<{ date: string; count: number }> = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const day = msToDayKey(todayMs - i * MS_PER_DAY);
    out.push({ date: day, count: counts.get(day) ?? 0 });
  }
  return out;
}
