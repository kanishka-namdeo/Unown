import { describe, expect, test } from "bun:test";
import {
  anomalies,
  amountOutliers,
  dealHealth,
  forecastDrift,
  leadScore,
  quarterEndBunching,
  sigmaBand,
  topLeads,
  worstDeals,
} from "./triage";
import type { AriaDeal, AriaLead, AriaState } from "./types";

const NOW = "2026-10-28T12:00:00Z";

function lead(over: Partial<AriaLead> & { id: string }): AriaLead {
  return {
    tenantId: "t1",
    status: "new",
    source: "inbound",
    priority: "normal",
    firstResponseAt: null,
    slaDueAt: "2026-10-29T00:00:00Z",
    converted: null,
    ownerId: "u1",
    createdAt: "2026-10-27T00:00:00Z",
    ...over,
  };
}

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
    expectedCloseDate: "2026-11-15",
    closedAt: null,
    lostReason: null,
    lastStageChangeAt: "2026-10-20T00:00:00Z",
    createdAt: "2026-09-01T00:00:00Z",
    ...over,
  };
}

function stateWith(deals: AriaDeal[], leads: AriaLead[] = [], extra: Partial<AriaState> = {}): AriaState {
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
    leads,
    pipelines: [
      {
        id: "p1",
        tenantId: "t1",
        name: "P1",
        stages: [
          { id: "s1", name: "Qualified", probability: 0.2, state: "open" },
          { id: "s2", name: "Demo", probability: 0.5, state: "open" },
          { id: "sw", name: "Won", probability: 1, state: "closed_won" },
          { id: "sl", name: "Lost", probability: 1, state: "closed_lost" },
        ],
        createdAt: "2026-04-01T00:00:00Z",
      },
    ],
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
    ...extra,
  };
}

