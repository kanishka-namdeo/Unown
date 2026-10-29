/**
 * The deterministic rotation engine (plan §4.4) — whoIsOnCall,
 * nextHandoff, the active window, and the override precedence.
 *
 * PURE: zero I/O, zero `Date.now()`, zero `Math.random()`. The
 * tiling invariant is STRUCTURAL — enforced at `rotation.create`
 * via `rotationContiguity` (400 on a violation); the read path
 * trusts the tiling (the invariant test re-checks every rotation in
 * the state as defense-in-depth).
 *
 * STRICT PERIODIC FORM: the seed rotations are anchored one period
 * back from AS_OF (the `AS_OF 2026-10-28T12:00:00Z` anchor shared
 * with the aria/parley seeds), so the 9-week seed span
 * (2026-08-31 … 2026-10-28) fits inside one period and whoIsOnCall
 * never wraps to a later period — "9 weeks of incidents + rotations"
 * is literal. A 4-seat weekly rotation has period 4 weeks; anchored
 * at 2026-08-31 the span covers weeks 0..8 of the cycle.
 */

import type { NocturneOverride, NocturneRotation, NocturneUser } from "./types";

/** A seat of a rotation. */
export type RotationSeat = NocturneRotation["seats"][number];

/* ── pure helpers ─────────────────────────────────────────────────── */

/** The earliest seat start in the rotation (ms) — the tiling anchor. */
export function firstStartMs(rotation: NocturneRotation): number {
  return Math.min(...rotation.seats.map((s) => new Date(s.start).getTime()));
}

/**
 * The period of the tiling (ms): `n × shiftLengthMs` — one full
 * cycle of the seat list. The seed's tilings repeat this period
 * (k=1 geometry: span = (n−1)·shift, period = n·shift), so every
 * instant maps onto exactly one slot of the cycle.
 */
export function periodMs(rotation: NocturneRotation): number {
  const n = rotation.seats.length;
  if (n === 0) return rotation.shiftLengthMs;
  return n * rotation.shiftLengthMs;
}

/**
 * The SEAT whose window contains `now` — the plan's strict form:
 * `seats[i].start + shiftLengthMs == seats[(i+1) % n].start`, so
 * the n windows are disjoint, tile exactly one period, and repeat
 * every period. Exactly one window contains `now`.
 */
export function currentSeat(rotation: NocturneRotation, now: string): RotationSeat | null {
  if (rotation.seats.length === 0) return null;
  const p = periodMs(rotation);
  if (p <= 0) return null;
  const nowMs = new Date(now).getTime();
  const anchor = firstStartMs(rotation);
  const rel = ((nowMs - anchor) % p + p) % p;
  const slotIdx = Math.floor(rel / rotation.shiftLengthMs) % rotation.seats.length;
  return rotation.seats.find((s) => s.seatIndex === slotIdx) ?? null;
}

/* ── whoIsOnCall (§4.4, the plan's exact engine) ─────────────────── */

/**
 * 1. the current seat index: the seat whose [start, start + shift)
 *    contains `now` (deterministic — the tiling guarantees exactly
 *    one match);
 * 2. an override covering `now` FOR the seat's user → the override's
 *    userId (the cover); precedence: the LATEST override by
 *    `startsAt` (descending) wins;
 * 3. otherwise the seat's userId.
 */
export function whoIsOnCall(
  rotation: NocturneRotation,
  overrides: NocturneOverride[],
  now: string,
): string | null {
  const seat = currentSeat(rotation, now);
  if (!seat) return null;
  const nowMs = new Date(now).getTime();
  const candidates = overrides
    .filter((o) => o.tenantId === rotation.tenantId)
    .filter((o) => o.rotationId === rotation.id)
    .filter((o) => o.forUserId === seat.userId)
    .filter(
      (o) =>
        new Date(o.startsAt).getTime() <= nowMs &&
        nowMs < new Date(o.endsAt).getTime(),
    )
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
  if (candidates.length > 0) return candidates[0]!.userId;
  return seat.userId;
}

/**
 * The user on the CURRENT seat before overrides are applied (the
 * raw seat user; the override-resolved answer is `whoIsOnCall`).
 */
export function seatUser(rotation: NocturneRotation, now: string): string | null {
  return currentSeat(rotation, now)?.userId ?? null;
}

/* ── nextHandoff (§4.4) ───────────────────────────────────────────── */

/**
 * `nextHandoff(rotation, now)`: the start of the NEXT seat — the
 * seat after the current one in the cycle, anchored at the period
 * containing `now`. For a strict tiling the next seat's window start
 * is `currentSeatWindowStart + shiftLengthMs` (the wrap case lands in
 * the next period's first seat).
 */
export function nextHandoff(rotation: NocturneRotation, now: string): string | null {
  const seat = currentSeat(rotation, now);
  if (!seat) return null;
  const p = periodMs(rotation);
  if (p <= 0) return null;
  const nowMs = new Date(now).getTime();
  const anchor = firstStartMs(rotation);
  const rel = ((nowMs - anchor) % p + p) % p;
  const slotIdx = Math.floor(rel / rotation.shiftLengthMs) % rotation.seats.length;
  const periodStart = anchor + Math.floor((nowMs - anchor) / p) * p;
  // the next seat's window starts exactly one shift after the current
  // slot's start — for a wrap (slotIdx = n−1) that is the NEXT
  // period's first seat.
  const currentSlotStart = periodStart + slotIdx * rotation.shiftLengthMs;
  return new Date(currentSlotStart + rotation.shiftLengthMs).toISOString().replace(".000Z", "Z");
}

/**
 * The active rotation window at `now`: `{ seat, handoffAt }` — the
 * plan's schedule-aware computed surface (every incident read carries
 * the resolved `primaryOnCall` through this). `handoffAt` is the
 * next handoff (the start of the NEXT seat in the cycle, anchored at
 * the period containing `now`).
 */
export function activeRotationWindow(
  rotation: NocturneRotation,
  now: string,
): { seat: RotationSeat; handoffAt: string } | null {
  const seat = currentSeat(rotation, now);
  if (!seat) return null;
  return { seat, handoffAt: nextHandoff(rotation, now)! };
}

/**
 * Join the on-call resolution to a display name: `{ userId, name }`
 * (the API's oncall response shape; unknown users degrade to the raw
 * id with an empty name — never a crash).
 */
export function onCallDisplay(
  userId: string | null,
  users: NocturneUser[],
): { userId: string; name: string } | null {
  if (userId === null) return null;
  const u = users.find((x) => x.id === userId);
  return { userId, name: u?.name ?? userId };
}
