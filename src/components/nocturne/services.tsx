"use client";

/**
 * The services view — the tenant's services (the on-call seat +
 * the escalation policy's tiers) + the service detail (the on-call
 * window, the open incidents, the runbooks). The component-status
 * lane is the admin-gated manual maintenance-window override
 * (`component.update` — the RBAC-disabled-with-reason surface).
 */
import { useState } from "react";
import { useNocturne, type ServiceRow } from "@/components/nocturne/nocturne-provider";
import type { NocturneComponentStatus } from "@/lib/nocturne/types";
import { ComponentStatusChip, ReasonGate, IncidentStatusChip, SeverityChip } from "./primitives";

export function ServicesView() {
  const nocturne = useNocturne();
  const detail = nocturne.serviceDetail;

  if (detail) {
    return <ServiceDetail onBack={() => void nocturne.openService(null)} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{nocturne.services.length} services</span>
      </div>
      {nocturne.services.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          No services configured yet.
        </div>
      ) : (
        <ul className="space-y-1.5" aria-label="Services">
          {nocturne.services.map((row) => (
            <li key={row.service.id}>
              <button
                type="button"
                onClick={() => void nocturne.openService(row.service.id)}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-accent"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{row.service.name}</div>
                  <div className="truncate text-xs text-muted">{row.service.description}</div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="text-muted">on call</div>
                  <div className="font-medium text-accent">
                    {row.primaryOnCall?.name ?? "no rotation"}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The service detail: the on-call window + the open incidents +
 * the runbooks + the manual component-status override. */
function ServiceDetail({ onBack }: { onBack: () => void }) {
  const nocturne = useNocturne();
  const detail = nocturne.serviceDetail!;
  const service = detail.service;
  const oncall = detail.oncall;

  const denyComponent = nocturne.denyReason("component.update");
  const serviceComponents = nocturne.components.filter(
    (c) => c.serviceId === service.id,
  );

  const tierKinds: Record<string, string> = {
    rotation: "on-call seat",
    user: "fixed user",
    manager: "tenant manager",
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-line bg-surface-2 px-3 py-1 text-sm text-muted hover:text-foreground"
      >
        ← All services
      </button>

      {/* profile */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{service.name}</h2>
          {service.slaOverride && (
            <span className="text-xs text-muted">service-level SLA override</span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">{service.description}</p>

        {/* the on-call window (the schedule-aware computed surface) */}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted">On call now</dt>
            <dd className="mt-0.5 font-medium text-accent">
              {oncall.primary?.name ?? "no rotation"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Next handoff</dt>
            <dd className="mt-0.5">{oncall.handoffAt ? nocturne.fmtTimestamp(oncall.handoffAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Secondary</dt>
            <dd className="mt-0.5">{oncall.secondary?.name ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {/* the escalation policy's tiers */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Escalation policy</h3>
        <ol className="mt-2 space-y-1.5" aria-label="Escalation tiers">
          {service.escalationPolicy.tiers.map((t, i) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              <span className="font-medium">tier {i + 1}</span>
              <span className="text-xs text-muted">{tierKinds[t.kind] ?? t.kind}</span>
              <span className="tabular-nums text-xs text-muted">{t.waitMinutes}m</span>
            </li>
          ))}
        </ol>
      </section>

      {/* the open incidents on this service */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Incidents</h3>
        {detail.incidents.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No incidents on this service.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {detail.incidents.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => {
                    nocturne.setView("incidents");
                    void nocturne.openIncident(i.id);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-sm hover:bg-surface-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SeverityChip severity={i.severity} />
                    <span className="truncate">{i.title}</span>
                  </div>
                  <IncidentStatusChip status={i.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* the runbooks on this service */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">Runbooks</h3>
        {detail.runbooks.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No runbooks yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {detail.runbooks.map((rb) => (
              <li key={rb.id} className="rounded-lg bg-surface-2 px-3 py-1.5">
                {rb.name}
                <span className="ml-2 text-xs text-muted">
                  {rb.steps.length} steps{rb.forSeverities.length > 0 ? " · " + rb.forSeverities.join(", ") : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* the manual component-status override (admin-gated) */}
      {serviceComponents.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h3 className="text-sm font-bold">Component status</h3>
          {denyComponent && <p className="mt-1 text-xs text-muted">{denyComponent}</p>}
          <ul className="mt-2 space-y-2">
            {serviceComponents.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <ComponentStatusChip status={c.status} />
                  {c.name}
                  {c.note && <span className="text-xs text-muted">— {c.note}</span>}
                </span>
                <ReasonGate reason={denyComponent}>
                  <select
                    aria-label={"set status for " + c.name}
                    value={c.status}
                    disabled={!!denyComponent}
                    onChange={(e) =>
                      void nocturne.setComponentStatus(c.id, e.target.value as NocturneComponentStatus, c.note)
                    }
                    className="rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus-visible:border-accent disabled:opacity-50"
                  >
                    {["operational", "degraded", "down", "maintenance", "unknown"].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </ReasonGate>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
