/**
 * Tests for the Nocturne dedup engine (plan §4.1 + §5.1
 * `dedup.test.ts` — the ~20-test lane).
 *
 * Pins:
 *  - the 60-second dedup window (within → merge, outside → new row);
 *  - idempotence: two calls with the same `(serviceId, dedupKey,
 *    firedAt)` → the second call dedupes onto the first, count
 *    increments by exactly 1;
 *  - count increments on every merge;
 *  - `lastSeenAt` advances to the latest `firedAt`;
 *  - the incident link is preserved (untouched when merging into
 *    a deduped alert that already has an incident);
 *  - a standalone alert (no incident link) stays standalone;
 *  - cross-tenant isolation (alerts from another tenant never
 *    merge);
 *  - copy-on-write: the prior snapshot is untouched.
 */

import { describe, expect, test } from "bun:test";
import { DEDUP_WINDOW_MS, mergeDedup } from "./dedup";
import type { NocturneAlert, NocturneIncident, NocturneState } from "./types";

/* ── helpers ─────────────────────────────────────────────────────── */

function baseState(): NocturneState {
  return {
    version: 1,
    tenants: [],
    users: [],
    memberships: [],
    services: [],
    rotations: [],
    overrides: [],
    alerts: [],
    incidents: [],
    timeline: [],
    notes: [],
    runbooks: [],
    checklists: [],
    components: [],
    postmortems: [],
    invites: [],
    audit: [],
    sessions: [],
    seq: 1,
  };
}

/** A minimal ctx with a fixed clock + seq-based id generator. */
function ctxWithNow(now: string, seqStart: number = 1) {
  let seq = seqStart;
  return {
    now: () => now,
    nextId: (prefix: string) => `nc_${prefix}_${seq++}`,
  };
}

const NOW = "2026-10-28T12:00:00Z";
const TENANT = "tn-lumen";
const SERVICE = "svc-payments";
const KEY = "5xx_ratio>0.5";

function alertRow(
  id: string,
  lastSeenAt: string,
  count: number,
  incidentId: string | null,
  tenantId: string = TENANT,
): NocturneAlert {
  return {
    id,
    tenantId,
    serviceId: SERVICE,
    dedupKey: KEY,
    title: "5xx ratio above 50%",
    body: "body",
    severity: "sev1",
    firedAt: lastSeenAt,
    lastSeenAt,
    count,
    incidentId,
    createdAt: lastSeenAt,
  };
}

const INPUT = { title: "5xx ratio above 50%", body: "still bad", severity: "sev1" as const };

/* ── window boundary tests ───────────────────────────────────────── */

describe("the dedup window boundary", () => {
  test("two alerts within the window merge (count 1 → 2)", () => {
    const s0 = baseState();
    // First call: creates a new alert row.
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW));
    expect(r1.result.deduped).toBe(false);
    expect(r1.result.alert.count).toBe(1);

    // Second call, 30 seconds later: within the 60-second window.
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:59Z" }, ctxWithNow(NOW, 2));
    expect(r2.result.deduped).toBe(true);
    expect(r2.result.alert.count).toBe(2);
    expect(r2.state.alerts).toHaveLength(1);
  });

  test("alerts just OUTSIDE the window do not merge", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    // 61 seconds later — outside the 60-second window.
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T12:00:01Z" }, ctxWithNow(NOW, 2));
    expect(r2.result.deduped).toBe(false);
    expect(r2.state.alerts).toHaveLength(2);
  });

  test("the window constant is exactly 60 seconds", () => {
    expect(DEDUP_WINDOW_MS).toBe(60_000);
  });

  test("the boundary: exactly DEDUP_WINDOW_MS apart does NOT merge (strict <)", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    // Exactly 60 seconds later → not within (< 60s), so no merge.
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T12:00:00Z" }, ctxWithNow(NOW, 2));
    expect(r2.result.deduped).toBe(false);
  });
});

/* ── idempotence ─────────────────────────────────────────────────── */

describe("dedup idempotence (the PBT invariant §5.4/5)", () => {
  test("two calls with the same (serviceId, dedupKey, firedAt) → same logical alert, count increments by 1", () => {
    const s0 = baseState();
    const fired = "2026-10-28T11:59:30Z";

    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: fired }, ctxWithNow(NOW));
    expect(r1.result.deduped).toBe(false);
    const alertId = r1.result.alert.id;
    expect(r1.result.alert.count).toBe(1);

    // Second call: same (serviceId, dedupKey, firedAt) → dedupes
    // onto the first, count goes to 2.
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: fired }, ctxWithNow(NOW, 2));
    expect(r2.result.deduped).toBe(true);
    expect(r2.result.alert.id).toBe(alertId);
    expect(r2.result.alert.count).toBe(2);

    // Third call: still the same logical alert, count 3.
    const r3 = mergeDedup(r2.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: fired }, ctxWithNow(NOW, 3));
    expect(r3.result.deduped).toBe(true);
    expect(r3.result.alert.id).toBe(alertId);
    expect(r3.result.alert.count).toBe(3);
  });

  test("the LATEST lastSeenAt wins when multiple alerts are within the window", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:20Z" }, ctxWithNow(NOW, 2));
    expect(r2.result.alert.lastSeenAt).toBe("2026-10-28T11:59:20Z");
    expect(r2.result.alert.count).toBe(2);
  });
});

