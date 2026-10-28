/**
 * The detail panel — the assign/status/priority/tags controls.
 * owner/admin/agent only (the brief's "owner/admin/agent only");
 * for a viewer the panel renders DISABLED with a ReasonTooltip
 * (the "hidden OR disabled" choice — the reason is visible, the
 * more useful of the two).
 */
import { useState } from "react";
import { useParley } from "@/app/parley/client-store";
import type { Priority, Status } from "@/lib/parley/types";
import { ReasonTooltip } from "./primitives";

const STATUS_LIST: Status[] = ["open", "pending", "closed"];
const PRIORITY_LIST: Priority[] = ["low", "normal", "high", "urgent"];

export function DetailPanel({
  convoId,
  assigneeOptions,
  currentStatus,
  currentPriority,
  currentTags,
  currentAssigneeId,
}: {
  convoId: string;
  assigneeOptions: Array<{ id: string; name: string }>;
  currentStatus: Status;
  currentPriority: Priority;
  currentTags: string[];
  currentAssigneeId: string | null;
}) {
  const parley = useParley();
  const ownerMembershipId =
    parley.members.find((m) => m.membership.role === "owner")?.membership.id ?? "mem-owner";
  const allowed = parley.canDo("conversation.assign", undefined, ownerMembershipId);
  const [tagInput, setTagInput] = useState("");

  async function post(body: unknown, path: string) {
    try {
      const res = await fetch(`/parley/api/conversations/${convoId}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      await parley.refresh();
    } catch {
      /* silent */
    }
  }

  function tagClass(t: string, on: boolean): string {
    return (
      "rounded-full px-2 py-0.5 text-xs " +
      (on ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
        Conversation settings
      </h3>

      {/* Assign */}
      <div className="mt-3">
        <label className="text-xs text-muted">Assign to</label>
        <ReasonTooltip
          reason={allowed ? undefined : "You can't assign conversations — owner/admin/agent only"}
          disabled={!allowed}
        >
          <select
            value={currentAssigneeId ?? ""}
            disabled={!allowed}
            onChange={(e) => void post({ userId: e.target.value || null }, "assign")}
            className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm disabled:opacity-50"
            aria-label="Assign to"
          >
            <option value="">Unassigned</option>
            {assigneeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </ReasonTooltip>
      </div>

      {/* Status */}
      <div className="mt-3">
        <label className="text-xs text-muted">Status</label>
        <ReasonTooltip
          reason={allowed ? undefined : "You can't change status — owner/admin/agent only"}
          disabled={!allowed}
        >
          <div className="mt-1 flex gap-1" role="group" aria-label="Status">
            {STATUS_LIST.map((s) => (
              <button
                key={s}
                disabled={!allowed}
                aria-pressed={s === currentStatus}
                onClick={() => void post({ status: s }, "status")}
                className={
                  "rounded-md px-2.5 py-1 text-xs " +
                  (s === currentStatus
                    ? "bg-accent/20 font-semibold text-accent"
                    : "bg-surface-2 text-muted hover:bg-surface-2/70") +
                  " disabled:opacity-50"
                }
              >
                {s}
              </button>
            ))}
          </div>
        </ReasonTooltip>
      </div>

      {/* Priority */}
      <div className="mt-3">
        <label className="text-xs text-muted">Priority</label>
        <ReasonTooltip
          reason={allowed ? undefined : "You can't change priority — owner/admin/agent only"}
          disabled={!allowed}
        >
          <div className="mt-1 flex gap-1" role="group" aria-label="Priority">
            {PRIORITY_LIST.map((p) => (
              <button
                key={p}
                disabled={!allowed}
                aria-pressed={p === currentPriority}
                onClick={() => void post({ priority: p }, "priority")}
                className={
                  "rounded-md px-2.5 py-1 text-xs " +
                  (p === currentPriority
                    ? "bg-accent/20 font-semibold text-accent"
                    : "bg-surface-2 text-muted hover:bg-surface-2/70") +
                  " disabled:opacity-50"
                }
              >
                {p}
              </button>
            ))}
          </div>
        </ReasonTooltip>
      </div>

      {/* Tags */}
      <div className="mt-3">
        <label className="text-xs text-muted">Tags</label>
        <div className="mt-1 flex flex-wrap gap-1">
          {currentTags.map((t) => (
            <button
              key={t}
              disabled={!allowed}
              onClick={() => void post({ tags: currentTags.filter((x) => x !== t) }, "tags")}
              className={tagClass(t, true) + (allowed ? " hover:opacity-70" : " opacity-50")}
            >
              {t} ✕
            </button>
          ))}
          {currentTags.length === 0 && (
            <span className="text-xs text-muted">No tags</span>
          )}
        </div>
        {allowed && (
          <div className="mt-2 flex gap-1">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && tagInput.trim()) {
                  const next = currentTags.concat(tagInput.trim());
                  void post({ tags: next }, "tags");
                  setTagInput("");
                }
              }}
              placeholder="Add tag + Enter"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs"
            />
            <button
              onClick={() => {
                if (tagInput.trim()) {
                  void post({ tags: currentTags.concat(tagInput.trim()) }, "tags");
                  setTagInput("");
                }
              }}
              className="rounded-lg bg-accent-strong px-2 py-1 text-xs font-semibold text-white hover:bg-accent"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
