/**
 * Audit event recording — copy-on-write (the cadence lesson: never
 * mutate the array in place). Every mutation in the store calls
 * `recordAudit`; `auditQuery` returns a filtered, newest-first view.
 */

import type { AuditEvent, ParleyState } from "./types";

/**
 * Append an audit event to a copy of `state`. Returns the new state
 * with the event appended to `audit` (the array itself is never
 * mutated — the caller's prior snapshot is untouched).
 *
 * `now` is the explicit clock (ISO string); `id` comes from the
 * caller (the store generates it, keeping this module pure).
 */
export function recordAudit(
  state: ParleyState,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  now: string,
  tenantId: string,
  id: string,
): ParleyState {
  const event: AuditEvent = {
    id,
    tenantId,
    actorUserId,
    action,
    entityType,
    entityId,
    meta: { before, after },
    createdAt: now,
  };
  return { ...state, audit: [...state.audit, event] };
}

export interface AuditQuery {
  action?: string;
  tenantId?: string;
}

/**
 * Return audit events matching the query, newest first (the feed's
 * ordering). Pure: no mutation, a filtered + reversed view.
 */
export function auditQuery(
  events: AuditEvent[],
  query: AuditQuery,
): AuditEvent[] {
  let out = events;
  if (query.tenantId) out = out.filter((e) => e.tenantId === query.tenantId);
  if (query.action) out = out.filter((e) => e.action === query.action);
  return [...out].reverse();
}
