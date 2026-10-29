/**
 * Integration tests for /aria/api/leads — CRUD + SLA state + the
 * atomic conversion (creates/links account + contact + optional
 * deal, moves the lead to converted).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  apiReq,
  cookieFor,
  freshStore,
  seededIdFor,
  TENANT_IDS,
} from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as leadsRoute from "@/app/aria/api/leads/route";
import * as leadsIdRoute from "@/app/aria/api/leads/[id]/route";
import * as convertLeadRoute from "@/app/aria/api/leads/[id]/convert/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /leads — the list + the computed slaState", () => {
  test("200 the tenant's leads, each row carries its slaState", async () => {
    freshStore();
    const res = await leadsRoute.GET(
      apiReq("GET", "/aria/api/leads", { cookie: cookieFor("mira@lumen.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ slaState: string; priority: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(["ok", "at_risk", "breached", "met"]).toContain(row.slaState);
    }
  });

  test("the ?slaState= filter returns only that bucket", async () => {
    freshStore();
    const res = await leadsRoute.GET(
      apiReq("GET", "/aria/api/leads?slaState=met", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ slaState: string }>;
    for (const row of rows) expect(row.slaState).toBe("met");
  });

  test("the ?priority-ish ?source= filter + ?status= filter combine", async () => {
    freshStore();
    const res = await leadsRoute.GET(
      apiReq("GET", "/aria/api/leads?source=demo", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ source: string }>;
    for (const row of rows) expect(row.source).toBe("demo");
  });

  test("a rep's list narrows to owned leads only", async () => {
    freshStore();
    const res = await leadsRoute.GET(
      apiReq("GET", "/aria/api/leads", { cookie: cookieFor("marco@northwind.test") }),
    );
    const rows = (await res.json()) as Array<{ ownerId: string }>;
    for (const row of rows) expect(row.ownerId).toBe("usr-nw-marco");
  });
});

describe("POST /leads", () => {
  test("201 a new lead + its SLA math (slaDueAt = created + priority SLA)", async () => {
    freshStore();
    const res = await leadsRoute.POST(
      apiReq("POST", "/aria/api/leads", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          name: "Fresh Lead",
          email: "fresh@probe.test",
          source: "demo",
          priority: "high",
          ownerId: "usr-lumen-ada",
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.status).toBe("new");
    expect(row.converted).toBe(null);
    // The SLA due is exactly the priority-SLA minutes past the
    // pinned clock (lumen's high-priority SLA is 240 minutes):
    const tenant = getAria().tenants.find((t) => t.id === TENANT_IDS.lumen)!;
    const slaMinutes = tenant.leadSlaMinutes.high;
    const due = new Date(row.slaDueAt).getTime() - new Date(row.createdAt).getTime();
    expect(Math.round(due / 60_000)).toBe(slaMinutes);
  });

  test("400 on a bad priority", async () => {
    freshStore();
    const res = await leadsRoute.POST(
      apiReq("POST", "/aria/api/leads", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          name: "x",
          email: "x@x.com",
          source: "s",
          priority: "bogus",
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("403 for a viewer's lead.create", async () => {
    freshStore();
    const res = await leadsRoute.POST(
      apiReq("POST", "/aria/api/leads", {
        cookie: cookieFor("sam@lumen.test"),
        body: {
          name: "x",
          email: "x@x.com",
          source: "s",
          priority: "low",
          ownerId: "usr-lumen-sam",
        },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("lead.create");
  });
});

describe("PATCH /leads/[id]", () => {
  test("200 an update to a live lead's status + priority", async () => {
    freshStore();
    const s = getAria();
    const live = s.leads.find(
      (l) => l.tenantId === TENANT_IDS.lumen && l.converted === null,
    )!;
    const res = await leadsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/leads/${live.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { status: "working", priority: "urgent" },
      }),
      params(live.id),
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.status).toBe("working");
    expect(row.priority).toBe("urgent");
  });

  test("a converted lead is terminal → 400 on update", async () => {
    freshStore();
    const s = getAria();
    const converted = s.leads.find(
      (l) => l.tenantId === TENANT_IDS.lumen && l.converted !== null,
    )!;
    const res = await leadsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/leads/${converted.id}`, {
        cookie: cookieFor("mira@lumen.test"),
        body: { status: "new" },
      }),
      params(converted.id),
    );
    expect(res.status).toBe(400);
  });

  test("404 cross-tenant (northwind cookie × lumen lead)", async () => {
    freshStore();
    const lumenLead = seededIdFor(TENANT_IDS.lumen, "lead", 0);
    const res = await leadsIdRoute.PATCH(
      apiReq("PATCH", `/aria/api/leads/${lumenLead}`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { status: "new" },
      }),
      params(lumenLead),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /leads/[id]/convert — the atomic conversion", () => {
  test("200 { lead, account, contact, deal: null } on a bare conversion", async () => {
    freshStore();
    const s = getAria();
    const live = s.leads.find(
      (l) => l.tenantId === TENANT_IDS.northwind && l.converted === null,
    )!;
    const res = await convertLeadRoute.POST(
      apiReq("POST", `/aria/api/leads/${live.id}/convert`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {},
      }),
      params(live.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.lead.id).toBe(live.id);
    expect(json.lead.converted).not.toBeNull();
    expect(json.lead.converted.accountId).toBe(json.account.id);
    expect(json.lead.converted.contactId).toBe(json.contact.id);
    expect(json.deal).toBe(null);
    // The store is actually committed:
    const after = getAria().leads.find((l) => l.id === live.id)!;
    expect(after.converted).not.toBeNull();
  });

  test("a second convert of the same lead → 400 (terminal)", async () => {
    freshStore();
    const s = getAria();
    const live = s.leads.find(
      (l) => l.tenantId === TENANT_IDS.northwind && l.converted === null,
    )!;
    const r1 = await convertLeadRoute.POST(
      apiReq("POST", `/aria/api/leads/${live.id}/convert`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {},
      }),
      params(live.id),
    );
    expect(r1.status).toBe(200);

    const r2 = await convertLeadRoute.POST(
      apiReq("POST", `/aria/api/leads/${live.id}/convert`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: {},
      }),
      params(live.id),
    );
    expect(r2.status).toBe(400);
  });

  test("an unknown accountId in the body → 404", async () => {
    freshStore();
    const s = getAria();
    const live = s.leads.find(
      (l) => l.tenantId === TENANT_IDS.northwind && l.converted === null,
    )!;
    const res = await convertLeadRoute.POST(
      apiReq("POST", `/aria/api/leads/${live.id}/convert`, {
        cookie: cookieFor("ingrid@northwind.test"),
        body: { accountId: "acr-ghost" },
      }),
      params(live.id),
    );
    expect(res.status).toBe(404);
    // No partial commit: the lead is still unconverted
    expect(
      getAria().leads.find((l) => l.id === live.id)!.converted,
    ).toBe(null);
  });

  test("a 403 rung for a viewer's lead.convert", async () => {
    freshStore();
    const s = getAria();
    const live = s.leads.find(
      (l) => l.tenantId === TENANT_IDS.lumen && l.converted === null,
    )!;
    const res = await convertLeadRoute.POST(
      apiReq("POST", `/aria/api/leads/${live.id}/convert`, {
        cookie: cookieFor("sam@lumen.test"),
        body: {},
      }),
      params(live.id),
    );
    expect(res.status).toBe(403);
  });

  test("GET /leads/[id] 200 the lead + its activities; 404 unknown", async () => {
    freshStore();
    const lead = seededIdFor(TENANT_IDS.lumen, "lead", 0);
    const ok = await leadsIdRoute.GET(
      apiReq("GET", `/aria/api/leads/${lead}`, {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params(lead),
    );
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.lead.id).toBe(lead);
    expect(Array.isArray(json.activities)).toBe(true);

    const bad = await leadsIdRoute.GET(
      apiReq("GET", "/aria/api/leads/alead-ghost", {
        cookie: cookieFor("mira@lumen.test"),
      }),
      params("alead-ghost"),
    );
    expect(bad.status).toBe(404);
  });
});
