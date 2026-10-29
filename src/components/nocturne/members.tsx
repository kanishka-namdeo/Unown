"use client";

/**
 * The members view — the tenant's seat list + the invite lane
 * (the `invite.create` 402-at-cap display) + the RBAC matrix
 * visibility (what each role can do) + the audit feed
 * (owner-gated, filterable). This view is reachable by the roles
 * that hold `invite.create` (owner + admin) — the shell gates
 * the nav item.
 */
import { useState } from "react";
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import { NocturneRoles, type NocturneRole } from "@/lib/nocturne/types";
import { AvatarInitial, ReasonGate, grantOf, shortDate } from "./primitives";

/** A compact slice of the RBAC matrix for the visibility table. */
const MATRIX_ACTIONS: Array<{ action: import("@/lib/nocturne/rbac").Action; label: string }> = [
  { action: "incident.ack", label: "Ack incidents" },
  { action: "incident.resolve", label: "Resolve incidents" },
  { action: "incident.escalate", label: "Escalate tiers" },
  { action: "incident.note", label: "Add notes" },
  { action: "rotation.override", label: "Override own seats" },
  { action: "invite.create", label: "Send invites" },
  { action: "service.update", label: "Edit services" },
  { action: "runbook.create", label: "Create runbooks" },
  { action: "component.update", label: "Set component status" },
  { action: "audit.read", label: "Read audit log" },
];

export function MembersView() {
  const nocturne = useNocturne();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<NocturneRole>("responder");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);

  const denyInvite = nocturne.denyReason("invite.create");

  const filteredAudit = nocturne.auditFilter
    ? nocturne.audit.filter((a) => a.action.includes(nocturne.auditFilter))
    : nocturne.audit;

  async function sendInvite() {
    setInviteBusy(true);
    setInviteMsg(null);
    const r = await nocturne.sendInvite(inviteEmail, inviteRole);
    setInviteBusy(false);
    if (r.ok) {
      setInviteMsg("Invite sent.");
      setInviteEmail("");
    } else {
      setInviteMsg(r.error ?? "Invite failed.");
    }
  }

  return (
    <div className="space-y-4">
      {/* ── the members list + invites ─────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Members</h2>
        <ul className="mt-2 space-y-1.5" role="list" aria-label="Members">
          {nocturne.members.map(({ membership, user }) => (
            <li
              key={membership.id}
              className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <AvatarInitial name={user?.name ?? "?"} sub={user?.email} />
                <div className="min-w-0">
                  <div className="truncate font-medium">{user?.name ?? membership.userId}</div>
                  <div className="truncate text-xs text-muted">{user?.email}</div>
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
              onChange={(e) => setInviteRole(e.target.value as NocturneRole)}
              aria-label="Invite role"
              disabled={!!denyInvite}
              className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent disabled:opacity-50"
            >
              {NocturneRoles.map((r) => (
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
              {NocturneRoles.map((r) => (
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
                {NocturneRoles.map((r) => (
                  <RbacCell key={r} action={row.action} role={r} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── the audit feed (filterable, owner-gated) ───────────── */}
      <AuditFeed />
    </div>
  );
}

/** A single RBAC matrix cell (the ✓/✗ rendering). */
function RbacCell({ action, role }: { action: import("@/lib/nocturne/rbac").Action; role: NocturneRole }) {
  const granted = grantOf(action, role);
  return (
    <td className="px-1 py-1.5 text-center">
      {granted ? (
        <span role="img" aria-label={role + " can " + action} className="text-ok">
          ✓
        </span>
      ) : (
        <span role="img" aria-label={role + " cannot " + action} className="text-danger">
          ✗
        </span>
      )}
    </td>
  );
}

/** The audit feed — the owner's surface (the `audit.read` lane). */
function AuditFeed() {
  const nocturne = useNocturne();
  const denyAudit = nocturne.denyReason("audit.read");

  if (denyAudit) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Audit log</h2>
        <p className="mt-2 text-xs text-muted">{denyAudit}</p>
      </section>
    );
  }

  const filtered = nocturne.auditFilter
    ? nocturne.audit.filter((a) => a.action.includes(nocturne.auditFilter))
    : nocturne.audit;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-sm font-bold">Audit log</h2>
      <input
        value={nocturne.auditFilter}
        onChange={(e) => nocturne.setAuditFilter(e.target.value)}
        placeholder="Filter by action…"
        aria-label="Filter audit events"
        className="mt-2 w-full max-w-xs rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent"
      />
      {filtered.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          No audit events{nocturne.auditFilter ? " match this filter" : ""}.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm" role="list" aria-label="Audit feed">
          {filtered.slice(0, 20).map((a) => (
            <li key={a.id} className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{a.action}</span>
                <span className="text-[10px] text-muted">{shortDate(a.createdAt)}</span>
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {a.entityType} {a.entityId} · by {nocturne.userName(a.actorUserId)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
