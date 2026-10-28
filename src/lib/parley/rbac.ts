/**
 * The RBAC matrix — pure, data-driven, no crypto.
 *
 * The matrix is the single source of truth; `can()` is a lookup.
 * The owner-seat carve-out (`invite.create` / `invite.role_change`
 * for admin is gated on `resource` not being the owner's membership)
 * is a resource check, not a second role.
 */

import type { Role } from "./types";

export type Action =
  | "conversation.list"
  | "conversation.read"
  | "conversation.reply"
  | "conversation.assign"
  | "conversation.status"
  | "conversation.priority"
  | "conversation.tags"
  | "canned.manage"
  | "canned.read"
  | "invite.create"
  | "invite.role_change"
  | "member.list"
  | "audit.read"
  | "usage.read"
  | "analytics.read"
  | "tenant.settings"
  | "plan.change"
  | "tenant.delete";

export const ACTIONS: Action[] = [
  "conversation.list",
  "conversation.read",
  "conversation.reply",
  "conversation.assign",
  "conversation.status",
  "conversation.priority",
  "conversation.tags",
  "canned.manage",
  "canned.read",
  "invite.create",
  "invite.role_change",
  "member.list",
  "audit.read",
  "usage.read",
  "analytics.read",
  "tenant.settings",
  "plan.change",
  "tenant.delete",
];

/**
 * The brief's literal matrix. `resource` is the membership id being
 * acted on (the owner-seat carve-out). When `resource` equals the
 * owner's membership, admin is denied `invite.create` /
 * `invite.role_change` (the "✓ (not owner seat)" cell).
 */
export const MATRIX: Record<Action, Record<Role, boolean>> = {
  "conversation.list": { owner: true, admin: true, agent: true, viewer: true },
  "conversation.read": { owner: true, admin: true, agent: true, viewer: true },
  "conversation.reply": { owner: true, admin: true, agent: true, viewer: false },
  "conversation.assign": { owner: true, admin: true, agent: true, viewer: false },
  "conversation.status": { owner: true, admin: true, agent: true, viewer: false },
  "conversation.priority": { owner: true, admin: true, agent: true, viewer: false },
  "conversation.tags": { owner: true, admin: true, agent: true, viewer: false },
  "canned.manage": { owner: true, admin: true, agent: false, viewer: false },
  "canned.read": { owner: true, admin: true, agent: true, viewer: false },
  "invite.create": { owner: true, admin: true, agent: false, viewer: false },
  "invite.role_change": { owner: true, admin: true, agent: false, viewer: false },
  "member.list": { owner: true, admin: true, agent: true, viewer: true },
  "audit.read": { owner: true, admin: true, agent: false, viewer: false },
  "usage.read": { owner: true, admin: true, agent: false, viewer: true },
  "analytics.read": { owner: true, admin: true, agent: false, viewer: true },
  "tenant.settings": { owner: true, admin: false, agent: false, viewer: false },
  "plan.change": { owner: true, admin: false, agent: false, viewer: false },
  "tenant.delete": { owner: true, admin: false, agent: false, viewer: false },
};

/**
 * The owner-seat carve-out: admin may `invite.create` /
 * `invite.role_change` only when `resource` is NOT the owner's
 * membership. Returns `true` when the action is allowed, `false`
 * otherwise.
 */
function ownerSeatGated(action: Action, role: Role, resource: string | undefined, ownerMembershipId: string): boolean {
  if (action !== "invite.create" && action !== "invite.role_change") return true;
  if (role !== "admin") return true; // only admin is gated
  if (resource === undefined) return true; // no resource = not targeting the owner seat
  return resource !== ownerMembershipId;
}

/**
 * Pure permission check. `resource` is the membership id (for
 * `invite.create` / `invite.role_change` the owner-seat carve-out
 * applies). `ownerMembershipId` is the owner's membership id in
 * the tenant (defaults to the conventional `"mem-owner"` when not
 * provided — the seed carries it).
 */
export function can(
  role: Role,
  action: Action,
  resource?: string,
  ownerMembershipId: string = "mem-owner",
): boolean {
  const base = MATRIX[action]?.[role];
  if (!base) return false;
  return ownerSeatGated(action, role, resource, ownerMembershipId);
}

/**
 * Human-readable permission names — the 403 JSON body's `permission`
 * field, so a denied call names the missing permission.
 */
export const PERMISSION_NAMES: Record<Action, string> = {
  "conversation.list": "conversation.list",
  "conversation.read": "conversation.read",
  "conversation.reply": "conversation.reply",
  "conversation.assign": "conversation.assign",
  "conversation.status": "conversation.status",
  "conversation.priority": "conversation.priority",
  "conversation.tags": "conversation.tags",
  "canned.manage": "canned.manage",
  "canned.read": "canned.read",
  "invite.create": "invite.create",
  "invite.role_change": "invite.role_change",
  "member.list": "member.list",
  "audit.read": "audit.read",
  "usage.read": "usage.read",
  "analytics.read": "analytics.read",
  "tenant.settings": "tenant.settings",
  "plan.change": "plan.change",
  "tenant.delete": "tenant.delete",
};
