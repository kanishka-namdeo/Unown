/**
 * Seat / pipeline / sequence caps + quota accounting.
 *
 * The 402 decision (plan §3's error body): this module reports
 * `quota_exceeded` verdicts; the API route maps them to HTTP 402.
 */

import type { AriaQuota, AriaState, AriaTenant } from "./types";
import { ARIA_PLAN_CAPS } from "./types";

/* ── helpers ──────────────────────────────────────────────────────── */

function tenantOf(state: AriaState, tenantId: string): AriaTenant {
  const t = state.tenants.find((x) => x.id === tenantId);
  if (!t) throw new Error(`unknown tenant: ${tenantId}`);
  return t;
}

/** The number of distinct memberships (seats used) for a tenant. */
export function seatsUsed(state: AriaState, tenantId: string): number {
  const userIds = new Set(
    state.memberships.filter((m) => m.tenantId === tenantId).map((m) => m.userId),
  );
  return userIds.size;
}

/** The tenant's pipeline count. */
export function pipelinesUsed(state: AriaState, tenantId: string): number {
  return state.pipelines.filter((p) => p.tenantId === tenantId).length;
}

/** The tenant's sequence count. */
export function sequencesUsed(state: AriaState, tenantId: string): number {
  return state.sequences.filter((s) => s.tenantId === tenantId).length;
}

export interface OverageInfo {
  seats: { used: number; cap: number; over: boolean };
  pipelines: { used: number; cap: number; over: boolean };
  sequences: { used: number; cap: number; over: boolean };
}

/** The usage panel's input: seats/pipelines/sequences vs the plan caps. */
export function overage(state: AriaState, tenantId: string): OverageInfo {
  const tenant = tenantOf(state, tenantId);
  const caps = ARIA_PLAN_CAPS[tenant.plan];
  const seats = seatsUsed(state, tenantId);
  const pipelines = pipelinesUsed(state, tenantId);
  const sequences = sequencesUsed(state, tenantId);
  return {
    seats: { used: seats, cap: caps.seats, over: seats > caps.seats },
    pipelines: { used: pipelines, cap: caps.pipelines, over: pipelines > caps.pipelines },
    sequences: { used: sequences, cap: caps.sequences, over: sequences > caps.sequences },
  };
}

/* ── quota gates (the 402 verdicts) ──────────────────────────────── */

/** `true` when the tenant may add another seat (an invite landing). */
export function canInvite(state: AriaState, tenantId: string): boolean {
  const cap = ARIA_PLAN_CAPS[tenantOf(state, tenantId).plan].seats;
  return seatsUsed(state, tenantId) < cap;
}

/** `true` when the tenant may create another pipeline. */
export function canCreatePipeline(state: AriaState, tenantId: string): boolean {
  const cap = ARIA_PLAN_CAPS[tenantOf(state, tenantId).plan].pipelines;
  return pipelinesUsed(state, tenantId) < cap;
}

/** `true` when the tenant may create another sequence. */
export function canCreateSequence(state: AriaState, tenantId: string): boolean {
  const cap = ARIA_PLAN_CAPS[tenantOf(state, tenantId).plan].sequences;
  return sequencesUsed(state, tenantId) < cap;
}

/* ── per-rep quota accounting ────────────────────────────────────── */

/**
 * The quarter containing ISO date `d` (UTC): `{ start, end }` ISO
 * strings on the quarter boundaries (Jan 1 / Apr 1 / Jul 1 / Oct 1).
 */
export function quarterOf(d: string): { start: string; end: string } {
  const t = new Date(d).getTime();
  const dt = new Date(t);
  const q = Math.floor(dt.getUTCMonth() / 3);
  const year = dt.getUTCFullYear();
  const start = new Date(Date.UTC(year, q * 3, 1)).toISOString().replace(".000Z", "Z");
  const end = new Date(Date.UTC(year, q * 3 + 3, 1)).toISOString().replace(".000Z", "Z");
  return { start, end };
}

/** The quota row for a user in a period (the current quarter of `now`). */
export function quotaFor(
  state: AriaState,
  tenantId: string,
  userId: string,
  now: string,
): AriaQuota | undefined {
  const { start, end } = quarterOf(now);
  return state.quotas.find(
    (q) => q.tenantId === tenantId && q.userId === userId && q.periodStart === start && q.periodEnd === end,
  );
}

/**
 * The rep's booked pipeline in the quarter: the sum of OPEN deals
 * whose expectedCloseDate falls in `quarter` + WON deals closed in
 * `quarter`. Pure, explicit `now` not needed (the quarter is given).
 */
export function quotaProgress(
  state: AriaState,
  tenantId: string,
  userId: string,
  quarter: { start: string; end: string },
): { target: number; booked: number; won: number; remaining: number } {
  const tenant = tenantOf(state, tenantId);
  const target = tenant.quotas[userId] ?? 0;
  const deals = state.deals.filter((d) => d.tenantId === tenantId && d.ownerId === userId);
  const inQuarter = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= new Date(quarter.start).getTime() && t < new Date(quarter.end).getTime();
  };
  const won = deals
    .filter((d) => d.closedAt !== null && d.forecastCategory === "closed")
    .filter((d) => inQuarter(d.closedAt!))
    .reduce((acc, d) => acc + d.amount, 0);
  const booked = deals
    .filter((d) => d.closedAt === null && inQuarter(d.expectedCloseDate))
    .reduce((acc, d) => acc + d.amount, 0);
  return { target, booked, won, remaining: Math.max(0, target - won - booked) };
}
