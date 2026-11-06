/**
 * schedule.ts — the PURE projection (job, nowMs) -> {due, skip, nextAt,
 * preview} (PLAN §1: "pure (schedule, now) -> {due, skip, next}").
 *
 * MECHANISM RULING (operator decision, replaces the retired UTC-offset
 * approach): the projection computes next-occurrence in the RUNTIME'S
 * LOCAL timezone via plain Date methods — new Date(ms) + local
 * getHours/getDay/etc. The OS timezone database answers local DST
 * correctly; that is the zero-dep law's honest path. No offset
 * constants, no sign-flip math, no tzdb of our own.
 *
 * FOREIGN-ZONE HONESTY: if the Job's IANA `timezone` differs from the
 * runtime's local zone (detected ONCE via
 * Intl.DateTimeFormat().resolvedOptions().timeZone), the projection
 * returns preview: "engine-authoritative" with nextAt: null and due:
 * false for the time-based kinds — an honest preview-unavailable state
 * (the engine stays authoritative; the UI shows this later). `event`
 * is never time-due (trigger-only) in every zone.
 *
 * Invariant: no Date.now() and no argument-less new Date() anywhere in
 * this module — the clock is the injected `nowMs`.
 */
import type { Job } from "./types.js";

/** The projection's decision. */
export interface ScheduleProjection {
  /** True when a time slot is due at `nowMs` (the next due instant is
   * inside the current one-minute window). Never true for `event`
   * (trigger-only) or for a foreign-zone job (preview unavailable). */
  due: boolean;
  /** True exactly once when a missed slot is recorded as a skip
   * instead of fired (the misfire policy: the engine never replays an
   * overdue slot — it records one skip and advances). `after` is
   * completion-anchored and never overdue → skip stays false.
   * `event` has no time slot → skip stays false. */
  skip: boolean;
  /** The next due instant STRICTLY after nowMs (epoch ms), or null when
   * the schedule cannot fire by time: `event` stays null forever; a
   * fired `once` retires to null; a foreign-zone time schedule stays
   * null (engine-authoritative). */
  nextAt: number | null;
  /** Which projection mode produced the answer:
   *  - "local" — computed in the runtime's local zone (OS tzdb)
   *  - "engine-authoritative" — the job's IANA zone is foreign to the
   *    runtime; the engine is authoritative, no preview is claimed
   *  - "trigger-only" — `event` kind, no time slot at all */
  preview: "local" | "engine-authoritative" | "trigger-only";
}

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const GRACE_MS = MIN_MS * 5; // the engine's catch-up grace window
const UNIT_MS: Record<"m" | "h", number> = { m: MIN_MS, h: 3_600_000 };

/* — zone honesty — */

/** The runtime's IANA timezone, read ONCE (detect-once ruling). */
let LOCAL_TZ: string | null = null;
export function localTimezone(): string {
  if (LOCAL_TZ === null) {
    LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
  return LOCAL_TZ;
}

/** The zone a job computes in: "" = local; any named zone that is NOT
 * the runtime's local zone is foreign (engine-authoritative). */
function isLocalZone(tz: string | null | undefined): boolean {
  return tz === null || tz === "" || tz === localTimezone();
}

/* — 5-field cron — */

/** Minimal 5-field cron parse (mirror of the engine's cron.ts: star,
 * single value, ranges, lists, steps, month/day names; 0 and 7 both
 * mean Sunday). */
export interface ParsedCron {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[]; // 0-6, Sunday = 0
  domRestricted: boolean;
  dowRestricted: boolean;
}

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];
const DOW_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function nameToNumber(name: string, field: number): number | null {
  const lower = name.toLowerCase();
  if (field === 3) {
    const i = MONTH_NAMES.indexOf(lower.slice(0, 3));
    if (i >= 0) return i + 1;
  }
  if (field === 4) {
    const i = DOW_NAMES.indexOf(lower.slice(0, 3));
    if (i >= 0) return i;
  }
  const n = Number(name);
  return Number.isInteger(n) ? n : null;
}