/* ── count + lastSeenAt semantics ────────────────────────────────── */

describe("count and lastSeenAt", () => {
  test("lastSeenAt advances to the newest firedAt on every merge", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW, 2));
    const r3 = mergeDedup(r2.state, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:55Z" }, ctxWithNow(NOW, 3));
    expect(r3.result.alert.lastSeenAt).toBe("2026-10-28T11:59:55Z");
    expect(r3.result.alert.count).toBe(3);
  });

  test("a new logical alert starts with count 1", () => {
    const s0 = baseState();
    const r = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    expect(r.result.alert.count).toBe(1);
  });
});

/* ── incident link preservation ──────────────────────────────────── */

describe("incident link preservation", () => {
  function stateWithIncident(): NocturneState {
    const s = baseState();
    const incident: NocturneIncident = {
      id: "inc-1",
      tenantId: TENANT,
      serviceId: SERVICE,
      title: "5xx ratio above 50%",
      severity: "sev1",
      status: "triggered",
      triggeredAt: "2026-10-28T11:59:00Z",
      acknowledgedAt: null,
      acknowledgedBy: null,
      snoozedUntil: null,
      resolvedAt: null,
      resolvedBy: null,
      postmortemId: null,
      activeTierIndex: 0,
      lastEscalatedAt: null,
      createdAt: "2026-10-28T11:59:00Z",
    };
    s.incidents = [incident];
    s.alerts = [alertRow("al-1", "2026-10-28T11:59:00Z", 1, "inc-1")];
    return s;
  }

  test("merging into an alert with an incident link returns the incident", () => {
    const s0 = stateWithIncident();
    const r = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW, 10));
    expect(r.result.deduped).toBe(true);
    expect(r.result.incident?.id).toBe("inc-1");
  });

  test("a fresh alert (no incident link) returns incident: null", () => {
    const s0 = baseState();
    const r = mergeDedup(s0, TENANT, SERVICE, "other-key", { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    expect(r.result.incident).toBeNull();
  });
});

/* ── cross-tenant isolation ─────────────────────────────────────── */

describe("cross-tenant isolation", () => {
  test("an alert from a different tenant never merges", () => {
    const s0 = baseState();
    s0.alerts = [alertRow("al-1", "2026-10-28T11:59:00Z", 1, null, "tn-other")];
    const r = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW));
    // No alert from TENANT exists → create a new one.
    expect(r.result.deduped).toBe(false);
    expect(r.state.alerts).toHaveLength(2);
  });
});

/* ── different dedupKey / serviceId ─────────────────────────────── */

describe("different dedupKey / serviceId create separate logical alerts", () => {
  test("a different dedupKey creates a new row", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    const r2 = mergeDedup(r1.state, TENANT, SERVICE, "other-key", { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW, 2));
    expect(r2.result.deduped).toBe(false);
    expect(r2.state.alerts).toHaveLength(2);
  });

  test("a different serviceId creates a new row", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    const r2 = mergeDedup(r1.state, TENANT, "svc-other", KEY, { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW, 2));
    expect(r2.result.deduped).toBe(false);
  });
});

/* ── copy-on-write ───────────────────────────────────────────────── */

describe("copy-on-write", () => {
  test("the prior snapshot's alerts array is untouched", () => {
    const s0 = baseState();
    const r1 = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:00Z" }, ctxWithNow(NOW));
    expect(r1.state.alerts).toHaveLength(1);
    expect(s0.alerts).toHaveLength(0); // the prior snapshot is unchanged
    expect(r1.state).not.toBe(s0);
  });

  test("a merge does not mutate the existing alert row in place", () => {
    const s0 = baseState();
    const existing = alertRow("al-existing", "2026-10-28T11:59:00Z", 1, null);
    s0.alerts = [existing];
    const r = mergeDedup(s0, TENANT, SERVICE, KEY, { ...INPUT, firedAt: "2026-10-28T11:59:30Z" }, ctxWithNow(NOW, 10));
    // The original row still has count 1 (the merge produced a new
    // object in the new array).
    expect(existing.count).toBe(1);
    expect(r.state.alerts[0]).not.toBe(existing);
    expect(r.state.alerts[0]!.count).toBe(2);
  });
});
