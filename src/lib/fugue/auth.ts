/**
 * Fugue auth — scrypt password hashing, signed-cookie sessions.
 * PLAN.md §5.
 *
 * Security invariants:
 *  - Passwords are NEVER returned by any API route (PublicUser has no password field).
 *  - Session cookie: httpOnly + SameSite=Lax + Path=/fugue (+ Secure on HTTPS).
 *  - Login failure returns the same 401 for unknown email and wrong password (no user enumeration).
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FugueState, PublicUser, User } from "./types";
import { loadState, saveState, nextId } from "./store";

// ── Constants ──

const SESSION_COOKIE = "fugue_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;

// ── scrypt helpers ──

/**
 * Hash a password with scrypt. Returns `{ hash, salt }` where:
 *  - salt: 32-char hex string (16 random bytes)
 *  - hash: "scrypt:16:<saltHex>$<digestHex>" (32-byte digest)
 */
export function hashPassword(password: string): { hash: string; salt: string } {
  const saltBuf = randomBytes(SALT_BYTES);
  const saltHex = saltBuf.toString("hex");
  const digest = scryptSync(password, saltBuf, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return { hash: `scrypt:16:${saltHex}$${digest.toString("hex")}`, salt: saltHex };
}

/**
 * Verify a password against a stored scrypt hash.
 * hash format: "scrypt:<saltLen>:<saltHex>$<digestHex>"
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  // Re-derive the digest with the stored salt.
  const saltBuf = Buffer.from(salt, "hex");
  const digest = scryptSync(password, saltBuf, 32, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const expected = digest.toString("hex");
  const storedDigest = hash.split("$")[1] ?? "";
  // Guard: timingSafeEqual throws if the two buffers differ in byte length —
  // a corrupt or truncated stored digest must yield `false`, never a 500.
  const expectedBuf = Buffer.from(expected, "hex");
  const storedBuf = Buffer.from(storedDigest, "hex");
  if (expectedBuf.length !== storedBuf.length) return false;
  return timingSafeEqual(expectedBuf, storedBuf);
}

// ── Session helpers ──

/** Generate a 32-byte random hex session token. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create a session for a user. Returns the token (to be set in the cookie).
 * The session is stored in state.sessions keyed by token.
 *
 * `nowIso` stamps createdAt only; the expiry is always anchored to the real
 * clock so getSessionUser(req.now) can't be fooled by a stale or future
 * stamp — a session created "in the past" must still live its full 7 days.
 */
export function createSession(userId: string, nowIso: string): string {
  const s = loadState();
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  s.sessions[token] = { userId, createdAt: nowIso, expiresAt };
  saveState();
  return token;
}

/**
 * Look up a session token → user (null if not found, unknown, or expired).
 */
export function getSessionUser(token: string | undefined, nowIso: string): User | null {
  if (!token) return null;
  const s = loadState();
  const session = s.sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= new Date(nowIso).getTime()) {
    // Expired — clean up.
    delete s.sessions[token];
    saveState();
    return null;
  }
  const user = s.users.find((u) => u.id === session.userId);
  return user ?? null;
}

/** Delete a session token (logout). No-op if token is unknown. */
export function deleteSession(token: string): void {
  const s = loadState();
  if (s.sessions[token]) {
    delete s.sessions[token];
    saveState();
  }
}

// ── Cookie helpers ──

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

/**
 * Build the Set-Cookie header value for a session.
 * @param token  the session token
 * @param secure true when the request is HTTPS
 * @param nowIso current ISO timestamp (used for Max-Age calculation)
 */
export function sessionCookieSet(
  token: string,
  secure: boolean,
  nowIso: string,
): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/fugue",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Build the Set-Cookie header value to clear the session cookie.
 */
export function sessionCookieClear(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/fugue; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Extract the session token from a Request's cookie header.
 */
export function getCookieToken(req: Request): string | undefined {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === SESSION_COOKIE) {
      return rest.join("=") || undefined;
    }
  }
  return undefined;
}

/** Determine whether a request came over HTTPS (for the Secure cookie flag). */
export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto");
  if (proto === "https") return true;
  // In dev (no reverse proxy) default to insecure.
  const url = new URL(req.url);
  return url.protocol === "https:";
}

// ── PublicUser helpers ──

/** Project a User → PublicUser (never includes password/salt). */
export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

// ── Auth route handlers ──

export interface AuthResult {
  status: number;
  body: unknown;
  /** Set-Cookie header value (only when creating/clearing a session). */
  setCookie?: string;
}

/**
 * POST /fugue/api/auth/signup
 * Body: { email, password }
 * 400 field errors, 409 duplicate email, 201 { user, session }
 */
