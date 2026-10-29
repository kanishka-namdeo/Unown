"use client";

/**
 * The reports view — the report tabs (win rate by owner, sales
 * cycle, funnel, cohorts, forecast with the commit ladder +
 * coverage), all rendering from the API's pure-math routes.
 */
import { useState } from "react";
import { useAria } from "@/app/aria/client-store";
import { Kpi, money, pct } from "./primitives";

type ReportTab = "winrate" | "salescycle" | "funnel" | "cohorts" | "forecast";

const TABS: Array<{ id: ReportTab; label: string }> = [
  { id: "winrate", label: "Win rate" },
  { id: "salescycle", label: "Sales cycle" },
  { id: "funnel", label: "Funnel" },
  { id: "cohorts", label: "Cohorts" },
  { id: "forecast", label: "Forecast" },
];

export function ReportsView() {
  const aria = useAria();
  const [tab, setTab] = useState<ReportTab>("winrate");
  const d = aria.dashboard;

  const denyRead = aria.denyReason("report.read");
  if (denyRead) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        {denyRead}
      </div>
    );
  }

  if (!d) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading reports…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <nav className="flex flex-wrap gap-1" role="tablist" aria-label="Reports">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              "rounded-lg px-3 py-1.5 text-sm " +
              (tab === t.id ? "bg-accent/20 font-semibold text-accent" : "text-muted hover:bg-surface-2")
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "winrate" && <WinRateTab d={d} aria={aria} />}
        {tab === "salescycle" && <SalesCycleTab d={d} aria={aria} />}
        {tab === "funnel" && <FunnelTab aria={aria} />}
        {tab === "cohorts" && <CohortsTab aria={aria} />}
        {tab === "forecast" && <ForecastTab aria={aria} />}
      </main>
    </div>
  );
}

function ownerName(aria: ReturnType<typeof useAria>, id: string): string {
  return aria.members.find((m) => m.user.id === id)?.user.name ?? id;
}

