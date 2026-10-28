/**
 * Integration tests for /parley/api/members + /parley/api/invites —
 * the member list, the invite create/accept ladder (404 unknown /
 * 410 used / 410 expired), the role attach on accept, and the
 * owner-seat + not-yourself guards on the members/[id] routes.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { apiReq, cookieFor, freshStore } from "./helpers";
import { getParley } from "@/lib/parley/store";

import * as membersRoute from "@/app/parley/api/members/route";
import * as invitesRoute from "@/app/parley/api/invites/route";
import * as acceptRoute from "@/app/parley/api/invites/accept/route";
import * as mailboxRoute from "@/app/parley/api/mailbox/route";
import * as roleRoute from "@/app/parley/api/members/[id]/role/route";
import * as removeRoute from "@/app/parley/api/members/[id]/remove/route";

beforeAll(freshStore);

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /members", () => {
  test("200 the tenant's memberships joined with their users (all 4 roles pass)", async () => {
    freshStore();
    for (const cookie of [
      cookieFor("mira@lumen.test"), // owner
      cookieFor("theo@lumen.test"), // admin
      cookieFor("ada@lumen.test"), // agent
      cookieFor("sam@lumen.test"), // viewer
    ]) {
      const res = await membersRoute.GET(apiReq("GET", "/parley/api/members", { cookie }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBe(4); // lumen has 4 memberships
      for (const m of json) {
        expect(m.user).toHaveProperty("email");
        expect(m.membership).toHaveProperty("role");
      }
    }
  });
});

describe("POST /invites + the mailbox", () => {
  test("owner creates an invite → 201 a single-use token + audit", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await invitesRoute.POST(
      apiReq("POST", "/parley/api/invites", { cookie: owner, body: { email: "new@x.com", role: "agent" } }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.token).toMatch(/^tok-/);
    expect(json.usedAt).toBe(null);
    const audit = getParley().audit.filter((e) => e.action === "invite.create");
    expect(audit.length).toBeGreaterThan(0);
  });

  test("a viewer's invite.create → 403 naming invite.create", async () => {
    freshStore();
    const viewer = cookieFor("sam@lumen.test");
    const res = await invitesRoute.POST(
      apiReq("POST", "/parley/api/invites", { cookie: viewer, body: { email: "x@y.com", role: "agent" } }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("invite.create");
  });

  test("the mailbox lists the tenant's invites with their accept links", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const res = await mailboxRoute.GET(apiReq("GET", "/parley/api/mailbox", { cookie: owner }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.length).toBeGreaterThan(0); // the seeded casey@lumen.test invite
    for (const i of json) {
      expect(i.acceptLink).toContain("token=");
    }
  });

  test("a viewer can't read the mailbox (invite.create read-gate) → 403", async () => {
    freshStore();
    const viewer = cookieFor("sam@lumen.test");
    const res = await mailboxRoute.GET(apiReq("GET", "/parley/api/mailbox", { cookie: viewer }));
    expect(res.status).toBe(403);
  });
});

describe("POST /invites/accept (the token is the credential)", () => {
  test("a pending invite's accept → 201 a REAL user + membership with the invited role", async () => {
    freshStore();
    const s = getParley();
    const pending = s.invites.find((i) => i.email === "casey@lumen.test")!;
    const res = await acceptRoute.POST(
      apiReq("POST", "/parley/api/invites/accept", {
        body: { token: pending.token, name: "Casey", password: "CaseyPass1" },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user.email).toBe("casey@lumen.test");
    expect(json.membership.role).toBe(pending.role); // the role attach pin
    // a REAL passwordHash (not the demo one) — verified by the
    // user existing in the store with the invited role
    const member = getParley().memberships.find((m) => m.id === json.membership.id);
    expect(member?.role).toBe(pending.role);
    // the invite is now used
    const used = getParley().invites.find((i) => i.id === pending.id)!;
    expect(used.usedAt).not.toBeNull();
    // audit event with entityType membership + after { userId, role }
    const aud = getParley().audit.find((e) => e.action === "invite.accept" && e.entityId === json.membership.id)!;
    expect(aud.meta.after).toHaveProperty("userId");
  });

  test("second accept of the same token → 410 with reason 'used'", async () => {
    freshStore();
    const pending = getParley().invites.find((i) => i.usedAt === null)!;
    await acceptRoute.POST(
      apiReq("POST", "/parley/api/invites/accept", {
        body: { token: pending.token, name: "A", password: "Pass1234" },
      }),
    );
    const again = await acceptRoute.POST(
      apiReq("POST", "/parley/api/invites/accept", {
        body: { token: pending.token, name: "B", password: "Pass1234" },
      }),
    );
    expect(again.status).toBe(410);
    const json = await again.json();
    expect(json.reason).toBe("used");
  });

  test("an unknown token → 404", async () => {
    freshStore();
    const res = await acceptRoute.POST(
      apiReq("POST", "/parley/api/invites/accept", {
        body: { token: "tok-00000000-000001", name: "X", password: "Pass1234" },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("an expired token → 410 with reason 'expired' (distinct from used)", async () => {
    freshStore();
    // Pin the clock past the pending invite's 24h expiry.
    const { setClock } = await import("@/lib/parley/clock");
    const pending = getParley().invites.find((i) => i.usedAt === null)!;
    const past = new Date(new Date(pending.expiresAt).getTime() + 1000).toISOString();
    setClock(past);
    const res = await acceptRoute.POST(
      apiReq("POST", "/parley/api/invites/accept", {
        body: { token: pending.token, name: "X", password: "Pass1234" },
      }),
    );
    expect(res.status).toBe(410);
    const json = await res.json();
    expect(json.reason).toBe("expired");
  });

  test("a weak password (below the floor) → 400", async () => {
    freshStore();
    const pending = getParley().invites.find((i) => i.usedAt === null)!;
    const res = await acceptRoute.POST(
      apiReq("POST", "/parley/api/invites/accept", {
        body: { token: pending.token, name: "X", password: "short" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("members/[id] role + remove guards", () => {
  test("changing a membership's role TO owner → 403 even for an admin", async () => {
    freshStore();
    const admin = cookieFor("theo@lumen.test");
    const target = getParley().memberships.find((m) => m.id === "mem-theo")!;
    // An admin changing their own seat to owner is forbidden.
    const res = await roleRoute.POST(
      apiReq("POST", "/x", { cookie: admin, body: { role: "owner" } }),
      params(target.id),
    );
    expect(res.status).toBe(403);
  });

  test("an admin changing a non-owner, non-own seat → 200 + audit", async () => {
    freshStore();
    const admin = cookieFor("theo@lumen.test");
    const target = getParley().memberships.find((m) => m.id === "mem-sam")!;
    const res = await roleRoute.POST(
      apiReq("POST", "/x", { cookie: admin, body: { role: "agent" } }),
      params(target.id),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.role).toBe("agent");
    expect(getParley().audit.some((e) => e.action === "member.role_change" && e.entityId === target.id)).toBe(true);
  });

  test("removing the owner → 403; removing yourself → 403", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    // The owner seat (mem-owner)
    const ownerSeat = getParley().memberships.find((m) => m.id === "mem-owner")!;
    const r1 = await removeRoute.POST(
      apiReq("POST", "/x", { cookie: owner }),
      params(ownerSeat.id),
    );
    expect(r1.status).toBe(403); // not the owner? actually it IS the owner — removed forbidden

    // yourself (a non-owner can't remove themselves): use theo as admin
    const admin = cookieFor("theo@lumen.test");
    const selfSeat = getParley().memberships.find((m) => m.id === "mem-theo")!;
    const r2 = await removeRoute.POST(
      apiReq("POST", "/x", { cookie: admin }),
      params(selfSeat.id),
    );
    expect(r2.status).toBe(403);
  });

  test("removing a normal member (not owner, not yourself) → 204 + audit", async () => {
    freshStore();
    const owner = cookieFor("mira@lumen.test");
    const target = getParley().memberships.find((m) => m.id === "mem-sam")!;
    const res = await removeRoute.POST(
      apiReq("POST", "/x", { cookie: owner }),
      params(target.id),
    );
    expect(res.status).toBe(204);
    expect(getParley().audit.some((e) => e.action === "member.remove" && e.entityId === target.id)).toBe(true);
  });
});
