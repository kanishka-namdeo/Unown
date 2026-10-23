/**
 * cron.ts — a dependency-free 5-field cron expression engine for Automations
 * (the zcode port; zcode delegates to the `croner` library — we keep the
 * vendored substrate dependency-free, same as jsonschema.ts).
 *
 * Supported syntax (the standard 5-field subset every cron implementation
 * agrees on; 6-field/@-shorthand/yearly 7th field deliberately out):
 *
 *   ┌─────────────  minute      0-59
 *   │ ┌───────────  hour        0-23
 *   │ │ ┌─────────  day-of-month 1-31
 *   │ │ │ ┌───────  month       1-12 (jan-dec names allowed)
 *   │ │ │ │ ┌─────  day-of-week 0-7  (0 and 7 are both Sunday; sun-sat names)
 *   │ │ │ │ │
 *   * * * * *
 *
 * Per field: `*`, a number, a range `1-5`, a list `1,5,9`, a step "star/10" step,
 * `5-30/5`, and month/day NAMES. Combinations compose (lists of ranges with
 * steps). Whitespace between fields is flexible; extra fields are rejected.
 *
 * The one semantic everyone gets wrong (pinned by tests): when BOTH
 * day-of-month and day-of-week are restricted (not `*`), cron fires when
 * EITHER matches (Vixie's OR rule); when only one is restricted, only that
 * one constrains the day.
 *
 * All arithmetic is local-time (Date-based), matching zcode's "cron is in
 * the user's local timezone" contract. nextRun() never throws for a valid
 * expression; it scans forward minute-by-minute with a 4-year cap (a 5-field
 * cron's full cycle — 400-year leap rules included — fits inside 4 years for
 * every real expression except Feb 29-only patterns, which the cap reports
 * as "no occurrence" instead of looping).
 */

export class CronParseError extends Error {}

export interface ParsedCron {
        minutes: number[];
        hours: number[];
        daysOfMonth: number[];
        months: number[];
        daysOfWeek: number[]; // 0-6, Sunday = 0
        /** true when dom/dow both restricted (Vixie OR rule applies) */
        domRestricted: boolean;
        dowRestricted: boolean;
        source: string;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const FIELD_RANGES: Array<[number, number]> = [
        [0, 59], // minute
        [0, 23], // hour
        [1, 31], // day of month
        [1, 12], // month
        [0, 7], // day of week (0 and 7 = Sunday)
];

function nameToNumber(name: string, field: number): number | null {
        const lower = name.toLowerCase();
        if (field === 3) {
                const idx = MONTH_NAMES.indexOf(lower.slice(0, 3));
                if (idx >= 0) return idx + 1;
        }
        if (field === 4) {
                const idx = DOW_NAMES.indexOf(lower.slice(0, 3));
                if (idx >= 0) return idx;
        }
        const asNumber = Number(name);
        return Number.isInteger(asNumber) ? asNumber : null;
}

/** Parse one field ("*", "5", "1-5", "* / 10", "1,3-5,9") into a sorted list. */
function parseField(raw: string, field: number): number[] {
        const [min, max] = FIELD_RANGES[field];
        const values = new Set<number>();
        for (const part of raw.split(",")) {
                if (part.length === 0) throw new CronParseError(`field ${field + 1}: empty list item`);
                const [rangePart, stepPart] = part.split("/");
                let step = 1;
                if (stepPart !== undefined) {
                        step = Number(stepPart);
                        if (!Number.isInteger(step) || step < 1) {
                                throw new CronParseError(`field ${field + 1}: step "${stepPart}" is not a positive integer`);
                        }
                } else if (part.includes("/")) {
                        throw new CronParseError(`field ${field + 1}: malformed step in "${part}"`);
                }
                let lo: number;
                let hi: number;
                if (rangePart === "*" || rangePart === "") {
                        if (rangePart === "" ) throw new CronParseError(`field ${field + 1}: missing value before "/"`);
                        lo = min;
                        hi = max;
                } else {
                        // Linear-time range split (ReDoS fix): the old lazy-dot
                        // /^(.+?)-(.+)$/ backtracked quadratically on adversarial
                        // inputs. Split at the first "-" that leaves a non-empty
                        // prefix and suffix; a line terminator anywhere made the
                        // dot-based regex fail, so keep that behavior for parity.
                        const dash = rangePart.indexOf("-", 1);
                        if (dash !== -1 && dash < rangePart.length - 1 && !/[\n\r\u2028\u2029]/.test(rangePart)) {
                                lo = requireNumber(rangePart.slice(0, dash), field);
                                hi = requireNumber(rangePart.slice(dash + 1), field);
                        } else {
                                lo = requireNumber(rangePart, field);
                                hi = lo;
                        }
                }
                if (lo > hi) throw new CronParseError(`field ${field + 1}: inverted range ${lo}-${hi}`);
                for (let v = lo; v <= hi; v += step) {
                        if (v < min || v > max) throw new CronParseError(`field ${field + 1}: ${v} out of range ${min}-${max}`);
                        values.add(field === 4 && v === 7 ? 0 : v);
                }
        }
        if (values.size === 0) throw new CronParseError(`field ${field + 1}: empty`);
        return [...values].sort((a, b) => a - b);
}

function requireNumber(token: string, field: number): number {
        const n = nameToNumber(token, field);
        if (n === null) throw new CronParseError(`field ${field + 1}: "${token}" is not a valid value`);
        return n;
}

/** Parse + validate a 5-field cron expression. Throws CronParseError. */
export function parseCron(expr: string): ParsedCron {
        const trimmed = expr.trim();
        const fields = trimmed.split(/\s+/);
        if (fields.length !== 5) {
                throw new CronParseError(`expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`);
        }
        const minutes = parseField(fields[0], 0);
        const hours = parseField(fields[1], 1);
        const daysOfMonth = parseField(fields[2], 2);
        const months = parseField(fields[3], 3);
        const daysOfWeek = parseField(fields[4], 4);
        return {
                minutes,
                hours,
                daysOfMonth,
                months,
                daysOfWeek,
                domRestricted: fields[2] !== "*",
                dowRestricted: fields[4] !== "*",
                source: trimmed,
        };
}

const DAY_MS = 86_400_000;
/** Scan ceiling: 4 years — covers every 5-field pattern's full cycle. */
const SCAN_CAP = 4 * 366 * 24 * 60; // minutes

function matchesDay(parsed: ParsedCron, d: Date): boolean {
        const dom = d.getDate();
        const dow = d.getDay();
        const domHit = parsed.daysOfMonth.includes(dom);
        const dowHit = parsed.daysOfWeek.includes(dow);
        if (parsed.domRestricted && parsed.dowRestricted) return domHit || dowHit; // Vixie OR
        if (parsed.domRestricted) return domHit;
        if (parsed.dowRestricted) return dowHit;
        return true;
}

/** True when the expression fires during the minute containing `at`. */
export function cronMatches(parsed: ParsedCron, at: Date): boolean {
        return (
                parsed.minutes.includes(at.getMinutes()) &&
                parsed.hours.includes(at.getHours()) &&
                parsed.months.includes(at.getMonth() + 1) &&
                matchesDay(parsed, at)
        );
}

/** Next fire time strictly after `from` (local time), or null when the
 *  expression cannot fire within the scan cap (e.g. Feb 30). */
export function nextRun(expr: string | ParsedCron, from: Date = new Date()): Date | null {
        const parsed = typeof expr === "string" ? parseCron(expr) : expr;
        // Start at the NEXT minute boundary; a cron fires at minute starts.
        const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0);
        for (let i = 0; i < SCAN_CAP; i++) {
                if (cursor.getFullYear() - from.getFullYear() > 4) return null;
                if (
                        parsed.months.includes(cursor.getMonth() + 1) &&
                        matchesDay(parsed, cursor) &&
                        parsed.hours.includes(cursor.getHours()) &&
                        parsed.minutes.includes(cursor.getMinutes())
                ) {
                        return new Date(cursor.getTime());
                }
                cursor.setMinutes(cursor.getMinutes() + 1);
        }
        return null;
}

