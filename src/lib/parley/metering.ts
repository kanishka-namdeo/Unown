/**
 * Usage metering + plan quota gates.
 *
 * The 402 vs 429 decision (Step 10's "pick one, document it, test it"):
 * this module returns a `quota_exceeded` body shape; the API route maps
 * it to HTTP 402 (payment-required semantics fit a plan cap — 429 is
 * rate-limit semantics and doesn't). The body's `error: "quota_exceeded"`
 * field is what the UI renders; the status code is the documented choice.
 */

import type { Conversation, ParleyState, Tenant } from "./types";
import { PLAN_CAPS } from "./types";

/* ── helpers ──────────────────────────────────────────────────────── */

function tenantById(state: ParleyState, tenantId: string): Tenant {
  const t = state.tenants.find((x) => x.id === tenantId);
  if (!t) throw new Error(`unknown tenant: ${tenantId}`);
  return t;
}

/**
 * The count of conversations in the current calendar month for a
 * tenant, at the explicit `now`. "Current month" means the month
 * of `now` (the 47/50 Northwind fixture is pinned against a known
 * `AS_OF`).
 */
export function conversationsThisMonth(state: ParleyState, tenantId: string, now: string): number {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return state.conversations.filter((c) => {
    if (c.tenantId !== tenantId) return false;
    const cd = new Date(c.createdAt);
    return cd.getUTCFullYear() === y && cd.getUTCMonth() === m;
  }).length;
}

/** The number of distinct memberships (seats used) for a tenant. */
export function seatsUsed(state: ParleyState, tenantId: string): number {
  const userIds = new Set(state.memberships.filter((m) => m.tenantId === tenantId).map((m) => m.userId));
  return userIds.size;
}

export interface OverageInfo {
  convos: { used: number; cap: number; over: boolean };
  seats: { used: number; cap: number; over: boolean };
}

/**
 * The usage panel's input: conversations this month vs the plan cap,
 * seats used vs the seat cap, and whether either is over.
 *
 * Northwind's free plan at 47/50 → `over: false` but near — the
 * seed makes this the "near its cap — show the overage state"
 * fixture; the OVER state is reached by a test that adds one more.
 */
export function overage(state: ParleyState, tenantId: string, now: string): OverageInfo {
  const tenant = tenantById(state, tenantId);
  const caps = PLAN_CAPS[tenant.plan];
  const convosUsed = conversationsThisMonth(state, tenantId, now);
  const seatsUsedN = seatsUsed(state, tenantId);
  return {
    convos: { used: convosUsed, cap: caps.convosPerMonth, over: convosUsed > caps.convosPerMonth },
    seats: { used: seatsUsedN, cap: caps.seats, over: seatsUsedN > caps.seats },
  };
}

/**
 * The quota gate: `true` when the tenant may create another
 * conversation this month. The route maps `false` to the 402
 * `quota_exceeded` body.
 */
export function canCreate(state: ParleyState, tenantId: string, now: string): boolean {
  const tenant = tenantById(state, tenantId);
  const cap = PLAN_CAPS[tenant.plan].convosPerMonth;
  return conversationsThisMonth(state, tenantId, now) < cap;
}

/**
 * Open conversations per assignee (the usage panel + the analytics
 * per-agent chart share this). Unassigned convos get the key `"__unassigned"`.
 */
export function perAgentLoad(state: ParleyState, tenantId: string): Record<string, number> {
  const open = state.conversations.filter(
    (c: Conversation) => c.tenantId === tenantId && c.status === "open",
  );
  const load: Record<string, number> = {};
  for (const c of open) {
    const key = c.assigneeId ?? "__unassigned";
    load[key] = (load[key] ?? 0) + 1;
  }
  return load;
}
