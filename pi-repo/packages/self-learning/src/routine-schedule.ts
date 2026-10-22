/**
 * routine-schedule.ts — the recurrence engine behind Routines (the user-facing
 * name for scheduled recurring agent runs; the storage/API substrate keeps the
 * historical `automations` identifiers — see automations.ts for the scheduler).
 *
 * Reverse-engineered from the best recurrence semantics in the industry
 * (docs/routines.md has the full decision record with sources):
 *
 *   - Todoist / Things / OmniFocus all make the COMPLETION ANCHOR an explicit,
 *     per-task choice: due-anchored ("every Monday" — the calendar owns the
 *     rhythm, gaps stay visible) vs completion-anchored ("after N days" — the
 *     task can never be overdue; the next occurrence just waits). Routines
 *     expose both: `every` (schedule-anchored) and `after` (completion-
 *     anchored), as distinct kinds — never overloaded onto one expression.
 *   - launchd / systemd / Quartz / Claude Code scheduled tasks all converge on
 *     the same missed-run design space: skip-and-record (cron), catch-up-once
 *     (launchd StartCalendarInterval coalescing) or backfill-N (rare, costly).
 *     Routines ship skip (default) and catch-up-once per routine; the scheduler
 *     coalesces a long-missed slot chain into ONE recorded skip, never N.
 *   - The wall-clock arithmetic is the RFC 5545 / Temporal "compatible" model:
 *     stepping happens on the calendar of the routine's timezone, not on epoch
 *     milliseconds, so "every 1 day at 09:00" stays at 09:00 across DST.
 *
 * Schedule kinds:
 *
 *   cron    "0 9 * * 1-5"           5-field cron, evaluated in the routine's
 *                                   timezone (default: the engine's local time)
 *   every   "every 30m"             interval from the schedule's own slots
 *           "every 2d at 09:00"     d/w step by WALL CLOCK in the tz (DST-
 *                                   safe); m/h are plain durations
 *   after   "after 45m" | "after 3d"  N units after each run COMPLETES —
 *                                   regenerating semantics; cannot misfire
 *   once    delayMinutes (1..525600) the existing one-shot
 *   event   "on <name>"            M2: no time slot at all — dispatched by
 *                                   inbound webhook events (hook-filter.ts
 *                                   carries the payload-filter half)
 *
 * Timezone/DST policies (pinned by test/routine-schedule.test.ts):
 *
 *   spring-forward gap   02:30 does not exist  → fires at 03:30 (shifted
 *                        forward by the gap — the Temporal "compatible"
 *                        policy; RFC 5545 says ignore-and-skip, but a late
 *                        run beats a silently vanished one)
 *   fall-back fold       01:30 happens twice   → fires ONCE, at the earlier
 *                        occurrence (what RFC 5545 / Luxon / Date agree on);
 *                        when `from` already sits in the later pass of the
 *                        fold, the later instant is used (a fire is never
 *                        returned in the past)
 *   day/week intervals   wall-clock stepping in the routine's timezone; a
 *                        "weekly" routine fires 167h or 169h apart across a
 *                        DST boundary, never drifts off its wall time
 *   minute/hour intervals pure durations (an hourly timer that crosses a
 *                        fall-back gap fires one extra wall hour later in
 *                        absolute terms — same as any duration timer)
 *
 * Everything here is PURE: no store, no clock reads (instants are passed in),
 * no dependencies — the same contract as cron.ts. The scheduler
 * (automations.ts) owns persistence, claiming and dispatch.
 */
import { describeCron, nextRun, parseCron, CronParseError } from "./cron.ts";
import { describeHookFilter } from "./hook-filter.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The recurrence kinds a routine can carry. `once` is the legacy one-shot;
 *  `event` (M2) is not a recurrence at all — the row's next_run_at stays
 *  NULL forever and dispatch happens through the webhook lane. */
export type ScheduleKind = "cron" | "every" | "after" | "once" | "event";

