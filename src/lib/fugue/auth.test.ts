/**
 * auth.ts unit tests — scrypt round-trip, wrong-password 401, session expiry,
 * cookie flags, no password leakage.
 * PLAN.md §5 + P2 test gates.
 */
import { test, expect, beforeEach, describe } from "bun:test";
import {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  deleteSession,
  getCookieToken,
  sessionCookieSet,
  sessionCookieClear,
  requireAuth,
  toPublicUser,
  handleLogin,
  handleSignup,
  handleLogout,
  handleMe,
  generateSessionToken,
  SESSION_COOKIE_NAME,
} from "./auth";
import { loadState, resetState } from "./store";
import { DEMO_USER_EMAIL, DEMO_USER_PASSWORD } from "./seed";
import type { PublicUser, User } from "./types";

// ── helpers ──

function makeUser(email = "test@example.com", id = "usr_test"): User {
  const { hash, salt } = hashPassword("secret123");
  return {
    id,
    email,
    passwordHash: hash,
    salt,
    createdAt: "2025-06-01T00:00:00.000Z",
  };
}

function reqWithCookie(token: string, url = "http://localhost:3100/fugue/api/auth/login"): Request {
  return new Request(url, { headers: { Cookie: `fugue_session=${token}` } });
}

function reqNoCookie(url = "http://localhost:3100/fugue/api/auth/login"): Request {
  return new Request(url);
}

// ── scrypt round-trip ──