/** One-line human hint ("At 09:00, Mon-Fri") — for listings, not for math. */
export function describeCron(expr: string): string {
        let parsed: ParsedCron;
        try {
                parsed = parseCron(expr);
        } catch {
                return expr;
        }
        if (parsed.minutes.length === 60 && parsed.hours.length === 24) {
                const day = describeDay(parsed);
                return day ? `every minute${day}` : "every minute";
        }
        const time = describeTime(parsed);
        const day = describeDay(parsed);
        const month = parsed.months.length === 12 ? "" : ` in ${listNames(parsed.months, MONTH_NAMES, 1)}`;
        return `${time}${day}${month}`.trim();
}

function describeTime(parsed: ParsedCron): string {
        if (parsed.minutes.length === 60 && parsed.hours.length === 24) return "every minute";
        if (parsed.hours.length === 24) {
                // Hours unrestricted: the minute pattern IS the schedule
                // ("*/15 * * * *" -> "every 15 minutes", "30 * * * *" -> ":30 past every hour").
                const m = parsed.minutes;
                if (m.length === 1) return `at :${String(m[0]).padStart(2, "0")} past every hour`;
                if (m.length >= 2) {
                        const step = m[1] - m[0];
                        if (step > 1 && m.every((v, i) => i === 0 || v - m[i - 1] === step)) return `every ${step} minutes`;
                }
                return `minutes ${listNames(m, null, 0)} past every hour`;
        }
        if (parsed.minutes.length === 1 && parsed.hours.length === 1) {
                return `at ${String(parsed.hours[0]).padStart(2, "0")}:${String(parsed.minutes[0]).padStart(2, "0")}`;
        }
        if (parsed.minutes.length === 1) {
                return `at :${String(parsed.minutes[0]).padStart(2, "0")} past ${listNames(parsed.hours, null, 0)}h`;
        }
        return `${listNames(parsed.hours, null, 0)}h, minutes ${listNames(parsed.minutes, null, 0)}`;
}

function describeDay(parsed: ParsedCron): string {
        const domAll = !parsed.domRestricted;
        const dowAll = !parsed.dowRestricted;
        if (domAll && dowAll) return "";
        if (domAll && !dowAll) return ` on ${listNames(parsed.daysOfWeek, DOW_NAMES, 0)}`;
        if (!domAll && dowAll) return ` on day ${listNames(parsed.daysOfMonth, null, 0)} of the month`;
        return ` (day ${listNames(parsed.daysOfMonth, null, 0)} OR ${listNames(parsed.daysOfWeek, DOW_NAMES, 0)})`;
}

function listNames(values: number[], names: string[] | null, offset: number): string {
        const render = (v: number) => (names ? names[v - offset] : String(v));
        if (values.length > 5) {
                // compress: full ranges, aligned steps, and contiguous runs
                if (names && values.length === names.length) return "every";
                const step = values.length > 1 ? values[1] - values[0] : 0;
                const uniform = step > 0 && values.every((v, i) => i === 0 || v - values[i - 1] === step);
                if (uniform && step > 1 && values[0] % step === 0) return `every ${step}`;
                if (uniform && step === 1) return `${render(values[0])}-${render(values[values.length - 1])}`;
        }
        return values.map(render).join(", ");
}