export type IntervalUnit = "m" | "h" | "d" | "w";

/** Parsed `every` / `after` spec: N units, optional wall-clock time-of-day. */
export interface IntervalSpec {
        n: number;
        unit: IntervalUnit;
        /** "HH:MM" wall-clock time-of-day (only valid for d/w units). */
        at?: string;
}

/** What the REST layer / CLI / tools accept for a routine's schedule. */
export interface ScheduleInput {
        cron?: string;
        /** "30m" | "6h" | "2d" | "3w" | "2d at 09:00" — schedule-anchored interval. */
        every?: string;
        /** "45m" | "2h" | "3d" | "1w" — completion-anchored interval. */
        after?: string;
        /** One-shot: run once after N minutes (legacy; 1..525600). */
        delayMinutes?: number;
}

/** The normalized, storable schedule (the automations row's schedule columns). */
export interface NormalizedSchedule {
        kind: ScheduleKind;
        cronExpr: string | null;
        intervalN: number | null;
        intervalUnit: IntervalUnit | null;
        intervalAt: string | null;
        delayMs: number | null;
}

export type SchedulePlanResult =
        | {
                  ok: true;
                  schedule: NormalizedSchedule;
                  nextRunAt: number;
          }
        | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Interval spec parsing — "every 2d at 09:00", "after 45m", …
// ---------------------------------------------------------------------------

const UNIT_MS: Record<"m" | "h", number> = { m: 60_000, h: 3_600_000 };

/** Upper bound for N, in the same spirit as delayMinutes' 525600 minutes
 *  (one year): a recurrence longer than a year out is a calendar, not a
 *  routine. */
const MAX_N: Record<IntervalUnit, number> = { m: 525_600, h: 8_760, d: 366, w: 53 };

/**
 * Parse an interval spec body — the part after "every"/"after":
 * `30m`, `6h`, `2d`, `3w`, `2d at 09:00`, `2d@09:00` (long unit words —
 * "min", "hours", "days", "weeks" — are accepted too). `at` is only
 * meaningful for calendar units (d/w) and rejected for m/h.
 */
export function parseIntervalSpec(text: string, allowAt: boolean): { ok: true; spec: IntervalSpec } | { ok: false; error: string } {
        const t = text.trim().replace(/\s+/g, " ");
        const m = t.match(/^(\d+)\s*(m|min|mins|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)(?:\s*(?:at|@)\s*([0-2]?\d:[0-5]\d))?$/i);
        if (!m) {
                return {
                        ok: false,
                        error: `cannot parse "${text}" — expected e.g. "30m", "6h", "2d", "3w"${allowAt ? ', "2d at 09:00"' : ""}`,
                };
        }
        const n = Number(m[1]);
        const unitWord = m[2].toLowerCase();
        const unit: IntervalUnit = unitWord.startsWith("m") ? "m" : unitWord.startsWith("h") ? "h" : unitWord.startsWith("d") ? "d" : "w";
        if (!Number.isInteger(n) || n < 1 || n > MAX_N[unit]) {
                return { ok: false, error: `interval count must be 1..${MAX_N[unit]} for ${unit} units (got ${n})` };
        }
        const at = m[3];
        if (at !== undefined) {
                if (!allowAt) return { ok: false, error: `"at HH:MM" is only valid for every-day/every-week intervals (not ${unit})` };
                if (unit !== "d" && unit !== "w") return { ok: false, error: `"at HH:MM" needs day or week units (got ${unit})` };
                if (Number(at.split(":")[0]) > 23) return { ok: false, error: `"at ${at}" is not a valid HH:MM time` };
        }
        return { ok: true, spec: { n, unit, at: at !== undefined ? at.padStart(5, "0") : undefined } };
}

// ---------------------------------------------------------------------------
// Timezone wall-clock helpers (dependency-free; Intl carries the tz database)
// ---------------------------------------------------------------------------