/** Parse one cron field (star, "5", "1-5", "step-form", comma lists). */
export function parseCronField(
  raw: string,
  field: number,
): number[] {
  const [min, max] = FIELD_RANGES[field];
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    if (part.length === 0) {
      throw new Error(`cron field ${field + 1}: empty list item`);
    }
    const [rangePart, stepPart] = part.split("/");
    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1) {
        throw new Error(`cron field ${field + 1}: bad step "${stepPart}"`);
      }
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else {
      const dash = rangePart.indexOf("-", 1);
      if (dash !== -1 && dash < rangePart.length - 1) {
        const a = nameToNumber(rangePart.slice(0, dash), field);
        const b = nameToNumber(rangePart.slice(dash + 1), field);
        if (a === null || b === null) {
          throw new Error(`cron field ${field + 1}: bad range "${rangePart}"`);
        }
        lo = a;
        hi = b;
      } else {
        lo = nameToNumber(rangePart, field);
        if (lo === null) {
          throw new Error(`cron field ${field + 1}: "${rangePart}" invalid`);
        }
        hi = lo;
      }
    }
    if (lo > hi) {
      throw new Error(`cron field ${field + 1}: inverted range ${lo}-${hi}`);
    }
    for (let v = lo; v <= hi; v += step) {
      if (v < min || v > max) {
        throw new Error(
          `cron field ${field + 1}: ${v} out of range ${min}-${max}`,
        );
      }
      values.add(field === 4 && v === 7 ? 0 : v);
    }
  }
  return [...values].sort((a, b) => a - b);
}

/** Parse + validate a 5-field cron expression (strict; throws). */
export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `cron: expected 5 fields, got ${fields.length} ("${expr}")`,
    );
  }
  const [minF, hourF, domF, monF, dowF] = fields;
  return {
    minutes: parseCronField(minF, 0),
    hours: parseCronField(hourF, 1),
    daysOfMonth: parseCronField(domF, 2),
    months: parseCronField(monF, 3),
    daysOfWeek: parseCronField(dowF, 4),
    domRestricted: domF !== "*",
    dowRestricted: dowF !== "*",
  };
}

/**
 * The next local-wall-clock match of a cron expression STRICTLY AFTER
 * fromMs — field-advance algorithm (ruling: no unbounded minute loops;
 * bounded to the 366-day horizon). All Date usage is local (new
 * Date(ms) + local getters/setters), so the OS tzdb answers DST.
 */
export function nextCronAfter(
  expr: string,
  fromMs: number,
): number | null {
  const p = parseCron(expr);
  // Start at the next whole local minute STRICTLY after fromMs.
  const d = new Date(fromMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const horizon = fromMs + 366 * DAY_MS;
  let cur = d.getTime();
  let guard = 0;
  while (cur <= horizon) {
    // Month not allowed → advance to the 1st 00:00 of the next allowed
    // month (bounded: at most 12 iterations).
    if (!p.months.includes(d.getMonth() + 1)) {
      const m = d.getMonth() + 1;
      const nextMonth = p.months.find((x) => x > m) ?? p.months[0];
      const targetYear = nextMonth > m ? d.getFullYear() : d.getFullYear() + 1;
      d.setMonth(nextMonth - 1, 1);
      d.setHours(0, 0, 0, 0);
      if (nextMonth <= m && targetYear !== d.getFullYear()) {
        d.setFullYear(targetYear);
      }
      cur = d.getTime();
      if (++guard > 500) return null;
      continue;
    }
    const domHit = p.daysOfMonth.includes(d.getDate());
    const dowHit = p.daysOfWeek.includes(d.getDay());
    const dayOk =
      p.domRestricted && p.dowRestricted
        ? domHit || dowHit // Vixie OR rule
        : p.domRestricted
          ? domHit
          : p.dowRestricted
            ? dowHit
            : true;
    if (!dayOk) {
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 1);
      cur = d.getTime();
      if (++guard > 500) return null;
      continue;
    }
    const hourHit = p.hours.includes(d.getHours());
    if (!hourHit) {
      d.setMinutes(0, 0);
      d.setHours(d.getHours() + 1); // rolls the day when 23 → 0
      cur = d.getTime();
      if (++guard > 500) return null;
      continue;
    }
    const minHit = p.minutes.includes(d.getMinutes());
    if (minHit) return cur;
    d.setMinutes(d.getMinutes() + 1); // rolls the hour when 59 → 0
    cur = d.getTime();
    if (++guard > 500) return null;
  }
  return null; // no match within the 366-day horizon
}