function WinRateTab({
  d,
  aria,
}: {
  d: NonNullable<ReturnType<typeof useAria>["dashboard"]>;
  aria: ReturnType<typeof useAria>;
}) {
  const wr = d!.winrate!;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Win rate" value={pct(wr.rate)} delta={wr.won + " won / " + wr.lost + " lost"} />
      </div>
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">By owner</h3>
        <ul className="mt-2 space-y-1.5 text-sm" role="list">
          {Object.entries(wr.byOwner).map(([ownerId, r]) => (
            <li key={ownerId} className="flex items-center justify-between">
              <span>{ownerName(aria, ownerId)}</span>
              <span className="tabular-nums text-muted">
                {r.won}w / {r.lost}l · {pct(r.rate)}
              </span>
            </li>
          ))}
          {Object.keys(wr.byOwner).length === 0 && (
            <li className="text-xs text-muted">No closed deals in the period.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function SalesCycleTab({
  d,
  aria,
}: {
  d: NonNullable<ReturnType<typeof useAria>["dashboard"]>;
  aria: ReturnType<typeof useAria>;
}) {
  const sc = d!.salescycle!;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3">
        <Kpi label="Median sales cycle" value={Math.round(sc.medianDays) + "d"} delta="created → closed" />
      </div>
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">By owner</h3>
        <ul className="mt-2 space-y-1.5 text-sm" role="list">
          {Object.entries(sc.byOwner).map(([ownerId, days]) => (
            <li key={ownerId} className="flex items-center justify-between">
              <span>{ownerName(aria, ownerId)}</span>
              <span className="tabular-nums text-muted">{Math.round(days)}d</span>
            </li>
          ))}
          {Object.keys(sc.byOwner).length === 0 && (
            <li className="text-xs text-muted">No closed deals yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}

function FunnelTab({ aria }: { aria: ReturnType<typeof useAria> }) {
  const pipeline =
    aria.pipelines.find((p) => p.id === aria.selectedPipelineId) ?? aria.pipelines[0];
  if (!pipeline) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        No pipelines.
      </div>
    );
  }
  const counts: Record<string, number> = {};
  for (const deal of aria.deals) {
    if (deal.pipelineId === pipeline.id) {
      counts[deal.stageId] = (counts[deal.stageId] ?? 0) + 1;
    }
  }
  const base = pipeline.stages.length ? counts[pipeline.stages[0].id] ?? 0 : 0;

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-bold">
        Funnel — {pipeline.name}
      </h3>
      <ol className="mt-3 space-y-2" aria-label={"Funnel for " + pipeline.name}>
        {pipeline.stages.map((s) => {
          const count = counts[s.id] ?? 0;
          const conv = base === 0 ? 0 : count / base;
          return (
            <li key={s.id}>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => void aria.openDrill("stage", s.id)}
                  className="text-left hover:text-accent"
                >
                  {s.name}
                </button>
                <span className="tabular-nums text-xs text-muted">
                  {count} · {pct(conv)}
                </span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent-strong"
                  style={{ width: Math.round(Math.min(1, conv) * 100) + "%" }}
                  role="img"
                  aria-label={s.name + " " + count + " deals, " + Math.round(conv * 100) + " percent of first stage"}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function CohortsTab({ aria }: { aria: ReturnType<typeof useAria> }) {
  // The cohorts are computed client-side over the deals the provider
  // loaded (the `reports/cohorts` route's math — the plan's pure-math
  // contract).
  const byMonth: Record<string, { created: number; won: number }> = {};
  for (const deal of aria.deals) {
    const m = deal.createdAt.slice(0, 7);
    const slot = (byMonth[m] ??= { created: 0, won: 0 });
    slot.created += 1;
    if (deal.closedAt !== null && deal.lostReason === null && deal.forecastCategory === "closed") {
      slot.won += 1;
    }
  }
  const months = Object.entries(byMonth).sort(([a], [b]) => (a < b ? -1 : 1));

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-bold">Deal cohorts by creation month</h3>
      {months.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No deals to cohort.</p>
      ) : (
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1">Month</th>
              <th>Created</th>
              <th>Won</th>
              <th>Win rate</th>
            </tr>
          </thead>
          <tbody>
            {months.map(([month, c]) => (
              <tr key={month} className="border-t border-line">
                <td className="py-1.5">{month}</td>
                <td>{c.created}</td>
                <td>{c.won}</td>
                <td>{pct(c.created === 0 ? 0 : c.won / c.created)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ForecastTab({ aria }: { aria: ReturnType<typeof useAria> }) {
  const d = aria.dashboard;
  if (!d) {
    return <p className="text-sm text-muted">Loading…</p>;
  }
  // The forecast rung numbers (the `reports/forecast` route's
  // commit ladder) — the client-side recomputation over the deals:
  const commit = aria.deals
    .filter((x) => x.closedAt === null && x.forecastCategory === "commit")
    .reduce((acc, x) => acc + x.amount, 0);
  const bestCase = commit +
    aria.deals
      .filter((x) => x.closedAt === null && x.forecastCategory === "best_case")
      .reduce((acc, x) => acc + x.amount, 0);
  const pipelineRung = bestCase +
    aria.deals
      .filter((x) => x.closedAt === null && x.forecastCategory === "pipeline")
      .reduce((acc, x) => acc + x.amount, 0);

  const quota = aria.tenant
    ? Object.values(aria.tenant.quotas ?? {}).reduce((a, b) => a + b, 0)
    : 0;
  const coverage = quota === 0 ? 0 : commit / quota;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Commit" value={money(commit)} />
        <Kpi label="Best case" value={money(bestCase)} />
        <Kpi label="Pipeline" value={money(pipelineRung)} />
        <Kpi label="Coverage" value={quota === 0 ? "n/a" : pct(coverage)} delta={quota ? "of " + money(quota) : "no quota"} />
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-sm font-bold">The commit ladder</h3>
        <ol className="mt-2 space-y-1.5 text-sm" aria-label="Commit ladder">
          {[
            ["Commit", commit],
            ["Best case", bestCase],
            ["Pipeline", pipelineRung],
          ].map(([label, v]) => (
            <li key={label as string} className="flex items-center justify-between">
              <span className="text-muted">{label}</span>
              <span className="tabular-nums font-semibold">{money(v as number)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
