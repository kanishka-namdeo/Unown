/**
 * The Team view — the admin surfaces: the member table + the
 * invite dialog + the DemoMailbox drawer (the brief's "in-app
 * Demo Mailbox, an envelope drawer listing 'sent' invite emails
 * with their accept links"): a drawer the envelope glyph opens,
 * listing `GET mailbox`'s invites, each row's accept link = the
 * in-app "accept as this invited user" flow. The role-change +
 * member-removal controls mirror the server-side owner-seat +
 * not-yourself guards (disabled with a reason when the guard
 * applies).
 */
import { useRef, useState } from "react";
import { useParley } from "@/app/parley/client-store";
import type { Role } from "@/lib/parley/types";
import { useDialogDismiss } from "../bazaar/primitives";
import { EmptyState, ReasonTooltip } from "./primitives";
import { AuditFeed } from "./audit-feed";

const ROLE_LIST: Role[] = ["owner", "admin", "agent", "viewer"];

export function MembersView() {
  const parley = useParley();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [accepting, setAccepting] = useState<{ token: string; email: string; role: Role } | null>(null);

  const ownerMembershipId =
    parley.members.find((m) => m.membership.role === "owner")?.membership.id ?? "mem-owner";
  const canInvite = parley.canDo("invite.create", undefined, ownerMembershipId);
  const canReadMailbox = parley.canDo("invite.create", undefined, ownerMembershipId);

  const currentUserId = parley.session?.user.id;
  const currentUserRole = parley.role;

  function guardForRole(
    m: (typeof parley.members)[number],
  ): string | undefined {
    if (m.membership.role === "owner")
      return "The owner seat may not have its role changed";
    if (m.membership.userId === currentUserId)
      return "You may not change your own role";
    return undefined;
  }
  function guardForRemove(
    m: (typeof parley.members)[number],
  ): string | undefined {
    if (m.membership.role === "owner") return "The owner may not be removed";
    if (m.membership.userId === currentUserId) return "You may not remove yourself";
    return undefined;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Team</h1>
        <div className="flex gap-2">
          <ReasonTooltip
            reason={canReadMailbox ? undefined : "Only owner/admin can open the demo mailbox"}
            disabled={!canReadMailbox}
          >
            <button
              onClick={() => canReadMailbox && setMailboxOpen(true)}
              aria-label="Open demo mailbox"
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
            >
              ✉ Mailbox
            </button>
          </ReasonTooltip>
          <ReasonTooltip
            reason={canInvite ? undefined : "Only owner/admin can invite"}
            disabled={!canInvite}
          >
            <button
              onClick={() => canInvite && setInviteOpen(true)}
              className="rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
            >
              + Invite
            </button>
          </ReasonTooltip>
        </div>
      </div>

      {parley.members.length === 0 ? (
        <EmptyState kind="no-conversations" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Email</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 text-right font-medium">Remove</th>
              </tr>
            </thead>
            <tbody>
              {parley.members.map((row) => (
                <MemberRow
                  key={row.membership.id}
                  row={row}
                  currentUserId={currentUserId!}
                  currentUserRole={currentUserRole}
                  ownerMembershipId={ownerMembershipId}
                  guardForRole={guardForRole(row)}
                  guardForRemove={guardForRemove(row)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inviteOpen && <InviteDialog onClose={() => setInviteOpen(false)} />}
      {mailboxOpen && (
        <MailboxDrawer
          invites={parley.mailbox}
          onClose={() => setMailboxOpen(false)}
          onAccept={(inv) => setAccepting({ token: inv.token, email: inv.email, role: inv.role })}
        />
      )}
      {accepting && (
        <AcceptInviteDialog
          email={accepting.email}
          role={accepting.role}
          token={accepting.token}
          onClose={() => setAccepting(null)}
        />
      )}

      {/* the admin-only audit feed (newest first, filterable by action) */}
      {parley.role === "owner" || parley.role === "admin" ? (
        <AuditFeed />
      ) : (
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">
            The audit feed is visible to owners and admins only.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── a member row with the role-change + remove controls ─────────── */

function MemberRow({
  row,
  currentUserId,
  currentUserRole,
  ownerMembershipId,
  guardForRole,
  guardForRemove,
}: {
  row: import("@/app/parley/client-store").MemberRow;
  currentUserId: string;
  currentUserRole: Role;
  ownerMembershipId: string;
  guardForRole?: string;
  guardForRemove?: string;
}) {
  const parley = useParley();
  const canManage = parley.canDo("invite.role_change", row.membership.id, ownerMembershipId);

  async function post(path: string, body?: unknown) {
    await fetch(`/parley/api/members/${row.membership.id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => {});
    await parley.refresh();
  }

  return (
    <tr className="border-b border-line/50">
      <td className="px-4 py-2.5 font-medium">{row.user.name}</td>
      <td className="px-4 py-2.5 text-muted">{row.user.email}</td>
      <td className="px-4 py-2.5">
        <ReasonTooltip reason={canManage && !guardForRole ? undefined : (guardForRole ?? "Only owner/admin can change roles")} disabled={!canManage || !!guardForRole}>
          <select
            value={row.membership.role}
            disabled={!canManage || !!guardForRole}
            onChange={(e) => void post("role", { role: e.target.value })}
            className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-sm disabled:opacity-50"
            aria-label={"Change " + row.user.name + "'s role"}
          >
            {ROLE_LIST.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </ReasonTooltip>
      </td>
      <td className="px-4 py-2.5 text-right">
        <ReasonTooltip reason={canManage && !guardForRemove ? undefined : (guardForRemove ?? "Only owner/admin can remove members")} disabled={!canManage || !!guardForRemove}>
          <button
            onClick={() => void post("remove")}
            disabled={!canManage || !!guardForRemove}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-danger hover:bg-danger/10 disabled:opacity-40"
          >
            Remove
          </button>
        </ReasonTooltip>
      </td>
    </tr>
  );
}

/* ── the invite dialog ────────────────────────────────────────────── */

function InviteDialog({ onClose }: { onClose: () => void }) {
  const parley = useParley();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const res = await fetch("/parley/api/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as { errors?: string[]; error?: string }).errors?.[0] ?? (body as { error?: string }).error ?? "Invite failed");
      return;
    }
    await parley.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close invite dialog" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-black/60" tabIndex={-1} />
      <div className="relative z-10 w-full max-w-xs rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-parley-pop">
        <h2 className="font-bold">Invite a teammate</h2>
        <label className="mt-3 block text-xs text-muted">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="mt-2 block text-xs text-muted">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          >
            {ROLE_LIST.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void send()}
            disabled={!email.trim()}
            className="flex-1 rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
          >
            Send invite
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── the demo mailbox drawer (envelope glyph → "sent" invites) ───── */

function MailboxDrawer({
  invites,
  onClose,
  onAccept,
}: {
  invites: import("@/app/parley/client-store").MailboxRow[];
  onClose: () => void;
  onAccept: (inv: import("@/app/parley/client-store").MailboxRow) => void;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(onClose, drawerRef);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end" role="dialog" aria-modal="true" aria-label="Demo mailbox">
      <button aria-label="Close demo mailbox" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-black/60" tabIndex={-1} />
      <div ref={drawerRef} className="relative z-10 h-full w-full max-w-sm overflow-y-auto border-l border-line bg-surface p-4 shadow-2xl animate-parley-pop">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">✉ Demo Mailbox</h2>
          <button onClick={onClose} aria-label="Close mailbox" className="rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-2">✕</button>
        </div>
        {invites.length === 0 ? (
          <p className="text-sm text-muted">No invites sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {invites.map((inv) => (
              <li key={inv.id} className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{inv.email}</div>
                  <span className={"rounded-full px-2 py-0.5 text-xs " + (inv.usedAt ? "bg-surface-2 text-muted" : "bg-ok/15 text-ok")}>
                    {inv.usedAt ? "used" : "pending"} · {inv.role}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  Expires in 24h · link: <code className="font-mono">{inv.acceptLink.slice(0, 32)}…</code>
                </div>
                {!inv.usedAt && (
                  <button
                    onClick={() => onAccept(inv)}
                    className="mt-2 rounded-lg bg-accent-strong px-3 py-1 text-xs font-semibold text-white hover:bg-accent"
                  >
                    Accept as {inv.email}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ── the accept-invite signup form (name + password) ─────────────── */

function AcceptInviteDialog({
  email,
  role,
  token,
  onClose,
}: {
  email: string;
  role: Role;
  token: string;
  onClose: () => void;
}) {
  const parley = useParley();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    const res = await fetch("/parley/api/invites/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((body as { errors?: string[]; error?: string }).errors?.[0] ?? (body as { error?: string }).error ?? "Accept failed");
      return;
    }
    await parley.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button aria-label="Close accept dialog" onClick={onClose} className="absolute inset-0 h-full w-full cursor-default bg-black/60" tabIndex={-1} />
      <div className="relative z-10 w-full max-w-xs rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-parley-pop">
        <h2 className="font-bold">Accept invite</h2>
        <p className="mt-1 text-xs text-muted">
          {email} · role: {role}
        </p>
        <label className="mt-3 block text-xs text-muted">
          Full name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="mt-2 block text-xs text-muted">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm"
          />
          <span className="mt-0.5 block text-[10px] text-muted">8+ chars, at least one letter and one digit</span>
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void accept()}
            disabled={!name.trim() || password.length < 8}
            className="flex-1 rounded-lg bg-accent-strong px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent disabled:opacity-50"
          >
            Create account
          </button>
          <button onClick={onClose} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
