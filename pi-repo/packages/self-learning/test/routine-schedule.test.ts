// routine-schedule.test.ts — the recurrence engine behind Routines. Pins the
// semantics reverse-engineered from Todoist/Things/OmniFocus/launchd/systemd
// (docs/routines.md has the decision record):
//
//   1. Spec parsing — every/after forms, `at HH:MM` gating, bounds
//   2. Timezone wall-clock helpers — the Temporal "compatible" policies:
//      spring-forward gap shifts forward, fall-back fold resolves to the
//      earlier instant
//   3. Cron-in-zone — evaluated against the routine's timezone, DST edges
//      (gap fires late-but-once, fold fires once, never in the past), the
//      4-year Feb-29 cap, and parity with the local-time engine
//   4. Interval advancement — wall-clock stepping for d/w (a daily 09:00
//      stays 09:00 across a 23h/25h DST day), durations for m/h
//   5. Row planners — once/max-runs/until exhaustion, interval coalescing,
//      completion-anchored `after` re-arming
//
// All timezone cases pin FIXED instants (2026 US DST: spring forward
// Sun Mar 8, fall back Sun Nov 1; Europe/Berlin: Mar 29 / Oct 25) so nothing
// depends on the host machine's zone.
import { describe, expect, test } from "bun:test";
import {
        advanceIntervalSlot,
        describeRoutineSchedule,
        firstIntervalSlot,
        inferLegacyKind,
        instantFromWall,
        isValidTimezone,
        nextAfterCompletion,
        nextAfterSlot,
        nextCronInZone,
        nextScheduleSlot,
        parseIntervalSpec,
        planRoutineSchedule,
        wallTimeInZone,
        type RoutineScheduleColumns,
} from "../src/routine-schedule.ts";
import { nextRun } from "../src/cron.ts";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

// 2026 DST anchors (fixed, verified against the IANA tz database):
//   US spring forward: Sunday 2026-03-08, 02:00 EST → 03:00 EDT (07:00 UTC)
//   US fall back:      Sunday 2026-11-01, 02:00 EDT → 01:00 EST (06:00 UTC)
const utc = (y: number, mo: number, d: number, h = 0, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);

// ---------------------------------------------------------------------------
// parseIntervalSpec
// ---------------------------------------------------------------------------

describe("parseIntervalSpec", () => {
        test("valid forms", () => {
                expect(parseIntervalSpec("30m", true)).toEqual({ ok: true, spec: { n: 30, unit: "m" } });
                expect(parseIntervalSpec("6h", true)).toEqual({ ok: true, spec: { n: 6, unit: "h" } });
                expect(parseIntervalSpec("2d", true)).toEqual({ ok: true, spec: { n: 2, unit: "d" } });
                expect(parseIntervalSpec("3w", true)).toEqual({ ok: true, spec: { n: 3, unit: "w" } });
                expect(parseIntervalSpec("  2d  at  09:00 ", true)).toEqual({ ok: true, spec: { n: 2, unit: "d", at: "09:00" } });
                expect(parseIntervalSpec("2d@9:05", true)).toEqual({ ok: true, spec: { n: 2, unit: "d", at: "09:05" } });
                expect(parseIntervalSpec("2 days at 23:59", true)).toEqual({ ok: true, spec: { n: 2, unit: "d", at: "23:59" } });
                expect(parseIntervalSpec("1 week", true)).toEqual({ ok: true, spec: { n: 1, unit: "w" } });
        });
        test("rejects garbage", () => {
                for (const bad of ["", "daily", "every 2d", "2", "d2", "0m", "-3h", "2x", "2d at"]) {
                        expect(parseIntervalSpec(bad, true).ok).toBe(false);
                }
        });
        test("bounds per unit", () => {
                expect(parseIntervalSpec("526000m", true).ok).toBe(false); // > 1 year of minutes
                expect(parseIntervalSpec("54w", true).ok).toBe(false);
                expect(parseIntervalSpec("53w", true).ok).toBe(true);
                expect(parseIntervalSpec("367d", true).ok).toBe(false);
        });
        test('"at" is rejected for sub-day units and for after-specs', () => {
                expect(parseIntervalSpec("30m at 09:00", true).ok).toBe(false);
                expect(parseIntervalSpec("6h at 09:00", true).ok).toBe(false);
                expect(parseIntervalSpec("2d at 09:00", false).ok).toBe(false);
        });
        test('"at" hour bounds', () => {
                expect(parseIntervalSpec("2d at 24:00", true).ok).toBe(false);
                expect(parseIntervalSpec("2d at 09:61", true).ok).toBe(false);
        });
});

