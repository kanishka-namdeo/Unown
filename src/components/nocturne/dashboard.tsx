"use client";

/**
 * The dashboard — the KPI band (open incidents, MTTA, MTTR,
 * breach rate, on-call now) + the active-incident list with the
 * live SLA countdowns + the severity distribution mini-chart
 * (accessible SVG, the cadence pattern).
 */
import { useNocturne } from "@/components/nocturne/nocturne-provider";
import { Kpi, SeverityChip, IncidentStatusChip, SlaChip, SparkBar } from "./primitives";

export function DashboardView() {
  const nocturne = useNocturne();
  const d = nocturne.dashboard;
  const fmt = nocturne.fmt;

  if (!d) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading the dashboard…
      </div>
    );
  }

  const openIncidents = d.openIncidents ?? [];
  const analytics = d.analytics;
  const onCallNow = openIncidents.reduce(
    (acc, i) => (i.primaryOnCall !== null ? acc + 1 : acc),
    0,
  );

  return (
    <div className="space-y-4">
      {/* ── the KPI band ──────────────────────────────────────────── */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        role="group"
        aria-label="KPIs"
      >
        <Kpi
          label="Open incidents"
          value={String(openIncidents.length)}
          delta="triggered · acknowledged · snoozed"
        />
        <Kpi
          label="MTTA"
          value={analytics?.mttaMs !== null && analytics?.mttaMs !== undefined ? fmt.duration(analytics.mttaMs) : "—"}
          delta="mean time to ack (resolved)"
        />
        <Kpi
          label="MTTR"
          value={analytics?.mttrMs !== null && analytics?.mttrMs !== undefined ? fmt.duration(analytics.mttrMs) : "—"}
          delta="mean time to resolve"
        />
        <Kpi
          label="SLA breach rate"
          value={analytics?.breachRate !== null && analytics?.breachRate !== undefined ? Math.round(analytics.breachRate * 100) + "%" : "—"}
          delta="of resolved incidents"
        />
        <Kpi
          label="On call now"
          value={String(onCallNow)}
          delta="open incidents paged"
        />
      </div>

      {/* ── the active-incident list with the live SLA countdowns ── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Active incidents</h2>
        {openIncidents.length === 0 ? (
          <p className="mt-2 text-xs text-muted">All clear — no open incidents.</p>
        ) : (
          <ul className="mt-2 space-y-1.5" aria-label="Active incidents">
            {openIncidents.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => {
                    nocturne.setView("incidents");
                    void nocturne.openIncident(i.id);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SeverityChip severity={i.severity} />
                    <span className="truncate text-sm">{i.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <IncidentStatusChip status={i.status} />
                    <SlaChip state={i.slaState} />
                    <span
                      className={
                        "tabular-nums " +
                        (i.slaState === "breached"
                          ? "text-danger"
                          : i.slaState === "at_risk"
                            ? "text-warn"
                            : "text-muted")
                      }
                      aria-label={"sla countdown " + i.slaState + " " + fmt.countdown(i.remainingMs)}
                    >
                      {i.slaState === "breached"
                        ? "breached"
                        : fmt.countdown(i.remainingMs)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── the severity distribution mini-chart ──────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Incidents by severity</h2>
        {analytics ? (
          <div className="mt-3">
            <SeverityBar analytics={analytics} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Loading analytics…</p>
        )}
      </section>
    </div>
  );
}

/** The severity distribution bar (the accessible SVG mini-chart). */
function SeverityBar({ analytics }: { analytics: NonNullable<ReturnType<typeof useNocturne>["analytics"]> }) {
  const entries = Object.entries(analytics.incidentsBySeverity ?? {});
  const values = entries.map(([, v]) => v);
  return (
    <div>
      <SparkBar label="Incidents by severity" series={values} width={420} height={40} />
      <ul className="mt-2 space-y-1">
        {entries.map(([sev, v]) => (
          <li key={sev} className="flex items-center justify-between text-xs">
            <SeverityChip severity={sev as "sev1"} />
            <span className="tabular-nums text-muted">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