export function handleSignup(
  body: unknown,
  req: Request,
  nowIso: string,
): AuthResult {
  // Validate body.
  if (typeof body !== "object" || body === null) {
    return { status: 400, body: { errors: [{ path: "body", message: "request body must be an object" }] } };
  }
  const b = body as Record<string, unknown>;
  const errors: Array<{ path: string; message: string }> = [];

  if (typeof b.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) {
    errors.push({ path: "email", message: "email must be a valid string" });
  }
  if (typeof b.password !== "string" || b.password.length < 6) {
    errors.push({ path: "password", message: "password must be at least 6 characters" });
  }
  if (errors.length > 0) {
    return { status: 400, body: { errors } };
  }

  const email = (b.email as string).toLowerCase();
  const s = loadState();

  // Duplicate email → 409.
  if (s.users.some((u) => u.email === email)) {
    return { status: 409, body: { error: "email already registered" } };
  }

  // Hash + create user.
  const { hash, salt } = hashPassword(b.password as string);
  const id = nextId("usr");
  const user: User = {
    id,
    email,
    passwordHash: hash,
    salt,
    createdAt: nowIso,
  };
  s.users.push(user);
  saveState();

  // Create session.
  const token = createSession(id, nowIso);
  const secure = isSecureRequest(req);
  return {
    status: 201,
    body: { user: toPublicUser(user) },
    setCookie: sessionCookieSet(token, secure, nowIso),
  };
}

/**
 * POST /fugue/api/auth/login
 * Body: { email, password }
 * 400 field errors, 401 invalid credentials (no user enumeration), 200 { user }
 */
export function handleLogin(
  body: unknown,
  req: Request,
  nowIso: string,
): AuthResult {
  if (typeof body !== "object" || body === null) {
    return { status: 400, body: { errors: [{ path: "body", message: "request body must be an object" }] } };
  }
  const b = body as Record<string, unknown>;
  const errors: Array<{ path: string; message: string }> = [];

  if (typeof b.email !== "string" || b.email.trim().length === 0) {
    errors.push({ path: "email", message: "email is required" });
  }
  if (typeof b.password !== "string" || b.password.length === 0) {
    errors.push({ path: "password", message: "password is required" });
  }
  if (errors.length > 0) {
    return { status: 400, body: { errors } };
  }

  const email = (b.email as string).toLowerCase();
  const s = loadState();
  const user = s.users.find((u) => u.email === email);

  // Unknown email OR wrong password → same 401 (no user enumeration).
  if (!user || !verifyPassword(b.password as string, user.passwordHash, user.salt)) {
    return { status: 401, body: { error: "invalid credentials" } };
  }

  const token = createSession(user.id, nowIso);
  const secure = isSecureRequest(req);
  return {
    status: 200,
    body: { user: toPublicUser(user) },
    setCookie: sessionCookieSet(token, secure, nowIso),
  };
}

/**
 * POST /fugue/api/auth/logout
 * Clears the session. 401 when no valid session, 204 on success.
 */
export function handleLogout(
  req: Request,
  nowIso: string,
): AuthResult {
  const token = getCookieToken(req);
  const user = getSessionUser(token, nowIso);
  if (!user) {
    // Still clear the cookie (idempotent) but report 401.
    return { status: 401, body: { error: "not authenticated" }, setCookie: sessionCookieClear(isSecureRequest(req)) };
  }
  deleteSession(token!);
  return { status: 204, body: null, setCookie: sessionCookieClear(isSecureRequest(req)) };
}

/**
 * GET /fugue/api/auth/me
 * Returns { user: PublicUser } or { user: null } when unauthenticated (204 → { user: null }).
 */
export function handleMe(
  req: Request,
  nowIso: string,
): AuthResult {
  const token = getCookieToken(req);
  const user = getSessionUser(token, nowIso);
  if (!user) {
    return { status: 401, body: { user: null } };
  }
  return { status: 200, body: { user: toPublicUser(user) } };
}

/**
 * Auth middleware helper for API routes that require a session.
 * Returns the PublicUser when authenticated, null when 401 is needed.
 */
export function requireAuth(req: Request, nowIso: string): PublicUser | null {
  const token = getCookieToken(req);
  const user = getSessionUser(token, nowIso);
  return user ? toPublicUser(user) : null;
}

/**
 * Session expiry check helper — used by tests to simulate expired sessions.
 */
export function sessionExpiresAt(token: string): string | null {
  const s = loadState();
  const session = s.sessions[token];
  return session ? session.expiresAt : null;
}

/**
 * Force-expire all sessions (test helper).
 */
export function expireAllSessions(expiresAtIso: string): void {
  const s = loadState();
  for (const [token, sess] of Object.entries(s.sessions)) {
    s.sessions[token] = { ...sess, expiresAt: expiresAtIso };
  }
  saveState();
}

/**
 * Get the full FugueState (test helper).
 */
export function _getStateForTest(): FugueState {
  return loadState();
}