// ---------------------------------------------------------------------------
// planRoutineSchedule — normalization + validation
// ---------------------------------------------------------------------------

describe("planRoutineSchedule", () => {
        const now = utc(2026, 1, 15, 10, 0);
        test("exactly one schedule input", () => {
                expect(planRoutineSchedule({}, null, now)).toMatchObject({ ok: false });
                expect(planRoutineSchedule({ cron: "* * * * *", every: "2d" }, null, now)).toMatchObject({ ok: false });
                expect(planRoutineSchedule({ every: "2d", after: "3d" }, null, now)).toMatchObject({ ok: false });
                expect(planRoutineSchedule({ cron: "* * * * *", delayMinutes: 5 }, null, now)).toMatchObject({ ok: false });
        });
        test("bad timezone is rejected with the IANA hint", () => {
                const r = planRoutineSchedule({ every: "2d" }, "Mars/Olympus", now);
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.error).toContain("America/New_York");
        });
        test("once normalizes like the legacy planSchedule", () => {
                const r = planRoutineSchedule({ delayMinutes: 90 }, null, now);
                expect(r).toEqual({
                        ok: true,
                        schedule: { kind: "once", cronExpr: null, intervalN: null, intervalUnit: null, intervalAt: null, delayMs: now + 90 * 60_000 },
                        nextRunAt: now + 90 * 60_000,
                });
        });
        test("every 30m is a duration from now", () => {
                const r = planRoutineSchedule({ every: "30m" }, null, now);
                expect(r.ok).toBe(true);
                if (r.ok) {
                        expect(r.schedule.kind).toBe("every");
                        expect(r.schedule.intervalN).toBe(30);
                        expect(r.schedule.intervalUnit).toBe("m");
                        expect(r.nextRunAt).toBe(now + 30 * 60_000);
                }
        });
        test('every 2d at 09:00 arms the next wall 09:00 (today when future)', () => {
                // now = 2026-01-15 08:00 NY (13:00 UTC) → first slot today 09:00 NY
                const from = utc(2026, 1, 15, 13, 0);
                const r = planRoutineSchedule({ every: "2d at 09:00" }, NY, from);
                expect(r.ok).toBe(true);
                if (r.ok) expect(r.nextRunAt).toBe(utc(2026, 1, 15, 14, 0)); // 09:00 EST = 14:00 UTC
        });
        test('every 2d at 09:00 rolls to tomorrow+1 when today\'s slot passed', () => {
                // now = 2026-01-15 10:00 NY (15:00 UTC) → today 09:00 passed → next = Jan 17 09:00
                const from = utc(2026, 1, 15, 15, 0);
                const r = planRoutineSchedule({ every: "2d at 09:00" }, NY, from);
                expect(r.ok).toBe(true);
                if (r.ok) expect(r.nextRunAt).toBe(utc(2026, 1, 17, 14, 0));
        });
        test("after arms from creation (the first completion is creating it)", () => {
                const r = planRoutineSchedule({ after: "3d" }, null, now);
                expect(r.ok).toBe(true);
                if (r.ok) {
                        expect(r.schedule.kind).toBe("after");
                        expect(r.nextRunAt).toBe(now + 3 * 86_400_000);
                }
        });
        test("bad cron surfaces the parse error; impossible cron reports no occurrence", () => {
                expect(planRoutineSchedule({ cron: "61 * * * *" }, null, now)).toMatchObject({ ok: false });
                const r = planRoutineSchedule({ cron: "0 0 30 2 *" }, null, now);
                expect(r.ok).toBe(false);
                if (!r.ok) expect(r.error).toContain("no occurrence");
        });
});

// ---------------------------------------------------------------------------
// Timezone wall-clock helpers — the DST policies
// ---------------------------------------------------------------------------