export interface WallTime {
        y: number;
        mo: number; // 1-12
        d: number;
        hh: number;
        mm: number;
}

/** Cached per-zone formatters — construction is the expensive part of Intl
 *  (the cron-in-zone scan would otherwise pay it per minute probed). */
const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(tz: string): Intl.DateTimeFormat {
        let f = wallFormatters.get(tz);
        if (!f) {
                f = new Intl.DateTimeFormat("en-US", {
                        timeZone: tz,
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                });
                wallFormatters.set(tz, f);
        }
        return f;
}

/** Validate an IANA timezone name ("America/New_York"); null/"" = local. */
export function isValidTimezone(tz: string | null | undefined): boolean {
        if (tz === null || tz === undefined || tz === "") return true; // local (floating)
        try {
                wallFormatter(tz);
                return true;
        } catch {
                return false;
        }
}

/** The wall-clock reading of an instant in a timezone (null/"" = local). */
export function wallTimeInZone(instant: number, tz: string | null): WallTime {
        const d = new Date(instant);
        if (!tz) {
                return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes() };
        }
        const parts = wallFormatter(tz).formatToParts(d);
        const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? "0");
        let hh = get("hour");
        if (hh === 24) hh = 0; // belt-and-braces for ICU builds ignoring h23
        return { y: get("year"), mo: get("month"), d: get("day"), hh, mm: get("minute") };
}

/** Offset (ms) of a timezone at an instant — positive east of UTC, minute
 *  resolution (the wall helpers carry no seconds). */
function zoneOffsetMs(instant: number, tz: string | null): number {
        if (!tz) return -new Date(instant).getTimezoneOffset() * 60_000;
        const w = wallTimeInZone(instant, tz);
        const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm);
        return Math.round((asUtc - instant) / 60_000) * 60_000;
}

/** Total wall minutes since the epoch of a wall reading (for caps/compares). */
function wallKey(w: WallTime): number {
        return (Date.UTC(w.y, w.mo - 1, w.d) / 60_000) + w.hh * 60 + w.mm;
}

function sameWall(a: WallTime, b: WallTime): boolean {
        return a.y === b.y && a.mo === b.mo && a.d === b.d && a.hh === b.hh && a.mm === b.mm;
}

/**
 * All instants whose wall-clock reading in `tz` equals `w` (0, 1 or 2
 * entries — 2 inside a fall-back fold), ascending. The candidate offsets
 * are probed at asUtc ± 1 day, which brackets any sub-day transition.
 *
 * Empty when `w` falls inside a spring-forward gap (the reading does not
 * exist) — use {@link instantFromWall} for the shifted-forward policy.
 */
export function instantsFromWall(w: WallTime, tz: string | null): number[] {
        const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm);
        if (!tz) {
                // Local: let Date do the resolution (same policies hold).
                return [new Date(w.y, w.mo - 1, w.d, w.hh, w.mm, 0, 0).getTime()];
        }
        const offsets = new Set([zoneOffsetMs(asUtc, tz), zoneOffsetMs(asUtc - 86_400_000, tz), zoneOffsetMs(asUtc + 86_400_000, tz)]);
        const hits: number[] = [];
        for (const off of offsets) {
                const t = asUtc - off;
                if (sameWall(wallTimeInZone(t, tz), w) && !hits.includes(t)) hits.push(t);
        }
        return hits.sort((a, b) => a - b);
}

/**
 * THE instant of a wall-clock reading in a timezone — the Temporal
 * "compatible" policies:
 *
 *   - fall-back fold (ambiguous wall time): the EARLIER instant wins
 *   - spring-forward gap (nonexistent wall time): shifted forward by the
 *     gap (fires late but fires once — never silently vanishes)
 */
