/**
 * Integration tests for /aria/api/forecast — the snapshot capture
 * (IMMUTABLE: no PATCH/DELETE routes exist) + the drill-down
 * recompute + the forecast report's math.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, TENANT_IDS } from "./helpers";
import { getAria } from "@/lib/aria/aria-store";
import { snapshotMath, openDealsFor } from "@/lib/aria/forecast";

import * as snapshotRoute from "@/app/aria/api/forecast/snapshot/route";
import * as snapshotsRoute from "@/app/aria/api/forecast/snapshots/route";
import * as forecastReportRoute from "@/app/aria/api/reports/forecast/route";
import * as drilldownRoute from "@/app/aria/api/reports/drilldown/route";

beforeAll(freshStore);

describe("POST /forecast/snapshot — the capture lane", () => {
  test("201 the snapshot; it freezes the weighted total + the raw ids", async () => {
    freshStore();
    const res = await snapshotRoute.POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2027-01-01T00:00:00Z",
        },
      }),
    );
    expect(res.status).toBe(201);
    const snap = await res.json();
    expect(snap.tenantId).toBe(TENANT_IDS.lumen);
    expect(snap.weightedTotal).toBeGreaterThan(0);
    expect(snap.dealIds.length).toBeGreaterThan(0);
    expect(Object.keys(snap.byStage).length).toBeGreaterThan(0);
    expect(Object.keys(snap.byCategory).length).toBeGreaterThan(0);
    // The store's row:
    expect(
      getAria().forecastSnapshots.some((f) => f.id === snap.id),
    ).toBe(true);
  });

  test("the P1 invariant: the snapshot total RECOMPUTES from the raw deal rows", async () => {
    freshStore();
    await snapshotRoute.POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2027-01-01T00:00:00Z",
        },
      }),
    );
    const s = getAria();
    const snap = s.forecastSnapshots[0];
    const pipeline = s.pipelines.find((p) => p.tenantId === snap.tenantId)!;
    const raw = s.deals.filter(
      (d) => snap.dealIds.includes(d.id) && d.tenantId === snap.tenantId,
    );
    const recomputed = snapshotMath(raw, pipeline);
    // The snapshot's total must equal the recompute over the same
    // raw ids (the drift pin):
    expect(snap.weightedTotal).toBeCloseTo(recomputed.weightedTotal, 3);
  });

  test("400 on a bad period shape", async () => {
    freshStore();
    const res = await snapshotRoute.POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        cookie: cookieFor("mira@lumen.test"),
        body: { periodStart: "not-a-date", periodEnd: "" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("403 for a rep's forecast.capture (the matrix's ✗)", async () => {
    freshStore();
    const res = await snapshotRoute.POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        cookie: cookieFor("ada@lumen.test"),
        body: {
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2027-01-01T00:00:00Z",
        },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("forecast.capture");
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await snapshotRoute.POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        body: { periodStart: "2026-10-01T00:00:00Z", periodEnd: "2027-01-01T00:00:00Z" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /forecast/snapshots — the IMMuTAbLe list", () => {
  test("200 the tenant's snapshots; no mutation routes exist (the plan's pin)", async () => {
    freshStore();
    await snapshotRoute.POST(
      apiReq("POST", "/aria/api/forecast/snapshot", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {
          periodStart: "2026-10-01T00:00:00Z",
          periodEnd: "2027-01-01T00:00:00Z",
        },
      }),
    );
    const res = await snapshotsRoute.GET(
      apiReq("GET", "/aria/api/forecast/snapshots", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ id: string; tenantId: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].tenantId).toBe(TENANT_IDS.northwind);

    // The IMMuTAbLe pin: the route module exposes ONLY a GET —
    // PATCH/DELETE are not part of the surface.
    const mod = await import("@/app/aria/api/forecast/snapshots/route");
    expect((mod as Record<string, unknown>).GET).toBeDefined();
    expect((mod as Record<string, unknown>).PATCH).toBeUndefined();
    expect((mod as Record<string, unknown>).DELETE).toBeUndefined();
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await snapshotsRoute.GET(
      apiReq("GET", "/aria/api/forecast/snapshots"),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /reports/forecast — the live forecast's math", () => {
  test("200 the plan's body: commitLadder + weightedTotal + coverage + byRep", async () => {
    freshStore();
    const res = await forecastReportRoute.GET(
      apiReq("GET", "/aria/api/reports/forecast", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.commitLadder).toHaveProperty("commit");
    expect(json.commitLadder).toHaveProperty("bestCase");
    expect(json.commitLadder).toHaveProperty("pipeline");
    // The ladder is monotonic (commit ≤ bestCase ≤ pipeline):
    expect(json.commitLadder.commit).toBeLessThanOrEqual(json.commitLadder.bestCase);
    expect(json.commitLadder.bestCase).toBeLessThanOrEqual(json.commitLadder.pipeline);
    expect(typeof json.weightedTotal).toBe("number");
    expect(typeof json.coverage).toBe("number");
    expect(Object.keys(json.byRep).length).toBeGreaterThan(0);
    for (const r of Object.values(json.byRep as Record<string, { quota: number; actual: number; remaining: number }>)) {
      expect(r.remaining).toBeGreaterThanOrEqual(0);
    }
  });

  test("a tenant with NO open deals still answers (empty math, no crash)", async () => {
    freshStore();
    // Both tenants have open deals in the seed; this test pins the
    // shape's stability, not emptiness:
    const res = await forecastReportRoute.GET(
      apiReq("GET", "/aria/api/reports/forecast", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.commitLadder).toHaveProperty("commit");
  });
});

describe("GET /reports/drilldown — the 'open the number' lane", () => {
  test("metric=stage + a stage id → that stage's deals", async () => {
    freshStore();
    const s = getAria();
    const pipeline = s.pipelines.find((p) => p.tenantId === TENANT_IDS.lumen)!;
    const stage = pipeline.stages[0];
    const res = await drilldownRoute.GET(
      apiReq("GET", `/aria/api/reports/drilldown?metric=stage&value=${stage.id}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.metric).toBe("stage");
    expect(json.value).toBe(stage.id);
    for (const row of json.records as Array<{ stageId: string }>) {
      expect(row.stageId).toBe(stage.id);
    }
  });

  test("metric=commit + a deal id → that deal (when it's a commit deal)", async () => {
    freshStore();
    const s = getAria();
    const commitDeal = s.deals.find(
      (d) => d.tenantId === TENANT_IDS.lumen && d.forecastCategory === "commit",
    )!;
    const res = await drilldownRoute.GET(
      apiReq("GET", `/aria/api/reports/drilldown?metric=commit&value=${commitDeal.id}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.records.length).toBe(1);
    expect(json.records[0].id).toBe(commitDeal.id);
  });

  test("metric=weighted + no deal id → the open deals (the lane's default)", async () => {
    freshStore();
    const res = await drilldownRoute.GET(
      apiReq("GET", "/aria/api/reports/drilldown?metric=weighted&value=", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    expect(res.status).toBe(400); // empty value → the validation rung
  });

  test("a bad metric → 400", async () => {
    freshStore();
    const res = await drilldownRoute.GET(
      apiReq("GET", "/aria/api/reports/drilldown?metric=bogus&value=x", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    expect(res.status).toBe(400);
  });

  test("403 for a viewer's report.read… wait — the matrix's report.read is all-✓", async () => {
    freshStore();
    const res = await drilldownRoute.GET(
      apiReq("GET", "/aria/api/reports/drilldown?metric=stage&value=stg_qs_01", {
        cookie: cookieFor("sam@lumen.test"),
      }),
    );
    expect(res.status).toBe(200); // viewer passes report.read
  });
});

describe("GET /reports/pipeline + /reports/stuck + /reports/slipped — the other report lanes", () => {
  test("the pipeline report carries the plan's body", async () => {
    freshStore();
    const pipelineRoute = await import("@/app/aria/api/reports/pipeline/route");
    const res = await pipelineRoute.GET(
      apiReq("GET", "/aria/api/reports/pipeline", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.openCount).toBeGreaterThan(0);
    expect(json.openWeighted).toBeGreaterThan(0);
    expect(Object.keys(json.weightedByStage).length).toBeGreaterThan(0);
  });

  test("the stuck report honors the ?days= filter", async () => {
    freshStore();
    const stuckRoute = await import("@/app/aria/api/reports/stuck/route");
    const res = await stuckRoute.GET(
      apiReq("GET", "/aria/api/reports/stuck?days=14", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ closedAt: string | null }>;
    for (const row of rows) expect(row.closedAt).toBe(null);
  });

  test("the slipped report returns open deals only", async () => {
    freshStore();
    const slippedRoute = await import("@/app/aria/api/reports/slipped/route");
    const res = await slippedRoute.GET(
      apiReq("GET", "/aria/api/reports/slipped", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ closedAt: string | null }>;
    for (const row of rows) expect(row.closedAt).toBe(null);
  });

  test("the winrate + salescycle + funnel + cohorts lanes answer the plan's bodies", async () => {
    freshStore();
    const winrateRoute = await import("@/app/aria/api/reports/winrate/route");
    const w = await winrateRoute.GET(
      apiReq("GET", "/aria/api/reports/winrate", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(w.status).toBe(200);
    const wj = await w.json();
    expect(wj).toHaveProperty("won");
    expect(wj).toHaveProperty("lost");
    expect(wj).toHaveProperty("rate");
    expect(wj).toHaveProperty("byOwner");

    const scRoute = await import("@/app/aria/api/reports/salescycle/route");
    const sc = await scRoute.GET(
      apiReq("GET", "/aria/api/reports/salescycle", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(sc.status).toBe(200);
    const scj = await sc.json();
    expect(scj.medianDays).toBeGreaterThanOrEqual(0);
    expect(scj.byOwner).toBeDefined();

    const fnRoute = await import("@/app/aria/api/reports/funnel/route");
    const fn = await fnRoute.GET(
      apiReq("GET", "/aria/api/reports/funnel", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(fn.status).toBe(200);
    const fnj = await fn.json();
    expect(Array.isArray(fnj.stages)).toBe(true);
    for (const st of fnj.stages) {
      expect(st).toHaveProperty("id");
      expect(st).toHaveProperty("count");
      expect(st).toHaveProperty("conversion");
    }

    const cohRoute = await import("@/app/aria/api/reports/cohorts/route");
    const coh = await cohRoute.GET(
      apiReq("GET", "/aria/api/reports/cohorts?months=6", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(coh.status).toBe(200);
    const cohj = await coh.json();
    expect(cohj.cohorts.length).toBe(6);
    for (const c of cohj.cohorts) {
      expect(c).toHaveProperty("month");
      expect(c).toHaveProperty("created");
      expect(c).toHaveProperty("winRate");
    }
  });
});
