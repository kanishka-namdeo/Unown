/**
 * The parley API's shared auth + RBAC helper — a route-level concern
 * that sits in `api/` (NOT lib): it touches `node:crypto`'s cookie
 * HMAC + the server store.
 *
 * The 401/403/404/402 ladder (in order: auth → permission →
 * cross-tenant/quota → validation → success) is enforced through two
 * entry points:
 *
 * - `sessionFromRequest(req)` → `{ user, tenant, membership, ctx, role }`
 *   or `null` when the cookie is absent/invalid/expired (the caller
 *   maps `null` to the 401 rung).
 * - `requirePermission(role, action, resource?, ownerMembershipId?)`
 *   → the `rbac.can` gate; `null` when allowed, or a 403-shaped
 *   `ForbiddenResponse` naming the missing permission when denied.
 *
 * The demo credentials (the 6 seeded emails + `parley-demo-1`) are
 * published in the UI by design; the HMAC key + the seed's scrypt
 * salts are public-by-design constants (the risk list's conscious
 * acceptance for a same-origin iframe demo).
 */

import { verifySignedCookie } from "@/lib/parley/sessions";
import { sessionActor, liveSession, getParley } from "@/lib/parley/store";
import type { TenantContext } from "@/lib/parley/tenancy";
import { can, PERMISSION_NAMES, type Action } from "@/lib/parley/rbac";
import type { Membership, Tenant, User } from "@/lib/parley/types";

export const SESSION_COOKIE = "parley_ses";

export interface ResolvedSession {
  user: User;
  tenant: Tenant;
  membership: Membership;
  ctx: TenantContext;
  role: Membership["role"];
  sessionId: string;
}

/** A 403 body naming the missing permission (the brief's 403 rung). */
export interface ForbiddenResponse {
  error: "forbidden";
  permission: string;
  status: 403;
}

/**
 * Resolve the request's session cookie → the caller's actor context.
 * Returns `null` (→ 401) when the cookie is absent, the signature
 * fails, the session row is gone, or the session is expired.
 */
export function sessionFromRequest(req: Request): ResolvedSession | null {
  // The standard `cookie` header is the real-server path. The
  // `x-parley-cookie` fallback is a test-lane convenience (WHATWG's
  // Request strips the forbidden `cookie` header in the bun test lane,
  // so the session cookie is passed through a non-forbidden header).
    let rawCookie = req.headers.get("cookie") ?? "";
  if (!rawCookie) {
    const fallback = req.headers.get("x-parley-cookie");
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
  const row = liveSession(sessionId);
  if (!row) return null;
  // sessionActor throws NotFoundError when the membership is gone;
  // map that to a null (401) — the session no longer resolves.
  try {
    const { user, membership, ctx } = sessionActor(row);
    const tenant = getParley().tenants.find((t) => t.id === ctx.tenantId)!;
    return { user, tenant, membership, ctx, role: membership.role, sessionId: row.id };
  } catch {
    return null;
  }
}

/**
 * The RBAC gate. Returns `null` when allowed; otherwise a 403-shaped
 * body naming the missing permission (the brief's "403 with a JSON
 * body naming the missing permission").
 */
export function requirePermission(
  role: Membership["role"],
  action: Action,
  resource?: string,
  ownerMembershipId?: string,
): ForbiddenResponse | null {
  if (can(role, action, resource, ownerMembershipId)) return null;
  return { error: "forbidden", permission: PERMISSION_NAMES[action], status: 403 };
}

/**
 * A route's 401 body (the "unauthenticated → 401" rung).
 */
export function unauthorizedResponse(): { error: string; status: number } {
  return { error: "unauthenticated", status: 401 };
}

/**
 * A route's 404 body (the cross-tenant rung — never a 403 that
 * confirms existence).
 */
export function notFoundResponse(): { error: string; status: number } {
  return { error: "not found", status: 404 };
}

/**
 * A route's 402 body (the quota rung — the documented 402 vs 429 pick).
 */
export function quotaExceededResponse(): { error: string; status: number } {
  return { error: "quota_exceeded", status: 402 };
}
