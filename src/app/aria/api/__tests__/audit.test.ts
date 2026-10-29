/**
 * Integration tests for /aria/api/audit — the filterable feed +
 * the 403 rung for rep/viewer (the matrix's audit.read: owner +
 * manager only).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore, TENANT_IDS } from "./helpers";
import { getAria } from "@/lib/aria/aria-store";

import * as auditRoute from "@/app/aria/api/audit/route";

beforeAll(freshStore);

describe("GET /audit — the feed + filters", () => {
  test("200 the tenant's audit feed (newest-first, the copy-on-write tail)", async () => {
    freshStore();
    // Mutate first so the tenant has live audit rows:
    const before = getAria().audit.length;
    await (await import("@/app/aria/api/accounts/route")).POST(
      apiReq("POST", "/aria/api/accounts", {
        cookie: cookieFor("mira@lumen.test"),
        body: {
          name: "Audit Probe",
          domain: "auditprobe.io",
          industry: "Audit",
          size: 5,
          ownerId: "usr-lumen-mira",
        },
      }),
    );
    expect(getAria().audit.length).toBeGreaterThan(before);

    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit", { cookie: cookieFor("mira@lumen.test") }),
    );
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ createdAt: string }>;
    expect(rows.length).toBeGreaterThan(0);
    // Newest-first:
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt.localeCompare(rows[i].createdAt)).toBeGreaterThanOrEqual(0);
    }
    // Every row belongs to the caller's tenant:
    for (const row of rows as unknown as Array<{ tenantId: string }>) {
      expect(row.tenantId).toBe(TENANT_IDS.lumen);
    }
  });

  test("?action= narrows to one action's events", async () => {
    freshStore();
    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit?action=deal.create", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ action: string }>;
    for (const row of rows) expect(row.action).toBe("deal.create");
  });

  test("?entityType= narrows to one entity kind's events", async () => {
    freshStore();
    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit?entityType=lead", {
        cookie: cookieFor("ingrid@northwind.test"),
      }),
    );
    const rows = (await res.json()) as Array<{ entityType: string }>;
    for (const row of rows) expect(row.entityType).toBe("lead");
  });

  test("an empty filter returns 200 [] (no events match)", async () => {
    freshStore();
    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit?action=invite.accept", {
        cookie: cookieFor("mira@lumen.test"),
      }),
    );
    expect(res.status).toBe(200);
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await auditRoute.GET(apiReq("GET", "/aria/api/audit"));
    expect(res.status).toBe(401);
  });
});

describe("GET /audit — the 403 rung (rep + viewer denied)", () => {
  test("a rep's audit.read → 403 naming audit.read", async () => {
    freshStore();
    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit", { cookie: cookieFor("ada@lumen.test") }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("forbidden");
    expect(json.permission).toBe("audit.read");
  });

  test("a viewer's audit.read → 403", async () => {
    freshStore();
    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit", { cookie: cookieFor("sam@lumen.test") }),
    );
    expect(res.status).toBe(403);
  });

  test("a manager's audit.read PASSES (the matrix's manager ✓)", async () => {
    freshStore();
    const res = await auditRoute.GET(
      apiReq("GET", "/aria/api/audit", { cookie: cookieFor("priya@northwind.test") }),
    );
    expect(res.status).toBe(200);
  });
});
