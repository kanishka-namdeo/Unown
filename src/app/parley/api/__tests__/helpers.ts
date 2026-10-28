/**
 * Shared helpers for the parley API integration tests — drive the
 * exported `GET`/`POST` handlers with `Request` objects, a pinned
 * clock + a reset store, and signed session cookies built through
 * the REAL login path (never faked auth state).
 */

import { resetParley, getParley, loginSession } from "@/lib/parley/store";
import { makeSignedCookie } from "@/lib/parley/sessions";
import { setClock, resetClock } from "@/lib/parley/clock";
import { resetRateBuckets } from "@/app/parley/api/_rate";
import { AS_OF, type Role } from "@/lib/parley/types";

/** Pin the clock + reset the store to a clean seed + wipe the rate-limit buckets. */
export function freshStore(): void {
  resetClock();
  setClock(AS_OF);
  resetParley();
  resetRateBuckets();
}

/**
 * A signed session cookie for a seeded user (a REAL login — the
 * session row is created through `loginSession`, so `sessionFrom
 * Request` resolves it on the next probe).
 */
export function cookieFor(email: string): string {
  const user = getParley().users.find((u) => u.email === email);
  if (!user) throw new Error(`unknown user: ${email}`);
  const membership = getParley().memberships.find((m) => m.userId === user.id)!;
  const session = loginSession(user.id, membership.tenantId);
  return `${"parley_ses"}=${encodeURIComponent(makeSignedCookie(session.id))}`;
}

/**
 * Build a `Request` for a parley API route with an optional session
 * cookie.
 *
 * WHATWG's `Request` constructor strips the forbidden `cookie`
 * header (the browser only ever sees the cookie through `Set-Cookie`;
 * the request's `Cookie` is set by the user agent, not by JS). In a
 * bun test lane we need to drive the route handlers with a session
 * cookie, so the `cookie` is attached through a NON-forbidden custom
 * header (`x-parley-cookie`) that `_auth.ts`'s `sessionFromRequest`
 * reads as a fallback when the standard `cookie` header is absent
 * (the real server path uses the standard `cookie` header — the
 * custom one is a test-lane convenience only).
 */
export function apiReq(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts?: {
    cookie?: string;
    body?: unknown;
    xff?: string;
  },
): Request {
  const headers: Record<string, string> = {};
  if (opts?.body !== undefined) headers["content-type"] = "application/json";
  if (opts?.cookie) {
    headers["cookie"] = opts.cookie;
    // the test-lane fallback (WHATWG Request strips the forbidden
    // `cookie` header; the custom one survives to the handler)
    headers["x-parley-cookie"] = encodeURIComponent(opts.cookie);
  }
  if (opts?.xff) headers["x-forwarded-for"] = opts.xff;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** The seeded roles, by email (the role switcher's source list). */
export const SEED_ROLES: Record<string, Role> = {
  "mira@lumen.test": "owner",
  "theo@lumen.test": "admin",
  "ada@lumen.test": "agent",
  "sam@lumen.test": "viewer",
  "ingrid@northwind.test": "owner",
  "kai@northwind.test": "agent",
};

/** A seeded conversation id for a tenant (the first one). */
export function convoIdFor(tenantId: string, index = 0): string {
  const s = getParley();
  const found = s.conversations.filter((c) => c.tenantId === tenantId)[index];
  if (!found) throw new Error(`no convo ${index} for ${tenantId}`);
  return found.id;
}
