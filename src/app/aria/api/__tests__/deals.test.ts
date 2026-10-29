/**
 * Integration tests for /aria/api/pipelines + /aria/api/deals —
 * CRUD + the stage-transition gates (the lost-reason 400 + the
 * closed-deal never-reopen P0 invariant).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  apiReq,
  cookieFor,
  freshStore,
  openDealFor,
  seededIdFor,
  TENANT_IDS,
} from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as pipelinesRoute from "@/app/aria/api/pipelines/route";
import * as pipelinesIdRoute from "@/app/aria/api/pipelines/[id]/route";
import * as dealsRoute from "@/app/aria/api/deals/route";
import * as dealsIdRoute from "@/app/aria/api/deals/[id]/route";
import * as dealStageRoute from "@/app/aria/api/deals/[id]/stage/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("pipelines — list + create + the plan-cap 402", () => {
  test("GET 200 the tenant's pipelines; each carries its stages", async () => {
    freshStore();
    const res = await pipelinesRoute.GET(
      apiReq("GET", "/aria/api/pipelines", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ stages: unknown[] }>;
    expect(rows.length).toBe(3); // northwind's 3 seeded pipelines
    for (const row of rows) {
      expect(row.stages.length).toBeGreaterThan(0);
      expect(row.stages[0]).toHaveProperty("probability");
    }
  });

  test("POST 402 at the starter plan's pipeline cap (lumen = 1)", async () => {
    freshStore();
    // Lumen is starter: 1 pipeline seeded → already AT the cap.
    const res = await pipelinesRoute.POST(
      apiReq("POST", "/aria/api/pipelines", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          name: "Overflow",
          stages: [
            { name: "S1", probability: 0.5, state: "open" },
            { name: "Won", probability: 1, state: "closed_won" },
          ],
        },
      }),
    );
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe("quota_exceeded");
  });

  test("POST 403 for a manager's pipeline.create", async () => {
    freshStore();
    const res = await pipelinesRoute.POST(
      apiReq("POST", "/aria/api/pipelines", {
        cookie: cookieFor("priya@northwind.test"),
        body: {
          name: "Nope",
          stages: [{ name: "S", probability: 0.5, state: "open" }],
        },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("pipeline.create");
  });

  test("POST 400 on a bad stages array (empty + bad probability)", async () => {
    freshStore();
    const res = await pipelinesRoute.POST(
      apiReq("POST", "/aria/api/pipelines", {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {
          name: "Bad",
          stages: [{ name: "", probability: 5, state: "bogus" }],
        },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /pipelines/[id] + PATCH", () => {
  test("200 the pipeline + its deals; 404 cross-tenant", async () => {
    freshStore();
    const lumenP = seededIdFor(TENANT_IDS.lumen, "pipeline", 0);

    const ok = await pipelinesIdRoute.GET(
      apiReq("GET", `/aria/api/pipelines/${lumenP}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params(lumenP),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.pipeline.id).toBe(lumenP);
    expect(Array.isArray(json.deals)).toBe(true);

    const cross = await pipelinesIdRoute.GET(
      apiReq("GET", `/aria/api/pipelines/${lumenP}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(lumenP),
    );
    expect(cross.status).toBe(404);
  });

  test("PATCH 200 a rename (owner lane)", async () => {
    freshStore();
    const p = seededIdFor(TENANT_IDS.lumen, "pipeline", 0);
    const res = await pipelinesIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/pipelines/${p}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { name: "Renamed" },
      }),
      params(p),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.name).toBe("Renamed");
  });
});

describe("GET /deals — filters + visibility", () => {
  test("200 the open deals; ?status=open never returns closed rows", async () => {
    freshStore();
    const res = await dealsRoute.GET(
      apiReq("GET", "/aria/api/deals?status=open", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ closedAt: string | null }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.closedAt).toBe(null);
  });

  test("?forecastCategory=commit returns only commit-category rows", async () => {
    freshStore();
    const res = await dealsRoute.GET(
      apiReq("GET", "/aria/api/deals?forecastCategory=commit", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ forecastCategory: string }>;
    for (const row of rows) expect(row.forecastCategory).toBe("commit");
  });

  test("a rep's list narrows to their owned deals", async () => {
    freshStore();
    const res = await dealsRoute.GET(
      apiReq("GET", "/aria/api/deals", { cookie: cookieFor("zoe@northwind.test") }),
    );
    const rows = (await res.json()) as Array<{ ownerId: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.ownerId).toBe("usr-nw-zoe");
  });
});

describe("POST /deals", () => {
  test("201 a new deal under a known pipeline/stage", async () => {
    freshStore();
    const s = getAria();
    const pipeline = s.pipelines.find((p) => p.tenantId === TENANT_IDS.lumen)!;
    const openStage = pipeline.stages.find((x) => x.state === "open")!;
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const contact = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;

    const res = await dealsRoute.POST(
      apiReq("POST", "/aria/api/deals", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          pipelineId: pipeline.id,
          stageId: openStage.id,
          accountId: account.id,
          contactId: contact.id,
          amount: 50000,
          forecastCategory: "pipeline",
          ownerId: "usr-lumen-ada",
          expectedCloseDate: "2026-12-31",
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.closedAt).toBe(null);
    expect(row.stageId).toBe(openStage.id);
  });

  test("404 when the pipeline is unknown", async () => {
    freshStore();
    const s = getAria();
    const pipeline = s.pipelines.find((p) => p.tenantId === TENANT_IDS.lumen)!;
    const openStage = pipeline.stages.find((x) => x.state === "open")!;
    const account = s.accounts.find((a) => a.tenantId === TENANT_IDS.lumen)!;
    const contact = s.contacts.find((c) => c.tenantId === TENANT_IDS.lumen)!;
    const res = await dealsRoute.POST(
      apiReq("POST", "/aria/api/deals", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          pipelineId: "apl-ghost",
          stageId: openStage.id,
          accountId: account.id,
          contactId: contact.id,
          amount: 50000,
          forecastCategory: "pipeline",
          ownerId: "usr-lumen-ada",
          expectedCloseDate: "2026-12-31",
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("403 for a viewer's deal.create", async () => {
    freshStore();
    const res = await dealsRoute.POST(
      apiReq("POST", "/aria/api/deals", {
        cookie: cookieFor("sam@lumen.test"),
        body: {
          pipelineId: "x",
          stageId: "x",
          accountId: "x",
          contactId: "x",
          amount: 1,
          forecastCategory: "pipeline",
          ownerId: "x",
          expectedCloseDate: "2026-12-31",
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("400 on a bad forecastCategory", async () => {
    freshStore();
    const res = await dealsRoute.POST(
      apiReq("POST", "/aria/api/deals", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          pipelineId: "x",
          stageId: "x",
          accountId: "x",
          contactId: "x",
          amount: -5,
          forecastCategory: "bogus",
          ownerId: "x",
          expectedCloseDate: "2026-13-99",
        },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.length).toBeGreaterThan(1);
  });
});

describe("POST /deals/[id]/stage — the transition gates", () => {
  test("moving to a lost stage WITHOUT a lostReason → 400 (the 400 gate)", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.northwind, 0);
    const pipeline = getAria().pipelines.find(
      (p) => p.id === getAria().deals.find((d) => d.id === deal)!.pipelineId,
    )!;
    const lostStage = pipeline.stages.find((s) => s.state === "closed_lost")!;

    const res = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${deal}/stage`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { stageId: lostStage.id },
      }),
      params(deal),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
  });

  test("moving to a lost stage WITH a lostReason → 200 + closedAt set", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.northwind, 0);
    const pipeline = getAria().pipelines.find(
      (p) => p.id === getAria().deals.find((d) => d.id === deal)!.pipelineId,
    )!;
    const lostStage = pipeline.stages.find((s) => s.state === "closed_lost")!;

    const res = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${deal}/stage`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { stageId: lostStage.id, lostReason: "Price" },
      }),
      params(deal),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.stageId).toBe(lostStage.id);
    expect(row.lostReason).toBe("Price");
    expect(row.closedAt).not.toBeNull();
  });

  test("moving a CLOSED deal back to an open stage → 400 (the P0 invariant)", async () => {
    freshStore();
    const s = getAria();
    const closed = s.deals.find(
      (d) => d.tenantId === TENANT_IDS.northwind && d.closedAt !== null,
    )!;
    const pipeline = s.pipelines.find((p) => p.id === closed.pipelineId)!;
    const openStage = pipeline.stages.find((x) => x.state === "open")!;

    const res = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${closed.id}/stage`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { stageId: openStage.id },
      }),
      params(closed.id),
    );
    expect(res.status).toBe(400);
    // The store is untouched:
    expect(
      getAria().deals.find((d) => d.id === closed.id)!.stageId,
    ).toBe(closed.stageId);
  });

  test("an unknown stage id → 400", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.northwind, 0);
    const res = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${deal}/stage`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { stageId: "stg-ghost" },
      }),
      params(deal),
    );
    expect(res.status).toBe(400);
  });

  test("a forward open→open transition → 200 + lastStageChangeAt refreshed", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.lumen, 0);
    const d = getAria().deals.find((x) => x.id === deal)!;
    const pipeline = getAria().pipelines.find((p) => p.id === d.pipelineId)!;
    const target = pipeline.stages.find(
      (x) => x.state === "open" && x.id !== d.stageId,
    )!;
    const before = getAria().deals.find((x) => x.id === deal)!.lastStageChangeAt;

    const res = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${deal}/stage`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { stageId: target.id },
      }),
      params(deal),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.stageId).toBe(target.id);
    expect(row.lastStageChangeAt).not.toBe(before);
  });

  test("403 for a viewer's deal.stage", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.lumen, 0);
    const res = await dealStageRoute.POST(
      apiReq("POST", `/aria/api/deals/${deal}/stage`, {
        cookie: cookieFor("sam@lumen.test"),
        body: { stageId: "x" },
      }),
      params(deal),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET/PATCH /deals/[id]", () => {
  test("GET 200 the deal + its activities + tasks; 404 cross-tenant", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.lumen, 0);
    const ok = await dealsIdRoute.GET(
      apiReq("GET", `/aria/api/deals/${deal}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params(deal),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.deal.id).toBe(deal);
    expect(Array.isArray(json.activities)).toBe(true);
    expect(Array.isArray(json.tasks)).toBe(true);

    const cross = await dealsIdRoute.GET(
      apiReq("GET", `/aria/api/deals/${deal}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
      params(deal),
    );
    expect(cross.status).toBe(404);
  });

  test("PATCH an open→lost stage via the patch lane honors the reason gate", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.lumen, 0);
    const d = getAria().deals.find((x) => x.id === deal)!;
    const pipeline = getAria().pipelines.find((p) => p.id === d.pipelineId)!;
    const lost = pipeline.stages.find((s) => s.state === "closed_lost")!;

    const res = await dealsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/deals/${deal}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { stageId: lost.id },
      }),
      params(deal),
    );
    expect(res.status).toBe(400); // no lostReason → the 400 gate

    const ok = await dealsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/deals/${deal}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { stageId: lost.id, lostReason: "Budget" },
      }),
      params(deal),
    );
    expect(ok.status).toBe(200);
    const row = await ok.json();
    expect(row.closedAt).not.toBeNull();
  });

  test("PATCH the deal amount + forecastCategory (plain fields)", async () => {
    freshStore();
    const deal = openDealFor(TENANT_IDS.northwind, 0);
    const res = await dealsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/deals/${deal}`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { amount: 12345, forecastCategory: "best_case" },
      }),
      params(deal),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.amount).toBe(12345);
    expect(row.forecastCategory).toBe("best_case");
  });
});
