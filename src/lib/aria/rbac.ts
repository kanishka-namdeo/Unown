/**
 * The RBAC matrix — pure, data-driven, no crypto.
 *
 * The matrix is the single source of truth; `can()` is a lookup
 * (plan §1: "data-driven, on top of can(role, action)"). Every
 * action in the API route map (§3) is a cell.
 *
 * The owner-seat carve-out is a resource check, not a second role:
 * `tenant.settings` for a tenant is granted to the owner only when
 * `resource` (the tenant id being acted on) is not the actor's own
 * seat — in practice the matrix gates it (admin is denied, owner is
 * granted) and the API layer applies the resource guard for
 * demoting/changing the owner seat itself.
 */

import type { AriaRole } from "./types";

export type Action =
  | "tenant.list"
  | "tenant.read"
  | "tenant.settings"
  | "member.list"
  | "invite.create"
  | "account.list"
  | "account.read"
  | "account.create"
  | "account.update"
  | "contact.list"
  | "contact.read"
  | "contact.create"
  | "contact.update"
  | "lead.list"
  | "lead.read"
  | "lead.create"
  | "lead.update"
  | "lead.convert"
  | "pipeline.list"
  | "pipeline.read"
  | "pipeline.create"
  | "pipeline.update"
  | "deal.list"
  | "deal.read"
  | "deal.create"
  | "deal.update"
  | "deal.stage"
  | "activity.list"
  | "activity.create"
  | "task.list"
  | "task.create"
  | "task.update"
  | "note.list"
  | "note.create"
  | "tag.list"
  | "tag.create"
  | "tag.update"
  | "tag.delete"
  | "sequence.list"
  | "sequence.read"
  | "sequence.create"
  | "enrollment.create"
  | "enrollment.advance"
  | "enrollment.exit"
  | "mailbox.list"
  | "report.read"
  | "triage.read"
  | "import.run"
  | "audit.read"
  | "forecast.capture";

export const ACTIONS: Action[] = [
  "tenant.list",
  "tenant.read",
  "tenant.settings",
  "member.list",
  "invite.create",
  "account.list",
  "account.read",
  "account.create",
  "account.update",
  "contact.list",
  "contact.read",
  "contact.create",
  "contact.update",
  "lead.list",
  "lead.read",
  "lead.create",
  "lead.update",
  "lead.convert",
  "pipeline.list",
  "pipeline.read",
  "pipeline.create",
  "pipeline.update",
  "deal.list",
  "deal.read",
  "deal.create",
  "deal.update",
  "deal.stage",
  "activity.list",
  "activity.create",
  "task.list",
  "task.create",
  "task.update",
  "note.list",
  "note.create",
  "tag.list",
  "tag.create",
  "tag.update",
  "tag.delete",
  "sequence.list",
  "sequence.read",
  "sequence.create",
  "enrollment.create",
  "enrollment.advance",
  "enrollment.exit",
  "mailbox.list",
  "report.read",
  "triage.read",
  "import.run",
  "audit.read",
  "forecast.capture",
];

/**
 * The matrix cells (role order: owner, admin, manager, rep, viewer):
 *  - owner: everything.
 *  - admin: everything except tenant.settings.
 *  - manager: everything read + team writes + reports/triage/import/
 *    audit + forecast.capture; no tenant settings, no invite.create.
 *  - rep: everything read + writes on records (their visibility scope
 *    is enforced by the visibility layer, not the matrix) + reports;
 *    no import.run, no audit.read, no forecast.capture.
 *  - viewer: every read + reports; zero mutations.
 */