/* — interval specs — */

/** Interval spec: "30m", "6h", "2d", "3w", "2d at 09:00". */
export interface IntervalSpec {
  n: number;
  unit: "m" | "h" | "d" | "w";
  /** "HH:MM" wall time-of-day (d/w units only). */
  at?: string;
}

/** Parse the `every`/`after` spec body. Throws on a bad shape. */
export function parseIntervalSpec(text: string): IntervalSpec {
  const t = text.trim().replace(/\s+/g, " ");
  const m = t.match(
    /^(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(?:\s*(?:at|@)\s*([01]?\d|2[0-3]):([0-5]\d))?$/i,
  );
  if (!m) {
    throw new Error(
      `interval spec: cannot parse "${text}" — expected e.g. "30m", "6h", "2d", "3w", "2d at 09:00"`,
    );
  }
  const n = Number(m[1]);
  const word = m[2].toLowerCase();
  const atRaw = m[4] !== undefined ? m[3].padStart(2, "0") + ":" + m[4] : undefined;
  const unit: IntervalSpec["unit"] = word.startsWith("m")
    ? "m"
    : word.startsWith("h")
      ? "h"
      : word.startsWith("d")
        ? "d"
        : "w";
  if (unit === "m" || unit === "h") {
    if (atRaw !== undefined) {
      throw new Error(`"at HH:MM" is only valid for d/w intervals`);
    }
    return { n, unit };
  }
  const at: string | undefined = atRaw;
  return { n, unit, at };
}

/** The FIRST interval slot STRICTLY after `fromMs` (d/w units pin the
 * local wall time-of-day — `at`, or the anchor's own wall time when
 * absent; the OS tzdb keeps d/w slots on their wall time across DST).
 */
export function firstIntervalSlotAfter(
  fromMs: number,
  spec: IntervalSpec,
): number {
  if (spec.unit === "m" || spec.unit === "h") {
    return fromMs + spec.n * UNIT_MS[spec.unit];
  }
  const anchor = new Date(fromMs);
  const [hh, mm] = spec.at ? spec.at.split(":").map(Number) : [anchor.getHours(), anchor.getMinutes()];
  const cand = new Date(fromMs);
  cand.setSeconds(0, 0);
  cand.setMinutes(hh * 60 + mm, 0, 0);
  let i = 0;
  while (cand.getTime() <= fromMs && i < (spec.unit === "w" ? 4 : 5)) {
    cand.setDate(cand.getDate() + (spec.unit === "w" ? 7 : 1));
    i++;
  }
  return cand.getTime();
}

/** Advance one interval slot from the consumed/anchored slot:
 *  - m/h: plain duration arithmetic
 *  - d/w: local calendar stepping; `at` pins the wall time-of-day */
export function advanceIntervalSlot(
  slotMs: number,
  spec: IntervalSpec,
): number {
  if (spec.unit === "m" || spec.unit === "h") {
    return slotMs + spec.n * UNIT_MS[spec.unit];
  }
  const [hh, mm] = spec.at ? spec.at.split(":").map(Number) : [
    new Date(slotMs).getHours(),
    new Date(slotMs).getMinutes(),
  ];
  const cand = new Date(slotMs);
  cand.setSeconds(0, 0);
  cand.setMinutes(hh * 60 + mm, 0, 0);
  const days = spec.unit === "w" ? spec.n * 7 : spec.n;
  cand.setDate(cand.getDate() + days);
  return cand.getTime();
}

/* — THE projection entrypoint — */

/**
 * THE pure projection entrypoint: (job, nowMs) -> {due, skip, nextAt,
 * preview}. The clock is the injected `nowMs` — never Date.now().
 * Kinds:
 *  - cron:   next local-wall-clock match of the 5-field expression
 *  - every:  fixed interval from the anchor (createdAt) with the
 *            optional "at HH:MM" local anchor; a missed slot is
 *            recorded as exactly ONE skip, never replayed
 *  - after:  completion-anchored: next = lastCompletedAt + interval
 *            (never overdue, never catch-up)
 *  - once:   createdAt + delayMinutes, then retired
 *  - event:  trigger-only — {due:false, nextAt:null,
 *            preview:"trigger-only"}
 * A foreign IANA zone (≠ the runtime's local zone) answers
 * "engine-authoritative" for the time-based kinds.
 */
export function projectSchedule(
  job: Pick<Job, "schedule" | "timezone" | "updatedAt" | "createdAt">,
  nowMs: number,
): ScheduleProjection {
  const local = isLocalZone(job.timezone);
  switch (job.schedule.kind) {
    case "event":
      return { due: false, skip: false, nextAt: null, preview: "trigger-only" };
    case "cron": {
      if (!local) {
        return { due: false, skip: false, nextAt: null, preview: "engine-authoritative" };
      }
      const next = nextCronAfter(job.schedule.expr, nowMs);
      // `nextCronAfter` answers STRICTLY after now, so a slot that just
      // fired (now is 0..1 min past it) is found by looking one minute
      // back: it is still due inside its one-minute window.
      const justFired =
        nextCronAfter(job.schedule.expr, nowMs - MIN_MS - 1) ?? null;
      const active =
        justFired !== null && justFired <= nowMs && nowMs - justFired <= MIN_MS
          ? justFired
          : next;
      const due =
        active !== null &&
        (active <= nowMs ? nowMs - active <= MIN_MS : active - nowMs <= MIN_MS);
      return { due, skip: false, nextAt: active, preview: "local" };
    }
    case "every": {
      if (!local) {
        return { due: false, skip: false, nextAt: null, preview: "engine-authoritative" };
      }
      const parsed = parseIntervalSpec(job.schedule.spec);
      // Anchor the interval grid at the job's creation instant so the
      // projection is a pure function of (job, now), not hidden state.
      let next = firstIntervalSlotAfter(job.createdAt, parsed);
      let behind = false;
      let lastFired: number | null = null;
      let guard = 0;
      while (next < nowMs) {
        behind = true;
        lastFired = next;
        next = advanceIntervalSlot(next, parsed);
        if (++guard > 53 * 366) break; // ~53 years of slots: unreachable
      }
      // Misfire policy (E-09): a slot (or slots) already past at now
      // is RECORDED as exactly one skip, never replayed; the next
      // slot is the first strictly-future one. A catch-up slot within
      // the engine's 5-minute grace window still FIRES (due), not
      // skip. `due` is true when the next slot is inside the current
      // one-minute window, OR a missed slot is within the grace window
      // and will fire as catch-up.
      const graceDue = lastFired !== null && nowMs - lastFired <= GRACE_MS;
      const due = (next > nowMs - MIN_MS && next <= nowMs + MIN_MS) || graceDue;
      return { due, skip: behind && !graceDue, nextAt: next, preview: "local" };
    }
    case "after": {
      if (!local) {
        return { due: false, skip: false, nextAt: null, preview: "engine-authoritative" };
      }
      // Completion-anchored: next = N units after the LAST completion
      // (updatedAt), regenerating; NEVER overdue → due:false, skip:false.
      const parsed = parseIntervalSpec(job.schedule.spec);
      const next = advanceIntervalSlot(job.updatedAt, parsed);
      return { due: false, skip: false, nextAt: next, preview: "local" };
    }
    case "once": {
      if (!local) {
        return { due: false, skip: false, nextAt: null, preview: "engine-authoritative" };
      }
      const atMs = job.createdAt + job.schedule.delayMinutes * MIN_MS;
      const due = nowMs >= atMs && nowMs <= atMs + MIN_MS;
      return {
        due,
        skip: false,
        nextAt: nowMs < atMs ? atMs : null, // a fired once retires
        preview: "local",
      };
    }
  }
}
