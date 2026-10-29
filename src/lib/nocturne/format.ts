/**
 * Pure date + duration formatters for the Nocturne UI chips (the cadence
 * format.ts conventions, lifted into the lib so the server-side routes and
 * the API tests share them). No DOM, no `Date.now()` — every function takes
 * an explicit value so renders and tests are deterministic.
 */

/** A `YYYY-MM-DD` day key. */
export type CheckoffDate = string;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** Parse a `YYYY-MM-DD` day key into a UTC `Date` (timezone-free). */
function parseDay(day: CheckoffDate): Date {
  return new Date(day + "T00:00:00Z");
}

/** "Mon"–"Sun" for a day key or `Date` (UTC weekday, Sunday = 0). */
export function weekdayShort(d: CheckoffDate | Date): string {
  const dow = typeof d === "string" ? parseDay(d).getUTCDay() : d.getUTCDay();
  return WEEKDAYS[(dow + 6) % 7];
}

/** "Jan"–"Dec" for a day key or `Date`. */
export function monthShort(d: CheckoffDate | Date): string {
  const m = typeof d === "string" ? parseDay(d).getUTCMonth() : d.getUTCMonth();
  return MONTHS[m];
}

/** Local `YYYY-MM-DD` day key of `now` (the app's "today"). */
export function todayKey(now: Date): CheckoffDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "Mon, Jul 14" — the compact long-form header date. */
export function formatLongDate(day: CheckoffDate | Date): string {
  const d = typeof day === "string" ? parseDay(day) : day;
  const dow = d.getUTCDay();
  return WEEKDAYS[(dow + 6) % 7] + ", " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
}

/** Convert any supported input to its `YYYY-MM-DD` day key. */
export function dayKeyOf(d: CheckoffDate | Date): CheckoffDate {
  if (typeof d === "string") return d;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a ms delta as a human-readable "2h 14m" countdown (the KPI chip text). */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Format a non-negative ms duration as "2h 14m" (the KPI chip text). */
export function formatDurationMs(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}
