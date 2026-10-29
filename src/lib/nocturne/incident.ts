/**
 * The incident lifecycle engine for Nocturne (plan §4.6).
 *
 * State machine (terminals are final):
 *
 * ```
 * triggered → acknowledged → resolved
 *    │              │
 *    │              └→ snoozed → acknowledged (on snooze expiry, auto)
 *    └→ resolved (direct, for sev4 informational)
 * ```
 *
 * - `ack` is only valid from `triggered` or `snoozed`.
 * - `resolve` is only valid from `acknowledged` — the PBT
 *   invariant "ack-before-resolve".
 * - `snooze` is only valid from `triggered` or `acknowledged`.
 * - A `resolved` incident NEVER transitions (terminal is final).
 *
 * Every valid transition appends exactly one
 * `NocturneTimelineEvent` row (the event's `at` is `ctx.now()`).
 * The timeline is append-only — the copy-on-write contract.
 */

import type {
  NocturneIncident,
  NocturneNote,
  NocturneState,
  NocturneTimelineEvent,
} from "./types";
import { newNoteId } from "./ids";

export interface IncidentCtx {
  now(): string;
  nextId(prefix: string): string;
}

export type TransitionError =
  | { ok: false; error: string }
  | { ok: true };

/* ── internal: append a timeline event (copy-on-write) ───────────── */

function appendTimeline(
  state: NocturneState,
  incident: NocturneIncident,
  kind: NocturneTimelineEvent["kind"],
  actorId: string | null,
  meta: Record<string, unknown>,
  ctx: IncidentCtx,
): NocturneState {
  const event: NocturneTimelineEvent = {
    id: ctx.nextId("evt"),
    tenantId: incident.tenantId,
    incidentId: incident.id,
    kind,
    actorId,
    meta,
    at: ctx.now(),
  };
  return { ...state, timeline: [...state.timeline, event] };
}

/* ── ack ──────────────────────────────────────────────────────────── */

/**
 * Acknowledge an incident. Valid from `triggered` or `snoozed`.
 * Sets `status: "acknowledged"`, `acknowledgedAt`, `acknowledgedBy`,
 * clears `activeTierIndex` (an acked incident never escalates),
 * and appends an `acknowledged` timeline event.
 */
export function ackIncident(
  state: NocturneState,
  incidentId: string,
  userId: string,
  note: string | undefined,
  ctx: IncidentCtx,
): { state: NocturneState; result: NocturneIncident } | { state: NocturneState; result: TransitionError } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    return {
      state,
      result: { ok: false, error: "unknown incident" },
    };
  }

  if (incident.status === "resolved") {
    return { state, result: { ok: false, error: "cannot ack a resolved incident" } };
  }
  // Already acknowledged: idempotent no-op (return the incident as-is).
  if (incident.status === "acknowledged") {
    return { state, result: incident };
  }

  // Valid: from triggered or snoozed.
  const acked: NocturneIncident = {
    ...incident,
    status: "acknowledged",
    acknowledgedAt: ctx.now(),
    acknowledgedBy: userId,
    activeTierIndex: null,
  };
  let newState: NocturneState = {
    ...state,
    incidents: state.incidents.map((i) => (i.id === incident.id ? acked : i)),
  };
  newState = appendTimeline(newState, acked, "acknowledged", userId, note ? { note } : {}, ctx);
  return { state: newState, result: acked };
}

/* ── resolve ──────────────────────────────────────────────────────── */

/**
 * Resolve an incident. Valid ONLY from `acknowledged`
 * (the PBT invariant "ack-before-resolve").
 * Sets `status: "resolved"`, `resolvedAt`, `resolvedBy`,
 * `activeTierIndex: null`, and appends a `resolved` timeline event.
 * The optional `postmortemBody` is handled by the caller's
 * `postmortem.ts` engine — this function only handles the
 * incident row + timeline.
 */
export function resolveIncident(
  state: NocturneState,
  incidentId: string,
  userId: string,
  ctx: IncidentCtx,
): { state: NocturneState; result: NocturneIncident } | { state: NocturneState; result: TransitionError } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    return { state, result: { ok: false, error: "unknown incident" } };
  }

  // Terminal: already resolved is a no-op (idempotent).
  if (incident.status === "resolved") {
    return { state, result: incident };
  }

  // Invariant: resolve is only valid from `acknowledged`.
  if (incident.status !== "acknowledged") {
    return {
      state,
      result: {
        ok: false,
        error: `cannot resolve from "${incident.status}" — the incident must be acknowledged first (ack-before-resolve)`,
      },
    };
  }

  const resolved: NocturneIncident = {
    ...incident,
    status: "resolved",
    resolvedAt: ctx.now(),
    resolvedBy: userId,
    activeTierIndex: null,
  };
  let newState: NocturneState = {
    ...state,
    incidents: state.incidents.map((i) => (i.id === incident.id ? resolved : i)),
  };
  newState = appendTimeline(newState, resolved, "resolved", userId, {}, ctx);
  return { state: newState, result: resolved };
}

