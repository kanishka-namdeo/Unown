/**
 * Integration lane for /parley/api/auth — drive the real route
 * handlers with `Request` objects, a pinned clock, a reset store.
 *
 * - login 200 + a real cookie (HMAC signature verified on the next
 *   probe), wrong-password 401, unknown-email 401
 * - logout destroys the row (the next session probe 401s)
 * - expiry (a session past `expiresAt` → 401 at the next probe)
 * - cookie-signature verification (a tampered signature → 401)
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { cookieFor, freshStore, apiReq, convoIdFor } from "./helpers";
import { getParley } from "@/lib/parley/store";
import { AS_OF } from "@/lib/parley/types";
import { makeSignedCookie } from "@/lib/parley/sessions";

// Route handlers (the real ones)
import * as loginRoute from "@/app/parley/api/auth/login/route";
import * as logoutRoute from "@/app/parley/api/auth/logout/route";
import * as sessionRoute from "@/app/parley/api/auth/session/route";

beforeAll(freshStore);

describe("POST /auth/login", () => {
  test("200 + a real session cookie on valid credentials", async () => {
    freshStore();
    const req = apiReq("POST", "/parley/api/auth/login", {
      body: { email: "mira@lumen.test", password: "parley-demo-1" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe("mira@lumen.test");
    expect(json.role).toBe("owner");
    // a real cookie, verified by the session probe (the test-lane
    // x-parley-cookie fallback — WHATWG Request strips `cookie`)
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("parley_ses=");
    const cookieNameValue = setCookie.split(";")[0]; // `parley_ses=<val>`
    const val = decodeURIComponent(cookieNameValue.split("=").slice(1).join("="));
    const probe = apiReq("GET", "/parley/api/auth/session", {
      cookie: `${"parley_ses"}=${encodeURIComponent(val)}`,
    });
    const probeRes = await sessionRoute.GET(probe);
    expect(probeRes.status).toBe(200);
  });

  test("401 on a wrong password (the brief's wrong-password 401)", async () => {
    freshStore();
    const req = apiReq("POST", "/parley/api/auth/login", {
      body: { email: "mira@lumen.test", password: "wrong" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(401);
  });

  test("401 on an unknown email (never a 'user exists' leak)", async () => {
    freshStore();
    const req = apiReq("POST", "/parley/api/auth/login", {
      body: { email: "ghost@nowhere.test", password: "parley-demo-1" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(401);
  });

  test("400 on a malformed payload", async () => {
    freshStore();
    const req = apiReq("POST", "/parley/api/auth/login", {
      body: { email: "not-an-email", password: "" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(400);
  });

  test("400 on invalid JSON", async () => {
    freshStore();
    const req = new Request("http://localhost/parley/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/logout", () => {
  test("destroys the row — the next session probe 401s", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const out = await logoutRoute.POST(apiReq("POST", "/parley/api/auth/logout", { cookie }));
    expect(out.status).toBe(204);
    const probe = await sessionRoute.GET(apiReq("GET", "/parley/api/auth/session", { cookie }));
    expect(probe.status).toBe(401);
  });

  test("a logged-out cookie still clears (401 + set-cookie), idempotent", async () => {
    freshStore();
    const out = await logoutRoute.POST(apiReq("POST", "/parley/api/auth/logout", { cookie: "parley_ses=bogus" }));
    expect(out.status).toBe(401);
  });
});

describe("GET /auth/session (expiry + signature)", () => {
  test("a session past expiresAt → 401 at the next probe", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    // Pin the clock 9h past the session's creation → the 8h TTL has
    // lapsed.
    const { setClock } = await import("@/lib/parley/clock");
    setClock(new Date(AS_OF).getTime() + 9 * 3_600_000 >= 0
      ? "2026-10-29T01:00:00Z"
      : AS_OF);
    const probe = await sessionRoute.GET(apiReq("GET", "/parley/api/auth/session", { cookie }));
    expect(probe.status).toBe(401);
  });

  test("a tampered signature → 401 (the HMAC rejects it)", async () => {
    freshStore();
    // A real session id, but a DOCTORED signature.
    const sessionId = makeSignedCookie("ses-forged-000001").split(".")[0];
    const badCookie = `parley_ses=${encodeURIComponent(`${sessionId}.${"f".repeat(64)}`)}`;
    const probe = await sessionRoute.GET(apiReq("GET", "/parley/api/auth/session", { cookie: badCookie }));
    expect(probe.status).toBe(401);
  });

  test("an unknown session id → 401", async () => {
    freshStore();
    const cookie = `parley_ses=${encodeURIComponent(`ses-unknown.${"0".repeat(64)}`)}`;
    const probe = await sessionRoute.GET(apiReq("GET", "/parley/api/auth/session", { cookie }));
    expect(probe.status).toBe(401);
  });

  test("200 the session's public shape on a live cookie", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await sessionRoute.GET(apiReq("GET", "/parley/api/auth/session", { cookie }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe("ingrid@northwind.test");
    expect(json.role).toBe("owner");
    expect(json.tenant.slug).toBe("northwind");
  });
});
