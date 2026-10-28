import { describe, expect, test } from "bun:test";
import {
  canCreatePipeline,
  canCreateSequence,
  canInvite,
  overage,
  pipelinesUsed,
  quotaFor,
  quotaProgress,
  quarterOf,
  seatsUsed,
  sequencesUsed,
} from "./metering";
import type { AriaState, AriaTenant } from "./types";

function tenant(id: string, plan: "starter" | "growth" | "enterprise", seats = 0): AriaTenant {
  const t: AriaTenant = {
    id,
    slug: id,
    name: id,
    plan,
    quotas: {},
    manages: {},
    leadSlaMinutes: { low: 0, normal: 0, high: 0, urgent: 0 },
    createdAt: "2026-01-01T00:00:00Z",
  };
  return t;
}

function base(): AriaState {
  return {
    version: 1,
    tenants: [tenant("t1", "starter"), tenant("t2", "enterprise")],
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
    audit: [],
    seq: 0,
  };
}

function withMemberships(n: number, tenantId: string, userIdPrefix = "u"): AriaState {
  const s = base();
  for (let i = 0; i < n; i++) {
    s.memberships.push({ id: `mem-${i}`, tenantId, userId: `${userIdPrefix}${i}`, role: "rep" });
  }
  return s;
}

function withPipelines(n: number, tenantId: string): AriaState {
  const s = base();
  for (let i = 0; i < n; i++) {
    s.pipelines.push({
      id: `p-${i}`,
      tenantId,
      name: `P${i}`,
      stages: [],
      createdAt: "2026-04-01T00:00:00Z",
    });
  }
  return s;
}

function withSequences(n: number, tenantId: string): AriaState {
  const s = base();
  for (let i = 0; i < n; i++) {
    s.sequences.push({
      id: `s-${i}`,
      tenantId,
      name: `S${i}`,
      steps: [],
      traitSeed: 0.5,
      createdAt: "2026-05-01T00:00:00Z",
    });
  }
  return s;
}

describe("seatsUsed", () => {
  test("counts distinct users (duplicate memberships don't double-count)", () => {
    const s = withMemberships(3, "t1");
    s.memberships.push({ id: "mem-x", tenantId: "t1", userId: "u0", role: "rep" });
    expect(seatsUsed(s, "t1")).toBe(3);
  });

  test("is scoped to the tenant", () => {
    const s = withMemberships(2, "t1");
    s.memberships.push({ id: "mem-9", tenantId: "t2", userId: "u9", role: "rep" });
    expect(seatsUsed(s, "t1")).toBe(2);
    expect(seatsUsed(s, "t2")).toBe(1);
  });
});

describe("plan cap gates", () => {
  test("starter: 5 seats — 4 ok, 5 denied", () => {
    expect(canInvite(withMemberships(4, "t1"), "t1")).toBe(true);
    expect(canInvite(withMemberships(5, "t1"), "t1")).toBe(false);
  });

  test("enterprise: 100 seats — 99 ok, 100 denied", () => {
    expect(canInvite(withMemberships(99, "t2"), "t2")).toBe(true);
    expect(canInvite(withMemberships(100, "t2"), "t2")).toBe(false);
  });

  test("starter: 1 pipeline — 0 ok, 1 denied", () => {
    expect(canCreatePipeline(withPipelines(0, "t1"), "t1")).toBe(true);
    expect(canCreatePipeline(withPipelines(1, "t1"), "t1")).toBe(false);
  });

  test("growth: 4 pipelines, enterprise: 20", () => {
    const s = base();
    s.tenants[0] = tenant("t1", "growth");
    s.pipelines = [
      { id: "p-0", tenantId: "t1", name: "P0", stages: [], createdAt: "2026-04-01T00:00:00Z" },
      { id: "p-1", tenantId: "t1", name: "P1", stages: [], createdAt: "2026-04-01T00:00:00Z" },
      { id: "p-2", tenantId: "t1", name: "P2", stages: [], createdAt: "2026-04-01T00:00:00Z" },
      { id: "p-3", tenantId: "t1", name: "P3", stages: [], createdAt: "2026-04-01T00:00:00Z" },
    ];
    expect(canCreatePipeline(s, "t1")).toBe(false); // 4/4 → denied
    s.pipelines.pop();
    expect(canCreatePipeline(s, "t1")).toBe(true); // 3/4 → allowed
    const ent = withPipelines(20, "t2");
    expect(canCreatePipeline(ent, "t2")).toBe(false); // 20/20 → denied
    ent.pipelines.pop();
    expect(canCreatePipeline(ent, "t2")).toBe(true); // 19/20 → allowed
  });

  test("growth: 10 sequences", () => {
    const s = base();
    s.tenants[0] = tenant("t1", "growth");
    s.sequences = Array.from({ length: 10 }, (_, i) => ({
      id: `s-${i}`,
      tenantId: "t1",
      name: `S${i}`,
      steps: [],
      traitSeed: 0.5,
      createdAt: "2026-05-01T00:00:00Z",
    }));
    expect(canCreateSequence(s, "t1")).toBe(false); // 10/10 → denied
    s.sequences.pop();
    expect(canCreateSequence(s, "t1")).toBe(true); // 9/10 → allowed
  });

  test("starter: 1 sequence — 0 ok, 1 denied", () => {
    expect(canCreateSequence(withSequences(0, "t1"), "t1")).toBe(true);
    expect(canCreateSequence(withSequences(1, "t1"), "t1")).toBe(false);
  });

  test("pipelinesUsed / sequencesUsed count per tenant", () => {
    const s = withPipelines(2, "t1");
    s.pipelines.push({ id: "p-x", tenantId: "t2", name: "X", stages: [], createdAt: "2026-04-01T00:00:00Z" });
    expect(pipelinesUsed(s, "t1")).toBe(2);
    expect(pipelinesUsed(s, "t2")).toBe(1);
    const s2 = withSequences(1, "t2");
    expect(sequencesUsed(s2, "t2")).toBe(1);
    expect(sequencesUsed(s2, "t1")).toBe(0);
  });
});

