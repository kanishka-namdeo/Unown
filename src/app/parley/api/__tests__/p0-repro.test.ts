/**
 * P0 REPRO — turned into the regression pin AFTER the fix: any
 * admin/owner attempting to promote a non-owner seat TO `owner`
 * must 403 (the tenant already has its owner seat — `mem-owner` /
 * `mem-nw-owner` per the seed; a second owner would break the
 * owner-seat carve-out + the customer-side owner-lookup).
 */
import { describe, expect, test, beforeAll } from "bun:test";
import { freshStore, cookieFor, apiReq } from "./helpers";
import { getParley } from "@/lib/parley/store";

function memIdFor(userId: string): string {
  const m = getParley().memberships.find((x) => x.userId === userId)!;
  return m.id;
}

describe("P0 REGRESSION: promoting a seat TO owner must 403", () => {
  beforeAll(() => freshStore());

  test("an admin (theo) flipping a non-owner seat (ada's) TO 'owner' → 403, owner count stays 1", async () => {
    const roleR = await import("@/app/parley/api/members/[id]/role/route");
    const targetMemId = memIdFor("usr-ada"); // ada's seat (currently agent)
    const res = await roleR.POST(
      apiReq("POST", `/parley/api/members/${targetMemId}/role`, {
        cookie: cookieFor("theo@lumen.test"), // admin
        body: { role: "owner" },
      }),
      { params: Promise.resolve({ id: targetMemId }) },
    );
    expect(res.status).toBe(403);
    const ownersNow = getParley().memberships.filter((m) => m.role === "owner" && m.tenantId === "tn-lumen");
    expect(ownersNow.length).toBe(1);
    expect(getParley().memberships.find((m) => m.id === targetMemId)!.role).toBe("agent");
  });

  test("store-level backstop: changeRole refuses to mint a second owner even when called directly", async () => {
    freshStore();
    const { changeRole, getParley: g, sessionActor } = await import("@/lib/parley/store");
    const demo = g().sessions.find((s) => s.tenantId === "tn-lumen")!;
    const { ctx } = sessionActor(demo);
    const targetMemId = memIdFor("usr-ada");
    const out = changeRole(ctx, targetMemId, "owner");
    expect(out).toBeNull();
    expect(g().memberships.filter((m) => m.role === "owner" && m.tenantId === "tn-lumen").length).toBe(1);
  });
});
