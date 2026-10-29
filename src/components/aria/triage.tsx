"use client";

/**
 * The triage inbox — the lead-score queue (score bars +
 * component explainability), the deal-health list (A-D grades +
 * named signals), and the anomaly flags panel.
 */
import { useAria } from "@/app/aria/client-store";
import { GradeChip, Kpi, ReasonGate, money, SparkBar } from "./primitives";

export function TriageView() {
  const aria = useAria();
  const denyOpen = aria.denyReason("deal.read");

  return (
    <div className="space-y-4">
      {/* ── the lead-score queue ─────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Lead queue (by score)</h2>
        {aria.triageLeads.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No leads to triage.</p>
        ) : (
          <ul className="mt-3 space-y-2.5" role="list" aria-label="Lead scores">
            {aria.triageLeads.map((row) => (
              <li key={row.lead.id}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {row.lead.source} · {row.lead.priority}
                    </div>
                    <ScoreBar score={row.score} components={row.components} />
                  </div>
                  <span
                    role="img"
                    aria-label={"score " + row.score}
                    className="shrink-0 text-lg font-bold text-accent"
                  >
                    {row.score}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── the deal-health list ─────────────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Deal health (worst first)</h2>
        {aria.triageDeals.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No deals to triage.</p>
        ) : (
          <ul className="mt-3 space-y-2" role="list" aria-label="Deal health">
            {aria.triageDeals.map((row) => (
              <li
                key={row.deal.id}
                className="rounded-lg border border-line bg-surface-2 p-2.5 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void aria.openDealDetail(row.deal.id)}
                    disabled={!!denyOpen}
                    className="min-w-0 truncate text-left font-medium hover:text-accent disabled:opacity-50"
                  >
                    {row.deal.id}
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <GradeChip grade={row.healthGrade} />
                    <span className="tabular-nums">{money(row.deal.amount)}</span>
                  </div>
                </div>
                {row.signals.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {row.signals.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] text-warn"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-xs text-muted">NBA: {row.nextBestAction}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── the anomaly flags panel ──────────────────────────────── */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-bold">Anomalies</h2>
        {aria.anomalies.length === 0 ||
        aria.anomalies.every((a) => a.deals.length === 0) ? (
          <p className="mt-2 text-xs text-muted">No anomalies flagged.</p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {aria.anomalies
              .filter((a) => a.deals.length > 0)
              .map((a) => (
                <div
                  key={a.type}
                  className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-danger">
                      {a.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs text-muted">{a.deals.length} deals</span>
                  </div>
                  <ul className="mt-1.5 space-y-1 text-xs text-muted">
                    {a.deals.map((d) => (
                      <li key={d.id}>
                        {d.id} · {money(d.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ScoreBar({
  score,
  components,
}: {
  score: number;
  components: Array<{ name: string; weight: number; value: number }>;
}) {
  const total = Math.max(1, components.reduce((a, c) => a + c.weight, 0));
  const values = components.map((c) => (c.value / c.weight) * (c.weight / total));
  return (
    <div className="mt-1">
      <SparkBar label={"Score components for score " + score} series={values} width={320} height={10} />
      <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-muted">
        {components.map((c) => (
          <span key={c.name}>
            {c.name} {c.value}/{c.weight}
          </span>
        ))}
      </div>
    </div>
  );
}
