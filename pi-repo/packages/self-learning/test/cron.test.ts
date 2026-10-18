// cron.test.ts — the dependency-free 5-field cron engine behind Automations
// (the zcode port; zcode uses croner, we own the parser). Pins: syntax
// acceptance/rejection, nextRun math across month/year boundaries, DST-free
// local-time arithmetic, the Vixie DOM/DOW OR rule, and the no-occurrence cap.
import { describe, expect, test } from "bun:test";
import { CronParseError, cronMatches, describeCron, nextRun, parseCron } from "../src/cron.ts";

/** Fixed clock helper — all cases local time. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

describe("parseCron — syntax", () => {
        test("accepts the canonical shapes", () => {
                for (const expr of ["* * * * *", "0 9 * * 1-5", "*/10 * * * *", "30 4 1,15 * *", "0 0 1 1 *", "15 14 * * 0", "5-30/5 8 * * *", "0 22 * * 1-5", "23 0-20/2 * * *", "5 4 * * sun", "0 0 * 7-8 *", "15 */3 * * *"]) {
                        expect(() => parseCron(expr)).not.toThrow();
                }
        });

        test("7 is Sunday alongside 0", () => {
                const p = parseCron("0 0 * * 7");
                expect(p.daysOfWeek).toEqual([0]);
        });

        test("month/day names (3-letter, case-insensitive)", () => {
                const p = parseCron("0 0 1 jan,DEC *");
                expect(p.months).toEqual([1, 12]);
                const q = parseCron("0 0 * * Mon-fri");
                expect(q.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
        });

        test("rejects the classic garbage", () => {
                for (const expr of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * 32 * *", "* * * 13 *", "* * * * 8", "* * * * * junk", "a b c d e", "1--2 * * * *", "*/0 * * * *", "5-1 * * * *"]) {
                        expect(() => parseCron(expr)).toThrow(CronParseError);
                }
        });
});

describe("nextRun — math", () => {
        test("every minute", () => {
                const from = at(2026, 10, 19, 9, 30);
                expect(nextRun("* * * * *", from)).toEqual(at(2026, 10, 19, 9, 31));
        });

        test("daily at 09:00 — later today, then tomorrow", () => {
                expect(nextRun("0 9 * * *", at(2026, 10, 19, 8, 59))).toEqual(at(2026, 10, 19, 9, 0));
                expect(nextRun("0 9 * * *", at(2026, 10, 19, 9, 0))).toEqual(at(2026, 10, 20, 9, 0)); // strictly after
                expect(nextRun("0 9 * * *", at(2026, 10, 19, 10, 0))).toEqual(at(2026, 10, 20, 9, 0));
        });

        test("weekday 9am (the zcode morning-brief template)", () => {
                // 2026-10-19 is a Monday.
                expect(nextRun("0 9 * * 1-5", at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 19, 9, 0)); // Sat -> Mon
                expect(nextRun("0 9 * * 1-5", at(2026, 10, 19, 9, 0))).toEqual(at(2026, 10, 20, 9, 0)); // Mon -> Tue
                expect(nextRun("0 9 * * 1-5", at(2026, 10, 23, 9, 0))).toEqual(at(2026, 10, 26, 9, 0)); // Fri -> Mon
        });

        test("month boundary + month-end clamp", () => {
                expect(nextRun("0 0 1 * *", at(2026, 1, 31, 23, 59))).toEqual(at(2026, 2, 1, 0, 0));
                // Feb 31 does not exist — the scan must skip past it entirely
                // (from Jan 31 00:00 the same-day fire is already past: strictly after)
                expect(nextRun("0 0 31 * *", at(2026, 1, 31, 0, 0))).toEqual(at(2026, 3, 31, 0, 0)); // Jan -> Mar (Feb has 28/29)
        });

        test("year boundary and leap day", () => {
                expect(nextRun("0 0 1 1 *", at(2026, 12, 31, 12, 0))).toEqual(at(2027, 1, 1, 0, 0));
                // Feb 29 only exists on leap years: 2028-02-29
                expect(nextRun("0 0 29 2 *", at(2026, 3, 1, 0, 0))).toEqual(at(2028, 2, 29, 0, 0));
        });

        test("Vixie DOM/DOW OR rule (the one everyone gets wrong)", () => {
                // Both restricted: fire on the 13th OR on Fridays (2026-11-13 is a Friday — one fire, not two)
                const p = parseCron("0 0 13 * 5");
                expect(cronMatches(p, at(2026, 11, 13, 0, 0))).toBe(true);
                // A Friday that is not the 13th still fires (DOW side of the OR)
                expect(cronMatches(p, at(2026, 11, 20, 0, 0))).toBe(true);
                // A 13th that is not a Friday still fires (DOM side of the OR)
                expect(cronMatches(p, at(2026, 11, 13, 0, 0))).toBe(true);
                expect(cronMatches(p, at(2026, 11, 17, 0, 0))).toBe(false); // Tue, not 13th
                // Only DOM restricted: DOW ignored
                const domOnly = parseCron("0 0 13 * *");
                expect(cronMatches(domOnly, at(2026, 11, 13, 0, 0))).toBe(true);
                expect(cronMatches(domOnly, at(2026, 11, 16, 0, 0))).toBe(false);
        });

        test("steps and ranges", () => {
                // every 10 minutes
                expect(nextRun("*/10 * * * *", at(2026, 10, 19, 9, 3))).toEqual(at(2026, 10, 19, 9, 10));
                // hours 8-18 step 2 -> 8,10,12,...,18
                expect(nextRun("0 8-18/2 * * *", at(2026, 10, 19, 11, 0))).toEqual(at(2026, 10, 19, 12, 0));
        });

        test("no-occurrence expressions cap out instead of hanging", () => {
                expect(nextRun("0 0 30 2 *", at(2026, 1, 1, 0, 0))).toBeNull(); // Feb 30 never exists
        });

        test("parsed object input (no reparse)", () => {
                const p = parseCron("0 9 * * 1-5");
                expect(nextRun(p, at(2026, 10, 17, 12, 0))).toEqual(at(2026, 10, 19, 9, 0));
        });
});

describe("describeCron — listing hints", () => {
        test("shapes", () => {
                expect(describeCron("* * * * *")).toBe("every minute");
                expect(describeCron("0 9 * * 1-5")).toContain("09:00");
                expect(describeCron("*/15 * * * *")).toContain("every 15");
                expect(describeCron("bad expr")).toBe("bad expr"); // passthrough, never throws
        });
});