describe("wall-clock helpers", () => {
        test("isValidTimezone accepts IANA names, null and empty; rejects garbage", () => {
                expect(isValidTimezone(null)).toBe(true);
                expect(isValidTimezone("")).toBe(true);
                expect(isValidTimezone("America/New_York")).toBe(true);
                expect(isValidTimezone("Europe/Berlin")).toBe(true);
                expect(isValidTimezone("UTC")).toBe(true);
                expect(isValidTimezone("Nowhere/Special")).toBe(false);
        });
        test("wallTimeInZone reads NY correctly across a DST boundary", () => {
                // 2026-03-07 14:00 UTC = 09:00 EST; 2026-03-08 14:00 UTC = 10:00 EDT
                expect(wallTimeInZone(utc(2026, 3, 7, 14), NY)).toEqual({ y: 2026, mo: 3, d: 7, hh: 9, mm: 0 });
                expect(wallTimeInZone(utc(2026, 3, 8, 14), NY)).toEqual({ y: 2026, mo: 3, d: 8, hh: 10, mm: 0 });
        });
        test("instantFromWall: normal readings round-trip", () => {
                expect(instantFromWall({ y: 2026, mo: 3, d: 7, hh: 9, mm: 0 }, NY)).toBe(utc(2026, 3, 7, 14));
                expect(instantFromWall({ y: 2026, mo: 11, d: 2, hh: 9, mm: 0 }, NY)).toBe(utc(2026, 11, 2, 14)); // EST again
        });
        test("spring-forward GAP shifts forward by the gap (02:30 → 03:30 EDT)", () => {
                expect(instantFromWall({ y: 2026, mo: 3, d: 8, hh: 2, mm: 30 }, NY)).toBe(utc(2026, 3, 8, 7, 30)); // = 03:30 EDT
        });
        test("fall-back FOLD resolves to the EARLIER instant (01:30 EDT, not 01:30 EST)", () => {
                expect(instantFromWall({ y: 2026, mo: 11, d: 1, hh: 1, mm: 30 }, NY)).toBe(utc(2026, 11, 1, 5, 30)); // 01:30 EDT
        });
        test("Berlin mirrors the same policies on its own dates", () => {
                // Berlin spring forward 2026-03-29 02:00→03:00 (01:00 UTC): wall 02:30
                // does not exist → shifted to 03:30 CEST = 01:30 UTC
                expect(instantFromWall({ y: 2026, mo: 3, d: 29, hh: 2, mm: 30 }, BERLIN)).toBe(utc(2026, 3, 29, 1, 30));
                // Berlin fall back 2026-10-25 03:00→02:00 (01:00 UTC): wall 02:30 is
                // ambiguous → earlier pass 02:30 CEST = 00:30 UTC
                expect(instantFromWall({ y: 2026, mo: 10, d: 25, hh: 2, mm: 30 }, BERLIN)).toBe(utc(2026, 10, 25, 0, 30));
        });
});

// ---------------------------------------------------------------------------
// Cron in a timezone
// ---------------------------------------------------------------------------

