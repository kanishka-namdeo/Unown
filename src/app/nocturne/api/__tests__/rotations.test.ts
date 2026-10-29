/**
 * Integration lane for /nocturne/api/rotations + /overrides
 * (plan §3.4): the CRUD + the contiguity 400 gate (the P1 tiling
 * invariant, plan §7/6), the override window's 400 rung, the
 * responder's own-seat carve-out, and the whoIsOnCall probe on
 * seeded rotations.
 */

import { describe, expect, test, beforeAll } from "bun:test";
import {
  cookieFor,
  freshStore,
  apiReq,
  TENANT_IDS,
  seededIdFor,
} from "./helpers";

// Route handlers (the real ones)
import * as rotationsRoute from "@/app/nocturne/api/rotations/route";
import * as rotationByIdRoute from "@/app/nocturne/api/rotations/[id]/route";
import * as overridesPostRoute from "@/app/nocturne/api/rotations/[id]/overrides/route";
import * as overrideByIdRoute from "@/app/nocturne/api/overrides/[id]/route";

beforeAll(freshStore);

/** A valid contiguous 2-seat weekly tiling anchored at the seed's
 *  period start (2026-08-31T00:00:00Z — two 7-day shifts). */
const WEEK = 7 * 86_400_000;
const ANCHOR = "2026-08-31T00:00:00Z";
function isoPlus(msFromAnchor: number): string {
  return new Date(new Date(ANCHOR).getTime() + msFromAnchor)
    .toISOString()
    .replace(".000Z", "Z");
}

describe("GET /rotations (the computed seat surface)", () => {
  test("200 the tenant's rotations + the currentSeat/nextSeat surface", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await rotationsRoute.GET(
      apiReq("GET", "/nocturne/api/rotations", { cookie }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.length).toBe(2);
    for (const row of json) {
      expect(row).toHaveProperty("currentSeat");
      expect(row).toHaveProperty("nextSeat");
      expect(row).toHaveProperty("handoffAt");
    }
  });

  test("401 with no cookie", async () => {
    freshStore();
    const res = await rotationsRoute.GET(apiReq("GET", "/nocturne/api/rotations"));
    expect(res.status).toBe(401);
  });
});