describe("scrypt password hashing", () => {
  test("hashPassword + verifyPassword round-trip succeeds", () => {
    const pw = "hunter2";
    const { hash, salt } = hashPassword(pw);
    expect(hash).toContain("scrypt:16:");
    expect(hash).toContain("$");
    expect(salt).toHaveLength(32); // 16 bytes hex
    expect(verifyPassword(pw, hash, salt)).toBe(true);
  });

  test("verifyPassword with wrong password fails", () => {
    const { hash, salt } = hashPassword("correct-horse");
    expect(verifyPassword("wrong-password", hash, salt)).toBe(false);
  });

  test("two hashPassword calls produce different salts", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  test("verifyPassword works with the demo user's committed literal", () => {
    resetState();
    const s = loadState();
    const demo = s.users.find((u) => u.email === DEMO_USER_EMAIL)!;
    expect(demo).toBeDefined();
    expect(verifyPassword(DEMO_USER_PASSWORD, demo.passwordHash, demo.salt)).toBe(true);
  });

  test("verifyPassword with a corrupt/truncated stored digest returns false, not a throw", () => {
    // A malformed stored digest (e.g. hand-edited state.json) used to make
    // timingSafeEqual throw a RangeError (buffer-length mismatch) → 500 on
    // login. The guard must return false so the 401 'invalid credentials'
    // path is preserved.
    const { salt } = hashPassword("x");
    const truncatedHash = `scrypt:16:${salt}$ab`; // 1-byte digest, not 32
    expect(() => verifyPassword("x", truncatedHash, salt)).not.toThrow();
    expect(verifyPassword("x", truncatedHash, salt)).toBe(false);
    // Digest entirely missing the '$' separator.
    expect(verifyPassword("x", "scrypt:16:" + salt, salt)).toBe(false);
  });
});

// ── session helpers ──

describe("sessions", () => {
  beforeEach(() => {
    resetState();
    loadState();
  });

  test("createSession stores a session and getSessionUser retrieves it", () => {
    const s = loadState();
    const user = s.users[0]; // demo user
    const nowIso = "2025-06-01T00:00:00.000Z";
    const token = createSession(user.id, nowIso);
    expect(typeof token).toBe("string");
    expect(token).toHaveLength(64); // 32 bytes hex

    const retrieved = getSessionUser(token, nowIso);
    expect(retrieved?.email).toBe(user.email);
  });

  test("getSessionUser returns null for unknown token", () => {
    expect(getSessionUser("nonexistent_token", "2025-06-01T00:00:00.000Z")).toBeNull();
  });

  test("getSessionUser returns null for expired session", () => {
    const s = loadState();
    const user = s.users[0];
    const nowIso = "2025-06-01T00:00:00.000Z";
    const token = createSession(user.id, nowIso);

    // Simulate expiry: set the session's expiresAt to the past.
    s.sessions[token].expiresAt = "2025-05-01T00:00:00.000Z";
    const retrieved = getSessionUser(token, nowIso);
    expect(retrieved).toBeNull();
    // Session is cleaned up.
    expect(loadState().sessions[token]).toBeUndefined();
  });

  test("deleteSession removes the session", () => {
    const s = loadState();
    const user = s.users[0];
    const nowIso = "2025-06-01T00:00:00.000Z";
    const token = createSession(user.id, nowIso);
    deleteSession(token);
    expect(getSessionUser(token, nowIso)).toBeNull();
  });

  test("generateSessionToken returns 64-char hex", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── cookie helpers ──

describe("cookie helpers", () => {
  test("sessionCookieSet includes HttpOnly, SameSite=Lax, Path=/fugue", () => {
    const cookie = sessionCookieSet("abc", false, "2025-06-01T00:00:00.000Z");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/fugue");
    expect(cookie).toContain("fugue_session=abc");
    expect(cookie).not.toContain("Secure");
  });

  test("sessionCookieSet includes Secure when secure=true", () => {
    const cookie = sessionCookieSet("abc", true, "2025-06-01T00:00:00.000Z");
    expect(cookie).toContain("Secure");
  });

  test("sessionCookieSet Max-Age is 7 days in seconds", () => {
    const cookie = sessionCookieSet("abc", false, "2025-06-01T00:00:00.000Z");
    expect(cookie).toContain("Max-Age=604800");
  });

  test("sessionCookieClear clears the cookie", () => {
    const cookie = sessionCookieClear(false);
    expect(cookie).toContain("fugue_session=");
    expect(cookie).toContain("Max-Age=0");
  });

  test("getCookieToken extracts token from cookie header", () => {
    const req = reqWithCookie("mytoken");
    expect(getCookieToken(req)).toBe("mytoken");
  });

  test("getCookieToken returns undefined when no cookie", () => {
    const req = reqNoCookie();
    expect(getCookieToken(req)).toBeUndefined();
  });

  test("getCookieToken handles multiple cookies", () => {
    const req = new Request("http://localhost", {
      headers: { Cookie: "other=1; fugue_session=tok123; x=2" },
    });
    expect(getCookieToken(req)).toBe("tok123");
  });

  test("cookie name constant is 'fugue_session'", () => {
    expect(SESSION_COOKIE_NAME).toBe("fugue_session");
  });
});

// ── toPublicUser ──

describe("toPublicUser", () => {
  test("never includes password or salt fields", () => {
    const user = makeUser();
    const pub = toPublicUser(user);
    expect(Object.keys(pub)).toEqual(["id", "email", "createdAt"]);
    expect("password" in pub).toBe(false);
    expect("salt" in pub).toBe(false);
    expect("passwordHash" in pub).toBe(false);
  });
});

// ── handleLogin ──

describe("handleLogin", () => {
  beforeEach(() => {
    resetState();
    loadState();
  });

  test("demo user login succeeds with 200", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/login");
    const result = handleLogin(
      { email: DEMO_USER_EMAIL, password: DEMO_USER_PASSWORD },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(200);
    const body = result.body as { user: PublicUser };
    expect(body.user.email).toBe(DEMO_USER_EMAIL);
    expect("password" in body.user).toBe(false);
    expect(result.setCookie).toBeDefined();
  });

  test("wrong password returns 401 (no user enumeration)", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/login");
    const result = handleLogin(
      { email: DEMO_USER_EMAIL, password: "wrong-password" },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(401);
    expect((result.body as { error: string }).error).toBe("invalid credentials");
  });

  test("unknown email returns 401 (same shape as wrong password)", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/login");
    const result = handleLogin(
      { email: "nobody@example.com", password: "whatever" },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(401);
    expect((result.body as { error: string }).error).toBe("invalid credentials");
  });

  test("missing email field returns 400", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/login");
    const result = handleLogin({ password: "x" }, req, "2025-06-01T00:00:00.000Z");
    expect(result.status).toBe(400);
    expect((result.body as { errors: Array<{ path: string }> }).errors[0].path).toBe("email");
  });

  test("non-object body returns 400", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/login");
    const result = handleLogin("not-an-object", req, "2025-06-01T00:00:00.000Z");
    expect(result.status).toBe(400);
  });
});

// ── handleSignup ──

describe("handleSignup", () => {
  beforeEach(() => {
    resetState();
    loadState();
  });

  test("new user signup succeeds with 201 and a session cookie", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/signup");
    const result = handleSignup(
      { email: "new@example.com", password: "secret123" },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(201);
    const body = result.body as { user: PublicUser };
    expect(body.user.email).toBe("new@example.com");
    expect("password" in body.user).toBe(false);
    expect(result.setCookie).toBeDefined();
  });

  test("short password returns 400", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/signup");
    const result = handleSignup(
      { email: "new@example.com", password: "abc" },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(400);
    const errors = (result.body as { errors: Array<{ path: string; message: string }> }).errors;
    expect(errors.some((e) => e.path === "password")).toBe(true);
  });

  test("invalid email returns 400", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/signup");
    const result = handleSignup(
      { email: "not-an-email", password: "secret123" },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(400);
    const errors = (result.body as { errors: Array<{ path: string }> }).errors;
    expect(errors.some((e) => e.path === "email")).toBe(true);
  });

  test("duplicate email returns 409", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/signup");
    const result = handleSignup(
      { email: DEMO_USER_EMAIL, password: "secret123" },
      req,
      "2025-06-01T00:00:00.000Z",
    );
    expect(result.status).toBe(409);
  });
});

// ── handleLogout ──

describe("handleLogout", () => {
  beforeEach(() => {
    resetState();
    loadState();
  });

  test("logout with valid session returns 204 and clears the cookie", () => {
    const s = loadState();
    const user = s.users[0];
    const nowIso = "2025-06-01T00:00:00.000Z";
    const token = createSession(user.id, nowIso);
    const req = reqWithCookie(token, "http://localhost:3100/fugue/api/auth/logout");
    const result = handleLogout(req, nowIso);
    expect(result.status).toBe(204);
    expect(result.setCookie).toBeDefined();
    expect(result.setCookie).toContain("Max-Age=0");
  });

  test("logout without session returns 401", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/logout");
    const result = handleLogout(req, "2025-06-01T00:00:00.000Z");
    expect(result.status).toBe(401);
  });
});

