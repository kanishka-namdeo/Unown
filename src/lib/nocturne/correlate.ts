/**
 * The correlation engine for Nocturne (plan §4.2).
 *
 * A standalone alert (one NOT deduped into an existing logical
 * alert) gets correlated into an open incident when:
 *  - there is exactly ONE open incident (`triggered` or
 *    `acknowledged`) on the same `serviceId` AND the same
 *    `severity`;
 *  - the alert's `firedAt` is within `CORRELATION_WINDOW_MS`
 *    (5 minutes) of the incident's `triggeredAt`.
 *
 * On match: the alert's `incidentId` is set and a
 * `alert_correlated` timeline event is appended. Otherwise the
 * alert stays standalone (the caller's `alert.ingest` route
 * decides when a NEW incident is born — this engine only links
 * existing alerts to existing open incidents).
 *
 * PURE: zero I/O, zero `Date.now()`, zero `Math.random()`.
 */

import type {
  NocturneAlert,
  NocturneIncident,
  NocturneState,
  NocturneTimelineEvent,
} from "./types";

/** The correlation window (ms): 5 minutes from the incident's trigger. */
export const CORRELATION_WINDOW_MS = 3_600_000;

export interface CorrelateResult {
  alert: NocturneAlert;
  incident: NocturneIncident | null;
  correlated: boolean;
}

/**
 * `correlate(state, standaloneAlert, ctx)`:
 *
 * 1. Find open incidents (`triggered` | `acknowledged`) on the
 *    alert's `serviceId` with the alert's `severity`.
 * 2. If exactly one AND `|firedAt − triggeredAt| < CORRELATION_WINDOW_MS`:
 *    - set `alert.incidentId = incident.id` (copy-on-write);
 *    - append a `alert_correlated` timeline event (system actor).
 *    → `{ alert: linked, incident, correlated: true }`.
 * 3. Otherwise the alert stays standalone:
 *    → `{ alert, incident: null, correlated: false }`.
 */
export function correlate(
  state: NocturneState,
  alertId: string,
  ctx: { now(): string; nextId(prefix: string): string },
): { state: NocturneState; result: CorrelateResult } {
  const alert = state.alerts.find((a) => a.id === alertId);
  if (!alert) {
    // Unknown alert: return a no-op (defensive — the caller always
    // passes a valid id from mergeDedup).
    return {
      state,
      result: { alert: undefined as unknown as NocturneAlert, incident: null, correlated: false },
    };
  }

  // An alert that already has an incident is NOT standalone.
  if (alert.incidentId !== null) {
    const incident = state.incidents.find((i) => i.id === alert.incidentId) ?? null;
    return { state, result: { alert, incident, correlated: false } };
  }

  // Find open incidents on the same service + severity.
  const openIncidents = state.incidents.filter(
    (i) =>
      i.tenantId === alert.tenantId &&
      i.serviceId === alert.serviceId &&
      i.severity === alert.severity &&
      (i.status === "triggered" || i.status === "acknowledged"),
  );

  if (openIncidents.length !== 1) {
    // Zero or multiple open incidents: stay standalone.
    return { state, result: { alert, incident: null, correlated: false } };
  }

  const incident = openIncidents[0]!;
  const firedMs = new Date(alert.firedAt).getTime();
  const triggeredMs = new Date(incident.triggeredAt).getTime();
  const delta = Math.abs(firedMs - triggeredMs);

  if (delta >= CORRELATION_WINDOW_MS) {
    // Too far from the trigger: stay standalone.
    return { state, result: { alert, incident: null, correlated: false } };
  }

  // Correlate: set the alert's incidentId and append the timeline event.
  const linked: NocturneAlert = { ...alert, incidentId: incident.id };
  const eventId = ctx.nextId("evt");
  const event: NocturneTimelineEvent = {
    id: eventId,
    tenantId: incident.tenantId,
    incidentId: incident.id,
    kind: "alert_correlated",
    actorId: null,
    meta: { alertId: alert.id },
    at: ctx.now(),
  };
  const newState: NocturneState = {
    ...state,
    alerts: state.alerts.map((a) => (a.id === alert.id ? linked : a)),
    timeline: [...state.timeline, event],
  };
  return { state: newState, result: { alert: linked, incident, correlated: true } };
}
