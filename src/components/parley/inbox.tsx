/**
 * The inbox — the two-pane layout: conversation list (left,
 * `role="list"`/`listitem`, the 6 filter chips each with its count,
 * the per-row SLA chip, mobile stacked + back affordance below `sm`)
 * + thread view (right: customer-vs-agent bubbles, the system-event
 * timeline, the customer card, the Composer, the DetailPanel, and
 * the portal-view toggle).
 */
import { useState } from "react";
import { useParley } from "@/app/parley/client-store";
import type { Conversation, Message, SystemEvent } from "@/lib/parley/types";
import { StatusChip, PriorityChip, SlaChip, EmptyState } from "./primitives";
import { Composer } from "./composer";
import { DetailPanel } from "./detail";
import { interleaveTimeline, shortDate, timeOf } from "./format";
import { PortalView } from "./portal";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "pending", label: "Pending" },
  { id: "closed", label: "Closed" },
  { id: "unassigned", label: "Unassigned" },
  { id: "sla_risk", label: "SLA at risk" },
] as const;

export function InboxView() {
  const parley = useParley();
  const [showBack, setShowBack] = useState(false);
  const selected = parley.conversations.find((c) => c.id === parley.selectedConvoId);

  return (
    <div className="flex gap-4" style={{ minHeight: "480px" }}>
      {/* ── left pane: the conversation list ────────────────────── */}
      <section
        className={
          "flex-1 min-w-0 rounded-xl border border-line bg-surface p-3 " +
          (selected ? "hidden sm:block" : "")
        }
        aria-label="Conversations"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <input
            value={parley.q}
            onChange={(e) => parley.setQ(e.target.value)}
            placeholder="Search subjects…"
            aria-label="Search conversations"
            className="w-full max-w-xs rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-sm outline-none focus-visible:border-accent"
          />
        </div>

        {/* the 6 filter chips, each with its count */}
        <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => parley.setFilter(f.id)}
              aria-pressed={parley.filter === f.id}
              className={
                "rounded-full px-2.5 py-1 text-xs font-medium " +
                (parley.filter === f.id
                  ? "bg-accent/20 text-accent"
                  : "bg-surface-2 text-muted hover:bg-surface-2/70")
              }
            >
              {f.label}
              {parley.counts[f.id] !== undefined && (
                <span className="ml-1 opacity-70">{parley.counts[f.id]}</span>
              )}
            </button>
          ))}
        </div>

        {parley.conversations.length === 0 ? (
          <EmptyState
            kind={parley.filter === "all" ? "no-conversations" : "no-results"}
            actionLabel={parley.filter !== "all" ? "Show all" : undefined}
            onAction={parley.filter !== "all" ? () => parley.setFilter("all") : undefined}
          />
        ) : (
          <ul role="list" aria-label="Conversation list" className="space-y-1">
            {parley.conversations.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => {
                    parley.selectConvo(c.id);
                    setShowBack(true);
                  }}
                  aria-current={parley.selectedConvoId === c.id ? "true" : undefined}
                  className={
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm " +
                    (parley.selectedConvoId === c.id
                      ? "bg-accent/15"
                      : "hover:bg-surface-2")
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.subject}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <StatusChip status={c.status} />
                      <PriorityChip priority={c.priority} />
                      {!c.assigneeId && <span className="text-muted">unassigned</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <SlaChip state={(c.slaState as "met" | "ok" | "at_risk" | "breached") ?? "ok"} label={c.slaLabel} />
                    <span className="text-[10px] text-muted">{shortDate(c.createdAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── right pane: the thread ─────────────────────────────── */}
      <section
        className={
          "flex-1 min-w-0 rounded-xl border border-line bg-surface p-3 " +
          (selected ? "block" : "hidden sm:block")
        }
        aria-label="Conversation thread"
      >
        {selected ? (
          <ThreadView convo={selected} />
        ) : (
          <EmptyState kind="no-selection" />
        )}

        {/* mobile back affordance */}
        {showBack && selected && (
          <button
            onClick={() => {
              setShowBack(false);
              parley.selectConvo(null);
            }}
            className="mt-2 w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-muted sm:hidden"
          >
            ← Back to list
          </button>
        )}
      </section>
    </div>
  );
}

/* ── the thread view ───────────────────────────────────────────────── */

export function ThreadView({ convo }: { convo: Conversation }) {
  const parley = useParley();
  const { messages, events, customer } = parley.thread;
  const timeline = interleaveTimeline(
    messages as Message[],
    events as SystemEvent[],
  );
  const tenantSlug = parley.tenant?.slug ?? "lumen";

  const now = new Date().toISOString();

  return (
    <div className="flex h-full flex-col">
      {/* the customer card + the portal toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <h2 className="font-bold">{convo.subject}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <StatusChip status={convo.status} />
            <PriorityChip priority={convo.priority} />
            {customer && (
              <span>
                {customer.name} · {customer.email}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => parley.setPortalOpen(!parley.portalOpen)}
          aria-pressed={parley.portalOpen}
          className={
            "rounded-lg border px-2.5 py-1 text-xs font-medium " +
            (parley.portalOpen
              ? "border-accent bg-accent/20 text-accent"
              : "border-line text-muted hover:bg-surface-2")
          }
        >
          {parley.portalOpen ? "Exit portal view" : "portal view"}
        </button>
      </div>

      {/* the portal (customer-side) view swaps in when toggled */}
      {parley.portalOpen ? (
        <PortalView convo={convo} messages={messages as Message[]} />
      ) : (
        <>
          {/* the message bubbles + system-event timeline */}
          <div className="my-3 flex-1 space-y-2 overflow-y-auto" role="log" aria-label="Thread">
            {timeline.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No messages yet.</p>
            )}
            {timeline.map((row, i) => {
              if (row.kind === "event") {
                const e = row.item as SystemEvent;
                return <SystemEventRow key={"e" + i} event={e} now={now} />;
              }
              const m = row.item as Message;
              const isAgent = m.role === "agent";
              return (
                <div key={"m" + i} className={"flex " + (isAgent ? "justify-end" : "justify-start")}>
                  <div
                    className={
                      "max-w-[80%] rounded-xl px-3 py-2 text-sm " +
                      (isAgent
                        ? "bg-accent-strong/25 text-foreground"
                        : "bg-surface-2 text-foreground")
                    }
                  >
                    <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">
                      {isAgent ? "Agent" : "Customer"} · {timeOf(m.createdAt)}
                    </div>
                    {m.body}
                  </div>
                </div>
              );
            })}
          </div>

          {/* the detail panel + composer */}
          <div className="mt-3 space-y-3">
            <DetailPanel
              convoId={convo.id}
              assigneeOptions={parley.members.map((m) => ({
                id: m.user.id,
                name: m.user.name,
              }))}
              currentStatus={convo.status}
              currentPriority={convo.priority}
              currentTags={convo.tags}
              currentAssigneeId={convo.assigneeId}
            />
            <Composer convoId={convo.id} />
          </div>
        </>
      )}
    </div>
  );
}

/** A system-event timeline row (assignment, status, tag change, reply). */
function SystemEventRow({ event, now }: { event: SystemEvent; now: string }) {
  const label =
    event.kind === "assigned" ? "assigned" :
    event.kind === "status_changed" ? "status changed" :
    event.kind === "priority_changed" ? "priority changed" :
    event.kind === "tag_changed" ? "tags changed" :
    event.kind === "replied" ? "replied" :
    "created";
  return (
    <div className="flex items-center gap-2 py-0.5 text-xs text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden="true" />
      <span>
        {label} · {timeOf(event.createdAt)}
      </span>
      <span className="ml-auto text-[10px] opacity-60">{shortDate(event.createdAt)}</span>
    </div>
  );
}