describe("nextCronInZone", () => {
        test("daily 09:00 NY evaluated from UTC instants", () => {
                // From Mar 7 20:00 UTC (15:00 EST): next = Mar 8 09:00 EDT = 13:00 UTC
                expect(nextCronInZone("0 9 * * *", utc(2026, 3, 7, 20), NY)).toBe(utc(2026, 3, 8, 13));
                // From Mar 8 14:00 UTC (10:00 EDT): next = Mar 9 09:00 EDT
                expect(nextCronInZone("0 9 * * *", utc(2026, 3, 8, 14), NY)).toBe(utc(2026, 3, 9, 13));
                // Across fall back: Nov 1 09:00 is EST (UTC-5) → 14:00 UTC
                expect(nextCronInZone("0 9 * * *", utc(2026, 10, 31, 20), NY)).toBe(utc(2026, 11, 1, 14));
        });
        test("GAP: a 02:30 daily cron fires at 03:30 on spring-forward day (late but once)", () => {
                // From Mar 7 12:00 UTC: next 02:30 slot is Mar 8 — nonexistent → 03:30 EDT = 07:30 UTC
                expect(nextCronInZone("30 2 * * *", utc(2026, 3, 7, 12), NY)).toBe(utc(2026, 3, 8, 7, 30));
                // From Mar 8 08:00 UTC (03:30 EDT passed): next = Mar 9 02:30 EDT = 06:30 UTC
                expect(nextCronInZone("30 2 * * *", utc(2026, 3, 8, 8), NY)).toBe(utc(2026, 3, 9, 6, 30));
        });
        test("FOLD: a 01:30 daily cron fires ONCE, at the earlier pass", () => {
                // From Oct 31 12:00 UTC: next = Nov 1 01:30 EDT (earlier) = 05:30 UTC
                expect(nextCronInZone("30 1 * * *", utc(2026, 10, 31, 12), NY)).toBe(utc(2026, 11, 1, 5, 30));
                // From 05:31 UTC (still EDT): the 01:30 EDT slot just passed → next is Nov 2 01:30 EST = 06:30 UTC
                expect(nextCronInZone("30 1 * * *", utc(2026, 11, 1, 5, 31), NY)).toBe(utc(2026, 11, 2, 6, 30));
        });
        test("FOLD from inside the later pass never returns a past instant", () => {
                // Every-minute cron from 01:46 EST (06:46 UTC): next = 01:47 EST = 06:47 UTC
                expect(nextCronInZone("* * * * *", utc(2026, 11, 1, 6, 46), NY)).toBe(utc(2026, 11, 1, 6, 47));
        });
        test("Feb-29-only cron finds the next leap day; impossible dates hit the 4-year cap", () => {
                // From 2026-01-01: next Feb 29 is 2028-02-29 00:00 local NY (05:00 UTC)
                const next = nextCronInZone("0 0 29 2 *", utc(2026, 1, 1), NY);
                expect(next).toBe(utc(2028, 2, 29, 5));
                // Feb 30 does not exist in any year — the 4-year cap reports null
                expect(nextCronInZone("0 0 30 2 *", utc(2026, 1, 1), NY)).toBeNull();
        });
        test("Vixie OR rule holds in-zone (dom OR dow when both restricted)", () => {
                // "0 0 13 * 5" — the 13th OR any Friday. From 2026-03-01:
                // first Friday is Mar 6, first 13th is Mar 13 → Mar 6 00:00 EST = 05:00 UTC
                expect(nextCronInZone("0 0 13 * 5", utc(2026, 3, 1), NY)).toBe(utc(2026, 3, 6, 5));
        });
        test("null tz falls back to the local-time engine (parity with cron.ts)", () => {
                const from = new Date(2026, 5, 15, 12, 0, 0).getTime();
                const expected = nextRun("*/5 * * * *", new Date(from))?.getTime() ?? null;
                expect(nextCronInZone("*/5 * * * *", from, null)).toBe(expected);
        });
});

// ---------------------------------------------------------------------------
// Interval advancement — wall-clock stepping
// ---------------------------------------------------------------------------

