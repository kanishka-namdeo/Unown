/**
 * Integration lane for /nocturne/api/tenants + /members + /invites
 * (plan §3.2): the entity routes' cross-tenant reads → 404 (never
 * a 403 that confirms existence — plan §7/1), the 401 rung, the
 * owner-gated tenant.settings lane, and the seat-cap's 402.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { cookieFor, freshStore, apiReq, TENANT_IDS } from "./helpers";
import { getNocturne, createInvite, acceptInvite, NotFoundError, QuotaExceededError, InviteError } from "@/app/nocturne/api/_state";

// Route handlers (the real ones)
import * as tenantsListRoute from "@/app/nocturne/api/tenants/route";
import * as tenantByIdRoute from "@/app/nocturne/api/tenants/[id]/route";
import * as membersRoute from "@/app/nocturne/api/members/route";
import * as invitesRoute from "@/app/nocturne/api/invites/route";
import * as invitesAcceptRoute from "@/app/nocturne/api/invites/accept/route";

beforeAll(freshStore);

describe("GET /tenants", () => {
  test("200 the caller's own tenant (the row-level tenancy floor)", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await tenantsListRoute.GET(apiReq("GET", "/nocturne/api/tenants", { cookie }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0]!.id).toBe(TENANT_IDS.lumen);
  });

  test("401 with no cookie (the auth rung)", async () => {
    freshStore();
    const res = await tenantsListRoute.GET(apiReq("GET", "/nocturne/api/tenants"));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("unauthenticated");
  });
});

describe("GET /tenants/[id] (cross-tenant → 404, never 403)", () => {
  test("200 the caller's own tenant row", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await tenantByIdRoute.GET(
      apiReq("GET", "/nocturne/api/tenants/tn-northwind", { cookie }),
      { params: Promise.resolve({ id: "tn-northwind" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slug).toBe("northwind");
  });

  test("404 for ANOTHER tenant's id (the P0 leak pin — plan §7/1)", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await tenantByIdRoute.GET(
      apiReq("GET", "/nocturne/api/tenants/tn-northwind", { cookie }),
      { params: Promise.resolve({ id: "tn-northwind" }) },
    );
    expect(res.status).toBe(404);
  });

  test("404 for an unknown id", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await tenantByIdRoute.GET(
      apiReq("GET", "/nocturne/api/tenants/tn-ghost", { cookie }),
      { params: Promise.resolve({ id: "tn-ghost" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /tenants/[id] (the owner-gated lane)", () => {
  test("an admin → 403 naming the permission", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await tenantByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/tenants/tn-lumen", {
        cookie,
        body: { name: "Renamed Labs" },
      }),
      { params: Promise.resolve({ id: "tn-lumen" }) },
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("forbidden");
    expect(json.permission).toBe("tenant.settings");
  });

  test("a viewer → 403 naming the permission", async () => {
    freshStore();
    const cookie = cookieFor("kai@lumen.test");
    const res = await tenantByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/tenants/tn-lumen", {
        cookie,
        body: { name: "Renamed Labs" },
      }),
      { params: Promise.resolve({ id: "tn-lumen" }) },
    );
    expect(res.status).toBe(403);
  });

  test("an owner → 200 the updated tenant", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await tenantByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/tenants/tn-lumen", {
        cookie,
        body: { name: "Lumen Labs (Renamed)" },
      }),
      { params: Promise.resolve({ id: "tn-lumen" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Lumen Labs (Renamed)");
  });

  test("a cross-tenant PATCH → 404 (never a 403 that confirms existence)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await tenantByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/tenants/tn-lumen", {
        cookie,
        body: { name: "Pwned" },
      }),
      { params: Promise.resolve({ id: "tn-lumen" }) },
    );
    expect(res.status).toBe(404);
  });

  test("400 on a bad slaMinutes shape", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await tenantByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/tenants/tn-northwind", {
        cookie,
        body: { slaMinutes: { sev1: { ack: 0, resolve: 5 } } },
      }),
      { params: Promise.resolve({ id: "tn-northwind" }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /members", () => {
  test("200 the tenant's seat list (the [{ membership, user }] shape)", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await membersRoute.GET(apiReq("GET", "/nocturne/api/members", { cookie }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.length).toBe(5);
    expect(json[0]).toHaveProperty("membership");
    expect(json[0]).toHaveProperty("user");
    expect(json[0]!.membership.role).toBe("owner");
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await membersRoute.GET(apiReq("GET", "/nocturne/api/members"));
    expect(res.status).toBe(401);
  });
});

describe("POST /invites (the seat-cap's 402 rung)", () => {
  test("an owner → 201 the invite row", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie,
        body: { email: "newbie@northwind.test", role: "responder" },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.email).toBe("newbie@northwind.test");
    expect(json.role).toBe("responder");
    expect(json.token).toBeTruthy();
    expect(json.usedAt).toBeNull();
  });

  test("a responder → 403 naming the permission", async () => {
    freshStore();
    const cookie = cookieFor("priya@northwind.test");
    const res = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie,
        body: { email: "newbie@northwind.test", role: "viewer" },
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("invite.create");
  });

  test("400 on a bad email/role", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie,
        body: { email: "not-an-email", role: "admin" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("402 at the seat cap (the P1 overage fix, plan §7/9)", async () => {
    freshStore();
    // Lumen is a professional plan (25 seats) with 5 members — the
    // cap is far away; instead we exercise the 402 through the
    // module's gate directly (the route's 402 mapping is pinned by
    // the invite-accept lane below).
    const s = getNocturne();
    expect(s.memberships.filter((m) => m.tenantId === "tn-lumen").length).toBe(5);
    // The northwind tenant is a starter plan (5-seat cap) with 3
    // members — 2 invites away from the cap:
    const c = cookieFor("ingrid@northwind.test");
    const i1 = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "a@northwind.test", role: "responder" },
      }),
    );
    const i2 = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "b@northwind.test", role: "responder" },
      }),
    );
    expect(i1.status).toBe(201);
    expect(i2.status).toBe(201);
    // Both accepts land the tenant AT its 5-seat cap → the next
    // invite 402s:
    const tokenA = (await i1.json()).token;
    const tokenB = (await i2.json()).token;
    await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token: tokenA, name: "Ann", password: "northwind-1" },
      }),
    );
    await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token: tokenB, name: "Ben", password: "northwind-1" },
      }),
    );
    const i3 = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "c@northwind.test", role: "responder" },
      }),
    );
    expect(i3.status).toBe(402);
    const json = await i3.json();
    expect(json.error).toBe("quota_exceeded");
  });
});

describe("POST /invites/accept (the token ladder)", () => {
  test("201 the new user + membership (a REAL scrypt hash)", async () => {
    freshStore();
    const c = cookieFor("ingrid@northwind.test");
    const inv = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "newbie@northwind.test", role: "responder" },
      }),
    );
    const token = (await inv.json()).token;
    const res = await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token, name: "New Bee", password: "northwind-1" },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe("newbie@northwind.test");
    expect(json.user.name).toBe("New Bee");
    expect(json.user.passwordHash).not.toBe("");
    expect(json.membership.role).toBe("responder");
  });

  test("404 on an unknown token", async () => {
    freshStore();
    const res = await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token: "nc_inv_ghost", name: "G", password: "northwind-1" },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("410 on a used token (single-use — the parley token pattern)", async () => {
    freshStore();
    const c = cookieFor("ingrid@northwind.test");
    const inv = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "once@northwind.test", role: "responder" },
      }),
    );
    const token = (await inv.json()).token;
    await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token, name: "Once", password: "northwind-1" },
      }),
    );
    const again = await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token, name: "Once", password: "northwind-1" },
      }),
    );
    expect(again.status).toBe(410);
  });

  test("400 on a weak password (the credential floor settles FIRST)", async () => {
    freshStore();
    const c = cookieFor("ingrid@northwind.test");
    const inv = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "floor@northwind.test", role: "viewer" },
      }),
    );
    const token = (await inv.json()).token;
    const res = await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token, name: "Floor", password: "short" },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.errors.length).toBeGreaterThan(0);
  });

  test("400 on a missing name", async () => {
    freshStore();
    const c = cookieFor("ingrid@northwind.test");
    const inv = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "noname@northwind.test", role: "viewer" },
      }),
    );
    const token = (await inv.json()).token;
    const res = await invitesAcceptRoute.POST(
      apiReq("POST", "/nocturne/api/invites/accept", {
        body: { token, name: "", password: "northwind-1" },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("402 at the seat cap (an invitee landing AT the cap, plan §7/9)", async () => {
    freshStore();
    // Fill northwind to its starter 5-seat cap (3 seeded members +
    // 2 accepts), then a third accept 402s.
    const c = cookieFor("ingrid@northwind.test");
    for (const email of ["fill-a@northwind.test", "fill-b@northwind.test"]) {
      const inv = await invitesRoute.POST(
        apiReq("POST", "/nocturne/api/invites", {
          cookie: c,
          body: { email, role: "responder" },
        }),
      );
      const token = (await inv.json()).token;
      const out = await invitesAcceptRoute.POST(
        apiReq("POST", "/nocturne/api/invites/accept", {
          body: { token, name: email, password: "northwind-1" },
        }),
      );
      expect(out.status).toBe(201);
    }
    const inv = await invitesRoute.POST(
      apiReq("POST", "/nocturne/api/invites", {
        cookie: c,
        body: { email: "fill-c@northwind.test", role: "responder" },
      }),
    );
    // AT the cap → the create itself 402s:
    expect(inv.status).toBe(402);
  });
});
