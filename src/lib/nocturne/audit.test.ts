import { describe, expect, test } from "bun:test";
import { auditQuery, recordAudit } from "./audit";
import type { NocturneState } from "./types";

function emptyState(): NocturneState {
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

function ev(over: Partial<NocturneState["audit"][number]>): NocturneState["audit"][number] {
  return {
    id: "a1",
    tenantId: "tn-lumen",
    actorUserId: "u1",
    action: "incident.ack",
    entityType: "incident",
    entityId: "i1",
    meta: { before: null, after: { acknowledgedAt: "x" } },
    createdAt: "2026-10-28T10:00:00Z",
    ...over,
  };
}

describe("recordAudit", () => {
  test("appends an event with every field present", () => {
    const s = recordAudit(
      emptyState(),
      "u-mira",
      "service.create",
      "service",
      "svc-1",
      null,
      { name: "API" },
      "2026-10-28T12:00:00Z",
      "tn-lumen",
      "nc_aud-000001",
    );
    const e = s.audit[s.audit.length - 1];
    expect(e.id).toBe("nc_aud-000001");
    expect(e.tenantId).toBe("tn-lumen");
    expect(e.actorUserId).toBe("u-mira");
    expect(e.action).toBe("service.create");
    expect(e.entityType).toBe("service");
    expect(e.entityId).toBe("svc-1");
    expect(e.meta.before).toBe(null);
    expect(e.meta.after).toEqual({ name: "API" });
    expect(e.createdAt).toBe("2026-10-28T12:00:00Z");
  });

  test("copy-on-write: the prior snapshot's array is not mutated", () => {
    const s0 = emptyState();
    const s1 = recordAudit(s0, "u1", "a1", "t", "e", null, null, "2026-01-01T00:00:00Z", "t1", "x1");
    const s2 = recordAudit(s1, "u1", "a2", "t", "e", null, null, "2026-01-02T00:00:00Z", "t1", "x2");
    expect(s0.audit).toHaveLength(0);
    expect(s1.audit).toHaveLength(1);
    expect(s2.audit).toHaveLength(2);
    expect(s2.audit[0].id).toBe("x1");
    expect(s2.audit[1].id).toBe("x2");
    expect(s2.audit).not.toBe(s1.audit);
  });

  test("event objects are reference-stable across appends (the immutability pin)", () => {
    const s0 = emptyState();
    const s1 = recordAudit(s0, "u", "a1", "t", "e", null, null, "2026-01-01T00:00:00Z", "t", "x1");
    const s2 = recordAudit(s1, "u", "a2", "t", "e", null, null, "2026-01-02T00:00:00Z", "t", "x2");
    expect(s2.audit[0]).toBe(s1.audit[0]);
  });

  test("the state object itself is a new reference (other fields shared by reference)", () => {
    const s0 = emptyState();
    const s1 = recordAudit(s0, "u", "a", "t", "e", null, null, "2026-01-01T00:00:00Z", "t", "x");
    expect(s1).not.toBe(s0);
    expect(s1.tenants).toBe(s0.tenants); // untouched arrays are shared
    expect(s1.audit).not.toBe(s0.audit);
  });
});

describe("auditQuery", () => {
  const events = [
    ev({ id: "e1", createdAt: "2026-10-28T08:00:00Z", action: "incident.ack" }),
    ev({ id: "e2", createdAt: "2026-10-28T09:00:00Z", action: "incident.resolve" }),
    ev({ id: "e3", createdAt: "2026-10-28T10:00:00Z", action: "incident.ack" }),
    ev({ id: "e4", createdAt: "2026-10-28T11:00:00Z", tenantId: "tn-northwind", action: "incident.ack" }),
  ];

  test("newest first (reverse of insertion order)", () => {
    const out = auditQuery(events, {});
    expect(out.map((e) => e.id)).toEqual(["e4", "e3", "e2", "e1"]);
  });

  test("filter by action", () => {
    const out = auditQuery(events, { action: "incident.resolve" });
    expect(out.map((e) => e.id)).toEqual(["e2"]);
  });

  test("filter by tenantId", () => {
    const out = auditQuery(events, { tenantId: "tn-northwind" });
    expect(out.map((e) => e.id)).toEqual(["e4"]);
  });

  test("filter by entityType", () => {
    const out = auditQuery(events, { entityType: "incident" });
    expect(out).toHaveLength(4);
    const none = auditQuery(events, { entityType: "service" });
    expect(none).toHaveLength(0);
  });

  test("filter by all three", () => {
    const out = auditQuery(events, {
      tenantId: "tn-lumen",
      action: "incident.ack",
      entityType: "incident",
    });
    expect(out.map((e) => e.id)).toEqual(["e3", "e1"]);
  });

  test("does not mutate the input array", () => {
    const before = events.map((e) => e.id);
    auditQuery(events, {});
    expect(events.map((e) => e.id)).toEqual(before);
  });

  test("an empty query returns the full reversed copy", () => {
    const out = auditQuery([], {});
    expect(out).toEqual([]);
  });
});
