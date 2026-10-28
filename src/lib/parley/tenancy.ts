/**
 * The fail-closed tenancy contract (pure — no crypto, no DOM).
 *
 * A repository call without tenant context throws `NoTenantContext
 * Error` (the brief's "no leak, no 403 that confirms existence — 404"
 * ladder's top rung). `crossTenant` is the boolean the API layer maps
 * to a 404 — the pure module only reports the flag; the mapping is
 * pinned in the API phase.
 */

import type { Role, User } from "./types";

/** A tenant-scoped call context: the user id + their tenant. */
export interface TenantContext {
  tenantId: string;
  actor: { userId: string; role: Role };
}

/** Thrown when a repository call has no tenant context. */
export class NoTenantContextError extends Error {
  constructor(msg = "no tenant context") {
    super(msg);
    this.name = "NoTenantContextError";
  }
}

/**
 * Throw `NoTenantContextError` when `ctx` is absent (the fail-closed
 * contract — the top rung of the 404 ladder).
 */
export function assertTenant(ctx: TenantContext | null | undefined): TenantContext {
  if (!ctx || !ctx.tenantId || !ctx.actor?.userId) throw new NoTenantContextError();
  return ctx;
}

/**
 * `true` when `entity.tenantId !== ctx.tenantId` — the caller maps
 * this to a 404 (never a 403 that confirms existence).
 */
export function crossTenant(entity: { tenantId: string }, ctx: TenantContext): boolean {
  return entity.tenantId !== ctx.tenantId;
}

/** A helper for building a context from a user + tenant pair. */
export function makeCtx(
  tenantId: string,
  userId: string,
  role: Role,
): TenantContext {
  return { tenantId, actor: { userId, role } };
}
