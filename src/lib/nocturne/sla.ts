/**
 * Pure, explicit-`now` SLA math for Nocturne (plan §4.5).
 *
 * `ackDue` / `resolveDue` are due-date calculations from the
 * incident's trigger/ack times + the tenant's per-severity targets
 * (a service's `slaOverride` wins over the tenant target — the
 * effective target is `override ?? tenant`). `slaState` is a pure
 * function of its inputs, no hidden clock.
 *
 * Invariants pinned by the tests:
 *  - a resolved incident's SLA state is FINAL (met | breached, never
 *    ok / at_risk);
 *  - a SNOOZED incident's timers are FROZEN — the snoozed interval
 *    does not count toward the SLA (risk list P1, the
 *    "snooze + un-snooze does not count toward the SLA" pin);
 *  - MTTA is computed ONLY over resolved incidents.
 */

import type {
  NocturneIncident,
  NocturneService,
  NocturneTenant,
  NocturneUser,
} from "./types";

/** The at-risk band: 20% of the target window (the plan's literal). */
export const AT_RISK_FRACTION = 0.2;

const MIN_MS = 60_000;

/**
 * The tenant's ack target (ms) for the incident's severity — the
 * service's `slaOverride` (minutes from ack to resolve) replaces the
 * tenant's resolve target when set; the ACK target is always the
 * tenant's.
 */
export function ackTargetMs(incident: NocturneIncident, tenant: NocturneTenant, service?: NocturneService): number {
  return tenant.slaMinutes[incident.severity].ack * MIN_MS;
}

/** The effective resolve target (ms): service override ?? tenant. */
export function resolveTargetMs(incident: NocturneIncident, tenant: NocturneTenant, service?: NocturneService): number {
  const override = service?.slaOverride?.[incident.severity];
  const minutes = override ?? tenant.slaMinutes[incident.severity].resolve;
  return minutes * MIN_MS;
}

/** The ack due instant (ISO): triggeredAt + the ack target. */
export function ackDue(incident: NocturneIncident, tenant: NocturneTenant, service?: NocturneService): string {
  const due = new Date(incident.triggeredAt).getTime() + ackTargetMs(incident, tenant, service);
  return new Date(due).toISOString().replace(".000Z", "Z");
}

/**
 * The resolve due instant (ISO): acknowledgedAt + the resolve target —
 * or triggeredAt + target while unacked (the plan's formula:
 * `acknowledgedAt ?? triggeredAt` + target).
 */
export function resolveDue(
  incident: NocturneIncident,
  tenant: NocturneTenant,
  service?: NocturneService,
): string {
  const base = incident.acknowledgedAt ?? incident.triggeredAt;
  const due = new Date(base).getTime() + resolveTargetMs(incident, tenant, service);
  return new Date(due).toISOString().replace(".000Z", "Z");
}

export type NocturneSlaState = "met" | "ok" | "at_risk" | "breached";

/**
 * The SLA state at the explicit `now` (ISO string).
 *
 * - resolved → FINAL: `met` when resolvedAt <= resolveDue, else
 *   `breached`.
 * - snoozed → the timers are FROZEN: the state is judged on the
 *   post-snooze budget (the snoozed interval is subtracted), so a
 *   legitimate snooze never trips a false-positive breach.
 * - acknowledged (open) → judged on the RESOLVE target;
 *   remaining < 0 → breached, < 0.2×target → at_risk, else ok.
 * - unacked → judged on the ACK target, same bands.
 */
export function slaState(
  incident: NocturneIncident,
  tenant: NocturneTenant,
  now: string,
  service?: NocturneService,
): NocturneSlaState {
  const nowMs = new Date(now).getTime();
  const rTarget = resolveTargetMs(incident, tenant, service);
  const aTarget = ackTargetMs(incident, tenant, service);

  if (incident.status === "resolved") {
    const dueMs =
      new Date(incident.acknowledgedAt ?? incident.triggeredAt).getTime() + rTarget;
    return new Date(incident.resolvedAt!).getTime() <= dueMs ? "met" : "breached";
  }

  // The snooze-freeze: the frozen interval (now - snoozedUntil, or
  // the whole snooze when still snoozed) is excluded from the budget.
  const snoozeFrozenMs =
    incident.snoozedUntil !== null
      ? Math.max(0, nowMs - new Date(incident.snoozedUntil).getTime())
      : 0;

  if (incident.acknowledgedAt !== null) {
    const baseMs = new Date(incident.acknowledgedAt).getTime();
    const remaining = baseMs + rTarget - nowMs - snoozeFrozenMs;
    if (remaining < 0) return "breached";
    if (remaining < AT_RISK_FRACTION * rTarget) return "at_risk";
    return "ok";
  }

  // Unacked: judge on the ACK target (the ack budget is not frozen —
  // an acked incident has already left the unacked state).
  const baseMs = new Date(incident.triggeredAt).getTime();
  const remaining = baseMs + aTarget - nowMs - snoozeFrozenMs;
  if (remaining < 0) return "breached";
  if (remaining < AT_RISK_FRACTION * aTarget) return "at_risk";
  return "ok";
}