export function instantFromWall(w: WallTime, tz: string | null): number {
        const candidates = instantsFromWall(w, tz);
        if (candidates.length > 0) return candidates[0]; // fold → earlier
        // Gap: no candidate maps back to the reading. Shift forward by the
        // gap using the pre-transition offset (asUtc - offBefore lands after
        // the transition).
        const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm);
        if (!tz) return asUtc; // unreachable (local always resolves)
        const offBefore = zoneOffsetMs(asUtc - 86_400_000, tz);
        return asUtc - offBefore;
}

function addWallMinutes(w: WallTime, minutes: number): WallTime {
        const d = new Date(Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm));
        d.setUTCMinutes(d.getUTCMinutes() + minutes);
        return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

/** Add N calendar days to a wall time (Date handles month/year rollover). */
function addCalendarDays(w: WallTime, days: number): WallTime {
        return addWallMinutes({ ...w, hh: 0, mm: 0 }, days * 24 * 60 + w.hh * 60 + w.mm);
}

// ---------------------------------------------------------------------------
// Next-slot computation per kind
// ---------------------------------------------------------------------------

function cronFieldsMatch(parsed: ReturnType<typeof parseCron>, w: WallTime): boolean {
        const domHit = parsed.daysOfMonth.includes(w.d);
        const dowHit = parsed.daysOfWeek.includes(new Date(Date.UTC(w.y, w.mo - 1, w.d)).getUTCDay());
        const dayOk = parsed.domRestricted && parsed.dowRestricted ? domHit || dowHit : parsed.domRestricted ? domHit : parsed.dowRestricted ? dowHit : true;
        return parsed.minutes.includes(w.mm) && parsed.hours.includes(w.hh) && parsed.months.includes(w.mo) && dayOk;
}

/**
 * The next cron occurrence strictly after `from`, evaluated in the routine's
 * timezone. The scan runs in WALL space (pure calendar math — fast, and each
 * wall minute is tested exactly once, which is what makes a fold fire once
 * and a gap shift forward instead of vanishing):
 *
 *   - fall-back fold: the earlier instant of an ambiguous reading wins; when
 *     `from` already sits in the LATER pass, the later twin is used (never
 *     return a fire in the past)
 *   - spring-forward gap: nonexistent readings resolve past the gap
 *     (instantFromWall's compatible policy)
 *   - 4-year scan cap, same contract as cron.ts
 */
export function nextCronInZone(expr: string, from: number, tz: string | null): number | null {
        if (!tz) {
                const next = nextRun(expr, new Date(from));
                return next ? next.getTime() : null;
        }
        let parsed;
        try {
                parsed = parseCron(expr);
        } catch {
                return null;
        }
        let w = addWallMinutes(wallTimeInZone(from, tz), 1);
        const capKey = wallKey(addWallMinutes(wallTimeInZone(from, tz), 4 * 366 * 24 * 60));
        const CAP_STEPS = 4 * 366 * 24 * 60 + 10;
        for (let i = 0; i < CAP_STEPS; i++) {
                if (wallKey(w) > capKey) return null;
                if (cronFieldsMatch(parsed, w)) {
                        // All instants carrying this wall reading (1 normally,
                        // 2 in a fold, none in a gap — the gap falls back to
                        // the shifted-forward instant): the first one strictly
                        // after `from` wins — earlier-pass-first ordering
                        // gives the once-at-the-earlier fold policy.
                        const candidates = instantsFromWall(w, tz);
                        if (candidates.length === 0) {
                                const shifted = instantFromWall(w, tz); // gap policy
                                if (shifted > from) return shifted;
                        }
                        for (const inst of candidates) {
                                if (inst > from) return inst;
                        }
                }
                w = addWallMinutes(w, 1);
        }
        return null;
}

/** Advance one interval slot from `slotMs` (the consumed/anchored slot).
 *  - m/h: plain duration arithmetic
 *  - d/w: wall-clock calendar stepping in the routine's timezone
 *  - `at` pins the wall time-of-day for d/w specs */
