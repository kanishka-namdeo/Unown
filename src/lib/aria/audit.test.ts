import { describe, expect, test } from "bun:test";
import { auditQuery, recordAudit } from "./audit";
import type { AriaAuditEvent, AriaState } from "./types";

const EMPTY: AriaState = {
  version: 1,
  tenants: [],
  users: [],
  memberships: [],
  accounts: [],
  contacts: [],
  leads: [],
  pipelines: [],
  deals: [],
  activities: [],
  tasks: [],
  notes: [],
  tags: [],
  sequences: [],
  enrollments: [],
  emailTemplates: [],
  engagementEvents: [],
  mailbox: [],
  quotas: [],
  forecastSnapshots: [],
  sessions: [],
  invites: [],
  audit: [],
  seq: 0,
};

function ev(over: Partial<AriaAuditEvent>): AriaAuditEvent {
  return {
    id: "a1",
    tenantId: "t1",
    actorUserId: "u1",
    action: "reply",
    entityType: "message",
    entityId: "m1",
    meta: { before: null, after: { body: "hi" } },
    createdAt: "2026-10-28T10:00:00Z",
    ...over,
  };
}

describe("recordAudit", () => {
  test("appends an event with every field present", () => {
    const s = recordAudit(EMPTY, "u-mira", "deal.stage", "deal", "d-1", null, { to: "stg-2" }, "2026-10-28T12:00:00Z", "t-lumen", "audit-0001");
    const e = s.audit[s.audit.length - 1];
    expect(e.id).toBe("audit-0001");
    expect(e.tenantId).toBe("t-lumen");
    expect(e.actorUserId).toBe("u-mira");
    expect(e.action).toBe("deal.stage");
    expect(e.entityType).toBe("deal");
    expect(e.entityId).toBe("d-1");
    expect(e.meta.before).toBe(null);
    expect(e.meta.after).toEqual({ to: "stg-2" });
    expect(e.createdAt).toBe("2026-10-28T12:00:00Z");
  });

  test("copy-on-write: the prior snapshot's array is not mutated", () => {
    const base = recordAudit(EMPTY, "u1", "a1", "t", "e", null, null, "2026-01-01T00:00:00Z", "t1", "x1");
    const next = recordAudit(base, "u1", "a2", "t", "e", null, null, "2026-01-02T00:00:00Z", "t1", "x2");
    expect(base.audit).toHaveLength(1);
    expect(next.audit).toHaveLength(2);
    expect(next.audit[0].id).toBe("x1");
    expect(next.audit[1].id).toBe("x2");
  });

  test("the original state object is not mutated", () => {
    const s = recordAudit(EMPTY, "u1", "a", "t", "e", null, null, "2026-01-01T00:00:00Z", "t1", "x1");
    expect(EMPTY.audit).toHaveLength(0);
    expect(s).not.toBe(EMPTY);
  });
});

describe("auditQuery", () => {
  const events = [
    ev({ id: "e1", createdAt: "2026-10-28T08:00:00Z", action: "reply" }),
    ev({ id: "e2", createdAt: "2026-10-28T09:00:00Z", action: "assign" }),
    ev({ id: "e3", createdAt: "2026-10-28T10:00:00Z", action: "reply" }),
    ev({ id: "e4", createdAt: "2026-10-28T11:00:00Z", tenantId: "t2", action: "reply" }),
  ];

  test("newest first (reverse of insertion order)", () => {
    const out = auditQuery(events, {});
    expect(out.map((e) => e.id)).toEqual(["e4", "e3", "e2", "e1"]);
  });

  test("filter by action", () => {
    const out = auditQuery(events, { action: "assign" });
    expect(out.map((e) => e.id)).toEqual(["e2"]);
  });

  test("filter by tenantId", () => {
    const out = auditQuery(events, { tenantId: "t2" });
    expect(out.map((e) => e.id)).toEqual(["e4"]);
  });

  test("filter by both action + tenantId", () => {
    const out = auditQuery(events, { tenantId: "t1", action: "reply" });
    expect(out.map((e) => e.id)).toEqual(["e3", "e1"]);
  });

  test("filter by entityType", () => {
    const out = auditQuery(events, { entityType: "message" });
    expect(out.map((e) => e.id)).toEqual(["e4", "e3", "e2", "e1"]);
  });

  test("does not mutate the input array", () => {
    const inputLength = events.length;
    const inputFirst = events[0].id;
    auditQuery(events, {});
    expect(events.length).toBe(inputLength);
    expect(events[0].id).toBe(inputFirst);
  });
});
