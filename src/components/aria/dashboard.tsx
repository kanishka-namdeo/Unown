"use client";

/**
 * The dashboard — the KPI band (weighted pipeline, commit, win rate,
 * sales cycle, open tasks/SLA breaches) + the metric drill-down
 * panels ("open the number": click a KPI → the underlying records
 * list from `/aria/api/reports/drilldown`) + accessible SVG
 * mini-charts (the cadence pattern).
 */
import { useAria } from "@/app/aria/client-store";
import { Kpi, CategoryChip, money, pct, SparkBar, stalledDays } from "./primitives";
import type { AriaDeal } from "@/lib/aria/types";

export function DashboardView() {
  const aria = useAria();
  const d = aria.dashboard;

  if (!d) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
        Loading the dashboard…
      </div>
    );
  }

  const weighted = d.pipeline.openWeighted ?? 0;
  const winPct = pct(d.winrate?.rate ?? 0);
  const openTasks = d.openTasks ?? [];
  const breached = openTasks.filter((t) => (t as unknown as { slaState?: string }).slaState === "late").length;

  return (
    <div className="space-y-4">
      {/* ── the KPI band ──────────────────────────────────────────── */}
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
        role="group"
        aria-label="KPIs"
      >
        <Kpi
          label="Weighted pipeline"
          value={money(weighted)}
          delta={d.pipeline.openCount + " open deals"}
          onClick={() => void aria.openDrill("weighted", "all")}
        />
        <Kpi
          label="Commit"
          value={money(dashboardCommit(aria.deals))}
          delta="commit category"
          onClick={() => void aria.openDrill("commit", "all")}
        />
        <Kpi
          label="Win rate"
          value={winPct}
          delta={d.winrate ? d.winrate.won + " won / " + d.winrate.lost + " lost" : undefined}
        />
        <Kpi label="Sales cycle" value={Math.round(d.salescycle?.medianDays ?? 0) + "d"} delta="median to close" />
        <Kpi
          label="Open tasks"
          value={String(openTasks.length)}
          delta={breached > 0 ? breached + " breached SLA" : "SLA on track"}
        />
      </div>

      {/* ── the pipeline stage chart + drill-down panel ───────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">Weighted by stage</h2>
          <StageChart d={d} aria={aria} />
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-bold">
            {aria.drilldown
              ? "Drill-down: " + aria.drilldown.metric + " = " + aria.drilldown.value
              : "The open number"}
          </h2>
          <DrilldownPanel />
        </section>
      </div>

      {/* ── the open-deal at-risk hints ───────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">At-risk open deals</h2>
        <AtRiskList deals={aria.deals} now="2026-10-28T12:00:00Z" onOpen={(id) => void aria.openDealDetail(id)} />
      </section>
    </div>
  );
}

/** The commit-category total (summed client-side from the open deals). */
function dashboardCommit(deals: AriaDeal[]): number {
  return deals
    .filter((d) => d.closedAt === null && d.forecastCategory === "commit")
    .reduce((acc, d) => acc + d.amount, 0);
}

function StageChart({ d, aria }: { d: NonNullable<ReturnType<typeof useAria>["dashboard"]>; aria: ReturnType<typeof useAria> }) {
  const entries = Object.entries(d.pipeline?.weightedByStage ?? {});
  const values = entries.map(([, v]) => v);
  const max = Math.max(1, ...values);
  if (entries.length === 0) {
    return <p className="mt-3 text-xs text-muted">No open pipeline.</p>;
  }
  return (
    <div className="mt-3 space-y-1.5">
      <SparkBar label="Weighted value by stage" series={values} width={420} height={40} />
      <ul className="space-y-1">
        {entries.map(([stageId, v]) => (
          <li key={stageId} className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => void aria.openDrill("stage", stageId)}
              className="text-accent hover:underline"
            >
              {stageName(aria, stageId)}
            </button>
            <span className="tabular-nums">{money(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function stageName(aria: ReturnType<typeof useAria>, stageId: string): string {
  for (const p of aria.pipelines) {
    const s = p.stages.find((x) => x.id === stageId);
    if (s) return s.name;
  }
  return stageId;
}

function DrilldownPanel() {
  const aria = useAria();
  if (!aria.drilldown || aria.drilldown.records.length === 0) {
    return <p className="mt-3 text-xs text-muted">Click a KPI or a stage to open the number.</p>;
  }
  const { records } = aria.drilldown;
  return (
    <ul className="mt-3 space-y-1.5 text-sm" aria-label="Drill-down records">
      {records.slice(0, 8).map((deal: AriaDeal) => (
        <li key={deal.id}>
          <button
            type="button"
            onClick={() => void aria.openDealDetail(deal.id)}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-surface-2"
          >
            <span className="truncate text-muted">{deal.id}</span>
            <CategoryChip category={deal.forecastCategory} />
            <span className="tabular-nums">{money(deal.amount)}</span>
          </button>
        </li>
      ))}
      {records.length > 8 && (
        <li className="text-xs text-muted">…and {records.length - 8} more</li>
      )}
    </ul>
  );
}

function AtRiskList({
  deals,
  now,
  onOpen,
}: {
  deals: AriaDeal[];
  now: string;
  onOpen: (id: string) => void;
}) {
  const atRisk = deals
    .filter((d) => d.closedAt === null && stalledDays(d.lastStageChangeAt, now) >= 14)
    .slice(0, 6);
  if (atRisk.length === 0) {
    return <p className="mt-2 text-xs text-muted">No open deals stalled ≥ 14 days in stage.</p>;
  }
  return (
    <ul className="mt-2 space-y-1.5 text-sm" aria-label="At-risk deals">
      {atRisk.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            onClick={() => onOpen(d.id)}
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-surface-2"
          >
            <span className="truncate">{d.id} · {d.expectedCloseDate}</span>
            <span className="text-xs text-warn">{stalledDays(d.lastStageChangeAt, now)}d in stage</span>
            <span className="tabular-nums">{money(d.amount)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
