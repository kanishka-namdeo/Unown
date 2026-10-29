/**
 * Usage metering + plan quota gates for Nocturne.
 *
 * The 402 decision (the parley choice): this module returns
 * `quota_exceeded` verdicts; the API route maps them to HTTP 402
 * (payment-required semantics fit a plan cap — 429 is rate-limit
 * semantics and doesn't). The body's `error: "quota_exceeded"`
 * field is what the UI renders.
 *
 * Caps (plan §1): seats, services, rotations, runbooks per plan —
 * all 402-gated.
 */

import type { NocturneState, NocturneTenant } from "./types";
import { NOCTURNE_PLAN_CAPS } from "./types";

/* ── helpers ──────────────────────────────────────────────────────── */

function tenantById(state: NocturneState, tenantId: string): NocturneTenant {
  const t = state.tenants.find((x) => x.id === tenantId);
  if (!t) throw new Error(`unknown tenant: ${tenantId}`);
  return t;
}

/** The number of distinct memberships (seats used) for a tenant. */
export function seatsUsed(state: NocturneState, tenantId: string): number {
  const userIds = new Set(
    state.memberships.filter((m) => m.tenantId === tenantId).map((m) => m.userId),
  );
  return userIds.size;
}

/** The tenant's service count. */
export function servicesUsed(state: NocturneState, tenantId: string): number {
  return state.services.filter((s) => s.tenantId === tenantId).length;
}

/** The tenant's rotation count. */
export function rotationsUsed(state: NocturneState, tenantId: string): number {
  return state.rotations.filter((r) => r.tenantId === tenantId).length;
}

/** The tenant's runbook count. */
export function runbooksUsed(state: NocturneState, tenantId: string): number {
  return state.runbooks.filter((r) => r.tenantId === tenantId).length;
}

export interface OverageInfo {
  seats: { used: number; cap: number; over: boolean };
  services: { used: number; cap: number; over: boolean };
  rotations: { used: number; cap: number; over: boolean };
  runbooks: { used: number; cap: number; over: boolean };
}

/**
 * The usage panel's input: each 402-cap field vs the plan cap and
 * whether it is over.
 */
export function overage(state: NocturneState, tenantId: string): OverageInfo {
  const tenant = tenantById(state, tenantId);
  const caps = NOCTURNE_PLAN_CAPS[tenant.plan];
  const seats = seatsUsed(state, tenantId);
  const services = servicesUsed(state, tenantId);
  const rotations = rotationsUsed(state, tenantId);
  const runbooks = runbooksUsed(state, tenantId);
  return {
    seats: { used: seats, cap: caps.seats, over: seats > caps.seats },
    services: { used: services, cap: caps.services, over: services > caps.services },
    rotations: { used: rotations, cap: caps.rotations, over: rotations > caps.rotations },
    runbooks: { used: runbooks, cap: caps.runbooks, over: runbooks > caps.runbooks },
  };
}

/**
 * The quota gates: `true` when the tenant may create one more of
 * the entity. The route maps `false` to the 402 `quota_exceeded`
 * body.
 */
export function canCreateService(state: NocturneState, tenantId: string): boolean {
  const cap = NOCTURNE_PLAN_CAPS[tenantById(state, tenantId).plan].services;
  return servicesUsed(state, tenantId) < cap;
}

export function canCreateRotation(state: NocturneState, tenantId: string): boolean {
  const cap = NOCTURNE_PLAN_CAPS[tenantById(state, tenantId).plan].rotations;
  return rotationsUsed(state, tenantId) < cap;
}

export function canCreateRunbook(state: NocturneState, tenantId: string): boolean {
  const cap = NOCTURNE_PLAN_CAPS[tenantById(state, tenantId).plan].runbooks;
  return runbooksUsed(state, tenantId) < cap;
}

/**
 * The seat-cap gate (the P1 overage fix): an invite landing on a
 * tenant at the plan's seat cap is REJECTED (the route maps it to
 * the 402 `quota_exceeded` body) — the seat count may not cross
 * `NOCTURNE_PLAN_CAPS[plan].seats`.
 */
export function canInvite(state: NocturneState, tenantId: string): boolean {
  const cap = NOCTURNE_PLAN_CAPS[tenantById(state, tenantId).plan].seats;
  return seatsUsed(state, tenantId) < cap;
}