export function advanceIntervalSlot(slotMs: number, spec: IntervalSpec, tz: string | null): number {
        if (spec.unit === "m" || spec.unit === "h") {
                return slotMs + spec.n * UNIT_MS[spec.unit];
        }
        const w = wallTimeInZone(slotMs, tz);
        let next = addCalendarDays(w, spec.unit === "d" ? spec.n : spec.n * 7);
        if (spec.at) {
                const [hh, mm] = spec.at.split(":").map(Number);
                next = { ...next, hh, mm };
        }
        return instantFromWall(next, tz);
}

/** The FIRST interval slot at-or-after `fromMs` — creation and resume both
 *  use this; the phase derives from the wall clock (today-if-future for `at`
 *  specs, from+duration for m/h), never from a hidden epoch anchor. */
export function firstIntervalSlot(fromMs: number, spec: IntervalSpec, tz: string | null): number {
        if (spec.unit === "m" || spec.unit === "h") {
                return fromMs + spec.n * UNIT_MS[spec.unit];
        }
        const w = wallTimeInZone(fromMs, tz);
        const [hh, mm] = spec.at ? spec.at.split(":").map(Number) : [w.hh, w.mm];
        // Candidate: same calendar day at the target wall time; if that is
        // not strictly future, step one interval forward (a routine never
        // fires in the present minute — same contract as cron's nextRun).
        const todayInstant = instantFromWall({ y: w.y, mo: w.mo, d: w.d, hh, mm }, tz);
        if (todayInstant > fromMs) return todayInstant;
        return advanceIntervalSlot(todayInstant, spec, tz);
}

/** Completion-anchored re-arm: the next slot N units after `completedMs`.
 *  d/w step by wall clock from the completion's reading (Todoist "after"
 *  semantics — measured from when the work actually finished). */
export function nextAfterCompletion(completedMs: number, spec: IntervalSpec, tz: string | null): number {
        return advanceIntervalSlot(completedMs, spec, tz);
}

// ---------------------------------------------------------------------------
// Normalization + first next_run_at
// ---------------------------------------------------------------------------

/** Validate + normalize a schedule input and compute its first next_run_at.
 *  Exactly one of cron/every/after/delayMinutes must be present. Pure. */
export function planRoutineSchedule(spec: ScheduleInput, timezone: string | null, now: number = Date.now()): SchedulePlanResult {
        if (!isValidTimezone(timezone)) {
                return { ok: false, error: `unknown timezone "${timezone}" (IANA names, e.g. America/New_York)` };
        }
        const tz = timezone && timezone !== "" ? timezone : null;
        const present: string[] = [];
        if (spec.cron !== undefined) present.push("cron");
        if (spec.every !== undefined) present.push("every");
        if (spec.after !== undefined) present.push("after");
        if (spec.delayMinutes !== undefined) present.push("delayMinutes");
        if (present.length === 0) return { ok: false, error: "pass one of cron, every, after, delayMinutes" };
        if (present.length > 1) return { ok: false, error: `pass only ONE of cron/every/after/delayMinutes (got ${present.join(" + ")})` };

        if (spec.delayMinutes !== undefined) {
                if (!Number.isFinite(spec.delayMinutes) || spec.delayMinutes < 1 || spec.delayMinutes > 525_600) {
                        return { ok: false, error: "delayMinutes must be 1..525600" };
                }
                const at = now + spec.delayMinutes * 60_000;
                return {
                        ok: true,
                        schedule: { kind: "once", cronExpr: null, intervalN: null, intervalUnit: null, intervalAt: null, delayMs: at },
                        nextRunAt: at,
                };
        }
        if (spec.cron !== undefined) {
                try {
                        parseCron(spec.cron);
                } catch (err) {
                        return { ok: false, error: err instanceof CronParseError ? err.message : String(err) };
                }
                const first = nextCronInZone(spec.cron.trim(), now, tz);
                if (first === null) return { ok: false, error: `cron "${spec.cron}" has no occurrence in the next 4 years` };
                return {
                        ok: true,
                        schedule: { kind: "cron", cronExpr: spec.cron.trim(), intervalN: null, intervalUnit: null, intervalAt: null, delayMs: null },
                        nextRunAt: first,
                };
        }
        if (spec.every !== undefined) {
                const parsed = parseIntervalSpec(spec.every, true);
                if (!parsed.ok) return { ok: false, error: parsed.error };
                return {
                        ok: true,
                        schedule: {
                                kind: "every",
                                cronExpr: null,
                                intervalN: parsed.spec.n,
                                intervalUnit: parsed.spec.unit,
                                intervalAt: parsed.spec.at ?? null,
                                delayMs: null,
                        },
                        nextRunAt: firstIntervalSlot(now, parsed.spec, tz),
                };
        }
        // `after` — an after-routine arms N units from creation (the first
        // "completion" is the act of creating it; Todoist's after-semantics
        // for a fresh regenerating task).
        const parsed = parseIntervalSpec(spec.after!, false);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        return {
                ok: true,
                schedule: {
                        kind: "after",
                        cronExpr: null,
                        intervalN: parsed.spec.n,
                        intervalUnit: parsed.spec.unit,
                        intervalAt: null,
                        delayMs: null,
                },
                nextRunAt: nextAfterCompletion(now, parsed.spec, tz),
        };
}

