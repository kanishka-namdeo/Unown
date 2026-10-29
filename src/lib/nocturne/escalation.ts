/**
 * The escalation engine for Nocturne (plan §4.3).
 *
 * Every open incident carries `activeTierIndex` (0-based, starts
 * at 0 when triggered). Each tier's `waitMinutes` is the silence
 * window before the NEXT tier is paged. `tickEscalation` is
 * clock-injected and deterministic: two calls with the same
 * inputs produce the same outputs (the fugue EngineCtx
 * determinism contract).
 *
 * Invariants (PBT pins, §5.4):
 *  - escalation ONLY fires while the incident is `triggered`
 *    (never while `acknowledged` or `snoozed` — the "escalation
 *    only while unacked" invariant);
 *  - a resolved incident's `activeTierIndex` is `null` (final);
 *  - the last tier never advances (the `currentTier <
 *    tiers.length - 1` guard).
 */

import type {
  NocturneIncident,
  NocturneService,
  NocturneState,
  NocturneTimelineEvent,
  NocturneUser,
} from "./types";
import { whoIsOnCall } from "./rotation";
import type { NocturneOverride, NocturneRotation } from "./types";

/**
 * The engine context for escalation ticks: the injected clock and
 * id generator (fugue EngineCtx pattern, keeps the module pure).
 */
export interface EscalationCtx {
  now(): string;
  nextId(prefix: string): string;
}

export interface TickResult {
  incident: NocturneIncident;
  fired: boolean;
}

/**
 * `tickEscalation(state, incidentId, ctx)`:
 *
 * 1. `incident.status === "resolved"` → no-op (the terminal is
 *    final; the `activeTierIndex` is already `null`).
 * 2. `incident.status !== "triggered"` (i.e. `acknowledged` or
 *    `snoozed`) → no-op. The escalation ONLY fires while unacked
 *    (the PBT invariant "escalation only while unacked").
 * 3. Compute `lastTick = incident.lastEscalatedAt ??
 *    incident.triggeredAt`; `currentTier =
 *    incident.activeTierIndex ?? 0`.
 * 4. If `(now - lastTick) >= tiers[currentTier].waitMinutes *
 *    60_000` AND `currentTier < tiers.length - 1`:
 *    - `activeTierIndex = currentTier + 1`
 *    - `lastEscalatedAt = now`
 *    - append an `escalated` timeline event
 *    → `fired: true`.
 * 5. Otherwise → `fired: false` (no state change).
 *
 * Returns `{ state, result: { incident, fired } }`.
 */
export function tickEscalation(
  state: NocturneState,
  incidentId: string,
  ctx: EscalationCtx,
): { state: NocturneState; result: TickResult } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    // Unknown incident: no-op (defensive).
    return { state, result: { incident: undefined as unknown as NocturneIncident, fired: false } };
  }

  // Terminal: resolved is final.
  if (incident.status === "resolved") {
    return { state, result: { incident, fired: false } };
  }

  // Invariant: escalation ONLY fires while the incident is unacked
  // (status === "triggered"). Acked / snoozed → no-op.
  if (incident.status !== "triggered") {
    return { state, result: { incident, fired: false } };
  }

  // Look up the service and its escalation policy.
  const service = state.services.find((s) => s.id === incident.serviceId);
  if (!service || !service.escalationPolicy || service.escalationPolicy.tiers.length === 0) {
    // No policy or empty tiers: nothing to escalate.
    return { state, result: { incident, fired: false } };
  }
  const tiers = service.escalationPolicy.tiers;

  const currentTier = incident.activeTierIndex ?? 0;
  const lastTick = incident.lastEscalatedAt ?? incident.triggeredAt;
  const lastTickMs = new Date(lastTick).getTime();
  const nowMs = new Date(ctx.now()).getTime();
  const waitMs = tiers[currentTier]!.waitMinutes * 60_000;

  // No advance if at the last tier or the wait window hasn't elapsed.
  if (currentTier >= tiers.length - 1) {
    return { state, result: { incident, fired: false } };
  }
  if (nowMs - lastTickMs < waitMs) {
    return { state, result: { incident, fired: false } };
  }

  // Fire the tick: advance the tier, set lastEscalatedAt, append timeline.
  const newTier = currentTier + 1;
  const advanced: NocturneIncident = {
    ...incident,
    activeTierIndex: newTier,
    lastEscalatedAt: ctx.now(),
  };
  const eventId = ctx.nextId("evt");
  const event: NocturneTimelineEvent = {
    id: eventId,
    tenantId: incident.tenantId,
    incidentId: incident.id,
    kind: "escalated",
    actorId: null,
    meta: { tier: newTier },
    at: ctx.now(),
  };
  const newState: NocturneState = {
    ...state,
    incidents: state.incidents.map((i) => (i.id === incident.id ? advanced : i)),
    timeline: [...state.timeline, event],
  };
  return { state: newState, result: { incident: advanced, fired: true } };
}

/**
 * `resolvePageTarget(tier, service, state, now)`: who gets paged
 * for a given escalation tier (the plan's tier-kind resolution).
 *
 * - `rotation` → the `primaryOnCall` seat at `now` for the
 *   service's rotation (overrides applied via `whoIsOnCall`).
 * - `user` → the fixed user (the tier's `userId` field —
 *   NOT present on the type but the engine treats `userId` as
 *   the fixed target when kind is `user`; the type omits it so
 *   we read it from the tier object dynamically).
 * - `manager` → the first owner-role user of the tenant; else
 *   the first admin (deterministic tie-break: by `createdAt`
 *   ascending, then by user id ascending).
 *
 * Returns the user id, or `null` when the target cannot be
 * resolved (e.g. no rotation set on the service).
 */
export function resolvePageTarget(
  tier: NocturneService["escalationPolicy"]["tiers"][number],
  service: NocturneService,
  state: NocturneState,
  now: string,
): string | null {
  switch (tier.kind) {
    case "rotation": {
      if (!service.rotationId) return null;
      const rotation = state.rotations.find((r) => r.id === service.rotationId);
      if (!rotation) return null;
      const tenantOverrides = state.overrides.filter((o) => o.tenantId === service.tenantId);
      return whoIsOnCall(rotation, tenantOverrides, now);
    }
    case "user": {
      // The fixed user is the tier's `userId` (the type doesn't
      // carry it as a named field in the schema — it's a dynamic
      // key on the tier object).
      const uid = (tier as unknown as { userId?: string }).userId;
      return uid ?? null;
    }
    case "manager": {
      return resolveManager(state, service.tenantId);
    }
    default:
      return null;
  }
}

/**
 * `resolveManager(state, tenantId)`: the tenant's first owner
 * (by `createdAt` ascending, then by user id ascending); else
 * the first admin (same tie-break). Returns `null` when neither
 * exists.
 */
export function resolveManager(state: NocturneState, tenantId: string): string | null {
  const membershipOf = new Map(
    state.memberships.filter((m) => m.tenantId === tenantId).map((m) => [m.userId, m.role]),
  );
  const users = state.users.filter((u) => membershipOf.has(u.id));
  const owners = users.filter((u) => membershipOf.get(u.id) === "owner");
  const admin = users.filter((u) => membershipOf.get(u.id) === "admin");
  const pool = owners.length > 0 ? owners : admin;
  if (pool.length === 0) return null;
  // Deterministic: sort by createdAt ascending, then id ascending.
  const sorted = [...pool].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return sorted[0]!.id;
}
