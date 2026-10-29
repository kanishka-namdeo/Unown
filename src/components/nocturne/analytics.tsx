"use client";

/**
 * The analytics view — the MTTA/MTTR KPIs, the SLA breach rate, the
 * incident counts by severity + service, and the on-call load per
 * paged user. The accessible-SVG mini-charts follow the cadence
 * pattern (`role="img"` + `aria-label`).
 */
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import { Kpi, SparkBar, pct, SeverityChip } from "./primitives";

export function AnalyticsView() {
  const nocturne = useNocturne();
  const a = nocturne.analytics;
  const fmt = nocturne.fmt;

  if (!a) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading analytics…
      </div>
    );
  }

  const severityEntries = Object.entries(a.incidentsBySeverity ?? {});
  const serviceEntries = Object.entries(a.incidentsByService ?? {});
  const loadEntries = Object.entries(a.onCallLoad ?? {});
  const totalLoad = loadEntries.reduce((acc, [, v]) => acc + v, 0);
  const maxService = Math.max(1, ...serviceEntries.map(([, v]) => v));

  const serviceName = (id: string): string =>
    nocturne.services.find((s) => s.service.id === id)?.service.name ?? id;

  return (
    <div className="space-y-4">
      {/* ── the KPI band ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Analytics KPIs">
        <Kpi
          label="MTTA"
          value={a.mttaMs !== null ? fmt.duration(a.mttaMs) : "—"}
          delta="mean time to acknowledge (resolved only)"
        />
        <Kpi
          label="MTTR"
          value={a.mttrMs !== null ? fmt.duration(a.mttrMs) : "—"}
          delta="mean time to resolve"
        />
        <Kpi
          label="SLA breach rate"
          value={a.breachRate !== null ? pct(a.breachRate) : "—"}
          delta="of resolved incidents"
        />
        <Kpi
          label="Open on-call load"
          value={String(totalLoad)}
          delta={"open incidents across " + loadEntries.length + " paged users"}
        />
      </div>

      {/* MTTA/MTTR + severity chart (accessible SVG) */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">Incidents by severity</h2>
          <div className="mt-3">
            <SparkBar
              label="Incident counts by severity"
              series={severityEntries.map(([, v]) => v)}
              width={420}
              height={40}
            />
          </div>
          <ul className="mt-2 space-y-1">
            {severityEntries.map(([sev, v]) => (
              <li key={sev} className="flex items-center justify-between text-xs">
                <SeverityChip severity={sev as "sev1"} />
                <span className="tabular-nums text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">Incidents by service</h2>
          {serviceEntries.length === 0 ? (
            <p className="mt-2 text-xs text-muted">No incidents.</p>
          ) : (
            <ul className="mt-2 space-y-1.5" aria-label="Incidents by service">
              {serviceEntries.map(([id, v]) => (
                <li key={id}>
                  <div className="flex items-center justify-between text-sm">
                    <span>{serviceName(id)}</span>
                    <span className="tabular-nums text-xs text-muted">{v}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent-strong"
                      style={{ width: Math.round((v / maxService) * 100) + "%" }}
                      role="img"
                      aria-label={serviceName(id) + " " + v + " incidents"}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── the on-call load ──────────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">On-call load (open incidents per paged user)</h2>
        {loadEntries.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No open incidents to page.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {[...loadEntries]
              .sort((a, b) => b[1] - a[1])
              .map(([userId, v]) => (
                <li key={userId} className="flex items-center justify-between text-sm">
                  <span>{nocturne.userName(userId)}</span>
                  <span className="tabular-nums text-xs text-muted">
                    {v} open incident{v === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}
