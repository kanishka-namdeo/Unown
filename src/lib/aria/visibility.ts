/**
 * The ownership/visibility layer (plan §1: data-driven, on top of
 * `can(role, action)`).
 *
 *  - `rep` → sees records they own (`ownerId === self`)
 *  - `manager` → sees team records (owners in their managed rep set)
 *  - `admin`/`owner` → whole tenant
 *  - `viewer` → read-only whole tenant (no mutations — the RBAC
 *    matrix enforces the read-only side; this layer only answers
 *    "which records are visible")
 *
 * Every function here is pure and takes the state explicitly — the
 * API phase owns the 404 mapping for out-of-scope reads.
 */

import type { TenantContext } from "./tenancy";
import { teamOf } from "./tenancy";
import type {
  AriaAccount,
  AriaContact,
  AriaDeal,
  AriaLead,
  AriaState,
} from "./types";

/** Which rows of a tenant state carry an `ownerId` visibility scope. */
export type VisibleEntity = "account" | "lead" | "deal";

/**
 * The record ids visible to `ctx` for `entityType` within the
 * tenant. Owner/admin/viewer → every tenant row; rep/manager → the
 * ownership scope only.
 *
 * A manager's scope = the union of the managed reps' owned records
 * (plan: "manager → sees team records"). An unmanaged manager sees
 * nothing beyond their own owned records.
 */
export function visibleOwnerIds(
  state: AriaState,
  ctx: TenantContext,
): Set<string> | null {
  // Whole-tenant roles return `null` — the "no filter" sentinel.
  if (
    ctx.actor.role === "owner" ||
    ctx.actor.role === "admin" ||
    ctx.actor.role === "viewer"
  ) {
    return null;
  }
  const ids = new Set<string>([ctx.actor.userId]);
  // A rep who manages a team (a manager-shaped rep) adds their team.
  for (const repId of teamOf(state, ctx.tenantId, ctx.actor.userId)) {
    ids.add(repId);
  }
  return ids;
}

/** Whether a single record is visible to `ctx` (null owner = system → visible to all). */
export function isRecordVisible(
  state: AriaState,
  ctx: TenantContext,
  entityType: VisibleEntity,
  ownerId: string | null,
  record: { tenantId: string },
): boolean {
  if (record.tenantId !== ctx.tenantId) return false; // cross-tenant: invisible (404)
  if (ownerId === null) return true; // system-owned records are tenant-visible
  const scope = visibleOwnerIds(state, ctx);
  if (scope === null) return true; // whole-tenant role
  return scope.has(ownerId);
}

/**
 * The tenant's contacts, narrowed to the ctx's visibility scope
 * (owner/admin/viewer → whole tenant; rep/manager → owned records).
 * The contact's visibility key is its OWN `ownerId` (the plan's
 * ownership layer — the rep's contacts are the ones they own).
 */
export function visibleContacts(
  state: AriaState,
  ctx: TenantContext,
): AriaContact[] {
  const scope = visibleOwnerIds(state, ctx);
  return state.contacts.filter(
    (c) =>
      c.tenantId === ctx.tenantId &&
      (scope === null || (c.ownerId ? scope.has(c.ownerId) : true)),
  );
}

/** Filter a list of accounts down to the ctx's visible scope. */
export function visibleAccounts(state: AriaState, ctx: TenantContext): AriaAccount[] {
  const scope = visibleOwnerIds(state, ctx);
  return state.accounts.filter(
    (a) =>
      a.tenantId === ctx.tenantId &&
      (scope === null || scope.has(a.ownerId)),
  );
}

/** Filter a list of leads down to the ctx's visible scope. */
export function visibleLeads(state: AriaState, ctx: TenantContext): AriaLead[] {
  const scope = visibleOwnerIds(state, ctx);
  return state.leads.filter(
    (l) =>
      l.tenantId === ctx.tenantId &&
      (scope === null || (l.ownerId ? scope.has(l.ownerId) : true)),
  );
}

/** Filter a list of deals down to the ctx's visible scope. */
export function visibleDeals(state: AriaState, ctx: TenantContext): AriaDeal[] {
  const scope = visibleOwnerIds(state, ctx);
  return state.deals.filter(
    (d) =>
      d.tenantId === ctx.tenantId &&
      (scope === null || (d.ownerId ? scope.has(d.ownerId) : true)),
  );
}

/**
 * The membership row for a user in a tenant (the role source for
 * `makeCtx`). `null` when the user has no membership there (the API
 * layer maps to 401/404 per its ladder).
 */
export function membershipFor(
  state: AriaState,
  tenantId: string,
  userId: string,
): AriaState["memberships"][number] | null {
  const m = state.memberships.find(
    (x) => x.tenantId === tenantId && x.userId === userId,
  );
  return m ?? null;
}
