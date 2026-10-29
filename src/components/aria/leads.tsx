"use client";

/**
 * The leads list — the lead queue with SLA state + priority +
 * source, filterable by status. Each row links into the lead's
 * triage score (the `?top=` route's data) when present.
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import type { AriaLead } from "@/lib/aria/types";
import { PriorityChip, shortDate } from "./primitives";

const SLA_CLS: Record<string, string> = {
  met: "bg-ok/15 text-ok",
  ok: "bg-surface-2 text-muted",
  at_risk: "bg-warn/15 text-warn",
  breached: "bg-danger/15 text-danger",
};

export function LeadsView() {
  const aria = useAria();
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const leads = aria.leads.filter((l: AriaLead) =>
    statusFilter === "all" ? true : l.status === statusFilter,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="aria-lead-status">
          Status
        </label>
        <select
          id="aria-lead-status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-sm outline-none focus-visible:border-accent"
        >
          <option value="all">All</option>
          <option value="new">New</option>
          <option value="working">Working</option>
          <option value="nurturing">Nurturing</option>
          <option value="qualified">Qualified</option>
          <option value="unqualified">Unqualified</option>
        </select>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
          <div className="text-3xl" aria-hidden="true">📥</div>
          <h2 className="mt-2 font-bold">No leads</h2>
          <p className="mt-1 text-sm text-muted">No leads match this filter.</p>
        </div>
      ) : (
        <ul className="space-y-2" role="list" aria-label="Leads">
          {leads.map((l: AriaLead) => {
            const sla = (l as { slaState?: string }).slaState ?? "ok";
            const score = aria.triageLeads.find((t) => t.lead.id === l.id);
            return (
              <li
                key={l.id}
                className="rounded-xl border border-line bg-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{l.source}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      <PriorityChip priority={l.priority} />
                      <span>{l.status}</span>
                      <span>·</span>
                      <span>{shortDate(l.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {score && (
                      <span
                        role="img"
                        aria-label={"lead score " + score.score}
                        className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-bold text-accent"
                      >
                        {score.score}
                      </span>
                    )}
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-xs font-medium " +
                        (SLA_CLS[sla] ?? "bg-surface-2 text-muted")
                      }
                    >
                      SLA {sla}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
