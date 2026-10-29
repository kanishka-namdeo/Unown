/**
 * Integration lane for /nocturne/api/auth — drive the real route
 * handlers with `Request` objects, a pinned clock, a reset store.
 *
 * - login 200 + a real cookie (HMAC signature verified on the next
 *   probe), wrong-password 401, unknown-email 401, 400 bad shape
 * - logout destroys the row (the next session probe 401s)
 * - expiry (a session past `expiresAt` → 401 at the next probe)
 * - cookie-signature verification (a tampered signature → 401)
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { cookieFor, freshStore, apiReq } from "./helpers";
import { getNocturne, loginSession, nocturneReset, sessionRows } from "@/app/nocturne/api/_state";
import { makeSignedCookie, findSession } from "@/lib/nocturne/sessions";
import { AS_OF, SESSION_TTL_MS } from "@/lib/nocturne/types";

// Route handlers (the real ones)
import * as loginRoute from "@/app/nocturne/api/auth/login/route";
import * as logoutRoute from "@/app/nocturne/api/auth/logout/route";
import * as sessionRoute from "@/app/nocturne/api/auth/session/route";

beforeAll(freshStore);

describe("POST /auth/login", () => {
  test("200 + a real session cookie on valid credentials", async () => {
    freshStore();
    const req = apiReq("POST", "/nocturne/api/auth/login", {
      body: { email: "mira@lumen.test", password: "nocturne-demo-1" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe("mira@lumen.test");
    expect(json.role).toBe("owner");
    // a real cookie, verified by the session probe (the test-lane
    // x-nocturne-cookie fallback — WHATWG Request strips `cookie`)
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("nocturne_ses=");
    const cookieNameValue = setCookie.split(";")[0]!; // `nocturne_ses=<val>`
    const val = decodeURIComponent(cookieNameValue.split("=").slice(1).join("="));
    const probe = apiReq("GET", "/nocturne/api/auth/session", {
      cookie: `nocturne_ses=${encodeURIComponent(val)}`,
    });
    const probeRes = await sessionRoute.GET(probe);
    expect(probeRes.status).toBe(200);
  });

  test("401 on a wrong password (the brief's wrong-password 401)", async () => {
    freshStore();
    const req = apiReq("POST", "/nocturne/api/auth/login", {
      body: { email: "mira@lumen.test", password: "wrong" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(401);
  });

  test("401 on an unknown email (never a 'user exists' leak)", async () => {
    freshStore();
    const req = apiReq("POST", "/nocturne/api/auth/login", {
      body: { email: "ghost@nowhere.test", password: "nocturne-demo-1" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(401);
  });

  test("400 on a malformed payload (bad email + empty password)", async () => {
    freshStore();
    const req = apiReq("POST", "/nocturne/api/auth/login", {
      body: { email: "not-an-email", password: "" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation failed");
    expect(json.errors.length).toBeGreaterThan(0);
  });

  test("400 on invalid JSON", async () => {
    freshStore();
    const req = new Request("http://localhost/nocturne/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid",
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("invalid JSON body");
  });

  test("the session's user/tenant shape carries the caller's role + tenant", async () => {
    freshStore();
    const req = apiReq("POST", "/nocturne/api/auth/login", {
      body: { email: "ingrid@northwind.test", password: "nocturne-demo-1" },
    });
    const res = await loginRoute.POST(req);
    const json = await res.json();
    expect(json.role).toBe("owner");
    expect(json.tenant.slug).toBe("northwind");
  });
});

describe("POST /auth/logout", () => {
  test("destroys the row — the next session probe 401s", async () => {
    freshStore();
    const cookie = cookieFor("mira@lumen.test");
    const out = await logoutRoute.POST(
      apiReq("POST", "/nocturne/api/auth/logout", { cookie }),
    );
    expect(out.status).toBe(204);
    const probe = await sessionRoute.GET(
      apiReq("GET", "/nocturne/api/auth/session", { cookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("a bogus cookie → 401 + set-cookie cleared (idempotent)", async () => {
    freshStore();
    const out = await logoutRoute.POST(
      apiReq("POST", "/nocturne/api/auth/logout", { cookie: "nocturne_ses=bogus" }),
    );
    expect(out.status).toBe(401);
    expect(out.headers.get("set-cookie")).toContain("nocturne_ses=");
  });

  test("no cookie at all → 401 (the auth rung)", async () => {
    freshStore();
    const out = await logoutRoute.POST(
      apiReq("POST", "/nocturne/api/auth/logout"),
    );
    expect(out.status).toBe(401);
  });
});

describe("GET /auth/session (expiry + signature)", () => {
  test("session-id collision pin: consecutive logins mint DISTINCT ids", async () => {
    freshStore();
    const s = getNocturne();
    const theo = s.users.find((u) => u.email === "theo@lumen.test")!;
    const sam = s.users.find((u) => u.email === "sam@lumen.test")!;
    const theoA = loginSession(theo.id, "tn-lumen");
    const samA = loginSession(sam.id, "tn-lumen");
    const theoB = loginSession(theo.id, "tn-lumen");
    // Three DISTINCT ids — the allocator must bump the seq on every
    // login, so the second theo login cannot collide with sam's.
    expect(theoA.id).not.toBe(samA.id);
    expect(theoA.id).not.toBe(theoB.id);
    expect(samA.id).not.toBe(theoB.id);
    // Each cookie resolves to ITS OWN user's session row.
    const rows = sessionRows(getNocturne());
    for (const [row, email] of [
      [theoA, "theo@lumen.test"],
      [samA, "sam@lumen.test"],
      [theoB, "theo@lumen.test"],
    ] as const) {
      const found = findSession(rows, row.id);
      expect(found?.id).toBe(row.id);
      const user = getNocturne().users.find((u) => u.id === found?.userId);
      expect(user?.email).toBe(email);
    }
  });

  test("a session past expiresAt → 401 at the next probe", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    // Pin the clock 9h past the session's creation → the 8h TTL
    // has lapsed.
    const { setClock } = await import("@/lib/nocturne/clock");
    setClock(
      new Date(
        new Date(AS_OF).getTime() + SESSION_TTL_MS + 3_600_000,
      ).toISOString(),
    );
    const probe = await sessionRoute.GET(
      apiReq("GET", "/nocturne/api/auth/session", { cookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("a tampered signature → 401 (the HMAC rejects it)", async () => {
    freshStore();
    // A real session id, but a DOCTORED signature.
    const session = loginSession("usr-lumen-mira", "tn-lumen");
    const good = makeSignedCookie(session.id);
    const sid = good.split(".")[0];
    const badCookie = `nocturne_ses=${encodeURIComponent(`${sid}.${"f".repeat(64)}`)}`;
    const probe = await sessionRoute.GET(
      apiReq("GET", "/nocturne/api/auth/session", { cookie: badCookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("an unknown session id → 401", async () => {
    freshStore();
    const cookie = `nocturne_ses=${encodeURIComponent(`nc_ses_unknown.${"0".repeat(64)}`)}`;
    const probe = await sessionRoute.GET(
      apiReq("GET", "/nocturne/api/auth/session", { cookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("200 the session's public shape on a live cookie", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await sessionRoute.GET(
      apiReq("GET", "/nocturne/api/auth/session", { cookie }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe("ingrid@northwind.test");
    expect(json.role).toBe("owner");
    expect(json.tenant.slug).toBe("northwind");
  });

  test("no cookie → 401 (the no-context rung)", async () => {
    freshStore();
    const res = await sessionRoute.GET(
      apiReq("GET", "/nocturne/api/auth/session"),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("unauthenticated");
  });

  test("the login lane sets a Set-Cookie with the session's TTL", async () => {
    freshStore();
    const res = await loginRoute.POST(
      apiReq("POST", "/nocturne/api/auth/login", {
        body: { email: "marco@northwind.test", password: "nocturne-demo-1" },
      }),
    );
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain("Max-Age=");
    expect(sc).toContain("HttpOnly");
  });
});
