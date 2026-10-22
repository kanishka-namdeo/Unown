/**
 * active-hours.ts — the M5 routine monitoring policies' pure core: the
 * `--active-hours "09:00-18:00"` window grammar and its timezone-aware
 * membership test (from OpenClaw's active-hours + Cline's scheduled-task
 * quiet windows).
 *
 * PURE only — no I/O, total over its input, no Date.now() (instants are
 * passed in). The scheduler applies the window at dispatch time; the
 * timezone comes from the routine's own `timezone` column via
 * routine-schedule.ts's wallTimeInZone.
 *
 * Grammar: `HH:MM-HH:MM` (24h), minutes precision, both ends inclusive.
 * A window MAY wrap midnight ("18:00-06:00" = evenings + early mornings) —
 * overnight-batch semantics. Whitespace around the dash is tolerated.
 */
import { wallTimeInZone } from "./routine-schedule.ts";

export interface ActiveHoursWindow {
        /** Minutes since local midnight, 0..1439, inclusive. */
        startMin: number;
        endMin: number;
        /** True when the window wraps past midnight (start > end). */
        wrapsMidnight: boolean;
        /** The normalized source form, "HH:MM-HH:MM" (what list/detail render). */
        canonical: string;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseClock(s: string): number | null {
        const m = TIME_RE.exec(s.trim());
        if (!m) return null;
        return Number(m[1]) * 60 + Number(m[2]);
}

function two(n: number): string {
        return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0");
}

/** Parse `HH:MM-HH:MM`. Full-window ("00:00-23:59") and empty-string are
 * both rejected as meaningless — absence is `null` on the row, not a window
 * that matches everything; a de-minimis window is a misconfiguration the
 * user should see, not silently store. */
export function parseActiveHours(text: string | null | undefined): { ok: true; window: ActiveHoursWindow } | { ok: false; error: string } {
        if (text === null || text === undefined) return { ok: false, error: "no window given" };
        const raw = text.trim();
        const parts = raw.split("-");
        if (parts.length !== 2) return { ok: false, error: `expected "HH:MM-HH:MM", got "${raw}"` };
        const start = parseClock(parts[0]);
        const end = parseClock(parts[1]);
        if (start === null || end === null) {
                return { ok: false, error: `expected 24-hour HH:MM times, got "${raw}"` };
        }
        if (start === end) return { ok: false, error: `the window is empty ("${raw}" — start equals end)` };
        return {
                ok: true,
                window: {
                        startMin: start,
                        endMin: end,
                        wrapsMidnight: start > end,
                        canonical: `${two(start)}-${two(end)}`,
                },
        };
}

/** Minutes-since-local-midnight for an instant in a timezone (null tz = local). */
export function minutesSinceMidnight(instant: number, tz: string | null): number {
        const wall = wallTimeInZone(instant, tz);
        return wall.hh * 60 + wall.mm;
}

/** Is the instant inside the window (in the given timezone)? Both ends are
 * inclusive; a wrapping window matches across midnight. */
export function isWithinActiveHours(instant: number, window: ActiveHoursWindow, tz: string | null): boolean {
        const m = minutesSinceMidnight(instant, tz);
        return window.wrapsMidnight ? m >= window.startMin || m <= window.endMin : m >= window.startMin && m <= window.endMin;
}
