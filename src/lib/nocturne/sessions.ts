/**
 * Session rows + HMAC cookie signing for the Nocturne demo
 * (the parley sessions pattern).
 *
 * `createSession` writes a `NocturneSession` row with
 * `expiresAt = now + 8h` (the plan's TTL). `HMAC_SECRET` is a
 * module constant — public-by-design for the same-origin iframe
 * demo (the risk list's documented acceptance; a real deployment
 * sources the key from env).
 *
 * The cookie attributes (`httpOnly`, `sameSite=lax`, `path=/`) are
 * set by the ROUTE; this module owns the signature only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NocturneSession } from "./types";
import { HMAC_SECRET, SESSION_TTL_MS } from "./types";
import { newId } from "./ids";

/**
 * Create a `NocturneSession` row. `now` is the explicit clock (ISO
 * string); `seq` is the store's current counter — the id generator is
 * injected (the fugue EngineCtx pattern): deterministic given the
 * same inputs, so two seeds stay deep-equal and a store replaying
 * the same seq stream mints the same ids.
 */
export function createSession(
  userId: string,
  tenantId: string,
  now: string,
  seq: number,
): NocturneSession {
  const expiresAtMs = new Date(now).getTime() + SESSION_TTL_MS;
  return {
    id: newId("ses", seq),
    userId,
    tenantId,
    expiresAt: new Date(expiresAtMs).toISOString().replace(".000Z", "Z"),
  };
}

/** True when the session has expired at `now` (strictly past `expiresAt`). */
export function isExpired(row: NocturneSession, now: string): boolean {
  return new Date(now).getTime() > new Date(row.expiresAt).getTime();
}

/** Remove a session row (copy-on-write — the input array is untouched). */
export function removeSession(
  sessions: NocturneSession[],
  sessionId: string,
): NocturneSession[] {
  return sessions.filter((s) => s.id !== sessionId);
}

/** Look up a session by id (returns `undefined` when absent). */
export function findSession(
  sessions: NocturneSession[],
  sessionId: string,
): NocturneSession | undefined {
  return sessions.find((s) => s.id === sessionId);
}

/* ── HMAC cookie signing ─────────────────────────────────────────── */

/** Sign a session id with HMAC-SHA256 over the demo secret. */
export function signCookie(sessionId: string): string {
  return createHmac("sha256", HMAC_SECRET).update(sessionId).digest("hex");
}

/** Verify a session id against its stored signature (constant-time). */
export function verifyCookie(sessionId: string, signature: string): boolean {
  const expected = signCookie(sessionId);
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, "hex");
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Sign a session: returns the cookie value (`sessionId.signature`).
 * The route splits it on the last `.` when verifying.
 */
export function makeSignedCookie(sessionId: string): string {
  return `${sessionId}.${signCookie(sessionId)}`;
}

/** Parse a signed cookie back into `{ sessionId, signature }`. */
export function parseSignedCookie(cookie: string): { sessionId: string; signature: string } | null {
  const lastDot = cookie.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const sessionId = cookie.slice(0, lastDot);
  const signature = cookie.slice(lastDot + 1);
  if (!sessionId || !signature) return null;
  return { sessionId, signature };
}

/**
 * Verify a full signed cookie string. Returns the session id when
 * the signature checks out, `null` otherwise (malformed or tampered
 * → `null`, never a throw — the 401 rung of the auth ladder).
 */
export function verifySignedCookie(cookie: string): string | null {
  const parsed = parseSignedCookie(cookie);
  if (!parsed) return null;
  if (verifyCookie(parsed.sessionId, parsed.signature)) return parsed.sessionId;
  return null;
}

