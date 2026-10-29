/**
 * Integration lane for /aria/api/auth — drive the real route
 * handlers with `Request` objects, a pinned clock, a reset store.
 *
 * - login 200 + a real cookie (HMAC signature verified on the next
 *   probe), wrong-password 401, unknown-email 401
 * - logout destroys the row (the next session probe 401s)
 * - expiry (a session past `expiresAt` → 401 at the next probe)
 * - cookie-signature verification (a tampered signature → 401)
 */

import { describe, expect, test, beforeAll } from "bun:test";
import { cookieFor, freshStore, apiReq } from "./helpers";
import { getAria, loginSession } from "@/lib/aria/aria-store";
import { makeSignedCookie } from "@/lib/aria/sessions";
import { AS_OF, SESSION_TTL_MS } from "@/lib/aria/types";

// Route handlers (the real ones)
import * as loginRoute from "@/app/aria/api/auth/login/route";
import * as logoutRoute from "@/app/aria/api/auth/logout/route";
import * as sessionRoute from "@/app/aria/api/auth/session/route";

beforeAll(freshStore);

describe("POST /auth/login", () => {
  test("200 + a real session cookie on valid credentials", async () => {
    freshStore();
    const req = apiReq("POST", "/aria/api/auth/login", {
      body: { email: "mira@lumen.test", password: "aria-demo-1" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.email).toBe("mira@lumen.test");
    expect(json.role).toBe("owner");
    // a real cookie, verified by the session probe (the test-lane
    // x-aria-cookie fallback — WHATWG Request strips `cookie`)
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("aria_ses=");
    const cookieNameValue = setCookie.split(";")[0]; // `aria_ses=<val>`
    const val = decodeURIComponent(cookieNameValue.split("=").slice(1).join("="));
    const probe = apiReq("GET", "/aria/api/auth/session", {
      cookie: `aria_ses=${encodeURIComponent(val)}`,
    });
    const probeRes = await sessionRoute.GET(probe);
    expect(probeRes.status).toBe(200);
  });

  test("401 on a wrong password (the brief's wrong-password 401)", async () => {
    freshStore();
    const req = apiReq("POST", "/aria/api/auth/login", {
      body: { email: "mira@lumen.test", password: "wrong" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(401);
  });

  test("401 on an unknown email (never a 'user exists' leak)", async () => {
    freshStore();
    const req = apiReq("POST", "/aria/api/auth/login", {
      body: { email: "ghost@nowhere.test", password: "aria-demo-1" },
    });
    const res = await loginRoute.POST(req);
    expect(res.status).toBe(401);
  });

  test("400 on a malformed payload (bad email + empty password)", async () => {
    freshStore();
    const req = apiReq("POST", "/aria/api/auth/login", {
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
    const req = new Request("http://localhost/aria/api/auth/login", {
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
    const req = apiReq("POST", "/aria/api/auth/login", {
      body: { email: "ingrid@northwind.test", password: "aria-demo-1" },
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
      apiReq("POST", "/aria/api/auth/logout", { cookie }),
    );
    expect(out.status).toBe(204);
    const probe = await sessionRoute.GET(
      apiReq("GET", "/aria/api/auth/session", { cookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("a bogus cookie → 401 + set-cookie cleared (idempotent)", async () => {
    freshStore();
    const out = await logoutRoute.POST(
      apiReq("POST", "/aria/api/auth/logout", { cookie: "aria_ses=bogus" }),
    );
    expect(out.status).toBe(401);
    expect(out.headers.get("set-cookie")).toContain("aria_ses=");
  });

  test("no cookie at all → 401 (the auth rung)", async () => {
    freshStore();
    const out = await logoutRoute.POST(
      apiReq("POST", "/aria/api/auth/logout"),
    );
    expect(out.status).toBe(401);
  });
});

describe("GET /auth/session (expiry + signature)", () => {
  test("a session past expiresAt → 401 at the next probe", async () => {
    freshStore();
    const cookie = cookieFor("ada@lumen.test");
    // Pin the clock 9h past the session's creation → the 8h TTL
    // has lapsed.
    const { setClock } = await import("@/lib/aria/clock");
    setClock(
      new Date(
        new Date(AS_OF).getTime() + SESSION_TTL_MS + 3_600_000,
      ).toISOString(),
    );
    const probe = await sessionRoute.GET(
      apiReq("GET", "/aria/api/auth/session", { cookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("a tampered signature → 401 (the HMAC rejects it)", async () => {
    freshStore();
    // A real session id, but a DOCTORED signature.
    const session = getAria().sessions.find((s) => s.tenantId === "aria-tn-lumen")!;
    const good = makeSignedCookie(session.id);
    const sid = good.split(".")[0];
    const badCookie = `aria_ses=${encodeURIComponent(`${sid}.${"f".repeat(64)}`)}`;
    const probe = await sessionRoute.GET(
      apiReq("GET", "/aria/api/auth/session", { cookie: badCookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("an unknown session id → 401", async () => {
    freshStore();
    const cookie = `aria_ses=${encodeURIComponent(`ses-unknown.${"0".repeat(64)}`)}`;
    const probe = await sessionRoute.GET(
      apiReq("GET", "/aria/api/auth/session", { cookie }),
    );
    expect(probe.status).toBe(401);
  });

  test("200 the session's public shape on a live cookie", async () => {
    freshStore();
    const cookie = cookieFor("ingrid@northwind.test");
    const res = await sessionRoute.GET(
      apiReq("GET", "/aria/api/auth/session", { cookie }),
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
      apiReq("GET", "/aria/api/auth/session"),
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("unauthenticated");
  });

  test("the login lane sets a Set-Cookie with the session's TTL", async () => {
    freshStore();
    const res = await loginRoute.POST(
      apiReq("POST", "/aria/api/auth/login", {
        body: { email: "marco@northwind.test", password: "aria-demo-1" },
      }),
    );
    expect(res.status).toBe(200);
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toContain("Max-Age=");
    expect(sc).toContain("HttpOnly");
  });
});
