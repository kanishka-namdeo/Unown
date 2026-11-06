/**
 * Scheduler tests — the injected-clock battery (P0 #3, PRD edge case 6).
 *
 * All tests drive `decideSchedule` with an INJECTED clock (a number),
 * never `Date.now()` — the Ostinato law this ticket honors. Pins:
 *
 *   1. one-shot fires exactly once; a second decision at the same due
 *      is a no-op (dedup), and `next === null` retires the schedule.
 *   2. interval advances `nextDue` by whole periods on each fire.
 *   3. misfire on a sleep gap (now − due ≥ 2·everyMs) → skip-and-record
 *      (ONE skip record, a reason, nextDue jumps FORWARD past now —
 *      never a catch-up storm of N fires).
 *   4. double-fire impossible: any due ≤ lastFiredIso is a dedup no-op,
 *      so a restart after a crash re-deciding the same due fires 0 times.
 *   5. boundary instants: due == now fires; due > now waits; a due
 *      < now within one period fires ONCE (a little late, still one fire).
 */
import { test, expect } from "bun:test";
import { decideSchedule, isoToMs, msToIso, type SkipReason } from "./scheduler.js";
import { DomainInvariantError } from "./types.js";
import type { Recipe, Schedule } from "./types.js";

// A fixed calendar — ISO-8601 strings so the tests stay readable;
// every decision below uses the SAME calendar (injected, not read).
const T0 = "2026-11-06T00:00:00Z";
const T0_MS = isoToMs(T0);
const PERIOD = 60_000; // 1 minute

function recipe(schedule?: Schedule, version = 1): Recipe {
  return {
    id: 1,
    name: "rec",
    version,
    steps: [],
    ...(schedule !== undefined ? { schedule } : {}),
  };
}

const oneShot = (nextDue: string, extra: Partial<Schedule> = {}): Schedule => ({
  kind: "one-shot",
  nextDueIso: nextDue,
  ...extra,
});

const interval = (nextDue: string, extra: Partial<Schedule> = {}): Schedule => ({
  kind: "interval",
  everyMs: PERIOD,
  nextDueIso: nextDue,
  ...extra,
});

// ─── 1. one-shot: fires once, retires, dedups on re-decision ──────────

test("one-shot: fires at the due instant (due == now fires)", () => {
  const d = decideSchedule(recipe(oneShot(T0)), T0_MS);
  expect(d.fire).toBe(true);
  expect(d.skip).toBeNull();
  expect(d.next).toBeNull(); // retired
  expect(d.record?.recipeId).toBe(1);
});

test("one-shot: due > now waits (state carries forward)", () => {
  const d = decideSchedule(recipe(oneShot(T0)), T0_MS - 1000);
  expect(d.fire).toBe(false);
  expect(d.skip).toBeNull();
  expect(d.record).toBeNull();
  expect(d.next).toEqual(recipe(oneShot(T0)).schedule!); // unchanged
});

test("one-shot: a second decision at the same due is a dedup no-op (never fires twice)", () => {
  // The loop fired once: lastFiredIso stamps the DUE instant. A crash +
  // restart re-deciding the same (stale) due must fire 0 times.
  const sched = oneShot(T0, { lastFiredIso: T0 });
  const d = decideSchedule(recipe(sched), T0_MS + 5000);
  expect(d.fire).toBe(false);
  expect(d.skip?.reason).toBe("one-shot-already-fired");
  expect(d.record).toBeNull();
});

// ─── 2. interval: advances nextDue by whole periods ───────────────────

test("interval: fires on time; nextDue advances exactly one period", () => {
  const d = decideSchedule(recipe(interval(T0)), T0_MS + 5000, { nowIso: msToIso(T0_MS + 5000) });
  expect(d.fire).toBe(true);
  expect(d.skip).toBeNull();
  // nextDue: the next period boundary after now. now = T0+5s; the next
  // boundary is T0 + P (periods are counted from the anchor T0).
  expect(d.next?.nextDueIso).toBe(msToIso(T0_MS + PERIOD));
  // The DUE instant, not now (msToIso of T0_MS renders with ms suffix).
  expect(d.next?.lastFiredIso).toBe(msToIso(T0_MS));
  expect(d.record?.startedAt).toBe(msToIso(T0_MS + 5000));
});

test("interval: a due < now within one period fires ONCE (late, not a misfire)", () => {
  // 0.5 periods late: now − due = 0.5·P ≤ P → on-time-fire (late OK).
  const nowMs = T0_MS + Math.floor(0.5 * PERIOD);
  const d = decideSchedule(recipe(interval(T0)), nowMs);
  expect(d.fire).toBe(true);
  expect(d.skip).toBeNull();
  // Next due: next period boundary after now = T0 + P.
  expect(isoToMs(d.next!.nextDueIso!)).toBe(T0_MS + 1 * PERIOD);
});

// ─── 3. misfire: sleep gap → skip-and-record, no catch-up storm ──────

test("misfire: a sleep gap of ≥ 2 periods records ONE skip and jumps forward", () => {
  // Machine slept 5 full periods: now − due = 5·P ≥ 2·P.
  const nowMs = T0_MS + 5 * PERIOD;
  const d = decideSchedule(recipe(interval(T0)), nowMs);
  expect(d.fire).toBe(false);
  expect(d.skip?.reason).toBe("misfire");
  // Exactly ONE skip record — never N catch-up runs.
  expect(d.record).not.toBeNull();
  expect(d.record!.committedPrefix).toBe(0);
  // nextDue jumps to the first period strictly after now (no backward).
  const nextMs = isoToMs(d.next!.nextDueIso!);
  expect(nextMs).toBe(T0_MS + 6 * PERIOD); // 5 missed, next is period 6
  expect(nextMs).toBeGreaterThan(nowMs);
});