/** The remaining ms on the incident's ACTIVE target (the KPI chip). */
export function remainingMs(
  incident: NocturneIncident,
  tenant: NocturneTenant,
  now: string,
  service?: NocturneService,
): number {
  const nowMs = new Date(now).getTime();
  const snoozeFrozenMs =
    incident.snoozedUntil !== null
      ? Math.max(0, nowMs - new Date(incident.snoozedUntil).getTime())
      : 0;
  if (incident.acknowledgedAt !== null) {
    const baseMs = new Date(incident.acknowledgedAt).getTime();
    return baseMs + resolveTargetMs(incident, tenant, service) - nowMs - snoozeFrozenMs;
  }
  const baseMs = new Date(incident.triggeredAt).getTime();
  return baseMs + ackTargetMs(incident, tenant, service) - nowMs - snoozeFrozenMs;
}

/* ── MTTA / MTTR (the resolved-only invariants) ──────────────────── */

/**
 * Mean time-to-ack (ms) — ONLY over resolved incidents whose
 * `acknowledgedAt` is set (the PBT invariant "MTTA/MTTR over
 * resolved only": unacked-resolved is impossible by the
 * ack-before-resolve invariant, but the input filter is pinned here
 * regardless). `null` when no resolved incident has an ack.
 */
export function meanTimeToAck(incidents: NocturneIncident[]): number | null {
  const eligible = incidents.filter(
    (i) => i.status === "resolved" && i.resolvedAt !== null && i.acknowledgedAt !== null,
  );
  if (eligible.length === 0) return null;
  const total = eligible.reduce(
    (acc, i) => acc + (new Date(i.acknowledgedAt!).getTime() - new Date(i.triggeredAt).getTime()),
    0,
  );
  return total / eligible.length;
}

/**
 * Mean time-to-resolve (ms) — ONLY over resolved incidents
 * (`resolvedAt !== null`). `null` when none.
 */
export function meanTimeToResolve(incidents: NocturneIncident[]): number | null {
  const eligible = incidents.filter((i) => i.status === "resolved" && i.resolvedAt !== null);
  if (eligible.length === 0) return null;
  const total = eligible.reduce(
    (acc, i) => acc + (new Date(i.resolvedAt!).getTime() - new Date(i.triggeredAt).getTime()),
    0,
  );
  return total / eligible.length;
}

/**
 * The SLA breach rate: the fraction of RESOLVED incidents whose
 * final SLA state is `breached` (0..1). `null` when no resolved
 * incidents.
 */
export function breachRate(
  incidents: NocturneIncident[],
  tenant: NocturneTenant,
  now: string,
  services: NocturneService[] = [],
): number | null {
  const serviceOf = new Map(services.map((s) => [s.id, s]));
  const resolved = incidents.filter((i) => i.status === "resolved" && i.resolvedAt !== null);
  if (resolved.length === 0) return null;
  const breached = resolved.filter(
    (i) => slaState(i, tenant, now, serviceOf.get(i.serviceId)) === "breached",
  ).length;
  return breached / resolved.length;
}

/**
 * On-call load: OPEN incidents (triggered | acknowledged | snoozed)
 * per paged user — the user currently on tier (via `resolvePageTarget`
 * callers) or the ack/resolution owner. Kept pure here: the caller
 * supplies the user id to count for each incident.
 */
export function onCallLoad(
  incidents: NocturneIncident[],
  pageTargetOf: (incident: NocturneIncident) => string | null,
  tenantUsers: NocturneUser[],
): Record<string, number> {
  const known = new Set(tenantUsers.map((u) => u.id));
  const load: Record<string, number> = {};
  for (const i of incidents) {
    if (i.status === "resolved") continue;
    const uid = pageTargetOf(i) ?? (i.status === "triggered" ? null : i.acknowledgedBy);
    if (!uid || !known.has(uid)) continue;
    load[uid] = (load[uid] ?? 0) + 1;
  }
  return load;
}
