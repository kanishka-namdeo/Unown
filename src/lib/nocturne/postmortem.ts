/**
 * The postmortem engine for Nocturne (plan §3.8 + the incident
 * resolve flow).
 *
 * A postmortem is written ONLY on a RESOLVED incident
 * (the risk list's P2 mitigation: `postmortem.create` checks
 * `incident.status === "resolved"` → 400 otherwise). The
 * `summary` block captures the trigger → ack → resolve deltas.
 *
 * `createPostmortem` mints the row + links it to the incident.
 * `setActionItemState` mutates a single action item in place
 * (copy-on-write) — the route maps the 404 when the action
 * id is unknown.
 *
 * PURE: zero I/O, zero `Date.now()`, zero `Math.random()`.
 */

import type { NocturneIncident, NocturnePostmortem, NocturneState } from "./types";

export interface PostmortemCtx {
  now(): string;
  nextId(prefix: string): string;
}

export interface ActionItemInput {
  title: string;
  assigneeId?: string | null;
  due?: string | null;
}

export interface CreatePostmortemInput {
  body: string;
  actionItems?: ActionItemInput[];
}

export interface PostmortemResult {
  postmortem: NocturnePostmortem;
  incident: NocturneIncident;
}

/**
 * `createPostmortem(state, incidentId, authorId, input, ctx)`:
 *
 * - the incident MUST be resolved (otherwise → error).
 * - mints a new `NocturnePostmortem` row with the summary deltas;
 * - links the incident's `postmortemId`;
 * - appends the postmortem to `state.postmortems`.
 *
 * Returns `{ state, result: { postmortem, incident } }` on
 * success; `{ state, error }` when the incident is not resolved.
 */
export function createPostmortem(
  state: NocturneState,
  incidentId: string,
  authorId: string,
  input: CreatePostmortemInput,
  ctx: PostmortemCtx,
):
  | { state: NocturneState; result: PostmortemResult }
  | { state: NocturneState; error: string } {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) {
    return { state, error: "unknown incident" };
  }
  if (incident.status !== "resolved") {
    return {
      state,
      error: `cannot write a postmortem on a "${incident.status}" incident — resolution required first`,
    };
  }

  const id = ctx.nextId("pm");
  const now = ctx.now();
  const postmortem: NocturnePostmortem = {
    id,
    tenantId: incident.tenantId,
    incidentId: incident.id,
    body: input.body,
    summary: {
      triggeredAt: incident.triggeredAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt!,
    },
    actionItems: (input.actionItems ?? []).map((item, idx) => ({
      id: `ai-${idx + 1}`,
      title: item.title,
      assigneeId: item.assigneeId ?? null,
      due: item.due ?? null,
      done: false,
      doneAt: null,
    })),
    createdAt: now,
    authorId,
  };

  const updatedIncident: NocturneIncident = { ...incident, postmortemId: id };
  const newState: NocturneState = {
    ...state,
    postmortems: [...state.postmortems, postmortem],
    incidents: state.incidents.map((i) => (i.id === incident.id ? updatedIncident : i)),
  };
  return { state: newState, result: { postmortem, incident: updatedIncident } };
}

/* ── action-item state ───────────────────────────────────────────── */

export type SetActionResult =
  | { ok: true; postmortem: NocturnePostmortem }
  | { ok: false; error: string };

/**
 * `setActionItemState(state, postmortemId, actionId, done, doneAt, ctx)`:
 *
 * - updates a single action item's `done` / `doneAt` fields
 *   (copy-on-write on the postmortem row).
 * - 404-when-unknown: returns `{ ok: false, error }` when the
 *   postmortem or action id is not found (the route maps it to 404).
 *
 * The `doneAt` is set to `ctx.now()` when `done` flips to `true`
 * and no explicit `doneAt` is supplied (the route passes it
 * through when the caller provides one).
 */
export function setActionItemState(
  state: NocturneState,
  postmortemId: string,
  actionId: string,
  done: boolean,
  doneAt: string | null | undefined,
  ctx: PostmortemCtx,
): { state: NocturneState; result: SetActionResult } {
  const pm = state.postmortems.find((p) => p.id === postmortemId);
  if (!pm) {
    return { state, result: { ok: false, error: "unknown postmortem" } };
  }
  const action = pm.actionItems.find((a) => a.id === actionId);
  if (!action) {
    return { state, result: { ok: false, error: "unknown action item" } };
  }

  // When flipping to done without an explicit doneAt, stamp the
  // engine clock.
  const effectiveDoneAt = done ? (doneAt ?? ctx.now()) : null;
  const updatedPm: NocturnePostmortem = {
    ...pm,
    actionItems: pm.actionItems.map((a) =>
      a.id === actionId ? { ...a, done, doneAt: effectiveDoneAt } : a,
    ),
  };
  const newState: NocturneState = {
    ...state,
    postmortems: state.postmortems.map((p) => (p.id === postmortemId ? updatedPm : p)),
  };
  return { state: newState, result: { ok: true, postmortem: updatedPm } };
}

/**
 * The postmortem's ms-delta summary block (the plan's "timeline
 * summary: triggered → ack → escalate → resolve (ms deltas)").
 * Returns a plain object the UI's KPI chips can consume directly.
 */
export function postmortemDeltas(
  pm: NocturnePostmortem,
): {
  triggerToAckMs: number | null;
  triggerToResolveMs: number;
  ackToResolveMs: number | null;
} {
  const t = new Date(pm.summary.triggeredAt).getTime();
  const r = new Date(pm.summary.resolvedAt).getTime();
  const a = pm.summary.acknowledgedAt
    ? new Date(pm.summary.acknowledgedAt).getTime()
    : null;
  return {
    triggerToAckMs: a !== null ? a - t : null,
    triggerToResolveMs: r - t,
    ackToResolveMs: a !== null ? r - a : null,
  };
}
