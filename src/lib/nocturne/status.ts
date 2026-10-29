/**
 * The public status page's computed surface for Nocturne
 * (plan §3.7 + §1 "The public status page is the one exception:
 * it reads ONLY its tenant's `services` / `components` / active
 * `incidents` by slug, never users or schedules").
 *
 * The status page exposes a LEAN view: component rows with their
 * own `status` field (independent of the incident state, used
 * for manual maintenance windows) + a list of active incidents
 * (triggered | acknowledged | snoozed — resolved incidents are
 * excluded). The response NEVER leaks user ids, emails, or
 * schedule details (the risk list's P1 "Status page leak"
 * mitigation, pinned by `status.test.ts`).
 *
 * PURE: zero I/O, zero `Date.now()`, zero `Math.random()`.
 */

import type {
  NocturneComponent,
  NocturneComponentStatus,
  NocturneIncident,
  NocturneService,
  NocturneState,
  NocturneTenant,
} from "./types";

/* ── the public response shape ───────────────────────────────────── */

/**
 * The public status page's incident view — the fields that are
 * safe to expose without authentication (no user ids, no
 * acknowledgedBy / resolvedBy, no schedule detail).
 */
export interface PublicIncidentView {
  id: string;
  title: string;
  severity: NocturneIncident["severity"];
  status: NocturneIncident["status"];
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  /** The service's public name (no internal id). */
  serviceName: string;
}

export interface PublicComponentView {
  id: string;
  name: string;
  status: NocturneComponentStatus;
  lastChangedAt: string | null;
  note: string | null;
}

export interface PublicStatusResult {
  tenant: { name: string; slug: string };
  components: PublicComponentView[];
  activeIncidents: PublicIncidentView[];
  /** The last component status change in this tenant (ISO) or
   *  null when no component has ever changed status. Used
   *  for the page's "last updated" chip. */
  lastUpdated: string | null;
}

/* ── helpers ─────────────────────────────────────────────────────── */

/**
 * Find a tenant by slug. Returns `null` when the slug is unknown
 * (the route maps this to the 404 response).
 */
export function tenantBySlug(state: NocturneState, slug: string): NocturneTenant | null {
  return state.tenants.find((t) => t.slug === slug) ?? null;
}

/**
 * The active incident statuses (the plan's "active = triggered or
 * acknowledged or snoozed").
 */
function isActiveIncident(incident: NocturneIncident): boolean {
  return (
    incident.status === "triggered" ||
    incident.status === "acknowledged" ||
    incident.status === "snoozed"
  );
}

/**
 * The latest `lastChangedAt` among a tenant's components, or
 * `null` when no component has a recorded change.
 */
function lastChangedAmong(components: NocturneComponent[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const c of components) {
    if (c.lastChangedAt === null) continue;
    const ms = new Date(c.lastChangedAt).getTime();
    if (ms > latestMs) {
      latestMs = ms;
      latest = c.lastChangedAt;
    }
  }
  return latest;
}

/* ── the main computed surface ───────────────────────────────────── */

/**
 * `statusForSlug(state, slug)`: the public status page's computed
 * surface for the tenant identified by `slug`.
 *
 * Returns `null` when the slug is unknown (→ 404). Otherwise
 * returns the `PublicStatusResult` with:
 *  - `tenant` — name + slug only (no plan, no SLA, no id);
 *  - `components` — the tenant's components in their stored order;
 *  - `activeIncidents` — open incidents with the public fields only;
 *  - `lastUpdated` — the latest component `lastChangedAt`.
 */
export function statusForSlug(state: NocturneState, slug: string): PublicStatusResult | null {
  const tenant = tenantBySlug(state, slug);
  if (!tenant) return null;

  const components: PublicComponentView[] = state.components
    .filter((c) => c.tenantId === tenant.id)
    .map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      lastChangedAt: c.lastChangedAt,
      note: c.note,
    }));

  const serviceNames = new Map(
    state.services
      .filter((s) => s.tenantId === tenant.id)
      .map((s) => [s.id, s.name] as const),
  );

  const activeIncidents: PublicIncidentView[] = state.incidents
    .filter((i) => i.tenantId === tenant.id && isActiveIncident(i))
    .map((i) => ({
      id: i.id,
      title: i.title,
      severity: i.severity,
      status: i.status,
      triggeredAt: i.triggeredAt,
      acknowledgedAt: i.acknowledgedAt,
      resolvedAt: i.resolvedAt,
      serviceName: serviceNames.get(i.serviceId) ?? "Unknown service",
    }));

  return {
    tenant: { name: tenant.name, slug: tenant.slug },
    components,
    activeIncidents,
    lastUpdated: lastChangedAmong(
      state.components.filter((c) => c.tenantId === tenant.id),
    ),
  };
}

/**
 * Update a component's status (the manual maintenance-window
 * override, `POST /nocturne/api/components/[id]/status`).
 *
 * Copy-on-write: the `components` array is replaced; the prior
 * snapshot is untouched. `lastChangedAt` is stamped with
 * `ctx.now()` on every update.
 *
 * Returns `{ state, component }` on success;
 * `{ state, error }` when the component id is unknown or belongs
 * to a different tenant than the caller's (404).
 */
export interface UpdateComponentCtx {
  now(): string;
}

export function updateComponentStatus(
  state: NocturneState,
  componentId: string,
  status: NocturneComponentStatus,
  note: string | null,
  tenantId: string,
  ctx: UpdateComponentCtx,
):
  | { state: NocturneState; component: NocturneComponent }
  | { state: NocturneState; error: string } {
  const component = state.components.find((c) => c.id === componentId);
  if (!component) {
    return { state, error: "unknown component" };
  }
  if (component.tenantId !== tenantId) {
    // Cross-tenant read → the route maps this to a 404 (never a 403).
    return { state, error: "unknown component" };
  }

  const updated: NocturneComponent = {
    ...component,
    status,
    note,
    lastChangedAt: ctx.now(),
  };
  const newState: NocturneState = {
    ...state,
    components: state.components.map((c) => (c.id === componentId ? updated : c)),
  };
  return { state: newState, component: updated };
}