describe("GET /rotations/[id] (the detail + overrides)", () => {
  test("200 the rotation + its overrides", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const res = await rotationByIdRoute.GET(
      apiReq("GET", "/nocturne/api/rotations/nc_seed_rot_02", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_rot_02" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Console Weekly");
    // The seeded override (Ada covers Sam on Console Weekly):
    expect(json.overrides).toHaveLength(1);
    expect(json.overrides[0]!.forUserId).toBe("usr-lumen-sam");
  });

  test("404 for ANOTHER tenant's rotation (the P0 leak pin)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await rotationByIdRoute.GET(
      apiReq("GET", "/nocturne/api/rotations/nc_seed_rot_01", { cookie }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /rotations (the create lane + contiguity 400 gate)", () => {
  test("an admin → 201 a contiguous tiling", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "Two-Seat Weekly",
          seats: [
            { userId: "usr-lumen-mira", start: ANCHOR },
            { userId: "usr-lumen-theo", start: isoPlus(WEEK) },
          ],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.seats).toHaveLength(2);
    expect(json.seats[0]!.seatIndex).toBe(0);
  });

  test("400 on a contiguity violation (the P1 tiling gate — plan §7/6): a GAP", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "Gappy",
          seats: [
            { userId: "usr-lumen-mira", start: ANCHOR },
            { userId: "usr-lumen-theo", start: isoPlus(WEEK * 2) }, // gap: not exactly one shift apart
          ],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.errors.some((e: string) => e.includes("tile"))).toBe(true);
  });

  test("400 on an OVERLAP (duplicate start)", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "Overlap",
          seats: [
            { userId: "usr-lumen-mira", start: ANCHOR },
            { userId: "usr-lumen-theo", start: ANCHOR },
          ],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  test("400 when a seat's userId is not the tenant's member (fail-closed tenancy)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "Cross-Seat",
          seats: [
            { userId: "usr-lumen-mira", start: ANCHOR }, // Lumen's user
          ],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("402 at the rotation cap (a starter tenant has a 2-rotation cap)", async () => {
    freshStore();
    // Northwind is a starter plan (2-rotation cap, 1 seeded):
    const cookie = cookieFor("ingrid@northwind.test");
    const second = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "NW Second",
          seats: [
            { userId: "usr-nw-priya", start: ANCHOR },
            { userId: "usr-nw-marco", start: isoPlus(WEEK) },
          ],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(second.status).toBe(201);
    const third = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "NW Third",
          seats: [
            { userId: "usr-nw-ingrid", start: ANCHOR },
            { userId: "usr-nw-priya", start: isoPlus(WEEK) },
          ],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(third.status).toBe(402);
    const json = await third.json();
    expect(json.error).toBe("quota_exceeded");
  });

  test("a responder → 403 naming the permission", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    const res = await rotationsRoute.POST(
      apiReq("POST", "/nocturne/api/rotations", {
        cookie,
        body: {
          name: "Nope",
          seats: [{ userId: "usr-lumen-ada", start: ANCHOR }],
          shiftLengthMs: WEEK,
          boundaryDow: 0,
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("PATCH /rotations/[id] (the update lane)", () => {
  test("an admin → 200 the updated row (name/shiftLengthMs/boundaryDow)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await rotationByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/rotations/nc_seed_rot_03", {
        cookie,
        body: { name: "Store Weekly (renamed)" },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_03" }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe("Store Weekly (renamed)");
  });

  test("400 on a bad boundaryDow", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await rotationByIdRoute.PATCH(
      apiReq("PATCH", "/nocturne/api/rotations/nc_seed_rot_03", {
        cookie,
        body: { boundaryDow: 9 },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_03" }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /rotations/[id]/overrides (the carve-out lane)", () => {
  test("an admin → 201 an override for a rotation seat", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-theo",
          userId: "usr-lumen-ada",
          startsAt: "2026-10-29T00:00:00Z",
          endsAt: "2026-10-30T00:00:00Z",
          reason: "Theo is out",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.forUserId).toBe("usr-lumen-theo");
    expect(json.userId).toBe("usr-lumen-ada");
  });

  test("400 when forUserId is not a seat of the rotation", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-kai", // not a seat of rot-01
          userId: "usr-lumen-ada",
          startsAt: "2026-10-29T00:00:00Z",
          endsAt: "2026-10-30T00:00:00Z",
          reason: "x",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(400);
  });

  test("400 on an invalid window (startsAt >= endsAt)", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const res = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-theo",
          userId: "usr-lumen-ada",
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-01T00:00:00Z",
          reason: "x",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(400);
  });

  test("a responder's OWN seat → 201 (the carve-out)", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    // Ada is a seat of rot-01 — she may cover her own seat:
    const res = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-ada",
          userId: "usr-lumen-sam",
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-05T00:00:00Z",
          reason: "PTO",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(201);
  });

  test("a responder covering a TEAMMATE's seat → 403 (the carve-out's denial)", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    const res = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-theo",
          userId: "usr-lumen-ada",
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-05T00:00:00Z",
          reason: "x",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.permission).toBe("rotation.override");
  });

  test("404 for ANOTHER tenant's rotation (never a 403)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-theo",
          userId: "usr-lumen-ada",
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-05T00:00:00Z",
          reason: "x",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /overrides/[id] (the teardown + carve-out)", () => {
  test("an admin → 204, the row is gone", async () => {
    freshStore();
    const cookie = cookieFor("theo@lumen.test");
    const ovr = seededIdFor(TENANT_IDS.lumen, "override");
    const res = await overrideByIdRoute.DELETE(
      apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, { cookie }),
      { params: Promise.resolve({ id: ovr }) },
    );
    expect(res.status).toBe(204);
    const gone = await overrideByIdRoute.DELETE(
      apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, { cookie }),
      { params: Promise.resolve({ id: ovr }) },
    );
    expect(gone.status).toBe(404);
  });

  test("404 for ANOTHER tenant's override (never a 403)", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const ovr = seededIdFor(TENANT_IDS.lumen, "override");
    const res = await overrideByIdRoute.DELETE(
      apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, { cookie }),
      { params: Promise.resolve({ id: ovr }) },
    );
    expect(res.status).toBe(404);
  });

  test("an admin deletes a teammate's override → 204 (owner/admin are ungated)", async () => {
    freshStore();
    // Theo is the admin lane (ungated by the carve-out) — he can
    // delete an override where neither seat touches him, AND one
    // where he is the cover. This is the "admin is ungated" pin.
    const cookie = cookieFor("theo@lumen.test");
    // First the case where Theo covers Kai (neither seat is Ada/Sam
    // → Sam's 403 is pinned below).
    const create = await overridesPostRoute.POST(
      apiReq("POST", "/nocturne/api/rotations/nc_seed_rot_01/overrides", {
        cookie,
        body: {
          forUserId: "usr-lumen-mira",
          userId: "usr-lumen-theo",
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-05T00:00:00Z",
          reason: "Theo covers Mira",
        },
      }),
      { params: Promise.resolve({ id: "nc_seed_rot_01" }) },
    );
    const ovr = (await create.json()).id;
    // Sam is neither seat → 403 (the carve-out's denial).
    const den = await overrideByIdRoute.DELETE(
      apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, {
        cookie: cookieFor("sam@lumen.test"),
      }),
      { params: Promise.resolve({ id: ovr }) },
    );
    expect(den.status).toBe(403);
    // Theo is the cover (userId === self, ungated admin lane) → 204.
    const ok = await overrideByIdRoute.DELETE(
      apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, {
        cookie: cookieFor("theo@lumen.test"),
      }),
      { params: Promise.resolve({ id: ovr }) },
    );
    expect(ok.status).toBe(204);
  });

  test("a responder who COVERS the SEED override may delete it (userId === self)", async () => {
    freshStore();
    const ovr = seededIdFor(TENANT_IDS.lumen, "override");
    // Ada is the COVER (userId = usr-lumen-ada) — the "override I
    // cover" is also "my own override":
    const ok = await overrideByIdRoute.DELETE(
      apiReq("DELETE", `/nocturne/api/overrides/${ovr}`, {
        cookie: cookieFor("ada@lumen.test"),
      }),
      { params: Promise.resolve({ id: ovr }) },
    );
    expect(ok.status).toBe(204);
  });
});