// ---------------------------------------------------------------------------
// The row-facing planner (what the scheduler calls after each run/skip)
// ---------------------------------------------------------------------------

/** The schedule columns as they live on an automations row. The event-kind
 *  columns (M2) are optional: every pre-event caller passes rows that never
 *  carried them and must keep compiling. */
export interface RoutineScheduleColumns {
        schedule_kind: string | null;
        cron_expr: string | null;
        interval_n: number | null;
        interval_unit: string | null;
        interval_at: string | null;
        delay_ms: number | null;
        timezone: string | null;
        until_ms: number | null;
        event_kind?: string | null;
        event_filter?: string | null;
}

/** Infer the kind of a LEGACY row (pre-routines schema): cron_expr → cron,
 *  delay_ms (or neither) → once. */
export function inferLegacyKind(row: Pick<RoutineScheduleColumns, "cron_expr" | "delay_ms">): ScheduleKind {
        if (row.cron_expr) return "cron";
        return "once";
}

export interface RoutineNextResult {
        /** null = the plan is exhausted (caller finalizes lifecycle). */
        nextRunAt: number | null;
        /** Why the plan is exhausted, when it is. */
        reason?: "once-done" | "max-runs" | "until-past";
}

/** Rebuild the IntervalSpec of an interval row (guards nulls for legacy). */
export function rowIntervalSpec(row: Pick<RoutineScheduleColumns, "interval_n" | "interval_unit" | "interval_at">): IntervalSpec {
        return {
                n: row.interval_n ?? 1,
                unit: (row.interval_unit as IntervalUnit | null) ?? "d",
                at: row.interval_at ?? undefined,
        };
}

/**
 * The next slot after a consumed one, for schedule-anchored kinds (cron /
 * every). NOT used for `after` (completion-anchored — the scheduler computes
 * that from the run's end time) or `once` (no recurrence).
 *
 * `fromMs` is "now" (run end / skip time). For `every`, the slot chain
 * advances from `slotMs` (the consumed slot) and keeps stepping until it is
 * strictly future — so a long pause coalesces into the next future slot
 * (phase-preserving, like cron's nextRun(expr, now)).
 */