export const MATRIX: Record<Action, Record<AriaRole, boolean>> = {
  "tenant.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "tenant.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "tenant.settings": { owner: true, admin: false, manager: false, rep: false, viewer: false },
  "member.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "invite.create": { owner: true, admin: true, manager: false, rep: false, viewer: false },
  "account.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "account.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "account.create": { owner: true, admin: true, manager: true, rep: false, viewer: false },
  "account.update": { owner: true, admin: true, manager: true, rep: false, viewer: false },
  "contact.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "contact.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "contact.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "contact.update": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "lead.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "lead.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "lead.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "lead.update": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "lead.convert": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "pipeline.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "pipeline.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "pipeline.create": { owner: true, admin: true, manager: false, rep: false, viewer: false },
  "pipeline.update": { owner: true, admin: true, manager: false, rep: false, viewer: false },
  "deal.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "deal.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "deal.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "deal.update": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "deal.stage": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "activity.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "activity.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "task.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "task.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "task.update": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "note.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "note.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "tag.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "tag.create": { owner: true, admin: true, manager: false, rep: false, viewer: false },
  "tag.update": { owner: true, admin: true, manager: false, rep: false, viewer: false },
  "tag.delete": { owner: true, admin: true, manager: false, rep: false, viewer: false },
  "sequence.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "sequence.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "sequence.create": { owner: true, admin: true, manager: true, rep: false, viewer: false },
  "enrollment.create": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "enrollment.advance": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "enrollment.exit": { owner: true, admin: true, manager: true, rep: true, viewer: false },
  "mailbox.list": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "report.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "triage.read": { owner: true, admin: true, manager: true, rep: true, viewer: true },
  "import.run": { owner: true, admin: true, manager: true, rep: false, viewer: false },
  "audit.read": { owner: true, admin: true, manager: true, rep: false, viewer: false },
  "forecast.capture": { owner: true, admin: true, manager: true, rep: false, viewer: false },
};

/**
 * The owner-seat carve-out: `tenant.settings` targets the tenant
 * row being patched. The owner role is granted by the matrix but
 * the route lane enforces the resource guard FIRST (the 404 rung
 * when the tenant id is not the actor's own tenant — the plan's
 * tenancy floor), so the carve-out collapses to a pure role check
 * by the time `can()` runs: an owner's own tenant → 200, any other
 * tenant → already 404 (not 403, not 200).
 */
function ownerSeatGated(
  action: Action,
  role: AriaRole,
  resource: string | undefined,
  actorTenantId: string,
): boolean {
  if (action !== "tenant.settings") return true;
  // Non-owner roles: the matrix already denies them (the ✗ cells).
  if (role !== "owner") return false;
  // The owner's resource guard: only their own tenant (the
  // cross-tenant case is the route's 404 rung, so by the time
  // can() runs with a resource, the resource is the actor's own
  // tenant id).
  return resource === undefined || resource === actorTenantId;
}

/**
 * Pure permission check. `resource` (optional) is the entity id being
 * acted on; when present and the action is the owner-seat gate
 * (`tenant.settings`), the carve-out applies.
 */
export function can(
  role: AriaRole,
  action: Action,
  resource?: string,
  actorTenantId?: string,
): boolean {
  const base = MATRIX[action]?.[role];
  if (!base) return false;
  return ownerSeatGated(action, role, resource, actorTenantId ?? "");
}

/**
 * Human-readable permission names — the 403 JSON body's `permission`
 * field, so a denied call names the missing permission.
 */
export const PERMISSION_NAMES: Record<Action, string> = {
  "tenant.list": "tenant.list",
  "tenant.read": "tenant.read",
  "tenant.settings": "tenant.settings",
  "member.list": "member.list",
  "invite.create": "invite.create",
  "account.list": "account.list",
  "account.read": "account.read",
  "account.create": "account.create",
  "account.update": "account.update",
  "contact.list": "contact.list",
  "contact.read": "contact.read",
  "contact.create": "contact.create",
  "contact.update": "contact.update",
  "lead.list": "lead.list",
  "lead.read": "lead.read",
  "lead.create": "lead.create",
  "lead.update": "lead.update",
  "lead.convert": "lead.convert",
  "pipeline.list": "pipeline.list",
  "pipeline.read": "pipeline.read",
  "pipeline.create": "pipeline.create",
  "pipeline.update": "pipeline.update",
  "deal.list": "deal.list",
  "deal.read": "deal.read",
  "deal.create": "deal.create",
  "deal.update": "deal.update",
  "deal.stage": "deal.stage",
  "activity.list": "activity.list",
  "activity.create": "activity.create",
  "task.list": "task.list",
  "task.create": "task.create",
  "task.update": "task.update",
  "note.list": "note.list",
  "note.create": "note.create",
  "tag.list": "tag.list",
  "tag.create": "tag.create",
  "tag.update": "tag.update",
  "tag.delete": "tag.delete",
  "sequence.list": "sequence.list",
  "sequence.read": "sequence.read",
  "sequence.create": "sequence.create",
  "enrollment.create": "enrollment.create",
  "enrollment.advance": "enrollment.advance",
  "enrollment.exit": "enrollment.exit",
  "mailbox.list": "mailbox.list",
  "report.read": "report.read",
  "triage.read": "triage.read",
  "import.run": "import.run",
  "audit.read": "audit.read",
  "forecast.capture": "forecast.capture",
};
