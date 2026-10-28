/**
 * Session store + HMAC cookie signing for the parley demo.
 *
 * `createSession` writes a `SessionRow` with `expiresAt = now + 8h`
 * (the brief's TTL). `HMAC_SECRET` is a module constant — public-by-
 * design for the same-origin iframe demo (the risk list documents
 * this as a conscious acceptance, not an oversight).
 *
 * The cookie attributes (`httpOnly`, `sameSite=lax`, `path=/`) are
 * set by the ROUTE; this module owns the signature only.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionRow } from "./types";
import { newSessionId } from "./ids";
import { mulberry32 } from "./ids";

/**
 * The demo HMAC key — a public-by-design constant for the same-origin
 * iframe. A real deployment would source this from env (see the
 * risk list: `HMAC_SECRET` + the salts carry a header comment
 * saying exactly that).
 */
export const HMAC_SECRET = "parley-demo-hmac-secret";

/** The session TTL: 8 hours (ms). */
export const SESSION_TTL_MS = 8 * 3_600_000;

// A seed-deterministic RNG so `createSession` without an RNG stays
// deterministic (the live path passes a counter-backed RNG).
let liveCounter = 0;

/**
 * Create a `SessionRow`. `now` is the explicit clock (ISO string).
 * An optional `rng` keeps seed-time calls deterministic.
 */
export function createSession(
  userId: string,
  tenantId: string,
  now: string,
  rng: () => number = (() => {
    liveCounter += 1;
    return liveCounter / 1e6;
  }),
): SessionRow {
  const expiresAtMs = new Date(now).getTime() + SESSION_TTL_MS;
  return {
    id: newSessionId(rng),
    userId,
    tenantId,
    expiresAt: new Date(expiresAtMs).toISOString().replace(".000Z", "Z"),
  };
}

/** True when the session has expired at `now`. */
export function isExpired(row: SessionRow, now: string): boolean {
  return new Date(now).getTime() > new Date(row.expiresAt).getTime();
}

/** Remove a session row (the store's `removeSession` path). */
export function removeSession(
  sessions: SessionRow[],
  sessionId: string,
): SessionRow[] {
  return sessions.filter((s) => s.id !== sessionId);
}

/** Look up a session by id (returns `undefined` when absent). */
export function findSession(
  sessions: SessionRow[],
  sessionId: string,
): SessionRow | undefined {
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
  const b = Buffer.from(signature, "hex");
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
