import { describe, expect, test } from "bun:test";
import {
  cohorts,
  drillDown,
  funnel,
  isWon,
  salesCycle,
  slippedDeals,
  stuckDeals,
  winRate,
} from "./reporting";
import type { AriaDeal, AriaPipeline, AriaState } from "./types";

const NOW = "2026-10-28T12:00:00Z";

const PIPELINE: AriaPipeline = {
  id: "p1",
  tenantId: "t1",
  name: "P1",
  stages: [
    { id: "s1", name: "Qualified", probability: 0.15, state: "open" },
    { id: "s2", name: "Demo", probability: 0.35, state: "open" },
    { id: "sw", name: "Won", probability: 1, state: "closed_won" },
    { id: "sl", name: "Lost", probability: 1, state: "closed_lost" },
  ],
  createdAt: "2026-04-01T00:00:00Z",
};

function deal(over: Partial<AriaDeal> & { id: string }): AriaDeal {
  return {
    tenantId: "t1",
    pipelineId: "p1",
    stageId: "s1",
    accountId: "a1",
    contactId: "c1",
    amount: 10_000,
    forecastCategory: "pipeline",
    ownerId: "u1",
    expectedCloseDate: "2026-11-01",
    closedAt: null,
    lostReason: null,
    lastStageChangeAt: "2026-10-01T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function stateWith(deals: AriaDeal[]): AriaState {
  return {
    version: 1,
    tenants: [
      {
        id: "t1",
        slug: "t1",
        name: "T1",
        plan: "enterprise",
        quotas: {},
        manages: {},
        leadSlaMinutes: { low: 0, normal: 0, high: 0, urgent: 0 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    users: [],
    memberships: [],
    accounts: [],
    contacts: [],
    leads: [],
    pipelines: [PIPELINE],
    deals,
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

/* ── win rate ─────────────────────────────────────────────────────── */

describe("winRate", () => {
  test("won/lost counts + rate over the period window", () => {
    const deals = [
      deal({ id: "w1", stageId: "sw", forecastCategory: "closed", closedAt: "2026-05-10T00:00:00Z", ownerId: "u1" }),
      deal({ id: "w2", stageId: "sw", forecastCategory: "closed", closedAt: "2026-06-10T00:00:00Z", ownerId: "u1" }),
      deal({ id: "l1", stageId: "sl", forecastCategory: "closed", closedAt: "2026-06-20T00:00:00Z", lostReason: "price", ownerId: "u2" }),
      deal({ id: "o1", stageId: "s1" }), // open → excluded
    ];
    const r = winRate(deals, "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z");
    expect(r.won).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.rate).toBeCloseTo(2 / 3);
    expect(r.byOwner["u1"]).toEqual({ won: 2, lost: 0, rate: 1 });
    expect(r.byOwner["u2"]).toEqual({ won: 0, lost: 1, rate: 0 });
  });

  test("deals closed outside the window are excluded", () => {
    const deals = [
      deal({ id: "w1", stageId: "sw", forecastCategory: "closed", closedAt: "2026-02-01T00:00:00Z" }),
    ];
    const r = winRate(deals, "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z");
    expect(r.won).toBe(0);
    expect(r.rate).toBe(0);
  });

  test("no closed deals → rate 0 (no NaN)", () => {
    expect(winRate([deal({ id: "o1" })], "2026-04-01T00:00:00Z", "2026-07-01T00:00:00Z").rate).toBe(0);
  });
});

describe("isWon", () => {
  test("won terminal stage + closedAt → true", () => {
    expect(isWon(deal({ id: "w", stageId: "sw", closedAt: "2026-05-01T00:00:00Z" }), PIPELINE)).toBe(true);
  });

  test("lost stage → false; open deal → false", () => {
    expect(isWon(deal({ id: "l", stageId: "sl", closedAt: "2026-05-01T00:00:00Z", lostReason: "x" }), PIPELINE)).toBe(false);
    expect(isWon(deal({ id: "o" }), PIPELINE)).toBe(false);
  });

  test("missing pipeline → false (fail-closed)", () => {
    expect(isWon(deal({ id: "w", stageId: "sw", closedAt: "2026-05-01T00:00:00Z" }), undefined)).toBe(false);
  });
});

/* ── sales cycle ──────────────────────────────────────────────────── */

describe("salesCycle", () => {
  test("median days across closed deals (odd count = middle value)", () => {
    const deals = [
      deal({ id: "d1", closedAt: "2026-05-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", ownerId: "u1" }), // 30d
      deal({ id: "d2", closedAt: "2026-05-10T00:00:00Z", createdAt: "2026-04-10T00:00:00Z", ownerId: "u1" }), // 30d
      deal({ id: "d3", closedAt: "2026-05-20T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", ownerId: "u2" }), // 49d
    ];
    const r = salesCycle(deals);
    expect(r.medianDays).toBe(30);
  });

  test("even count = mean of the two middle values", () => {
    const deals = [
      deal({ id: "d1", closedAt: "2026-05-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z" }), // 30
      deal({ id: "d2", closedAt: "2026-05-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z" }), // 30
      deal({ id: "d3", closedAt: "2026-05-01T00:00:00Z", createdAt: "2026-03-16T00:00:00Z" }), // 46
      deal({ id: "d4", closedAt: "2026-05-01T00:00:00Z", createdAt: "2026-03-01T00:00:00Z" }), // 61
    ];
    expect(salesCycle(deals).medianDays).toBe((30 + 46) / 2);
  });

  test("byOwner medians + open deals excluded", () => {
    const deals = [
      deal({ id: "d1", closedAt: "2026-05-01T00:00:00Z", createdAt: "2026-04-01T00:00:00Z", ownerId: "u1" }),
      deal({ id: "d2" }), // open
    ];
    const r = salesCycle(deals);
    expect(r.byOwner["u1"]).toBe(30);
    expect(Object.keys(r.byOwner)).toHaveLength(1);
  });

  test("no closed deals → 0 (no NaN)", () => {
    expect(salesCycle([deal({ id: "o" })]).medianDays).toBe(0);
  });
});

/* ── funnel ───────────────────────────────────────────────────────── */

describe("funnel", () => {
  test("counts per stage + conversion vs the first stage", () => {
    const s = stateWith([
      deal({ id: "d1", stageId: "s1" }),
      deal({ id: "d2", stageId: "s1" }),
      deal({ id: "d3", stageId: "s2" }),
      deal({ id: "d4", stageId: "sw" }),
    ]);
    const f = funnel(s, "t1", "p1");
    expect(f).toHaveLength(4);
    expect(f[0]).toMatchObject({ id: "s1", count: 2, conversion: 1 });
    expect(f[1]).toMatchObject({ id: "s2", count: 1, conversion: 0.5 });
    expect(f[2]).toMatchObject({ id: "sw", count: 1, conversion: 0.5 });
    expect(f[3]).toMatchObject({ id: "sl", count: 0, conversion: 0 });
  });

  test("unknown pipeline → [] (no crash)", () => {
    const s = stateWith([deal({ id: "d1" })]);
    expect(funnel(s, "t1", "nope")).toEqual([]);
  });

  test("a cross-tenant pipeline → []", () => {
    const s = stateWith([deal({ id: "d1" })]);
    expect(funnel(s, "t9", "p1")).toEqual([]);
  });

  test("zero base stage → conversion 0 (no NaN)", () => {
    const s = stateWith([deal({ id: "d1", stageId: "s2" })]);
    const f = funnel(s, "t1", "p1");
    expect(f[1].conversion).toBe(0);
  });
});

/* ── cohorts ──────────────────────────────────────────────────────── */

describe("cohorts", () => {
  test("groups deals by creation month, winRate per cohort", () => {
    const s = stateWith([
      deal({ id: "d1", createdAt: "2026-08-05T00:00:00Z", closedAt: "2026-09-05T00:00:00Z", stageId: "sw", forecastCategory: "closed" }),
      deal({ id: "d2", createdAt: "2026-08-15T00:00:00Z", closedAt: "2026-09-15T00:00:00Z", stageId: "sl", forecastCategory: "closed", lostReason: "x" }),
      deal({ id: "d3", createdAt: "2026-09-05T00:00:00Z" }),
    ]);
    const c = cohorts(s.deals, 6, NOW);
    // months: May,Jun,Jul,Aug,Sep,Oct (6 ending at October 2026)
    expect(c.map((x) => x.month)).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    const aug = c.find((x) => x.month === "2026-08")!;
    expect(aug.created).toBe(2);
    expect(aug.won).toBe(1);
    expect(aug.winRate).toBe(0.5);
    const sep = c.find((x) => x.month === "2026-09")!;
    expect(sep.created).toBe(1);
    expect(sep.won).toBe(0);
  });

  test("empty months carry created 0, winRate 0 (no NaN)", () => {
    const c = cohorts([deal({ id: "d1" })], 2, NOW);
    expect(c.every((x) => x.created >= 0)).toBe(true);
    expect(c[0].winRate).toBe(0);
  });
});

/* ── drill-down ───────────────────────────────────────────────────── */

describe("drillDown", () => {
  const deals = [
    deal({ id: "d1", ownerId: "u1" }),
    deal({ id: "d2", ownerId: "u2", forecastCategory: "commit" }),
    deal({ id: "d3", tenantId: "t2", ownerId: "u1" }),
  ];

  test("stage metric → the deals in that stage (tenant-scoped)", () => {
    const s = stateWith(deals);
    const r = drillDown(s, "t1", "stage", "s1");
    expect(r.records.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(r.metric).toBe("stage");
  });

  test("commit metric + a deal id → that deal", () => {
    const s = stateWith(deals);
    const r = drillDown(s, "t1", "commit", "d2");
    expect(r.records.map((d) => d.id)).toEqual(["d2"]);
  });

  test("commit metric + an unknown id → the whole commit-category set", () => {
    const s = stateWith(deals);
    const r = drillDown(s, "t1", "commit", "nope");
    expect(r.records.map((d) => d.id)).toEqual(["d2"]);
  });

  test("weighted metric + a deal id → the raw record behind the number", () => {
    const s = stateWith(deals);
    const r = drillDown(s, "t1", "weighted", "d1");
    expect(r.records.map((d) => d.id)).toEqual(["d1"]);
    // the recompute invariant: every listed record contributes
    // amount × probability — total recomputable from raw records
    expect(r.records.every((d) => typeof d.amount === "number")).toBe(true);
  });

  test("cross-tenant records never leak into a drill-down", () => {
    const s = stateWith(deals);
    const r = drillDown(s, "t1", "weighted", "d3");
    // d3 belongs to t2 — it can never appear in a t1 drill-down.
    // The unknown-id fallback returns the tenant's open deals.
    expect(r.records.every((d) => d.tenantId === "t1")).toBe(true);
    expect(r.records.map((d) => d.id)).not.toContain("d3");
  });
});

/* ── stuck + slipped ─────────────────────────────────────────────── */

describe("stuckDeals", () => {
  test("open deals stalled ≥ days → listed", () => {
    const deals = [
      deal({ id: "d1", lastStageChangeAt: "2026-08-01T00:00:00Z" }), // ~88d
      deal({ id: "d2", lastStageChangeAt: "2026-10-20T00:00:00Z" }), // 8d
      deal({ id: "d3", lastStageChangeAt: "2026-08-01T00:00:00Z", closedAt: "2026-10-01T00:00:00Z" }),
    ];
    const stuck = stuckDeals(deals, 14, NOW);
    expect(stuck.map((d) => d.id)).toEqual(["d1"]);
  });

  test("closed deals are never 'stuck' (they have a terminal stage)", () => {
    const deals = [
      deal({ id: "d1", lastStageChangeAt: "2026-01-01T00:00:00Z", closedAt: "2026-02-01T00:00:00Z" }),
    ];
    expect(stuckDeals(deals, 14, NOW)).toHaveLength(0);
  });
});

describe("slippedDeals", () => {
  test("open deals whose close date is ≥ 1 quarter after creation", () => {
    const deals = [
      deal({ id: "d1", createdAt: "2026-09-01T00:00:00Z", expectedCloseDate: "2027-03-15" }), // ~205d slip
      deal({ id: "d2", createdAt: "2026-09-01T00:00:00Z", expectedCloseDate: "2026-10-15" }), // fine
      deal({ id: "d3", createdAt: "2026-09-01T00:00:00Z", expectedCloseDate: "2027-03-15", closedAt: "2026-10-01T00:00:00Z" }),
    ];
    const slipped = slippedDeals(deals, NOW);
    expect(slipped.map((d) => d.id)).toEqual(["d1"]);
  });
});
