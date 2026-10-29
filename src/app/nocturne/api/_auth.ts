/**
 * The Nocturne API's shared auth + RBAC helper — a route-level concern
 * that sits in `api/` (NOT lib): it touches the session cookie HMAC
 * + the server store. Follows the aria/parley `_auth.ts` surface.
 *
 * The 401/403/404/402/400 ladder (in order: auth → permission →
 * cross-tenant/quota → validation → success) is enforced through:
 *
 * - `sessionFromRequest(req)` → `{ user, tenant, membership, ctx,
 *   role, sessionId }` or `null` when the cookie is absent/invalid/
 *   expired (the caller maps `null` to the 401 rung).
 * - `requirePermission(role, action, resource?, actorUserId?)` →
 *   the `rbac.can` gate; `null` when allowed, or a 403-shaped body
 *   naming the missing permission when denied.
 *
 * The demo credentials (the 8 seeded emails + `nocturne-demo-1`) are
 * published in the UI by design; the HMAC key + the seed's scrypt
 * salts are public-by-design constants (plan §7/13's conscious
 * acceptance for a same-origin iframe demo).
 */

import { verifySignedCookie, isExpired } from "@/lib/nocturne/sessions";
import { now as nowClock } from "@/lib/nocturne/clock";
import { can, PERMISSION_NAMES, type Action } from "@/lib/nocturne/rbac";
import { getNocturne, findStoredSession } from "@/app/nocturne/api/_state";
import type { NocturneMembership, NocturneTenant, NocturneUser } from "@/lib/nocturne/types";
import { makeCtx, type TenantContext } from "@/lib/nocturne/tenancy";

export const SESSION_COOKIE = "nocturne_ses";

export interface ResolvedSession {
  user: NocturneUser;
  tenant: NocturneTenant;
  membership: NocturneMembership;
  ctx: TenantContext;
  role: NocturneMembership["role"];
  sessionId: string;
}

/** A 403 body naming the missing permission (plan §3's 403 rung). */
export interface ForbiddenResponse {
  error: "forbidden";
  permission: string;
  status: 403;
}

/**
 * Resolve the request's session cookie → the caller's actor context.
 * Returns `null` (→ 401) when the cookie is absent, the signature
 * fails, the session row is gone, or the session is expired.
 *
 * The expiry read is the domain's PINNED clock (`clock.now`) — the
 * determinism contract: a test that advances the clock past a
 * session's `expiresAt` gets a 401 at the next probe (the plan's
 * auth-ladder "expired" rung).
 */
export function sessionFromRequest(req: Request): ResolvedSession | null {
  // The standard `cookie` header is the real-server path. The
  // `x-nocturne-cookie` fallback is a test-lane convenience (WHATWG's
  // Request strips the forbidden `cookie` header in the bun test
  // lane, so the session cookie is passed through a non-forbidden
  // header — the aria test-lane pattern).
  let rawCookie = req.headers.get("cookie") ?? "";
  if (!rawCookie) {
    const fallback = req.headers.get("x-nocturne-cookie");
    if (fallback) rawCookie = decodeURIComponent(fallback);
  }
  const match = rawCookie
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  let cookieValue: string;
  try {
    cookieValue = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
  } catch {
    // A malformed %-sequence is an attacker-supplied cookie value —
    // fail closed to a 401, never let it crash into a 500.
    return null;
  }
  if (!cookieValue) return null;
  const sessionId = verifySignedCookie(cookieValue);
  if (!sessionId) return null;
  const s = getNocturne();
  const row = findStoredSession(s, sessionId);
  if (!row) return null;
  if (isExpired(row, nowClock())) return null;
  const membership = s.memberships.find((m) => m.id === row.membershipId);
  if (!membership) return null;
  const user = s.users.find((u) => u.id === row.userId);
  const tenant = s.tenants.find((t) => t.id === row.tenantId);
  if (!user || !tenant) return null;
  return {
    user,
    tenant,
    membership,
    ctx: makeCtx(tenant.id, user.id, membership.role),
    role: membership.role,
    sessionId: row.id,
  };
}

/**
 * The RBAC gate. Returns `null` when allowed; otherwise a 403-shaped
 * body naming the missing permission. `resource` + `actorUserId`
 * carry the responder's own-seat override carve-out (`rotation.override`
 * → the override's `forUserId` must equal the caller's user id — the
 * plan's "edit their own overrides, not a teammate's").
 */
export function requirePermission(
  role: NocturneMembership["role"],
  action: Action,
  resource?: string,
  actorUserId?: string,
): ForbiddenResponse | null {
  if (can(role, action, resource, actorUserId)) return null;
  return { error: "forbidden", permission: PERMISSION_NAMES[action] ?? action, status: 403 };
}

/** A route's 401 body. */
export function unauthorizedResponse(): { error: string; status: number } {
  return { error: "unauthenticated", status: 401 };
}

/** A route's 404 body (the cross-tenant rung — never a 403). */
export function notFoundResponse(): { error: string; status: number } {
  return { error: "not found", status: 404 };
}

/** A route's 402 body (the quota rung — the documented 402 pick). */
export function quotaExceededResponse(): { error: string; status: number } {
  return { error: "quota_exceeded", status: 402 };
}

/** A route's 400 body (the validation rung — field-level errors). */
export function validationFailedResponse(errors: string[]): { error: string; errors: string[]; status: number } {
  return { error: "validation failed", errors, status: 400 };
}

/** A route's 400 body for a bad JSON payload. */
export function invalidJsonResponse(): { error: string; errors: string[]; status: number } {
  return { error: "invalid JSON body", errors: ["body must be valid JSON"], status: 400 };
}