test("misfire: NO catch-up storm — the skipped due never fires after the jump", () => {
  // After the misfire advance, the loop re-decides at nowMs+ε on the NEW
  // nextDue: it must wait (not fire), proving one skip, zero fires.
  const nowMs = T0_MS + 5 * PERIOD;
  const first = decideSchedule(recipe(interval(T0)), nowMs);
  expect(first.fire).toBe(false);
  const second = decideSchedule(recipe(first.next!), nowMs + 1);
  expect(second.fire).toBe(false);
  expect(second.record).toBeNull();
});

test("misfire: a later on-time due after the jump fires normally once", () => {
  const nowMs = T0_MS + 5 * PERIOD;
  const jumped = decideSchedule(recipe(interval(T0)), nowMs).next!;
  // At period 6 (the first past now), the schedule fires on time.
  const d = decideSchedule(
    recipe({ ...jumped }),
    isoToMs(jumped.nextDueIso!) + 1000,
  );
  expect(d.fire).toBe(true);
  expect(d.skip).toBeNull();
});

// ─── 4. dedup law: a fired due records once; restarts can't re-fire ──

test("dedup: an interval due ≤ lastFiredIso never fires (restart double-fire impossible)", () => {
  // The loop fired once: lastFiredIso stamps the DUE T0. A crash +
  // restart re-deciding the SAME persisted due (T0) must fire 0 times.
  const sched = interval(T0, { lastFiredIso: T0 });
  const d = decideSchedule(recipe(sched), T0_MS + PERIOD);
  expect(d.fire).toBe(false);
  expect(d.skip?.reason).toBe("interval-already-fired");
  expect(d.record).toBeNull();
  // DEDUP-HEAL: the stale state (nextDue still T0 ≤ lastFired) is
  // advanced to the next boundary strictly after now — no permanent
  // brick. now = T0+P → nextDue heals to T0 + 2P.
  expect(isoToMs(d.next!.nextDueIso!)).toBe(T0_MS + 2 * PERIOD);
});

test("dedup: a fresh due after a fire still fires once (the law is per-due, not per-schedule)", () => {
  // Fire due T0 (advancing nextDue to T0+P and lastFired to T0). The
  // persisted state on restart has nextDue=T0+P, lastFired=T0.
  const sched = interval(msToIso(T0_MS + PERIOD), { lastFiredIso: T0 });
  // Due T0+P was never fired (lastFired = T0 < T0+P): it fires ONCE
  // at the due instant itself (now − due = 0).
  const d = decideSchedule(recipe(sched), T0_MS + PERIOD);
  expect(d.fire).toBe(true);
});

test("dedup: a fresh due just under one period after lastFired fires on time", () => {
  const sched = interval(msToIso(T0_MS + PERIOD), { lastFiredIso: T0 });
  // The due T0+P was never fired (lastFired = T0 < T0+P): it fires ONCE
  // at the due instant itself — a fresh due, not suppressed by dedup.
  const d = decideSchedule(recipe(sched), T0_MS + PERIOD);
  expect(d.fire).toBe(true);
});

test("dedup: a one-shot due ≤ lastFiredIso is a pure no-op (retires via the runner)", () => {
  const sched = oneShot(T0, { lastFiredIso: T0 });
  const d = decideSchedule(recipe(sched), T0_MS + PERIOD);
  expect(d.fire).toBe(false);
  expect(d.skip?.reason).toBe("one-shot-already-fired");
  expect(d.record).toBeNull();
  // One-shot dedup does NOT heal — the state is unchanged.
  expect(d.next).toEqual(sched);
});

// ─── 5. boundary + validation ──────────────────────────────────────────

test("boundary: due == now fires (the instant is due)", () => {
  expect(decideSchedule(recipe(interval(T0)), T0_MS).fire).toBe(true);
});

test("misfire boundary: a gap just over one period IS a misfire (skip-and-record)", () => {
  const nowMs = T0_MS + PERIOD + 1;
  const d = decideSchedule(recipe(interval(T0)), nowMs);
  expect(d.skip?.reason).toBe("misfire");
  // nextDue jumps to the first period boundary strictly after now.
  expect(isoToMs(d.next!.nextDueIso!)).toBe(T0_MS + 2 * PERIOD);
});

test("misfire boundary: a gap of exactly one period fires on time (one late fire)", () => {
  const nowMs = T0_MS + PERIOD;
  const d = decideSchedule(recipe(interval(T0)), nowMs);
  expect(d.fire).toBe(true);
  expect(d.skip).toBeNull();
  // nextDue advances to T0 + 2P (the next boundary after the late due).
  expect(isoToMs(d.next!.nextDueIso!)).toBe(T0_MS + 2 * PERIOD);
});

test("no schedule: an unscheduled recipe is a no-op decision", () => {
  const d = decideSchedule(recipe(), T0_MS);
  expect(d.fire).toBe(false);
  expect(d.record).toBeNull();
  expect(d.next).toBeNull();
});

test("interval without everyMs throws DomainInvariantError", () => {
  expect(() =>
    decideSchedule(recipe({ kind: "interval", nextDueIso: T0 }), T0_MS),
  ).toThrow(DomainInvariantError);
});

test("a missing nextDueIso throws DomainInvariantError", () => {
  expect(() =>
    decideSchedule(recipe({ kind: "one-shot" } as Schedule), T0_MS),
  ).toThrow(DomainInvariantError);
});
