/**
 * Session store + HMAC cookie signing for the aria demo.
 *
 * `createSession` writes a `SessionRow` with `expiresAt = now + 8h`
 * (the plan's TTL). `HMAC_SECRET` is a module constant — public-by-
 * design for the same-origin iframe demo (the risk list documents
 * this as a conscious acceptance, not an oversight).
 *
 * The cookie attributes (`httpOnly`, `sameSite=lax`, `path=/`) are
 * set by the ROUTE; this module owns the signature only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { AriaSession } from "./types";
import { HMAC_SECRET, SESSION_TTL_MS } from "./types";
import { mulberry32, newSessionId } from "./ids";

// Re-export the TTL constant so tests + the API layer import from one place.
export { SESSION_TTL_MS };

// A seed-deterministic RNG so `createSession` without an RNG stays
// deterministic (the live path passes a counter-backed RNG).
let liveCounter = 0;

/**
 * Create a session row. `now` is the explicit clock (ISO string).
 * `id` is minted by the caller (the seed keeps it seed-constant; the
 * live path uses a counter-backed id via the store's `nextId`).
 */
export function createSession(
  userId: string,
  tenantId: string,
  now: string,
  id: string,
): AriaSession {
  const expiresAtMs = new Date(now).getTime() + SESSION_TTL_MS;
  return {
    id,
    userId,
    tenantId,
    expiresAt: new Date(expiresAtMs).toISOString().replace(".000Z", "Z"),
  };
}

/** A live (non-seed) session row: the module counter keeps ids unique. */
export function createLiveSession(userId: string, tenantId: string, now: string): AriaSession {
  liveCounter += 1;
  const rng = mulberry32(liveCounter);
  return createSession(userId, tenantId, now, newSessionId("ses", rng, liveCounter));
}

/** True when the session has expired at `now`. */
export function isExpired(row: AriaSession, now: string): boolean {
  return new Date(now).getTime() > new Date(row.expiresAt).getTime();
}

/** Remove a session row (copy-on-write — returns a new array). */
export function removeSession(
  sessions: AriaSession[],
  sessionId: string,
): AriaSession[] {
  return sessions.filter((s) => s.id !== sessionId);
}

/** Look up a session by id (returns `undefined` when absent). */
export function findSession(
  sessions: AriaSession[],
  sessionId: string,
): AriaSession | undefined {
  return sessions.find((s) => s.id === sessionId);
}

/* ── HMAC cookie signing ─────────────────────────────────────────── */

/** Sign a session id with HMAC-SHA256. */
export function signCookie(sessionId: string): string {
  return createHmac("sha256", HMAC_SECRET).update(sessionId).digest("hex");
}

/** Verify a session id against its stored signature. */
export function verifyCookie(sessionId: string, signature: string): boolean {
  const expected = signCookie(sessionId);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
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
 * Verify a full signed cookie string. Returns the session id when the
 * signature checks out, `null` otherwise.
 */
export function verifySignedCookie(cookie: string): string | null {
  const parsed = parseSignedCookie(cookie);
  if (!parsed) return null;
  if (verifyCookie(parsed.sessionId, parsed.signature)) return parsed.sessionId;
  return null;
}

// Re-export mulberry32 for the seed's convenience
export { mulberry32 };
