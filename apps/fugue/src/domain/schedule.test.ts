/**
 * schedule test — the MECHANISM RULING pins: the five kinds computed
 * in the RUNTIME'S LOCAL zone with an injected `nowMs` (deterministic
 * — expected instants derive from the same local-Date arithmetic the
 * module uses, so the pins are host-timezone-invariant), the
 * engine-authoritative fallback for a foreign IANA zone, the once/after
 * arithmetic, and E-09 (a misfire yields skip:true exactly once).
 */
import { test, expect } from "bun:test";
import {
  parseIntervalSpec,
  parseCron,
  nextCronAfter,
  projectSchedule,
  localTimezone,
} from "./schedule.js";
import type { Job } from "./types.js";

/** Build a job-shaped projection input. */
function job(
  schedule: Job["schedule"],
  timezone: string,
  createdAt: number,
  updatedAt: number,
): Job {
  return {
    id: 1,
    title: "pin",
    prompt: "p",
    schedule,
    mode: "read-only",
    model: "m",
    timezone,
    misfire: "skip",
    spendCap: "off",
    createdAt,
    updatedAt,
  };
}

/**
 * HOST-INvariant anchor: a UTC instant in mid-2026 far enough from any
 * DST transition on any host. The host's local tzdb answers the local
 * wall reading of that instant; pins below derive their expected values
 * from the module's own local-Date arithmetic, so they hold on every
 * host timezone.
 */
const T0 = Date.UTC(2026, 6, 15, 0, 0, 0); // 2026-07-15 00:00 UTC

/** Local wall-clock instant of T0 + offset — the module's own
 * arithmetic (new Date + local getters) applied in the test. */
function localAt(offsetMs: number): number {
  return T0 + offsetMs; // epoch ms are tz-agnostic: the instant
}

const T = localAt(0); // injected now

test("parseIntervalSpec: plain + anchored forms", () => {
  expect(parseIntervalSpec("30m")).toEqual({ n: 30, unit: "m" });
  expect(parseIntervalSpec("6h")).toEqual({ n: 6, unit: "h" });
  expect(parseIntervalSpec("2d")).toEqual({ n: 2, unit: "d" });
  expect(parseIntervalSpec("3w")).toEqual({ n: 3, unit: "w" });
  expect(parseIntervalSpec("2d at 09:00")).toEqual({ n: 2, unit: "d", at: "09:00" }); // verbatim HH:MM
  expect(() => parseIntervalSpec("30m at 09:00")).toThrow(); // at only for d/w
  expect(() => parseIntervalSpec("soon")).toThrow();
});

