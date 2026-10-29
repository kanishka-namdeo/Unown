/**
 * The Nocturne RBAC matrix — pure, data-driven, no crypto.
 *
 * The matrix is the single source of truth; `can()` is a lookup.
 * Every action in the plan's API route map (§3) is a cell.
 *
 * Role ladder (plan §1, the team-shaped incident-ops surface):
 *  - owner     — everything.
 *  - admin     — responders + config (services, escalation policies,
 *                rotations, runbooks, invites) but NOT tenant
 *                settings/plan.
 *  - responder — paged user: ack/resolve/comment/escalate incidents,
 *                edit their own overrides, read schedules/runbooks.
 *  - viewer    — read-only, zero mutations.
 *
 * There is no ownership scoping like aria's rep/manager layer — the
 * layer here is schedule-aware (whoIsOnCall + activeRotationWindow).
 */

import type { NocturneRole } from "./types";

export type Action =
  | "tenant.list"
  | "tenant.read"
  | "tenant.settings"
  | "member.list"
  | "invite.create"
  | "service.list"
  | "service.read"
  | "service.create"
  | "service.update"
  | "rotation.list"
  | "rotation.read"
  | "rotation.create"
  | "rotation.update"
  | "rotation.override"
  | "alert.ingest"
  | "alert.list"
  | "incident.list"
  | "incident.read"
  | "incident.ack"
  | "incident.resolve"
  | "incident.snooze"
  | "incident.escalate"
  | "incident.note"
  | "runbook.list"
  | "runbook.read"
  | "runbook.create"
  | "runbook.update"
  | "runbook.delete"
  | "checklist.start"
  | "checklist.update"
  | "component.list"
  | "component.update"
  | "postmortem.list"
  | "postmortem.read"
  | "postmortem.action"
  | "analytics.read"
  | "audit.read";

export const ACTIONS: Action[] = [
  "tenant.list",
  "tenant.read",
  "tenant.settings",
  "member.list",
  "invite.create",
  "service.list",
  "service.read",
  "service.create",
  "service.update",
  "rotation.list",
  "rotation.read",
  "rotation.create",
  "rotation.update",
  "rotation.override",
  "alert.ingest",
  "alert.list",
  "incident.list",
  "incident.read",
  "incident.ack",
  "incident.resolve",
  "incident.snooze",
  "incident.escalate",
  "incident.note",
  "runbook.list",
  "runbook.read",
  "runbook.create",
  "runbook.update",
  "runbook.delete",
  "checklist.start",
  "checklist.update",
  "component.list",
  "component.update",
  "postmortem.list",
  "postmortem.read",
  "postmortem.action",
  "analytics.read",
  "audit.read",
];

/**
 * The role ladder collapsed into the matrix:
 *  - READ actions: every role.
 *  - RESPONDER actions (incident ops): owner/admin/responder.
 *  - CONFIG actions: owner/admin.
 *  - OWNER actions (tenant.settings, audit.read): owner.
 */
const READ_ACTIONS: Action[] = [
  "tenant.list",
  "tenant.read",
  "member.list",
  "service.list",
  "service.read",
  "rotation.list",
  "rotation.read",
  "alert.list",
  "incident.list",
  "incident.read",
  "runbook.list",
  "runbook.read",
  "component.list",
  "postmortem.list",
  "postmortem.read",
  "analytics.read",
];

const RESPONDER_ACTIONS: Action[] = [
  "alert.ingest",
  "incident.ack",
  "incident.resolve",
  "incident.snooze",
  "incident.escalate",
  "incident.note",
  "checklist.start",
  "checklist.update",
  "postmortem.action",
];

/** responder's own overrides: the carve-out action (resource-scoped). */
const OVERRIDE_ACTION: Action = "rotation.override";

const CONFIG_ACTIONS: Action[] = [
  "invite.create",
  "service.create",
  "service.update",
  "rotation.create",
  "rotation.update",
  "runbook.create",
  "runbook.update",
  "runbook.delete",
  "component.update",
];

const OWNER_ACTIONS: Action[] = ["tenant.settings", "audit.read"];

function cell(action: Action): Record<NocturneRole, boolean> {
  if (READ_ACTIONS.includes(action))
    return { owner: true, admin: true, responder: true, viewer: true };
  if (RESPONDER_ACTIONS.includes(action))
    return { owner: true, admin: true, responder: true, viewer: false };
  if (action === OVERRIDE_ACTION)
    return { owner: true, admin: true, responder: true, viewer: false };
  if (CONFIG_ACTIONS.includes(action))
    return { owner: true, admin: true, responder: false, viewer: false };
  if (OWNER_ACTIONS.includes(action))
    return { owner: true, admin: false, responder: false, viewer: false };
  // unreachable — ACTIONS is the closed set
  return { owner: false, admin: false, responder: false, viewer: false };
}

export const MATRIX: Record<Action, Record<NocturneRole, boolean>> = Object.fromEntries(
  ACTIONS.map((a) => [a, cell(a)]),
) as Record<Action, Record<NocturneRole, boolean>>;

/**
 * The owner/admin carve-out: `rotation.override` for a responder is
 * granted only when `resource` (the override's `forUserId`) equals
 * the responder's OWN user id — they may edit their own overrides,
 * not a teammate's. Admins and owners are never gated.
 */
function ownOverrideGated(
  action: Action,
  role: NocturneRole,
  resource: string | undefined,
  actorUserId: string | undefined,
): boolean {
  if (action !== OVERRIDE_ACTION) return true;
  if (role !== "responder") return true;
  // no resource = general capability check → granted; a mismatching
  // resource (someone else's seat) → denied.
  if (resource === undefined || actorUserId === undefined) return true;
  return resource === actorUserId;
}

/**
 * Pure permission check. `resource` is the override's `forUserId`
 * (the responder's own-seat carve-out); `actorUserId` is the caller's
 * user id for that carve-out.
 */
export function can(
  role: NocturneRole,
  action: Action,
  resource?: string,
  actorUserId?: string,
): boolean {
  const base = MATRIX[action]?.[role];
  if (!base) return false;
  return ownOverrideGated(action, role, resource, actorUserId);
}

/**
 * Human-readable permission names — the 403 JSON body's `permission`
 * field, so a denied call names the missing permission.
 */
export const PERMISSION_NAMES: Record<Action, string> = Object.fromEntries(
  ACTIONS.map((a) => [a, a]),
) as Record<Action, string>;
