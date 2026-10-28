import { describe, expect, test } from "bun:test";
import {
  byRep,
  commitLadder,
  coverage,
  openDealsFor,
  snapshotMath,
  weightedValue,
} from "./forecast";
import type { AriaDeal, AriaPipeline, AriaState } from "./types";

const PIPELINE: AriaPipeline = {
  id: "p1",
  tenantId: "t1",
  name: "P1",
  stages: [
    { id: "s1", name: "Qualified", probability: 0.15, state: "open" },
    { id: "s2", name: "Demo", probability: 0.35, state: "open" },
    { id: "s3", name: "Proposal", probability: 0.6, state: "open" },
    { id: "s4", name: "Negotiation", probability: 0.85, state: "open" },
    { id: "sw", name: "Won", probability: 1, state: "closed_won" },
    { id: "sl", name: "Lost", probability: 1, state: "closed_lost" },
  ],
  createdAt: "2026-04-01T00:00:00Z",
};

function deal(over: Partial<AriaDeal> = {}): AriaDeal {
  return {
    id: "d1",
    tenantId: "t1",
    pipelineId: "p1",
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
    stageId: "s1",
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
        quotas: { u1: 100_000, u2: 50_000 },
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
    audit: [],
    seq: 0,
  };
}

describe("weightedValue", () => {
  test("= amount × stage probability", () => {
    expect(weightedValue(deal({ stageId: "s1" }), PIPELINE)).toBe(1_500);
    expect(weightedValue(deal({ stageId: "s3" }), PIPELINE)).toBe(6_000);
    expect(weightedValue(deal({ stageId: "sw" }), PIPELINE)).toBe(10_000);
  });

  test("an unknown stage id contributes 0 (fail-closed)", () => {
    expect(weightedValue(deal({ stageId: "nope" }), PIPELINE)).toBe(0);
  });

  test("zero-amount deals contribute 0", () => {
    expect(weightedValue(deal({ stageId: "s2", amount: 0 }), PIPELINE)).toBe(0);
  });
});

describe("snapshotMath", () => {
  test("weightedTotal is the sum of per-deal weighted values", () => {
    const deals = [
      deal({ id: "d1", stageId: "s1", amount: 10_000, forecastCategory: "pipeline" }),
      deal({ id: "d2", stageId: "s3", amount: 20_000, forecastCategory: "commit" }),
    ];
    const m = snapshotMath(deals, PIPELINE);
    expect(m.weightedTotal).toBe(1_500 + 12_000);
    expect(m.dealIds).toEqual(["d1", "d2"]);
  });

  test("byStage and byCategory break down the total (every total recomputable)", () => {
    const deals = [
      deal({ id: "d1", stageId: "s1", amount: 10_000, forecastCategory: "pipeline" }),
      deal({ id: "d2", stageId: "s3", amount: 20_000, forecastCategory: "commit" }),
      deal({ id: "d3", stageId: "s3", amount: 5_000, forecastCategory: "best_case" }),
    ];
    const m = snapshotMath(deals, PIPELINE);
    expect(m.byStage["s1"]).toBe(1_500);
    expect(m.byStage["s3"]).toBe(15_000); // 20k×0.6 + 5k×0.6
    expect(m.byCategory["pipeline"]).toBe(1_500);
    expect(m.byCategory["commit"]).toBe(12_000);
    expect(m.byCategory["best_case"]).toBe(3_000);
    // invariant: the stage breakdown sums to the total
    expect(Object.values(m.byStage).reduce((a, b) => a + b, 0)).toBe(m.weightedTotal);
    expect(Object.values(m.byCategory).reduce((a, b) => a + b, 0)).toBe(m.weightedTotal);
  });

  test("empty input → zero totals, empty dealIds", () => {
    const m = snapshotMath([], PIPELINE);
    expect(m.weightedTotal).toBe(0);
    expect(m.dealIds).toEqual([]);
  });
});

describe("openDealsFor", () => {
  test("only open deals, tenant + optional pipeline scoped", () => {
    const s = stateWith([
      deal({ id: "d1" }),
      deal({ id: "d2", closedAt: "2026-10-01T00:00:00Z", forecastCategory: "closed" }),
      deal({ id: "d3", tenantId: "t2" }),
    ]);
    expect(openDealsFor(s, "t1").map((d) => d.id)).toEqual(["d1"]);
  });

  test("the pipeline filter narrows further", () => {
    const s = stateWith([
      deal({ id: "d1", pipelineId: "p1" }),
      deal({ id: "d2", pipelineId: "p2" }),
    ]);
    expect(openDealsFor(s, "t1", "p1").map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("commitLadder", () => {
  test("commit = commit-category open amounts only", () => {
    const deals = [
      deal({ id: "d1", amount: 100, forecastCategory: "commit" }),
      deal({ id: "d2", amount: 50, forecastCategory: "best_case" }),
      deal({ id: "d3", amount: 25, forecastCategory: "pipeline" }),
      deal({ id: "d4", amount: 999, forecastCategory: "omitted" }),
      deal({ id: "d5", amount: 400, forecastCategory: "closed", closedAt: "2026-09-01T00:00:00Z" }),
    ];
    const l = commitLadder(deals);
    expect(l.commit).toBe(100);
    expect(l.bestCase).toBe(150);
    expect(l.pipeline).toBe(175); // commit + best_case + pipeline; omitted/closed excluded
  });

  test("empty deals → all zeros", () => {
    expect(commitLadder([])).toEqual({ commit: 0, bestCase: 0, pipeline: 0 });
  });
});

describe("coverage", () => {
  test("commit / target", () => {
    expect(coverage(40_000, 80_000)).toBe(0.5);
    expect(coverage(80_000, 80_000)).toBe(1);
  });

  test("a zero target → 0 (the 'n/a' case)", () => {
    expect(coverage(50_000, 0)).toBe(0);
  });
});

describe("byRep", () => {
  test("quota + open commit/best-case amounts + remaining", () => {
    const s = stateWith([
      deal({ id: "d1", ownerId: "u1", amount: 60_000, forecastCategory: "commit" }),
      deal({ id: "d2", ownerId: "u1", amount: 20_000, forecastCategory: "best_case" }),
      deal({ id: "d3", ownerId: "u1", amount: 40_000, forecastCategory: "pipeline" }), // not counted
      deal({ id: "d4", ownerId: "u2", amount: 30_000, forecastCategory: "commit" }),
    ]);
    const r1 = byRep(s, "t1", "u1");
    expect(r1.quota).toBe(100_000);
    expect(r1.actual).toBe(80_000); // commit + best_case only
    expect(r1.remaining).toBe(20_000);
    const r2 = byRep(s, "t1", "u2");
    expect(r2.actual).toBe(30_000);
    expect(r2.remaining).toBe(20_000); // 50k quota − 30k
  });

  test("closed deals don't count toward actual", () => {
    const s = stateWith([
      deal({ id: "d1", ownerId: "u1", amount: 60_000, forecastCategory: "closed", closedAt: "2026-10-01T00:00:00Z" }),
    ]);
    expect(byRep(s, "t1", "u1").actual).toBe(0);
  });

  test("an unknown rep gets a zero quota", () => {
    const s = stateWith([]);
    expect(byRep(s, "t1", "nobody").quota).toBe(0);
  });
});