export function nextScheduleSlot(
        row: RoutineScheduleColumns & { scheduled_run_count: number; max_runs: number | null },
        slotMs: number,
        fromMs: number,
): RoutineNextResult {
        const kind = (row.schedule_kind as ScheduleKind | null) ?? inferLegacyKind(row);
        if (kind === "once") return { nextRunAt: null, reason: "once-done" };
        if (row.max_runs !== null && row.scheduled_run_count >= row.max_runs) return { nextRunAt: null, reason: "max-runs" };
        if (kind === "cron") {
                const next = nextCronInZone(row.cron_expr ?? "", fromMs, row.timezone);
                return untilCheck(next, row.until_ms) ?? { nextRunAt: next };
        }
        // every (interval): advance from the consumed slot, coalescing any
        // fully-elapsed slots into the next future one.
        const spec = rowIntervalSpec(row);
        let next = advanceIntervalSlot(slotMs, spec, row.timezone);
        let guard = 0;
        while (next <= fromMs && guard < 53 * 100) {
                next = advanceIntervalSlot(next, spec, row.timezone);
                guard++;
        }
        return untilCheck(next, row.until_ms) ?? { nextRunAt: next };
}

/** The `after`-kind re-arm: N units past the completion instant. */
export function nextAfterSlot(
        row: RoutineScheduleColumns & { scheduled_run_count: number; max_runs: number | null },
        completedMs: number,
): RoutineNextResult {
        if (row.max_runs !== null && row.scheduled_run_count >= row.max_runs) return { nextRunAt: null, reason: "max-runs" };
        const next = nextAfterCompletion(completedMs, rowIntervalSpec(row), row.timezone);
        return untilCheck(next, row.until_ms) ?? { nextRunAt: next };
}

function untilCheck(next: number | null, untilMs: number | null): RoutineNextResult | null {
        if (next === null) return { nextRunAt: null, reason: "until-past" };
        if (untilMs !== null && next > untilMs) return { nextRunAt: null, reason: "until-past" };
        return null;
}

// ---------------------------------------------------------------------------
// Human-readable descriptions
// ---------------------------------------------------------------------------

function unitWord(unit: IntervalUnit, n: number): string {
        switch (unit) {
                case "m":
                        return n === 1 ? "minute" : "minutes";
                case "h":
                        return n === 1 ? "hour" : "hours";
                case "d":
                        return n === 1 ? "day" : "days";
                default:
                        return n === 1 ? "week" : "weeks";
        }
}

/** One-line human description of any routine's schedule, e.g.
 *  "every 2 days at 09:00 (America/New_York)", "after 45 minutes (from
 *  completion)", "cron 0 9 * * 1-5 — at 09:00 on Mon-Fri", "one-shot in 90m". */
export function describeRoutineSchedule(row: RoutineScheduleColumns, nowMs: number = Date.now()): string {
        const kind = (row.schedule_kind as ScheduleKind | null) ?? inferLegacyKind(row);
        const tz = row.timezone ? ` (${row.timezone})` : "";
        switch (kind) {
                case "cron": {
                        let hint = "";
                        try {
                                hint = describeCron(row.cron_expr ?? "");
                        } catch {
                                hint = "";
                        }
                        return `cron ${row.cron_expr}${hint ? ` — ${hint}` : ""}${tz}`;
                }
                case "every": {
                        const at = row.interval_at ? ` at ${row.interval_at}` : "";
                        return `every ${row.interval_n} ${unitWord((row.interval_unit as IntervalUnit | null) ?? "d", row.interval_n ?? 1)}${at}${tz}`;
                }
                case "after":
                        return `after ${row.interval_n} ${unitWord((row.interval_unit as IntervalUnit | null) ?? "d", row.interval_n ?? 1)} (from completion)${tz}`;
                case "event":
                        // M2: the trigger description (the filter is half of WHEN this
                        // fires, so it rides the schedule line; describeHookFilter keeps
                        // it short — long ones truncate at the display edges).
                        return `on ${row.event_kind ?? "?"}${row.event_filter ? ` · ${describeHookFilter(row.event_filter)}` : ""}`;
                default:
                        if (typeof row.delay_ms === "number") {
                                const mins = Math.max(0, Math.round((row.delay_ms - nowMs) / 60_000));
                                return `one-shot in ${mins}m`;
                        }
                        return "one-shot";
        }
}