describe("leadScore", () => {
  test("components always sum to exactly 100", () => {
    const s = stateWith([], [lead({ id: "l1", priority: "urgent", source: "demo", createdAt: "2026-10-26T00:00:00Z" })]);
    const r = leadScore(s.leads[0], s, NOW);
    expect(r.components.reduce((a, c) => a + c.value, 0)).toBeLessThanOrEqual(100);
    expect(r.components.map((c) => c.name)).toEqual(["priority", "source", "recency", "freshness"]);
    // weights sum to 100 (the documented shape)
    expect(r.components.reduce((a, c) => a + c.weight, 0)).toBe(100);
  });

  test("score is always in 0..100", () => {
    for (const p of ["low", "normal", "high", "urgent"] as const) {
      const s = stateWith([], [lead({ id: "l", priority: p })]);
      const r = leadScore(s.leads[0], s, NOW);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  test("urgent + high-intent source + fresh + unresponded → the max fixture", () => {
    const s = stateWith([], [
      lead({ id: "l1", priority: "urgent", source: "demo", createdAt: "2026-10-27T00:00:00Z" }),
    ]);
    const r = leadScore(s.leads[0], s, NOW);
    expect(r.score).toBeGreaterThan(80);
  });

  test("low priority + old + responded → the low fixture", () => {
    const s = stateWith([], [
      lead({
        id: "l1",
        priority: "low",
        source: "outbound-cold",
        createdAt: "2026-01-01T00:00:00Z",
        firstResponseAt: "2026-01-02T00:00:00Z",
      }),
    ]);
    const r = leadScore(s.leads[0], s, NOW);
    expect(r.score).toBeLessThan(40);
  });

  test("determinism: two calls → identical output", () => {
    const s = stateWith([], [lead({ id: "l1" })]);
    expect(leadScore(s.leads[0], s, NOW)).toEqual(leadScore(s.leads[0], s, NOW));
  });
});

describe("topLeads", () => {
  test("returns the top-N by score, deterministic tie-break on createdAt", () => {
    const s = stateWith([], [
      lead({ id: "l1", priority: "urgent", createdAt: "2026-10-27T00:00:00Z" }),
      lead({ id: "l2", priority: "low", createdAt: "2026-10-27T00:00:00Z" }),
      lead({ id: "l3", priority: "high", createdAt: "2026-10-28T00:00:00Z" }),
    ]);
    const top = topLeads(s, "t1", 2, NOW);
    expect(top).toHaveLength(2);
    expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
  });

  test("is tenant-scoped", () => {
    const s = stateWith([], [lead({ id: "l1" }), lead({ id: "l2", tenantId: "t2" })]);
    expect(topLeads(s, "t1", 10, NOW)).toHaveLength(1);
  });

  test("top larger than the pool returns the whole pool", () => {
    const s = stateWith([], [lead({ id: "l1" })]);
    expect(topLeads(s, "t1", 99, NOW)).toHaveLength(1);
  });
});

describe("dealHealth", () => {
  test("won deals grade A + a close-out NBA", () => {
    const s = stateWith([deal({ id: "d1", stageId: "sw", closedAt: "2026-10-01T00:00:00Z", forecastCategory: "closed" })]);
    const h = dealHealth(s.deals[0], s, NOW);
    expect(h.healthGrade).toBe("A");
    expect(h.nextBestAction).toMatch(/expansion/i);
  });

  test("lost deals grade C + a post-mortem NBA", () => {
    const s = stateWith([deal({ id: "d1", stageId: "sl", closedAt: "2026-10-01T00:00:00Z", forecastCategory: "closed", lostReason: "price" })]);
    const h = dealHealth(s.deals[0], s, NOW);
    expect(h.healthGrade).toBe("C");
    expect(h.signals.join()).toMatch(/price/);
    expect(h.nextBestAction).toMatch(/post-mortem/i);
  });

  test("a fresh open deal grades A (no stall, future close date)", () => {
    const s = stateWith([deal({ id: "d1", lastStageChangeAt: "2026-10-27T00:00:00Z", expectedCloseDate: "2026-11-30", createdAt: "2026-10-25T00:00:00Z" })]);
    const h = dealHealth(s.deals[0], s, NOW);
    expect(h.healthGrade).toBe("A");
    expect(h.signals).toHaveLength(0);
  });

  test("stalled ≥ 21d → C with a stalled signal", () => {
    const s = stateWith([deal({ id: "d1", lastStageChangeAt: "2026-08-01T00:00:00Z" })]);
    const h = dealHealth(s.deals[0], s, NOW);
    expect(h.healthGrade).toBe("C");
    expect(h.signals.join()).toMatch(/stalled/i);
  });

  test("aging 14-20d → B with an aging signal", () => {
    const s = stateWith([deal({ id: "d1", lastStageChangeAt: "2026-10-10T00:00:00Z" })]); // 18d
    expect(dealHealth(s.deals[0], s, NOW).healthGrade).toBe("B");
  });

  test("past expected close → a notch down", () => {
    const s = stateWith([deal({ id: "d1", lastStageChangeAt: "2026-10-27T00:00:00Z", expectedCloseDate: "2026-10-01" })]);
    const h = dealHealth(s.deals[0], s, NOW);
    expect(h.healthGrade).toBe("B");
    expect(h.signals.join()).toMatch(/close date/i);
  });

  test("omitted category → a notch down with an excluded signal", () => {
    const s = stateWith([deal({ id: "d1", lastStageChangeAt: "2026-10-27T00:00:00Z", expectedCloseDate: "2026-11-30", forecastCategory: "omitted" })]);
    const h = dealHealth(s.deals[0], s, NOW);
    expect(h.healthGrade).toBe("B");
    expect(h.signals.join()).toMatch(/excluded/i);
  });

  test("D grade: multiple notches stack", () => {
    const s = stateWith([deal({ id: "d1", lastStageChangeAt: "2026-06-01T00:00:00Z", expectedCloseDate: "2026-09-01", forecastCategory: "omitted" })]);
    expect(dealHealth(s.deals[0], s, NOW).healthGrade).toBe("D");
  });

  test("worstDeals ranks D first, deterministic", () => {
    const s = stateWith([
      deal({ id: "d1", lastStageChangeAt: "2026-06-01T00:00:00Z", expectedCloseDate: "2026-09-01", forecastCategory: "omitted" }),
      deal({ id: "d2", lastStageChangeAt: "2026-10-01T00:00:00Z", expectedCloseDate: "2026-11-30", createdAt: "2026-09-28T00:00:00Z" }), // 27d stall → D
      deal({ id: "d3", lastStageChangeAt: "2026-09-15T00:00:00Z", expectedCloseDate: "2026-11-01", createdAt: "2026-09-15T00:00:00Z" }), // 43d stall → C
      deal({ id: "d4", lastStageChangeAt: "2026-10-27T00:00:00Z", expectedCloseDate: "2026-11-30", createdAt: "2026-10-20T00:00:00Z" }), // fresh → A
    ]);
    const w = worstDeals(s, "t1", 4, NOW);
    expect(w.map((x) => x.healthGrade)).toEqual(["D", "C", "C", "A"]); // worst-first
    // deterministic: two calls deep-equal
    expect(worstDeals(s, "t1", 4, NOW)).toEqual(w);
  });
});

describe("sigmaBand + amountOutliers", () => {
  test("sigmaBand: mean/sigma/2σ upper over a known set", () => {
    const b = sigmaBand([10, 10, 10, 10, 10, 100]);
    const mean = (10 * 5 + 100) / 6;
    expect(b.mean).toBeCloseTo(mean);
    expect(b.upper).toBeCloseTo(mean + 2 * b.sigma);
  });

  test("empty set → all zeros (no NaN)", () => {
    expect(sigmaBand([])).toEqual({ mean: 0, sigma: 0, upper: 0 });
  });

  test("fewer than 3 closed deals → no band, no outliers", () => {
    const s = stateWith(
      [deal({ id: "o1" }), deal({ id: "c1", closedAt: "2026-10-01T00:00:00Z", forecastCategory: "closed" })],
    );
    expect(amountOutliers(s, "t1")).toEqual([]);
  });

  test("an open deal far above mean+2σ of closed amounts is flagged", () => {
    const s = stateWith([
      deal({ id: "c1", closedAt: "2026-09-01T00:00:00Z", forecastCategory: "closed", amount: 10_000 }),
      deal({ id: "c2", closedAt: "2026-09-01T00:00:00Z", forecastCategory: "closed", amount: 11_000 }),
      deal({ id: "c3", closedAt: "2026-09-01T00:00:00Z", forecastCategory: "closed", amount: 12_000 }),
      deal({ id: "o1", amount: 90_000 }),
    ]);
    expect(amountOutliers(s, "t1").map((d) => d.id)).toEqual(["o1"]);
  });
});

describe("forecastDrift", () => {
  test("no snapshot → no drift (nothing to drift against)", () => {
    const s = stateWith([deal({ id: "d1" })]);
    expect(forecastDrift(s, "t1")).toEqual([]);
  });

  test("a deal weighted up > 25% since the snapshot is flagged", () => {
    const s = stateWith([
      deal({ id: "d1", stageId: "s2", amount: 10_000 }),
    ], [], {
      forecastSnapshots: [
        {
          id: "snap1",
          tenantId: "t1",
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-12-31T00:00:00Z",
          capturedAt: "2026-10-05T00:00:00Z",
          weightedTotal: 2_000,
          byStage: { s1: 2_000, s2: 0 },
          byCategory: { pipeline: 2_000 },
          dealIds: ["d1"],
        },
      ],
    });
    // d1 was in stage s1 (20% → 2000) at capture; it is now in s2 (50% → 5000) → 2.5× drift
    expect(forecastDrift(s, "t1").map((d) => d.id)).toEqual(["d1"]);
  });

  test("unchanged deals are not flagged", () => {
    const s = stateWith([deal({ id: "d1", stageId: "s1", amount: 10_000 })], [], {
      forecastSnapshots: [
        {
          id: "snap1",
          tenantId: "t1",
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-12-31T00:00:00Z",
          capturedAt: "2026-10-05T00:00:00Z",
          weightedTotal: 2_000,
          byStage: { s1: 2_000 },
          byCategory: { pipeline: 2_000 },
          dealIds: ["d1"],
        },
      ],
    });
    expect(forecastDrift(s, "t1")).toEqual([]);
  });

  test("the latest snapshot wins when several exist", () => {
    const s = stateWith([deal({ id: "d1", stageId: "s2", amount: 10_000 })], [], {
      forecastSnapshots: [
        {
          id: "snap-old",
          tenantId: "t1",
          periodStart: "2026-07-01T00:00:00Z",
          periodEnd: "2026-09-30T00:00:00Z",
          capturedAt: "2026-09-01T00:00:00Z",
          weightedTotal: 0,
          byStage: { s1: 0, s2: 0 },
          byCategory: {},
          dealIds: [], // the old snapshot knows nothing → no drift
        },
        {
          id: "snap-new",
          tenantId: "t1",
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2026-12-31T00:00:00Z",
          capturedAt: "2026-10-05T00:00:00Z",
          weightedTotal: 2_000,
          byStage: { s1: 2_000, s2: 0 },
          byCategory: { pipeline: 2_000 },
          dealIds: ["d1"],
        },
      ],
    });
    expect(forecastDrift(s, "t1").map((d) => d.id)).toEqual(["d1"]);
  });
});

describe("quarterEndBunching", () => {
  test("open deals closing in the last 5 days of the quarter → flagged", () => {
    // Q4 2026: the quarter containing AS_OF ends 2027-01-01.
    const s = stateWith([
      deal({ id: "d1", expectedCloseDate: "2026-12-30" }),
      deal({ id: "d2", expectedCloseDate: "2026-12-01" }), // not the last 5 days
    ]);
    expect(quarterEndBunching(s, "t1", "2026-12-28T00:00:00Z").map((d) => d.id)).toEqual(["d1"]);
  });

  test("closed deals never bunch", () => {
    const s = stateWith([deal({ id: "d1", expectedCloseDate: "2026-12-30", closedAt: "2026-12-30T00:00:00Z", forecastCategory: "closed" })]);
    expect(quarterEndBunching(s, "t1", "2026-12-28T00:00:00Z")).toEqual([]);
  });

  test("cross-tenant deals never leak", () => {
    const s = stateWith([deal({ id: "d1", expectedCloseDate: "2026-12-30" })]);
    s.deals[0].tenantId = "t2";
    expect(quarterEndBunching(s, "t1", "2026-12-28T00:00:00Z")).toEqual([]);
  });
});

describe("anomalies (the combined report)", () => {
  test("returns all three detector shapes, deterministic", () => {
    const s = stateWith([
      deal({ id: "c1", closedAt: "2026-09-01T00:00:00Z", forecastCategory: "closed", amount: 10_000 }),
      deal({ id: "c2", closedAt: "2026-09-01T00:00:00Z", forecastCategory: "closed", amount: 10_500 }),
      deal({ id: "c3", closedAt: "2026-09-01T00:00:00Z", forecastCategory: "closed", amount: 9_800 }),
      deal({ id: "o1", amount: 500_000, expectedCloseDate: "2026-12-29" }),
    ]);
    const a = anomalies(s, "t1", "2026-12-28T00:00:00Z");
    expect(a.map((x) => x.type)).toEqual(["amount_outlier", "forecast_drift", "quarter_end_bunching"]);
    expect(a[0].deals.map((d) => d.id)).toEqual(["o1"]);
    expect(a[2].deals.map((d) => d.id)).toEqual(["o1"]);
    expect(anomalies(s, "t1", "2026-12-28T00:00:00Z")).toEqual(a);
  });
});
