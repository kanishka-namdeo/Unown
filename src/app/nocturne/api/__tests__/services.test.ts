/**
 * Integration lane for /nocturne/api/services (plan §3.3): the
 * CRUD + oncall-computed surface, the 402 at the service cap, and
 * the cross-tenant 404 (never a 403 — plan §7/1).
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  cookieFor,
  freshStore,
  apiReq,
  TENANT_IDS,
} from "./helpers";

// Route handlers (the real ones)
import * as servicesRoute from "@/app/nocturne/api/services/route";
import * as serviceByIdRoute from "@/app/nocturne/api/services/[id]/route";
import * as oncallRoute from "@/app/nocturne/api/services/[id]/oncall/route";

beforeAll(freshStore);

describe("GET /services (the computed primaryOnCall surface)", () => {
  test("200 the tenant's services + a computed on-call per service", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await servicesRoute.GET(
      apiReq("GET", "/nocturne/api/services", { cookie }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.length).toBe(2);
    // The schedule-aware surface: a rotation-bearing service carries
    // the override-resolved whoIsOnCall (plan §1's "schedule-aware" layer).
    for (const row of json) {
      expect(row).toHaveProperty("service");
      expect(row).toHaveProperty("primaryOnCall");
    }
    const payments = json.find((r) => r.service.id === "nc_seed_svc_01")!;
    // 2026-10-28 (a Wednesday) sits inside the week of Sun
    // 2026-10-25 → Lumen rot-01's current seat is idx 0 (Theo).
    expect(payments.primaryOnCall?.userId).toBe("usr-lumen-theo");
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await servicesRoute.GET(apiReq("GET", "/nocturne/api/services"));
    expect(res.status).toBe(401);
  });
});

describe("GET /services/[id] (the detail + 404 rungs)", () => {
  test("200 the service + its incidents + its runbooks", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await serviceByIdRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_01", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Payments API");
    expect(json.incidents.length).toBeGreaterThan(0);
    expect(json.runbooks.length).toBeGreaterThan(0);
  });

  test("404 for ANOTHER tenant's service (the P0 leak pin)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await serviceByIdRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_01", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(404);
  });

  test("404 for an unknown id", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await serviceByIdRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_svc_ghost", { cookie }),
      { params: Promise.resolve({ id: "nc_svc_ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /services (the create lane + 402 at the cap)", () => {
  test("an admin → 201 the new row", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await servicesRoute.POST(
      apiReq("POST", "/nocturne/api/services", {
        cookie,
        body: {
          name: "Fleet Telemetry",
          description: "Vehicle telemetry ingest.",
          escalationPolicy: {
            tiers: [
              { id: "e1", kind: "manager", waitMinutes: 30, toTierIndex: null },
            ],
          },
        },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe("Fleet Telemetry");
    expect(json.tenantId).toBe(TENANT_IDS.lumen);
    expect(json.id.startsWith("nc_svc_")).toBe(true);
  });

  test("a responder → 403 naming the permission", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    const res = await servicesRoute.POST(
      apiReq("POST", "/nocturne/api/services", {
        cookie,
        body: { name: "Nope", description: "Nope" },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("service.create");
  });

  test("400 on a bad escalation policy (the tier-ladder gate)", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await servicesRoute.POST(
      apiReq("POST", "/nocturne/api/services", {
        cookie,
        body: {
          name: "Bad",
          description: "Bad",
          escalationPolicy: { tiers: [] },
        },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.errors.length).toBeGreaterThan(0);
  });

  test("404 when the rotationId is ANOTHER tenant's rotation (fail-closed tenancy)", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await servicesRoute.POST(
      apiReq("POST", "/nocturne/api/services", {
        cookie,
        body: {
          name: "Cross-Tenant",
          description: "x",
          rotationId: "nc_seed_rot_03", // Northwind's rotation
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("402 at the service cap (plan §7/10 — a starter tenant has a 2-service cap)", async () => {
    freshStore();
    // Northwind is a starter plan (cap: 2 services) and already has
    // 1 seeded service. Create a second → 201; a third → 402.
    const cookie = cookieFor("ingrid@northwind.test");
    const second = await servicesRoute.POST(
      apiReq("POST", "/nocturne/api/services", {
        cookie,
        body: {
          name: "Second NW Service",
          description: "d",
          escalationPolicy: {
            tiers: [
              { id: "e1", kind: "manager", waitMinutes: 30, toTierIndex: null },
            ],
          },
        },
      }),
    );
    expect(second.status).toBe(201);
    const third = await servicesRoute.POST(
      apiReq("POST", "/nocturne/api/services", {
        cookie,
        body: {
          name: "Third NW Service",
          description: "d",
          escalationPolicy: {
            tiers: [
              { id: "e1", kind: "manager", waitMinutes: 30, toTierIndex: null },
            ],
          },
        },
      }),
    );
    expect(third.status).toBe(402);
    const json = await third.json();
    expect(json.error).toBe("quota_exceeded");
  });
});

describe("PATCH /services/[id] (the update lane)", () => {
  test("an admin → 200 the updated row", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await serviceByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/services/nc_seed_svc_01", {
        cookie,
        body: { description: "Card auth, capture, refunds + webhooks." },
      }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.description).toBe("Card auth, capture, refunds + webhooks.");
  });

  test("a viewer → 403 naming the permission", async () => {
    freshStore();
    const cookie = cookieFor("kai@lumen.test");
    const res = await serviceByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/services/nc_seed_svc_01", {
        cookie,
        body: { description: "nope" },
      }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(403);
  });

  test("a cross-tenant PATCH → 404 (never a 403)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await serviceByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/services/nc_seed_svc_01", {
        cookie,
        body: { description: "pwn" },
      }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /services/[id]/oncall (the computed on-call window)", () => {
  test("200 { primary, secondary, handoffAt } for a rotation-bearing service", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await oncallRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_01", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    // 2026-10-28 (Wed) → rot-01 seat idx 0 = Theo (primary), seat
    // idx 1 = Ada (the next raw seat); the handoff is the next
    // seat's start (2026-11-01T00:00:00Z).
    expect(json.primary?.userId).toBe("usr-lumen-theo");
    expect(json.secondary?.userId).toBe("usr-lumen-ada");
    expect(json.handoffAt).toBe("2026-11-01T00:00:00Z");
  });

  test("an override applies: the Console service's primary is the cover", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    // rot-02's seat idx 0 is Ada, with a seeded override: Sam is
    // covered by Ada THIS WEEK — so the Console service's raw next
    // seat + primary resolution flows through the override lane.
    const res = await oncallRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_02", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_svc_02" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.primary).not.toBeNull();
  });

  test("404 for another tenant's service (never a 403)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await oncallRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_01", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(404);
  });

  test("a ?at= probe at a later week resolves the NEXT seat", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    // One week later: 2026-11-04 (a Wednesday) → seat idx 1 (Ada).
    const res = await oncallRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_01", {
        cookie,
        query: "?at=2026-11-04T12:00:00Z",
      }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.primary?.userId).toBe("usr-lumen-ada");
  });

  test("400 on a malformed ?at=", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await oncallRoute.GET(
      apiReq("GET", "/nocturne/api/services/nc_seed_svc_01", {
        cookie,
        query: "?at=not-a-date",
      }),
      { params: Promise.resolve({ id: "nc_seed_svc_01" }) },
    );
    expect(res.status).toBe(400);
  });
});
