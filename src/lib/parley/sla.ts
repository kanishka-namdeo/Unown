/**
 * Pure, explicit-`now` SLA math.
 *
 * `firstResponseDue` / `resolveDue` are due-date calculations from
 * `conv.createdAt` + the tenant's `SlaPolicy` target by priority.
 * `slaState` is the computed state given an explicit `now` — a
 * pure function of its inputs, no hidden clock.
 *
 * "at risk" = within 20% of the due window (remaining < 0.2 × target).
 * "breached" = past the due target with no reply (first-response) or
 * still open past the resolve target.
 *
 * The data-driven test (Northwind's free plan slower than Lumen's
 * team plan) lives in `seed.test.ts` — this module just consumes
 * whatever `SlaPolicy` it's given.
 */

import type { Conversation, Priority, SlaPolicy, Tenant } from "./types";

/** The at-risk band: 20% of the target window. */
export const AT_RISK_FRACTION = 0.2;

const HOURS_MS = 3_600_000;

/** The first-response due timestamp (ISO) for a conversation. */
export function firstResponseDue(conv: Conversation, tenant: Tenant): string {
  const targetHours = tenant.slas.firstResponseHours[conv.priority];
  const due = new Date(conv.createdAt).getTime() + targetHours * HOURS_MS;
  return new Date(due).toISOString().replace(".000Z", "Z");
}

/** The resolve due timestamp (ISO) for a conversation. */
export function resolveDue(conv: Conversation, tenant: Tenant): string {
  const targetHours = tenant.slas.resolveHours[conv.priority];
  const due = new Date(conv.createdAt).getTime() + targetHours * HOURS_MS;
  return new Date(due).toISOString().replace(".000Z", "Z");
}

export type SlaState = "met" | "ok" | "at_risk" | "breached";

/**
 * Compute the SLA state at the explicit `now` (ISO string).
 *
 * - A conv with `firstRespondedAt` set is past first-response: state
 *   is judged on the RESOLVE target from then on.
 * - "met" = the relevant target was met (first-response met, or
 *   conversation closed within the resolve target).
 * - "ok" = before the at-risk band.
 * - "at_risk" = within 20% of the due window.
 * - "breached" = past the due target with no reply / still open past
 *   resolve.
 */
export function slaState(conv: Conversation, tenant: Tenant, now: string): SlaState {
  const nowMs = new Date(now).getTime();

  if (conv.closedAt !== null) {
    // Closed: was it met? Check resolve target.
    const resolveTarget = tenant.slas.resolveHours[conv.priority] * HOURS_MS;
    const resolvedIn = new Date(conv.closedAt).getTime() - new Date(conv.createdAt).getTime();
    return resolvedIn <= resolveTarget ? "met" : "breached";
  }

  if (conv.firstRespondedAt !== null) {
    // Past first-response: judge on resolve target from createdAt.
    const resolveTargetMs = tenant.slas.resolveHours[conv.priority] * HOURS_MS;
    const remaining = new Date(conv.createdAt).getTime() + resolveTargetMs - nowMs;
    if (remaining < 0) return "breached";
    if (remaining < AT_RISK_FRACTION * resolveTargetMs) return "at_risk";
    return "ok";
  }

  // No reply yet: judge on first-response target.
  const frTargetMs = tenant.slas.firstResponseHours[conv.priority] * HOURS_MS;
  const remaining = new Date(conv.createdAt).getTime() + frTargetMs - nowMs;
  if (remaining < 0) return "breached";
  if (remaining < AT_RISK_FRACTION * frTargetMs) return "at_risk";
  return "ok";
}

/**
 * Format a millisecond remainder as a human-readable countdown string
 * (e.g. "2h 14m"). The live ticking chip's text — a pure function of
 * the explicit `now`.
 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/**
 * The remaining milliseconds for the active SLA target (first-response
 * if no reply yet, resolve if replied). Used by the live countdown chip.
 */
export function remainingMs(conv: Conversation, tenant: Tenant, now: string): number {
  const nowMs = new Date(now).getTime();
  const target = conv.firstRespondedAt !== null
    ? tenant.slas.resolveHours[conv.priority]
    : tenant.slas.firstResponseHours[conv.priority];
  return new Date(conv.createdAt).getTime() + target * HOURS_MS - nowMs;
}
