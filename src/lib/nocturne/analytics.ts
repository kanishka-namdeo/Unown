/**
 * The analytics engine for Nocturne (plan §3.9 + the API's
 * `/nocturne/api/analytics` response shape).
 *
 * All functions are pure over `NocturneState` — no I/O, no
 * `Date.now()`. The caller (the API route) supplies the explicit
 * `now` and the tenant's `NocturneState` snapshot.
 *
 * Invariants pinned by tests (§5.4):
 *  - MTTA/MTTR are computed ONLY over resolved incidents
 *    (`resolvedAt !== null`);
 *  - the breach rate is the fraction of resolved incidents
 *    whose final SLA state is `breached` (0..1, `null` when
 *    no resolved incidents).
 */

import type {
  NocturneIncident,
  NocturneService,
  NocturneState,
  NocturneTenant,
  NocturneUser,
  Severity,
} from "./types";
import {
  breachRate as slaBreachRate,
  meanTimeToAck,
  meanTimeToResolve,
  onCallLoad as slaOnCallLoad,
} from "./sla";
import { resolvePageTarget } from "./escalation";
import { whoIsOnCall } from "./rotation";

/* ── the analytics response shape ────────────────────────────────── */

export interface AnalyticsResult {
  mttaMs: number | null;
  mttrMs: number | null;
  incidentsBySeverity: Record<Severity, number>;
  incidentsByService: Record<string, number>;
  breachRate: number | null;
  onCallLoad: Record<string, number>;
}

/* ── helpers ──────────────────────────────────────────────────────── */

/** Tenant-scoped incidents only (fail-closed tenancy, parley pattern). */
function tenantIncidents(state: NocturneState, tenantId: string): NocturneIncident[] {
  return state.incidents.filter((i) => i.tenantId === tenantId);
}

function tenantServices(state: NocturneState, tenantId: string): NocturneService[] {
  return state.services.filter((s) => s.tenantId === tenantId);
}

function tenantUsers(state: NocturneState, tenantId: string): NocturneUser[] {
  const ids = new Set(
    state.memberships.filter((m) => m.tenantId === tenantId).map((m) => m.userId),
  );
  // The "unknown user" case is handled by the caller's onCallLoad:
  // a paged target not in the tenant's user pool is dropped from
  // the load map. Here we return the tenant's known users so the
  // join can resolve names.
  return state.users.filter((u) => ids.has(u.id));
}

/**
 * Resolve the paged user id for an open incident: the current
 * escalation tier's page target (for triggered incidents), or
 * the `acknowledgedBy` user (for acknowledged / snoozed).
 * `null` when no target can be resolved.
 */
function pageTargetOf(
  incident: NocturneIncident,
  state: NocturneState,
  services: NocturneService[],
  now: string,
): string | null {
  if (incident.status === "resolved") return null;
  if (incident.status === "triggered") {
    const service = services.find((s) => s.id === incident.serviceId);
    if (!service?.escalationPolicy || service.escalationPolicy.tiers.length === 0)
      return null;
    const tier = service.escalationPolicy.tiers[incident.activeTierIndex ?? 0];
    if (!tier) return null;
    return resolvePageTarget(tier, service, state, now);
  }
  // acknowledged / snoozed: the ack owner is the paged user.
  return incident.acknowledgedBy;
}

/* ── the main analytics entry point ──────────────────────────────── */

/**
 * `analytics(state, tenantId, now)`:
 *
 * Computes the full analytics response for a tenant at the
 * explicit `now`:
 *  - `mttaMs` / `mttrMs` — mean time-to-ack / resolve (resolved
 *    only, `null` when no resolved incidents);
 *  - `incidentsBySeverity` — count per severity (all incidents);
 *  - `incidentsByService` — count per service id (all incidents);
 *  - `breachRate` — fraction of resolved incidents whose final
 *    SLA state is `breached` (`null` when no resolved incidents);
 *  - `onCallLoad` — open incidents per paged user id (triggered
 *    → current tier target; acknowledged/snoozed → ack owner).
 */
export function analytics(
  state: NocturneState,
  tenantId: string,
  now: string,
): AnalyticsResult {
  const incidents = tenantIncidents(state, tenantId);
  const services = tenantServices(state, tenantId);
  const users = tenantUsers(state, tenantId);
  const serviceOf = new Map(services.map((s) => [s.id, s]));

  // MTTA / MTTR (resolved only — the PBT invariant "MTTA/MTTR
  // over resolved only").
  const mttaMs = meanTimeToAck(incidents);
  const mttrMs = meanTimeToResolve(incidents);

  // Breach rate (resolved only).
  const tenant = state.tenants.find((t) => t.id === tenantId) as NocturneTenant;
  const br = slaBreachRate(incidents, tenant, now, services);

  // Incidents by severity (all incidents, not just resolved).
  const bySeverity: Record<Severity, number> = { sev1: 0, sev2: 0, sev3: 0, sev4: 0 };
  for (const i of incidents) bySeverity[i.severity]! += 1;

  // Incidents by service (all incidents).
  const byService: Record<string, number> = {};
  for (const i of incidents) {
    byService[i.serviceId] = (byService[i.serviceId] ?? 0) + 1;
  }

  // On-call load: open incidents per paged user.
  const load: Record<string, number> = slaOnCallLoad(
    incidents,
    (i) => pageTargetOf(i, state, services, now),
    users,
  );

  return {
    mttaMs,
    mttrMs,
    incidentsBySeverity: bySeverity,
    incidentsByService: byService,
    breachRate: br,
    onCallLoad: load,
  };
}

/* ── the "open incidents" KPI surface (the dashboard's red chip) ─── */

/**
 * The number of OPEN incidents (`triggered` | `acknowledged` |
 * `snoozed`) for a tenant — the dashboard's primary KPI.
 */
export function openIncidentCount(state: NocturneState, tenantId: string): number {
  return tenantIncidents(state, tenantId).filter(
    (i) => i.status === "triggered" || i.status === "acknowledged" || i.status === "snoozed",
  ).length;
}

/**
 * The tenant's services with the currently-on-call user resolved
 * (the plan's `GET /nocturne/api/services` computed
 * `primaryOnCall` field).
 */
export function servicesWithOnCall(
  state: NocturneState,
  tenantId: string,
  now: string,
): Array<{
  service: NocturneService;
  primaryOnCall: { userId: string; name: string } | null;
}> {
  const services = tenantServices(state, tenantId);
  const overrides = state.overrides.filter((o) => o.tenantId === tenantId);
  const users = tenantUsers(state, tenantId);

  return services.map((service) => {
    let primaryOnCall: { userId: string; name: string } | null = null;
    if (service.rotationId) {
      const rotation = state.rotations.find((r) => r.id === service.rotationId);
      if (rotation) {
        const uid = whoIsOnCall(rotation, overrides, now);
        if (uid !== null) {
          const u = users.find((x) => x.id === uid);
          primaryOnCall = { userId: uid, name: u?.name ?? uid };
        }
      }
    }
    return { service, primaryOnCall };
  });
}
