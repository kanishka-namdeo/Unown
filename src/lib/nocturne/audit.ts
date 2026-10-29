/**
 * Audit event recording for Nocturne — copy-on-write (the parley
 * pattern: never mutate the array in place). Every store mutation
 * calls `recordAudit`; `auditQuery` returns a filtered,
 * newest-first view.
 */

import type { NocturneAuditEvent, NocturneState } from "./types";

/**
 * Append an audit event to a copy of `state`. Returns the new state
 * with the event appended to `audit` (the array itself is never
 * mutated — the caller's prior snapshot is untouched, and event
 * object references stay stable across appends — invariant §5.4/7).
 *
 * `now` is the explicit clock (ISO string); `id` comes from the
 * caller (the store generates it, keeping this module pure).
 */
export function recordAudit(
  state: NocturneState,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  now: string,
  tenantId: string,
  id: string,
): NocturneState {
  const event: NocturneAuditEvent = {
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
  entityType?: string;
  tenantId?: string;
}

/**
 * Return audit events matching the query, newest first (the feed's
 * ordering). Pure: no mutation, a filtered + reversed view.
 */
export function auditQuery(
  events: NocturneAuditEvent[],
  query: AuditQuery,
): NocturneAuditEvent[] {
  let out = events;
  if (query.tenantId) out = out.filter((e) => e.tenantId === query.tenantId);
  if (query.action) out = out.filter((e) => e.action === query.action);
  if (query.entityType) out = out.filter((e) => e.entityType === query.entityType);
  return [...out].reverse();
}