describe("advanceIntervalSlot", () => {
        test("m/h are plain durations", () => {
                expect(advanceIntervalSlot(1000, { n: 30, unit: "m" }, NY)).toBe(1000 + 30 * 60_000);
                expect(advanceIntervalSlot(1000, { n: 6, unit: "h" }, NY)).toBe(1000 + 6 * 3_600_000);
        });
        test("daily 09:00 stays 09:00 across spring forward (a 23h day)", () => {
                const mar7 = utc(2026, 3, 7, 14); // 09:00 EST
                const mar8 = advanceIntervalSlot(mar7, { n: 1, unit: "d", at: "09:00" }, NY);
                expect(mar8).toBe(utc(2026, 3, 8, 13)); // 09:00 EDT — 23h later
                expect(mar8 - mar7).toBe(23 * 3_600_000);
        });
        test("daily 09:00 stays 09:00 across fall back (a 25h day)", () => {
                const oct31 = utc(2026, 10, 31, 13); // 09:00 EDT
                const nov1 = advanceIntervalSlot(oct31, { n: 1, unit: "d", at: "09:00" }, NY);
                expect(nov1).toBe(utc(2026, 11, 1, 14)); // 09:00 EST — 25h later
                expect(nov1 - oct31).toBe(25 * 3_600_000);
        });
        test("weekly without `at` preserves the slot's own wall time across DST", () => {
                // Sun Mar 1 09:00 EST → Sun Mar 8 09:00 EDT (167h, not 168h)
                const a = utc(2026, 3, 1, 14);
                const b = advanceIntervalSlot(a, { n: 1, unit: "w" }, NY);
                expect(b).toBe(utc(2026, 3, 8, 13));
                expect(b - a).toBe(167 * 3_600_000);
        });
        test("month and year rollovers", () => {
                expect(advanceIntervalSlot(utc(2026, 1, 31, 9), { n: 1, unit: "d" }, null)).toBe(utc(2026, 2, 1, 9));
                expect(advanceIntervalSlot(utc(2026, 12, 31, 9), { n: 1, unit: "w" }, null)).toBe(utc(2027, 1, 7, 9));
        });
        test("leap-year day steps correctly", () => {
                expect(advanceIntervalSlot(utc(2028, 2, 28, 9), { n: 1, unit: "d" }, null)).toBe(utc(2028, 2, 29, 9));
                expect(advanceIntervalSlot(utc(2028, 2, 29, 9), { n: 1, unit: "d" }, null)).toBe(utc(2028, 3, 1, 9));
        });
});

describe("firstIntervalSlot", () => {
        test("at-spec: today when the wall time is still ahead", () => {
                // Mar 7 10:00 UTC = 05:00 EST → 09:00 today is still ahead
                expect(firstIntervalSlot(utc(2026, 3, 7, 10), { n: 1, unit: "d", at: "09:00" }, NY)).toBe(utc(2026, 3, 7, 14));
        });
        test("at-spec: same day when ahead", () => {
                // Mar 7 05:00 UTC = Mar 7 00:00 EST → 09:00 today = 14:00 UTC
                expect(firstIntervalSlot(utc(2026, 3, 7, 5), { n: 1, unit: "d", at: "09:00" }, NY)).toBe(utc(2026, 3, 7, 14));
        });
        test("no-at spec: first slot is now + N units", () => {
                expect(firstIntervalSlot(1000, { n: 45, unit: "m" }, NY)).toBe(1000 + 45 * 60_000);
        });
});

describe("nextAfterCompletion", () => {
        test("d/w step by wall clock from the completion instant (DST-aware)", () => {
                // Completed Mar 7 22:00 UTC (17:00 EST) → after 2d = Mar 9 17:00 EDT = 21:00 UTC
                // (the wall time is preserved across Mar 8's spring forward)
                expect(nextAfterCompletion(utc(2026, 3, 7, 22), { n: 2, unit: "d" }, NY)).toBe(utc(2026, 3, 9, 21));
                // Completed 30m → +30m always
                expect(nextAfterCompletion(1234, { n: 30, unit: "m" }, NY)).toBe(1234 + 30 * 60_000);
        });
});

// ---------------------------------------------------------------------------
// Row planners — exhaustion + coalescing
// ---------------------------------------------------------------------------

function row(partial: Partial<RoutineScheduleColumns> & Pick<RoutineScheduleColumns, "schedule_kind">): RoutineScheduleColumns & { scheduled_run_count: number; max_runs: number | null } {
        return {
                cron_expr: null,
                interval_n: null,
                interval_unit: null,
                interval_at: null,
                delay_ms: null,
                timezone: null,
                until_ms: null,
                scheduled_run_count: 0,
                max_runs: null,
                ...partial,
        };
}