// ── handleMe ──

describe("handleMe", () => {
  beforeEach(() => {
    resetState();
    loadState();
  });

  test("me with valid session returns 200 and PublicUser", () => {
    const s = loadState();
    const user = s.users[0];
    const nowIso = "2025-06-01T00:00:00.000Z";
    const token = createSession(user.id, nowIso);
    const req = reqWithCookie(token, "http://localhost:3100/fugue/api/auth/me");
    const result = handleMe(req, nowIso);
    expect(result.status).toBe(200);
    const body = result.body as { user: PublicUser };
    expect(body.user.email).toBe(user.email);
    expect("password" in body.user).toBe(false);
  });

  test("me without session returns 401 with user: null", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/auth/me");
    const result = handleMe(req, "2025-06-01T00:00:00.000Z");
    expect(result.status).toBe(401);
    expect((result.body as { user: null }).user).toBeNull();
  });
});

// ── requireAuth ──

describe("requireAuth", () => {
  beforeEach(() => {
    resetState();
    loadState();
  });

  test("returns PublicUser when session is valid", () => {
    const s = loadState();
    const user = s.users[0];
    const nowIso = "2025-06-01T00:00:00.000Z";
    const token = createSession(user.id, nowIso);
    const req = reqWithCookie(token, "http://localhost:3100/fugue/api/workspaces");
    const pub = requireAuth(req, nowIso);
    expect(pub).not.toBeNull();
    expect(pub!.email).toBe(user.email);
  });

  test("returns null when no session", () => {
    const req = reqNoCookie("http://localhost:3100/fugue/api/workspaces");
    expect(requireAuth(req, "2025-06-01T00:00:00.000Z")).toBeNull();
  });
});