describe("overage", () => {
  test("below cap → over: false", () => {
    const o = overage(withMemberships(4, "t1"), "t1");
    expect(o.seats).toEqual({ used: 4, cap: 5, over: false });
  });

  test("at cap → over: false (the cap is inclusive)", () => {
    const o = overage(withMemberships(5, "t1"), "t1");
    expect(o.seats.over).toBe(false);
  });

  test("over cap → over: true", () => {
    const s = withMemberships(6, "t1");
    expect(overage(s, "t1").seats.over).toBe(true);
    const s2 = withPipelines(2, "t1");
    expect(overage(s2, "t1").pipelines.over).toBe(true);
    const s3 = withSequences(2, "t1");
    expect(overage(s3, "t1").sequences.over).toBe(true);
  });

  test("throws for an unknown tenant", () => {
    expect(() => overage(base(), "nope")).toThrow(/unknown tenant/);
  });
});

describe("quarterOf", () => {
  test("quarters start on Jan/Apr/Jul/Oct 1", () => {
    expect(quarterOf("2026-04-15T00:00:00Z")).toEqual({ start: "2026-04-01T00:00:00Z", end: "2026-07-01T00:00:00Z" });
    expect(quarterOf("2026-10-28T12:00:00Z")).toEqual({ start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" });
    expect(quarterOf("2026-01-05T00:00:00Z")).toEqual({ start: "2026-01-01T00:00:00Z", end: "2026-04-01T00:00:00Z" });
    expect(quarterOf("2026-07-31T00:00:00Z")).toEqual({ start: "2026-07-01T00:00:00Z", end: "2026-10-01T00:00:00Z" });
  });
});

describe("quotaFor", () => {
  test("returns the quota row for the user's current quarter", () => {
    const s = base();
    s.tenants[0] = { ...s.tenants[0], quotas: { "u1": 100_000 } };
    s.quotas.push({
      id: "q1",
      tenantId: "t1",
      userId: "u1",
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2027-01-01T00:00:00Z",
      target: 100_000,
    });
    expect(quotaFor(s, "t1", "u1", "2026-10-28T12:00:00Z")?.target).toBe(100_000);
  });

  test("returns undefined when no quota row exists for the quarter", () => {
    const s = base();
    expect(quotaFor(s, "t1", "u1", "2026-10-28T12:00:00Z")).toBeUndefined();
  });
});

describe("quotaProgress", () => {
  function withDeals(deals: AriaState["deals"]): AriaState {
    const s = base();
    s.deals = deals;
    s.tenants[0] = { ...s.tenants[0], quotas: { "u1": 200_000 } };
    return s;
  }

  const deal = (over: Partial<AriaState["deals"][number]>): AriaState["deals"][number] => ({
    id: "d1",
    tenantId: "t1",
    pipelineId: "p1",
    stageId: "s1",
    accountId: "a1",
    contactId: "c1",
    amount: 0,
    forecastCategory: "pipeline",
    ownerId: "u1",
    expectedCloseDate: "2026-10-15",
    closedAt: null,
    lostReason: null,
    lastStageChangeAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  });

  test("booked = open deals closing in the quarter", () => {
    const s = withDeals([
      deal({ id: "d1", amount: 80_000, expectedCloseDate: "2026-10-20" }),
      deal({ id: "d2", amount: 50_000, expectedCloseDate: "2027-02-01" }), // next quarter
    ]);
    const q = { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };
    const p = quotaProgress(s, "t1", "u1", q);
    expect(p.booked).toBe(80_000);
    expect(p.target).toBe(200_000);
  });

  test("won = closed deals that closed in the quarter", () => {
    const s = withDeals([
      deal({ id: "d1", amount: 120_000, closedAt: "2026-10-15T00:00:00Z", forecastCategory: "closed" }),
      deal({ id: "d2", amount: 90_000, closedAt: "2026-08-15T00:00:00Z", forecastCategory: "closed" }), // prior quarter
    ]);
    const q = { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };
    const p = quotaProgress(s, "t1", "u1", q);
    expect(p.won).toBe(120_000);
  });

  test("remaining clamps at 0 when quota is exceeded", () => {
    const s = withDeals([
      deal({ id: "d1", amount: 250_000, closedAt: "2026-10-15T00:00:00Z", forecastCategory: "closed" }),
      deal({ id: "d2", amount: 40_000, expectedCloseDate: "2026-10-20" }),
    ]);
    const q = { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };
    const p = quotaProgress(s, "t1", "u1", q);
    expect(p.remaining).toBe(0);
  });

  test("scoped to the rep owner (other reps' deals don't count)", () => {
    const s = withDeals([
      deal({ id: "d1", amount: 50_000, ownerId: "u1", expectedCloseDate: "2026-10-20" }),
      deal({ id: "d2", amount: 70_000, ownerId: "u2", expectedCloseDate: "2026-10-20" }),
    ]);
    const q = { start: "2026-10-01T00:00:00Z", end: "2027-01-01T00:00:00Z" };
    expect(quotaProgress(s, "t1", "u1", q).booked).toBe(50_000);
  });
});