/* ── snooze ───────────────────────────────────────────────────────── */

/**
 * Snooze an incident. Valid from `triggered` or `acknowledged`.
 * Sets `status: "snoozed"` and `snoozedUntil`, and appends a
 * `snoozed` timeline event. A resolved incident CANNOT be
 * snoozed (terminal is final).
 */
export function snoozeIncident(
  state: NocturneState,
  incidentId: string,
  userId: string,
  until: string,
  ctx: IncidentCtx,
): { state: NocturneState; result: NocturneIncident } | { state: NocturneState; result: TransitionError } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    return { state, result: { ok: false, error: "unknown incident" } };
  }

  if (incident.status === "resolved") {
    return { state, result: { ok: false, error: "cannot snooze a resolved incident" } };
  }

  const snoozed: NocturneIncident = {
    ...incident,
    status: "snoozed",
    snoozedUntil: until,
  };
  let newState: NocturneState = {
    ...state,
    incidents: state.incidents.map((i) => (i.id === incident.id ? snoozed : i)),
  };
  newState = appendTimeline(newState, snoozed, "snoozed", userId, { until }, ctx);
  return { state: newState, result: snoozed };
}

/**
 * The auto-un-snooze: when `now >= snoozedUntil`, the incident
 * transitions back to `acknowledged` (if it was acked before the
 * snooze) or stays `triggered` if it wasn't. This is the plan's
 * `snoozed → acknowledged (on snooze expiry, auto)` transition.
 * Returns the updated state + incident when a transition fired;
 * the original state when the snooze has not yet expired.
 */
export function autoUnSnooze(
  state: NocturneState,
  incidentId: string,
  ctx: IncidentCtx,
): { state: NocturneState; incident: NocturneIncident; fired: boolean } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident || incident.status !== "snoozed") {
    return { state, incident: incident ?? (undefined as unknown as NocturneIncident), fired: false };
  }

  const nowMs = new Date(ctx.now()).getTime();
  const untilMs = new Date(incident.snoozedUntil ?? incident.triggeredAt).getTime();
  if (nowMs < untilMs) {
    return { state, incident, fired: false };
  }

  // The snooze has expired: go back to `acknowledged` if
  // acknowledgedAt is set, else stay `triggered`.
  const newStatus: NocturneIncident["status"] =
    incident.acknowledgedAt !== null ? "acknowledged" : "triggered";
  const updated: NocturneIncident = {
    ...incident,
    status: newStatus,
    snoozedUntil: null,
  };
  let newState: NocturneState = {
    ...state,
    incidents: state.incidents.map((i) => (i.id === incident.id ? updated : i)),
  };
  newState = appendTimeline(
    newState,
    updated,
    "status_changed",
    null,
    { from: "snoozed", to: newStatus },
    ctx,
  );
  return { state: newState, incident: updated, fired: true };
}

/* ── notes ────────────────────────────────────────────────────────── */

/**
 * Append a note to an incident (the note row is mutable; the
 * timeline event is immutable). Appends a `note` timeline event
 * with the note's id in `meta`.
 */
export function addNote(
  state: NocturneState,
  incidentId: string,
  authorId: string,
  body: string,
  ctx: IncidentCtx,
): { state: NocturneState; note: NocturneNote } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  const noteId = ctx.nextId("note");
  const note: NocturneNote = {
    id: noteId,
    tenantId: incident?.tenantId ?? "",
    incidentId,
    authorId,
    body,
    createdAt: ctx.now(),
    updatedAt: null,
  };
  const notes: NocturneState = { ...state, notes: [...state.notes, note] };
  // The timeline event references the note.
  const event: NocturneTimelineEvent = {
    id: ctx.nextId("evt"),
    tenantId: incident?.tenantId ?? "",
    incidentId,
    kind: "note",
    actorId: authorId,
    meta: { noteId },
    at: ctx.now(),
  };
  return { state: { ...notes, timeline: [...notes.timeline, event] }, note };
}

/**
 * Edit a note in place (the note row is the mutable record; the
 * timeline event that referenced it stays immutable).
 */
export function updateNote(
  state: NocturneState,
  noteId: string,
  body: string,
  now: string,
): NocturneState {
  const updated = state.notes.map((n) =>
    n.id === noteId ? { ...n, body, updatedAt: now } : n,
  );
  return { ...state, notes: updated };
}