describe("nextScheduleSlot", () => {
        test("once is exhausted immediately", () => {
                expect(nextScheduleSlot(row({ schedule_kind: "once", delay_ms: 123 }), 123, 200)).toEqual({ nextRunAt: null, reason: "once-done" });
        });
        test("max_runs exhausts", () => {
                const r = row({ schedule_kind: "every", interval_n: 1, interval_unit: "d", scheduled_run_count: 5, max_runs: 5 });
                expect(nextScheduleSlot(r, utc(2026, 1, 10), utc(2026, 1, 10))).toEqual({ nextRunAt: null, reason: "max-runs" });
        });
        test("until exhausts when the next slot is past it (until is inclusive)", () => {
                const r = row({ schedule_kind: "every", interval_n: 1, interval_unit: "d", until_ms: utc(2026, 1, 10, 12) });
                expect(nextScheduleSlot(r, utc(2026, 1, 10), utc(2026, 1, 10))).toEqual({ nextRunAt: null, reason: "until-past" });
                expect(nextScheduleSlot(row({ schedule_kind: "every", interval_n: 1, interval_unit: "d", until_ms: utc(2026, 1, 12) }), utc(2026, 1, 10), utc(2026, 1, 10))!.nextRunAt).toBe(utc(2026, 1, 11));
        });
        test("legacy cron rows keep their kind (inferLegacyKind)", () => {
                expect(inferLegacyKind({ cron_expr: "0 9 * * *", delay_ms: null })).toBe("cron");
                expect(inferLegacyKind({ cron_expr: null, delay_ms: 42 })).toBe("once");
                const r = row({ schedule_kind: null, cron_expr: "0 9 * * *", scheduled_run_count: 0, max_runs: null });
                const next = nextScheduleSlot(r, 0, utc(2026, 1, 15, 10));
                expect(next.nextRunAt).toBeGreaterThan(utc(2026, 1, 15, 10));
        });
        test("interval slots coalesce after a long pause (phase-preserving)", () => {
                // every 1d, slot was Jan 1 09:00, machine slept until Jan 10 →
                // next future slot on the SAME 09:00 phase = Jan 10 09:00
                const r = row({ schedule_kind: "every", interval_n: 1, interval_unit: "d", interval_at: "09:00", timezone: null });
                const next = nextScheduleSlot(r, utc(2026, 1, 1, 9), utc(2026, 1, 10, 12));
                expect(next.nextRunAt).toBe(utc(2026, 1, 11, 9)); // Jan 10 09:00 already passed at 12:00
        });
        test("cron rows recompute from now (manual runs never consume slots)", () => {
                const r = row({ schedule_kind: "cron", cron_expr: "0 9 * * *" });
                const next = nextScheduleSlot(r, 0, utc(2026, 1, 15, 10));
                expect(next.nextRunAt).toBe(utc(2026, 1, 16, 9));
        });
});

describe("nextAfterSlot", () => {
        test("re-arms from the completion instant (not the slot)", () => {
                const r = row({ schedule_kind: "after", interval_n: 3, interval_unit: "d" });
                const next = nextAfterSlot(r, utc(2026, 1, 10, 18));
                expect(next.nextRunAt).toBe(utc(2026, 1, 13, 18));
        });
        test("respects max_runs and until", () => {
                expect(nextAfterSlot(row({ schedule_kind: "after", interval_n: 1, interval_unit: "d", max_runs: 1, scheduled_run_count: 1 }), 0)).toEqual({ nextRunAt: null, reason: "max-runs" });
                expect(nextAfterSlot(row({ schedule_kind: "after", interval_n: 30, interval_unit: "d", until_ms: 1000 }), 5000)).toEqual({ nextRunAt: null, reason: "until-past" });
        });
});

// ---------------------------------------------------------------------------
// Human descriptions
// ---------------------------------------------------------------------------

describe("describeRoutineSchedule", () => {
        test("every kind renders a distinct, human description", () => {
                expect(describeRoutineSchedule(row({ schedule_kind: "cron", cron_expr: "0 9 * * 1-5" }))).toContain("cron 0 9 * * 1-5");
                expect(describeRoutineSchedule(row({ schedule_kind: "cron", cron_expr: "0 9 * * 1-5", timezone: NY }))).toContain(NY);
                expect(describeRoutineSchedule(row({ schedule_kind: "every", interval_n: 2, interval_unit: "d", interval_at: "09:00" }))).toBe("every 2 days at 09:00");
                expect(describeRoutineSchedule(row({ schedule_kind: "after", interval_n: 45, interval_unit: "m" }))).toContain("after 45 minutes");
                expect(describeRoutineSchedule(row({ schedule_kind: "once", delay_ms: Date.now() + 90 * 60_000 }))).toContain("one-shot in 90m");
        });
});
