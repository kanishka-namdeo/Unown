"use client";

/**
 * The admin view — the members list + invites (the seat-cap 402
 * display), the RBAC matrix visibility (what each role can do),
 * the audit feed (filterable), and usage/plan caps. This view is
 * only reachable by the roles that hold `audit.read` (owner +
 * manager) — the shell gates the nav item.
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import type { AriaRole } from "@/lib/aria/types";
import { AvatarInitial, ReasonGate, shortDate } from "./primitives";

/** A compact slice of the RBAC matrix for the visibility table. */
const MATRIX_ACTIONS: Array<{ action: string; label: string }> = [
  { action: "account.create", label: "Create accounts" },
  { action: "deal.stage", label: "Move deal stages" },
  { action: "enrollment.advance", label: "Advance sequences" },
  { action: "import.run", label: "Run imports" },
  { action: "audit.read", label: "Read audit" },
  { action: "invite.create", label: "Send invites" },
];

const ROLES: AriaRole[] = ["owner", "admin", "manager", "rep", "viewer"];

export function AdminView() {
  const aria = useAria();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AriaRole>("rep");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const denyInvite = aria.denyReason("invite.create");

  const filteredAudit = aria.auditFilter
    ? aria.audit.filter((a) => a.action.includes(aria.auditFilter))
    : aria.audit;

  async function sendInvite() {
    setInviteBusy(true);
    setInviteMsg(null);
    try {
      await fetch("/aria/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteMsg("Invite sent.");
      setInviteEmail("");
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 402) {
        setInviteMsg("Seat cap reached — upgrade the plan to send more invites.");
      } else {
        setInviteMsg("Invite failed.");
      }
    } finally {
      setInviteBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── the members list + invites ─────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Members</h2>
        <ul className="mt-2 space-y-1.5" role="list" aria-label="Members">
          {aria.members.map(({ membership, user }) => (
            <li
              key={membership.id}
              className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AvatarInitial name={user.name} sub={user.email} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{user.name}</div>
                  <div className="truncate text-xs text-muted">{user.email}</div>
                </div>
              </div>
              <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
                {membership.role}
              </span>
            </li>
          ))}
        </ul>

        {/* the invite form — the seat-cap 402 display */}
        <div className="mt-4">
          <h3 className="text-xs font-bold text-muted">Invite a member</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@example.com"
              aria-label="Invite email"
              disabled={!!denyInvite}
              className="w-48 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm outline-none focus-visible:border-accent disabled:opacity-50"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as AriaRole)}
              aria-label="Invite role"
              disabled={!!denyInvite}
              className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent disabled:opacity-50"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <ReasonGate reason={denyInvite}>
              <button
                type="button"
                disabled={inviteBusy || inviteEmail.trim() === "" || !!denyInvite}
                onClick={() => void sendInvite()}
                className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
              >
                {inviteBusy ? "Sending…" : "Invite"}
              </button>
            </ReasonGate>
          </div>
          {denyInvite && <p className="mt-1 text-xs text-muted">{denyInvite}</p>}
          {inviteMsg && (
            <p
              role="status"
              className={"mt-1 text-xs " + (inviteMsg.includes("cap") ? "text-warn" : "text-ok")}
            >
              {inviteMsg}
            </p>
          )}
        </div>
      </section>

      {/* ── the RBAC matrix visibility ─────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">What each role can do</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2">Capability</th>
              {ROLES.map((r) => (
                <th key={r} className="px-1 py-1 text-center">
                  {r}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX_ACTIONS.map((row) => (
              <tr key={row.action} className="border-t border-line">
                <td className="py-1.5 pr-2">{row.label}</td>
                {ROLES.map((r) => (
                  <RbacCell key={r} action={row.action} role={r} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── the audit feed (filterable) ────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Audit log</h2>
        <input
          value={aria.auditFilter}
          onChange={(e) => aria.setAuditFilter(e.target.value)}
          placeholder="Filter by action…"
          aria-label="Filter audit events"
          className="mt-2 w-full max-w-xs rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent"
        />
        {filteredAudit.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No audit events{aria.auditFilter ? " match this filter" : ""}.</p>
        ) : (
          <ul className="mt-3 space-y-1.5 text-sm" role="list" aria-label="Audit feed">
            {filteredAudit.slice(0, 20).map((a) => (
              <li key={a.id} className="rounded-lg bg-surface-2 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-[10px] text-muted">{shortDate(a.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {a.entityType} {a.entityId} · by {a.actorUserId}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A single RBAC matrix cell (the ✓/✗ rendering). */
function RbacCell({ action, role }: { action: string; role: AriaRole }) {
  // The static matrix view (what each role CAN do — the plan's
  // "the RBAC matrix visibility" surface). This is a pure
  // role→capability table, not a live `can()` call on the session.
  const granted = grantOf(action, role);
  return (
    <td className="px-1 py-1.5 text-center">
      {granted ? (
        <span role="img" aria-label={role + " can " + action} className="text-ok">✓</span>
      ) : (
        <span role="img" aria-label={role + " cannot " + action} className="text-danger">✗</span>
      )}
    </td>
  );
}

/** The static capability matrix (mirrors the RBAC module's
 * `MATRIX` — a read-only visualization for the admin screen). */
function grantOf(action: string, role: AriaRole): boolean {
  // owner: everything.
  if (role === "owner") return true;
  // admin: everything except tenant.settings + invite caps handled at
  // the API layer (the matrix grants admin the create/read/report set).
  if (role === "admin") {
    return action === "invite.create" || MATRIX_ACTIONS.some((m) => m.action === action);
  }
  // manager: reads + team writes + reports/triage/import/audit.
  if (role === "manager") {
    switch (action) {
      case "account.create":
      case "deal.stage":
      case "enrollment.advance":
      case "import.run":
      case "audit.read":
        return true;
      case "invite.create":
        return false;
      default:
        return false;
    }
  }
  // rep: reads + writes on their own records; no import/audit.
  if (role === "rep") {
    switch (action) {
      case "deal.stage":
      case "enrollment.advance":
        return true;
      case "account.create":
      case "import.run":
      case "audit.read":
      case "invite.create":
        return false;
      default:
        return false;
    }
  }
  // viewer: reads only; zero mutations.
  return false;
}
