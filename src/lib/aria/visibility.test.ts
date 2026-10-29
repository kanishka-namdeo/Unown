import { describe, expect, test } from "bun:test";
import {
  isRecordVisible,
  membershipFor,
  visibleAccounts,
  visibleDeals,
  visibleLeads,
  visibleOwnerIds,
} from "./visibility";
import { makeCtx } from "./tenancy";
import type { AriaState } from "./types";

/**
 * A minimal state with:
 *  - tenant t1: owner u-owner, manager u-mgr (manages u-rep1, u-rep2),
 *    reps u-rep1/u-rep2, viewer u-viewer.
 *  - accounts/leads/deals owned by u-rep1, u-rep2, u-sys (system, null
 *    owner lives outside these — system records are tested separately).
 */
function fixture(): AriaState {
  return {
    version: 1,
    tenants: [
      {
        id: "t1",
        slug: "t1",
        name: "T1",
        plan: "starter",
        quotas: {},
        manages: { "u-mgr": ["u-rep1", "u-rep2"] },
        leadSlaMinutes: { low: 0, normal: 0, high: 0, urgent: 0 },
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "t2",
        slug: "t2",
        name: "T2",
        plan: "enterprise",
        quotas: {},
        manages: {},
        leadSlaMinutes: { low: 0, normal: 0, high: 0, urgent: 0 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    users: [],
    memberships: [],
    accounts: [
      { id: "a1", tenantId: "t1", name: "A1", domain: "a1.co", industry: "x", size: 1, ownerId: "u-rep1", status: "active", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a2", tenantId: "t1", name: "A2", domain: "a2.co", industry: "x", size: 1, ownerId: "u-rep2", status: "active", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a3", tenantId: "t1", name: "A3", domain: "a3.co", industry: "x", size: 1, ownerId: "u-mgr", status: "active", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a4", tenantId: "t2", name: "A4", domain: "a4.co", industry: "x", size: 1, ownerId: "u-other", status: "active", createdAt: "2026-01-01T00:00:00Z" },
    ],
    contacts: [],
    leads: [
      { id: "l1", tenantId: "t1", status: "new", source: "s", priority: "normal", firstResponseAt: null, slaDueAt: "2026-01-01T00:00:00Z", converted: null, ownerId: "u-rep1", createdAt: "2026-01-01T00:00:00Z" },
      { id: "l2", tenantId: "t1", status: "new", source: "s", priority: "normal", firstResponseAt: null, slaDueAt: "2026-01-01T00:00:00Z", converted: null, ownerId: "u-rep2", createdAt: "2026-01-01T00:00:00Z" },
      { id: "l3", tenantId: "t1", status: "new", source: "s", priority: "normal", firstResponseAt: null, slaDueAt: "2026-01-01T00:00:00Z", converted: null, ownerId: "u-mgr", createdAt: "2026-01-01T00:00:00Z" },
      { id: "l4", tenantId: "t2", status: "new", source: "s", priority: "normal", firstResponseAt: null, slaDueAt: "2026-01-01T00:00:00Z", converted: null, ownerId: "u-other", createdAt: "2026-01-01T00:00:00Z" },
    ],
    pipelines: [],
    deals: [
      { id: "d1", tenantId: "t1", pipelineId: "p1", stageId: "s1", accountId: "a1", contactId: "c1", amount: 100, forecastCategory: "pipeline", ownerId: "u-rep1", expectedCloseDate: "2026-01-15", closedAt: null, lostReason: null, lastStageChangeAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "d2", tenantId: "t1", pipelineId: "p1", stageId: "s1", accountId: "a2", contactId: "c2", amount: 200, forecastCategory: "commit", ownerId: "u-rep2", expectedCloseDate: "2026-01-15", closedAt: null, lostReason: null, lastStageChangeAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "d3", tenantId: "t1", pipelineId: "p1", stageId: "s1", accountId: "a3", contactId: "c3", amount: 300, forecastCategory: "pipeline", ownerId: "u-mgr", expectedCloseDate: "2026-01-15", closedAt: null, lostReason: null, lastStageChangeAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
      { id: "d4", tenantId: "t2", pipelineId: "p2", stageId: "s1", accountId: "a4", contactId: "c4", amount: 400, forecastCategory: "pipeline", ownerId: "u-other", expectedCloseDate: "2026-01-15", closedAt: null, lostReason: null, lastStageChangeAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:00Z" },
    ],
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
}

const STATE = fixture();

describe("visibleOwnerIds", () => {
  test("owner/admin/viewer → null (the no-filter sentinel)", () => {
    for (const role of ["owner", "admin", "viewer"] as const) {
      expect(visibleOwnerIds(STATE, makeCtx("t1", "u-x", role))).toBeNull();
    }
  });

  test("rep → only themselves", () => {
    const scope = visibleOwnerIds(STATE, makeCtx("t1", "u-rep1", "rep"));
    expect(scope).not.toBeNull();
    expect(scope!.has("u-rep1")).toBe(true);
    expect(scope!.has("u-rep2")).toBe(false);
  });

  test("a rep who manages a team adds their managed reps", () => {
    const scope = visibleOwnerIds(STATE, makeCtx("t1", "u-mgr", "manager"));
    expect(scope).not.toBeNull();
    expect(scope!.has("u-mgr")).toBe(true);
    expect(scope!.has("u-rep1")).toBe(true);
    expect(scope!.has("u-rep2")).toBe(true);
  });

  test("a manager with an empty managed set sees only themselves", () => {
    const s2 = { ...STATE, tenants: STATE.tenants.map((t) => (t.id === "t1" ? { ...t, manages: { "u-mgr": [] } } : t)) };
    const scope = visibleOwnerIds(s2, makeCtx("t1", "u-mgr", "manager"));
    expect(scope!.has("u-mgr")).toBe(true);
    expect(scope!.has("u-rep1")).toBe(false);
  });

  test("an unmanaged manager id in teamOf returns no team members", () => {
    const s3 = { ...STATE, tenants: STATE.tenants.map((t) => (t.id === "t1" ? { ...t, manages: {} } : t)) };
    const scope = visibleOwnerIds(s3, makeCtx("t1", "u-mgr", "manager"));
    expect([...scope!]).toEqual(["u-mgr"]);
  });
});

describe("isRecordVisible", () => {
  test("cross-tenant records are never visible", () => {
    const ctx = makeCtx("t1", "u-owner", "owner");
    expect(isRecordVisible(STATE, ctx, "account", "u-other", { tenantId: "t2" })).toBe(false);
  });

  test("null ownerId (system records) are visible to the whole tenant", () => {
    const ctx = makeCtx("t1", "u-rep1", "rep");
    expect(isRecordVisible(STATE, ctx, "account", null, { tenantId: "t1" })).toBe(true);
  });

  test("a rep sees their own records", () => {
    const ctx = makeCtx("t1", "u-rep1", "rep");
    expect(isRecordVisible(STATE, ctx, "deal", "u-rep1", { tenantId: "t1" })).toBe(true);
    expect(isRecordVisible(STATE, ctx, "deal", "u-rep2", { tenantId: "t1" })).toBe(false);
  });

  test("a manager sees team + own records", () => {
    const ctx = makeCtx("t1", "u-mgr", "manager");
    expect(isRecordVisible(STATE, ctx, "deal", "u-rep1", { tenantId: "t1" })).toBe(true);
    expect(isRecordVisible(STATE, ctx, "deal", "u-mgr", { tenantId: "t1" })).toBe(true);
  });

  test("admin/owner see all tenant records", () => {
    const ctx = makeCtx("t1", "u-admin", "admin");
    expect(isRecordVisible(STATE, ctx, "deal", "u-rep2", { tenantId: "t1" })).toBe(true);
    const octx = makeCtx("t1", "u-owner", "owner");
    expect(isRecordVisible(STATE, octx, "account", "u-mgr", { tenantId: "t1" })).toBe(true);
  });

  test("viewer sees the whole tenant (read-only — the matrix gates writes)", () => {
    const ctx = makeCtx("t1", "u-viewer", "viewer");
    expect(isRecordVisible(STATE, ctx, "lead", "u-rep1", { tenantId: "t1" })).toBe(true);
    expect(isRecordVisible(STATE, ctx, "lead", "u-rep2", { tenantId: "t1" })).toBe(true);
  });
});

describe("visibleAccounts / visibleLeads / visibleDeals", () => {
  test("owner → the whole tenant, cross-tenant excluded", () => {
    const ctx = makeCtx("t1", "u-owner", "owner");
    expect(visibleAccounts(STATE, ctx).map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(visibleDeals(STATE, ctx).map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
  });

  test("rep → only their owned rows", () => {
    const ctx = makeCtx("t1", "u-rep1", "rep");
    expect(visibleLeads(STATE, ctx).map((l) => l.id)).toEqual(["l1"]);
    expect(visibleDeals(STATE, ctx).map((d) => d.id)).toEqual(["d1"]);
  });

  test("manager → team + own rows", () => {
    const ctx = makeCtx("t1", "u-mgr", "manager");
    const ids = visibleDeals(STATE, ctx).map((d) => d.id).sort();
    expect(ids).toEqual(["d1", "d2", "d3"]);
  });

  test("viewer → whole tenant (same as owner for visibility)", () => {
    const ctx = makeCtx("t1", "u-viewer", "viewer");
    expect(visibleAccounts(STATE, ctx)).toHaveLength(3);
  });

  test("an empty tenant scope returns empty lists", () => {
    const ctx = makeCtx("t2", "u-x", "owner");
    expect(visibleLeads(STATE, ctx).map((l) => l.id)).toEqual(["l4"]);
    // t2 has no accounts owned by visible reps in this fixture except a4
    expect(visibleDeals(STATE, ctx).map((d) => d.id)).toEqual(["d4"]);
  });
});

describe("membershipFor", () => {
  test("returns the membership row when present", () => {
    const s = {
      ...STATE,
      memberships: [
        { id: "m1", tenantId: "t1", userId: "u-1", role: "rep" as const },
        { id: "m2", tenantId: "t1", userId: "u-2", role: "owner" as const },
      ],
    };
    expect(membershipFor(s, "t1", "u-1")).toEqual({ id: "m1", tenantId: "t1", userId: "u-1", role: "rep" });
  });

  test("returns null when absent", () => {
    expect(membershipFor(STATE, "t1", "u-nobody")).toBeNull();
  });
});