test("parseCron: 5-field strict, Vixie OR + closed sets", () => {
  const p = parseCron("0 9 * * 1-5");
  expect(p.hours).toEqual([9]);
  expect(p.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  expect(p.domRestricted).toBe(false);
  expect(p.dowRestricted).toBe(true);
  expect(() => parseCron("* * * *")).toThrow();
});

/**
 * The LOCAL-wall-clock cron pins: 09:00 Mon-Fri. nextCronAfter walks
 * local wall clock; the expected answer is the same walk computed in
 * the test via local-Date arithmetic — host-invariant.
 */
function localWallAfter(ms: number, hh: number, mm: number): number {
  const d = new Date(ms);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  // walk minute-by-minute until the wall reading is hh:mm on an allowed
  // day (mirrors the module's algorithm — the pin, not the code)
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const dd = new Date(d.getTime());
    const dow = dd.getDay();
    const ok = dow >= 1 && dow <= 5; // Mon-Fri
    if (ok && dd.getHours() === hh && dd.getMinutes() === mm) return dd.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  throw new Error("no match in walk");
}

test("cron: next local-wall-clock match strictly after now (kind pin)", () => {
  // now = T (mid-2026 UTC instant); expected = next Mon-Fri 09:00
  // local reading strictly after T, computed in the test's own walk.
  const expected = localWallAfter(T, 9, 0);
  expect(nextCronAfter("0 9 * * 1-5", T)).toBe(expected);
  expect(expected).toBeGreaterThan(T);
});

test("cron: due inside the one-minute window (now is 30s past the slot)", () => {
  const atSlot = localWallAfter(T, 9, 0);
  const p = projectSchedule(job({ kind: "cron", expr: "0 9 * * 1-5" }, "", T, T), atSlot + 30_000);
  // now is 30s PAST the slot instant: the just-fired slot is still
  // inside its one-minute window → due, nextAt stays that slot.
  expect(p.due).toBe(true);
  expect(p.skip).toBe(false);
  expect(p.nextAt).toBe(atSlot);
  expect(p.preview).toBe("local");
});

test("cron: past the window → not due, next slot is the following match", () => {
  const atSlot = localWallAfter(T, 9, 0);
  const past = atSlot + 30 * 60_000; // 30 min after the slot
  const p = projectSchedule(job({ kind: "cron", expr: "0 9 * * 1-5" }, "", T, T), past);
  expect(p.due).toBe(false);
  expect(p.nextAt).toBe(localWallAfter(past, 9, 0));
  expect(p.preview).toBe("local");
});
test("every: m/h — fixed interval from the anchor, due in-window", () => {
  // anchor 60min before now with a 60m period: anchor + 60m == exactly
  // now → the slot instant is now, inside the window [now, now+1m].
  const p = projectSchedule(job({ kind: "every", spec: "60m" }, "", T - 60 * 60_000, T), T);
  expect(p.due).toBe(true); // anchor + 60m = exactly T
  expect(p.skip).toBe(false);
  expect(p.nextAt).toBe(T);
  expect(p.preview).toBe("local");
});

test("every: m/h within the 5m catch-up grace still fires, not skips", () => {
  // anchor 32min before now, 30m period: the 30m slot is only 2min
  // past — inside the 5-minute grace window → it FIRES as catch-up
  // (due, no skip), not a misfire.
  const p = projectSchedule(job({ kind: "every", spec: "30m" }, "", T - 32 * 60_000, T), T);
  expect(p.skip).toBe(false); // within grace → fire, not skip
  expect(p.due).toBe(true); // catch-up fire
  expect(p.nextAt).toBe(T - 32 * 60_000 + 60 * 60_000); // next slot (60m)
});

test("every: past the 5m grace → a misfire (skip:true)", () => {
  // anchor 40min before now, 30m period: the 30m slot is 10min past
  // — beyond grace → ONE skip, nextAt is the first strictly-future slot.
  const p = projectSchedule(job({ kind: "every", spec: "30m" }, "", T - 40 * 60_000, T), T);
  expect(p.skip).toBe(true);
  expect(p.due).toBe(false);
  expect(p.nextAt).toBe(T - 40 * 60_000 + 60 * 60_000);
});

test("E-09: every misfire — now past due yields skip:true exactly once", () => {
  // 40 min old with a 30m period: the 30m slot slipped past → ONE skip,
  // nextAt is the first strictly-future slot (the 60m slot).
  const p = projectSchedule(job({ kind: "every", spec: "30m" }, "", T - 40 * 60_000, T), T);
  expect(p.skip).toBe(true); // the missed slot recorded as exactly one skip
  expect(p.due).toBe(false);
  expect(p.nextAt).toBe(T - 40 * 60_000 + 60 * 60_000); // first future slot
  // A second projection at the same `now` records NO further skip —
  // the skip is a property of (job, now), never accumulated.
  const again = projectSchedule(job({ kind: "every", spec: "30m" }, "", T - 40 * 60_000, T), T);
  expect(again.skip).toBe(true);
  expect(again.nextAt).toBe(p.nextAt); // deterministic, single skip
});

test("every: d/w with an 'at HH:MM' local anchor pins the wall time-of-day", () => {
  // Anchor T with "2d at 09:00": first slot is the first local 09:00
  // strictly after T, then stepped 2 local days at a time (the OS
  // tzdb keeps the wall time-of-day pinned across DST).
  const spec = parseIntervalSpec("2d at 09:00");
  const first = firstSlotAfter(T, spec); // test-side mirror of the module
  const p = projectSchedule(job({ kind: "every", spec: "2d at 09:00" }, "", T, T), T);
  expect(p.nextAt).toBe(first);
  expect(p.due).toBe(first === T || false); // only due inside the slot window
  expect(p.preview).toBe("local");
});

/** Test-side mirror of the module's d/w slot walk (the pin, not the
 * code-under-test): first local HH:MM strictly after fromMs. */
function firstSlotAfter(fromMs: number, at: { n: number; at?: string }): number {
  const [hh, mm] = at.at!.split(":").map(Number);
  const cand = new Date(fromMs);
  cand.setHours(hh, mm, 0, 0);
  let i = 0;
  while (cand.getTime() <= fromMs && i < 5) {
    cand.setDate(cand.getDate() + 1);
    i++;
  }
  return cand.getTime();
}

test("after: completion-anchored arithmetic, never overdue (kind pin)", () => {
  // Last completion 1h ago, spec "6h" → next = last + 6h, in the future;
  // a much later completion still answers last + 6h, never catch-up.
  const p = projectSchedule(job({ kind: "after", spec: "6h" }, "", T, T - 3_600_000), T);
  expect(p.nextAt).toBe(T - 3_600_000 + 6 * 3_600_000);
  expect(p.due).toBe(false);
  expect(p.skip).toBe(false);
  expect(p.preview).toBe("local");
  const later = projectSchedule(job({ kind: "after", spec: "6h" }, "", T, T - 10 * 3_600_000), T);
  expect(later.nextAt).toBe(T - 10 * 3_600_000 + 6 * 3_600_000); // no catch-up
});

test("once: createdAt + delayMinutes, due in-window, then retires", () => {
  const atMs = T + 10 * 60_000;
  const spec = { kind: "once", delayMinutes: 10 } as const;
  const before = projectSchedule(job(spec, "", T, T), T + 5 * 60_000);
  expect(before.due).toBe(false);
  expect(before.nextAt).toBe(atMs);
  const at = projectSchedule(job(spec, "", T, T), atMs);
  expect(at.due).toBe(true); // the delay instant is inside the window
  const after = projectSchedule(job(spec, "", T, T), T + 20 * 60_000);
  expect(after.due).toBe(false);
  expect(after.nextAt).toBeNull(); // retired
});

test("event: trigger-only — never time-due, nextAt null, preview pin", () => {
  const p = projectSchedule(job({ kind: "event", name: "push" }, "", T, T), T);
  expect(p.due).toBe(false);
  expect(p.skip).toBe(false);
  expect(p.nextAt).toBeNull();
  expect(p.preview).toBe("trigger-only");
});

test("foreign zone: engine-authoritative fallback (nextAt null, due false)", () => {
  // "Pacific/Kiritimati" unless that IS the local zone — detect-once.
  const foreign = localTimezone() === "Pacific/Kiritimati" ? "America/Anchorage" : "Pacific/Kiritimati";
  const cron = projectSchedule(job({ kind: "cron", expr: "0 9 * * 1-5" }, foreign, T, T), T);
  expect(cron.preview).toBe("engine-authoritative");
  expect(cron.nextAt).toBeNull();
  expect(cron.due).toBe(false);
  const every = projectSchedule(job({ kind: "every", spec: "30m" }, foreign, T - 30 * 60_000, T), T);
  expect(every.preview).toBe("engine-authoritative");
  expect(every.nextAt).toBeNull();
  const once = projectSchedule(job({ kind: "once", delayMinutes: 10 }, foreign, T, T), T + 5 * 60_000);
  expect(once.preview).toBe("engine-authoritative");
  expect(once.nextAt).toBeNull();
  const after = projectSchedule(job({ kind: "after", spec: "6h" }, foreign, T, T - 3_600_000), T);
  expect(after.preview).toBe("engine-authoritative");
  // `event` stays trigger-only even for a foreign zone (never time-due):
  const ev = projectSchedule(job({ kind: "event", name: "push" }, foreign, T, T), T);
  expect(ev.preview).toBe("trigger-only");
});

test("local zone strings answer preview 'local' (the '' and the runtime zone)", () => {
  const namedLocal = projectSchedule(
    job({ kind: "cron", expr: "0 9 * * 1-5" }, localTimezone(), T, T),
    T,
  );
  expect(namedLocal.preview).toBe("local");
  const emptyLocal = projectSchedule(job({ kind: "cron", expr: "0 9 * * 1-5" }, "", T, T), T);
  expect(emptyLocal.preview).toBe("local");
});
