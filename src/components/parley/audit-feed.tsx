/**
 * The audit feed — the admin-visible log (newest first, filterable
 * by action). Rendered inside the Team view below the member table.
 */
import { useState } from "react";
import { useParley } from "@/app/parley/client-store";

const ACTION_FILTERS = [
  "",
  "conversation.reply",
  "conversation.assign",
  "conversation.status",
  "conversation.priority",
  "conversation.tags",
  "invite.create",
  "invite.accept",
  "member.role_change",
  "member.remove",
  "canned.create",
  "canned.update",
  "canned.delete",
  "conversation.create",
] as const;

export function AuditFeed() {
  const parley = useParley();
  const [action, setAction] = useState<string>("");

  const events = (parley.audit as Array<Record<string, unknown>>)
    .filter((e) => (action ? e.action === action : true));

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">Audit log</h2>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
          className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs"
        >
          <option value="">All actions</option>
          {ACTION_FILTERS.slice(1).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-muted">No audit events{action ? " for this action" : ""}.</p>
      ) : (
        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
          {events.map((e, i) => (
            <li
              key={(e.id as string) ?? i}
              className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs"
            >
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <span className="font-semibold text-foreground">{String(e.action ?? "event")}</span>
                <span className="text-muted">
                  {" "}· {String(e.entityType ?? "")} {String(e.entityId ?? "")}
                </span>
                {typeof e.actorUserId === "string" && e.actorUserId ? (
                  <span className="ml-1 text-muted">by {String(e.actorUserId)}</span>
                ) : null}
                {typeof e.createdAt === "string" ? (
                  <span className="ml-1 text-[10px] text-muted opacity-70">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
