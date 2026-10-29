/**
 * The dedup engine for Nocturne (plan §4.1).
 *
 * Two alerts with the same `(serviceId, dedupKey)` whose `lastSeenAt`
 * is within `DEDUP_WINDOW_MS` (1 minute) of the incoming `firedAt`
 * are ONE logical alert. The merge is idempotent: calling
 * `mergeDedup` twice with the same `(serviceId, dedupKey, firedAt)`
 * produces the same logical alert — the second call dedupes onto
 * the first and the count increments by exactly 1 (the PBT
 * invariant "dedup idempotence", §5.4/5).
 *
 * PURE: zero I/O, zero `Date.now()`, zero `Math.random()`.
 * The copy-on-write contract: every call returns a new state with
 * the `alerts` array replaced; prior snapshots and alert-row
 * references stay stable.
 */

import type { NocturneAlert, NocturneIncident, NocturneState } from "./types";

/** The dedup window (ms): two fires within 60 seconds = one logical alert. */
export const DEDUP_WINDOW_MS = 60_000;

/**
 * The merge result: the logical alert (existing or new), whether it
 * was deduped into an existing row, the linked incident (if any),
 * and whether correlation happened (always `false` here — that is
 * the correlate engine's job).
 */
export interface MergeDedupResult {
  alert: NocturneAlert;
  deduped: boolean;
  incident: NocturneIncident | null;
  correlated: boolean;
}

/**
 * `mergeDedup(state, serviceId, dedupKey, newAlert, ctx)`:
 *
 * 1. Find the LATEST alert with the same `(serviceId, dedupKey)`
 *    whose `lastSeenAt` is within `DEDUP_WINDOW_MS` of
 *    `newAlert.firedAt`.
 * 2. If found: increment `count`, advance `lastSeenAt`. No new row.
 *    → `{ alert: merged, deduped: true, incident: linked-or-null, correlated: false }`.
 * 3. If not found: append a new `NocturneAlert` row with `count: 1`.
 *    → `{ alert: newRow, deduped: false, incident: null, correlated: false }`.
 *
 * `ctx` supplies the injected clock (`now`) and id generator
 * (`nextId`), keeping this module pure (the fugue EngineCtx
 * pattern). `tenantId` is the alert's tenant — the caller (the
 * store's `transaction`) provides it.
 */
export function mergeDedup(
  state: NocturneState,
  tenantId: string,
  serviceId: string,
  dedupKey: string,
  newAlert: {
    title: string;
    body: string;
    severity: NocturneAlert["severity"];
    firedAt: string;
  },
  ctx: { now(): string; nextId(prefix: string): string },
): { state: NocturneState; result: MergeDedupResult } {
  const nowMs = new Date(ctx.now()).getTime();
  const firedMs = new Date(newAlert.firedAt).getTime();
  const windowMs = DEDUP_WINDOW_MS;

  // Find the LATEST alert with the same (serviceId, dedupKey) whose
  // lastSeenAt is within the window of newAlert.firedAt.
  let latest: NocturneAlert | null = null;
  for (const a of state.alerts) {
    if (a.tenantId !== tenantId) continue;
    if (a.serviceId !== serviceId) continue;
    if (a.dedupKey !== dedupKey) continue;
    const lastMs = new Date(a.lastSeenAt).getTime();
    // within the window: |firedAt - lastSeenAt| < windowMs
    // (the plan's "within the window" is symmetric around the merge point)
    if (Math.abs(firedMs - lastMs) < windowMs) {
      if (latest === null || new Date(a.lastSeenAt).getTime() > new Date(latest.lastSeenAt).getTime()) {
        latest = a;
      }
    }
  }

  if (latest !== null) {
    // Idempotent merge: count++ and lastSeenAt advances.
    const merged: NocturneAlert = {
      ...latest,
      count: latest.count + 1,
      lastSeenAt: newAlert.firedAt,
    };
    const newState: NocturneState = {
      ...state,
      alerts: state.alerts.map((a) => (a.id === latest!.id ? merged : a)),
    };
    const incident = state.incidents.find((i) => i.id === latest!.incidentId) ?? null;
    return {
      state: newState,
      result: { alert: merged, deduped: true, incident, correlated: false },
    };
  }

  // No dedup match: create a new logical alert row.
  const id = ctx.nextId("al");
  const newRow: NocturneAlert = {
    id,
    tenantId,
    serviceId,
    dedupKey,
    title: newAlert.title,
    body: newAlert.body,
    severity: newAlert.severity,
    firedAt: newAlert.firedAt,
    lastSeenAt: newAlert.firedAt,
    count: 1,
    incidentId: null,
    createdAt: newAlert.firedAt,
  };
  const newState: NocturneState = {
    ...state,
    alerts: [...state.alerts, newRow],
  };
  return {
    state: newState,
    result: { alert: newRow, deduped: false, incident: null, correlated: false },
  };
}
