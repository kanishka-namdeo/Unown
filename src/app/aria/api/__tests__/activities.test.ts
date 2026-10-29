/**
 * Integration tests for /aria/api/activities — the timeline append
 * + filters + the 403 rung for viewer.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, TENANT_IDS } from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as activitiesRoute from "@/app/aria/api/activities/route";

beforeAll(freshStore);

describe("GET /activities — the timeline lane", () => {
  test("200 the tenant's activities, newest-first", async () => {
    freshStore();
    const res = await activitiesRoute.GET(
      apiReq("GET", "/aria/api/activities", { cookie: cookieFor("ingrid@northwind.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ at: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // Newest-first ordering:
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].at.localeCompare(rows[i].at)).toBeGreaterThanOrEqual(0);
    }
  });

  test("?entityType=&entityId= narrows to one entity's timeline", async () => {
    freshStore();
    const s = getAria();
    const deal = s.deals.find((d) => d.tenantId === TENANT_IDS.northwind && d.closedAt !== null)!;
    const res = await activitiesRoute.GET(
      apiReq("GET", `/aria/api/activities?entityType=deal&entityId=${deal.id}`, {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ entityId: string; entityType: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].entityId).toBe(deal.id);
    expect(rows[0].entityType).toBe("deal");
  });

  test("the ?kind= filter matches one activity kind", async () => {
    freshStore();
    const res = await activitiesRoute.GET(
      apiReq("GET", "/aria/api/activities?kind=system", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ kind: string }>;
    for (const row of rows) expect(row.kind).toBe("system");
  });

  test("the lane is tenant-scoped: no northwind rows leak under a lumen session", async () => {
    freshStore();
    const res = await activitiesRoute.GET(
      apiReq("GET", "/aria/api/activities", { cookie: cookieFor("mira@lumen.test") }),
    );
    const rows = (await res.json()) as Array<{ tenantId: string }>;
    for (const row of rows) expect(row.tenantId).toBe(TENANT_IDS.lumen);
  });

  test("401 with no cookie; a viewer passes the read lane (all-✓)", async () => {
    freshStore();
    const anon = await activitiesRoute.GET(apiReq("GET", "/aria/api/activities"));
    expect(anon.status).toBe(401);

    const viewer = await activitiesRoute.GET(
      apiReq("GET", "/aria/api/activities", { cookie: cookieFor("sam@lumen.test") }),
    );
    expect(viewer.status).toBe(200);
  });
});

describe("POST /activities — the append lane", () => {
  test("201 a new activity; it lands in the store + the audit feed", async () => {
    freshStore();
    const s = getAria();
    const deal = s.deals.find((d) => d.tenantId === TENANT_IDS.lumen && d.closedAt === null)!;
    const auditBefore = getAria().audit.length;

    const res = await activitiesRoute.POST(
      apiReq("POST", "/aria/api/activities", {
        cookie: cookieFor("ada@lumen.test"),
        body: {
          kind: "call",
          entityType: "deal",
          entityId: deal.id,
          body: "Intro call — walked through the pricing page.",
        },
      }),
    );
    expect(res.status).toBe(201);
    const row = await res.json();
    expect(row.actorId).toBe("usr-lumen-ada");
    expect(getAria().activities.some((a) => a.id === row.id)).toBe(true);
    expect(getAria().audit.length).toBeGreaterThan(auditBefore);
  });

  test("400 on a bad kind / entity shape", async () => {
    freshStore();
    const res = await activitiesRoute.POST(
      apiReq("POST", "/aria/api/activities", {
        cookie: cookieFor("ada@lumen.test"),
        body: { kind: "bogus", entityType: "lead", entityId: "x", body: "" },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
  });

  test("403 for a viewer's activity.create", async () => {
    freshStore();
    const s = getAria();
    const deal = s.deals.find((d) => d.tenantId === TENANT_IDS.lumen)!;
    const res = await activitiesRoute.POST(
      apiReq("POST", "/aria/api/activities", {
        cookie: cookieFor("sam@lumen.test"),
        body: { kind: "note", entityType: "deal", entityId: deal.id, body: "nope" },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("activity.create");
  });
});
