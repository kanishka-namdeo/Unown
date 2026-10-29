"use client";

/**
 * Ledger — the cash-flow chart band (plan §3 band 3).
 *
 * A 90-day SVG chart: two painted lines (inflow green-tinted ink,
 * outflow dim) and the net area under the accent. Keyboard-operable
 * day scrubbing via a native range input (WAI-ARIA by construction —
 * the encore before/after slider's discipline). The sr-only data table
 * carries the values for screen readers, and the clip lives on a
 * WRAPPER DIV, never the table (the F17 anatomy: scoped table CSS
 * re-expands sr-only tables).
 */
import { useId, useState } from "react";
import type { FlowSeries } from "@/lib/ledger/types";
import { moneyCompact, shortDate } from "@/lib/ledger/format";

const W = 1000;
const H = 260;
const PAD = { top: 16, right: 12, bottom: 24, left: 12 };

export function FlowChart({ series }: { series: FlowSeries }) {
  const rangeId = useId();
  const [day, setDay] = useState(series.days.length - 1);
  const n = series.days.length;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (n - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (Math.abs(v) / series.maxAbs) * innerH;

  // iter1 (the VLM's dwarfed-series finding): the 2026-09-18 tranche
  // ($1.25M) flattened the other 89 days. The DISPLAY curve clamps at the
  // 95th-percentile absolute flow and the spike day carries a marker + the
  // honest label — the data never lies, the axis just refuses to be
  // hijacked by one outlier.
  const absFlows = series.days.flatMap((dd) => [Math.abs(dd.inflow), Math.abs(dd.outflow)]).sort((a, b) => a - b);
  const clamp = absFlows[Math.floor(absFlows.length * 0.95)]!;
  const yClamped = (v: number) => {
    const clamped = Math.max(-clamp, Math.min(clamp, v));
    return PAD.top + innerH - (Math.abs(clamped) / clamp) * innerH;
  };
  const TRANCHE_DAY = series.days.findIndex((dd) => dd.date === "2026-09-18");

  const line = (key: "inflow" | "outflow") =>
    series.days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yClamped(d[key]).toFixed(1)}`).join(" ");

  const netPath =
    series.days.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yClamped(d.net).toFixed(1)}`).join(" ") +
    ` L${x(n - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

  const d = series.days[day]!;


  return (
    <section className="lg-band" aria-labelledby="flow-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Micro>Cash flow · 90 days</Micro>
          <h2 id="flow-heading" className="mt-2 text-[24px] font-semibold tracking-[-0.012em] text-[var(--lg-ink-deep)]">
            In, out, and the net between
          </h2>
        </div>
        <p className="lg-num text-[13px] text-[var(--lg-dim)]" aria-label={`Selected day ${d.date}: inflow ${moneyCompact(d.inflow)}, outflow ${moneyCompact(d.outflow)}, net ${moneyCompact(d.net)}`}>
          {shortDate(d.date)} · in {moneyCompact(d.inflow)} · out {moneyCompact(d.outflow)} · net{" "}
          <span className={d.net >= 0 ? "text-[var(--lg-pos)]" : "text-[var(--lg-neg)]"}>{moneyCompact(d.net)}</span>
        </p>
      </div>

      <div className="mt-6 rounded-[12px] border border-[var(--lg-line)] bg-white/60 p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-[260px] w-full"
          role="img"
          aria-label={`Cash-flow chart from ${shortDate(series.start)} to ${shortDate(series.end)}: net over the period ${moneyCompact(series.net90)}`}
        >
          {/* the zero line */}
          <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--lg-line)" strokeWidth="1" />
          {/* the net area — the accent, the only color */}
          <path d={netPath} fill="var(--lg-clay)" opacity="0.12" />
          <path d={netPath} fill="none" stroke="var(--lg-clay)" strokeWidth="2" className="lg-draw" pathLength={1} />
          {/* the two series */}
          <path d={line("inflow")} fill="none" stroke="var(--lg-ink-soft)" strokeWidth="1.5" opacity="0.55" />
          <path d={line("outflow")} fill="none" stroke="var(--lg-dim)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.7" />
          {/* the tranche marker — the spike, named honestly */}
          {TRANCHE_DAY >= 0 && (
            <g>
              <line x1={x(TRANCHE_DAY)} x2={x(TRANCHE_DAY)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--lg-line-strong)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={x(TRANCHE_DAY)} cy={PAD.top + 6} r="3.5" fill="var(--lg-clay-deep)" />
            </g>
          )}
          {/* the scrub cursor */}
          <line x1={x(day)} x2={x(day)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--lg-clay-deep)" strokeWidth="1" />
          <circle cx={x(day)} cy={yClamped(d.net)} r="4" fill="var(--lg-clay-deep)" />
        </svg>
        <div className="mt-2 flex items-center gap-3 border-t border-[var(--lg-line)]/70 pt-3">
          <label htmlFor={rangeId} className="lg-micro text-[var(--lg-faint)]">
            Scrub days
          </label>
          <input
            id={rangeId}
            type="range"
            min={0}
            max={n - 1}
            value={day}
            onChange={(e) => setDay(Number(e.target.value))}
            className="h-1.5 w-full max-w-[420px] cursor-pointer appearance-none rounded-[4px] bg-[var(--lg-line)] accent-[var(--lg-clay)]"
            aria-valuetext={shortDate(d.date)}
          />
        </div>
      </div>

      {/* the axis clamp note — the honest label for the truncated spike */}
      <p className="mt-2 text-[12px] text-[var(--lg-faint)]">
        Y-axis clamps at {moneyCompact(clamp)} (95th percentile) — the 18 Sep tranche (+$1.25M) is marked, not plotted to scale.
      </p>

      {/* the legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-[var(--lg-dim)]">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-[2px] w-5 bg-[var(--lg-clay)]" /> net
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-[2px] w-5 bg-[var(--lg-ink-soft)] opacity-60" /> inflow
        </span>
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-[2px] w-5 bg-[var(--lg-dim)] opacity-70" style={{ backgroundImage: "repeating-linear-gradient(90deg, var(--lg-dim) 0 4px, transparent 4px 8px)" }} /> outflow
        </span>
      </div>

      {/* the sr-only data table — the clip on the WRAPPER (the F17 rule) */}
      <div className="sr-only">
        <table>
          <caption>Cash flow by day, inflow, outflow and net in dollars</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Inflow</th>
              <th scope="col">Outflow</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {series.days.map((dd) => (
              <tr key={dd.date}>
                <th scope="row">{shortDate(dd.date)}</th>
                <td>{moneyCompact(dd.inflow)}</td>
                <td>{moneyCompact(dd.outflow)}</td>
                <td>{moneyCompact(dd.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Micro({ children }: { children: React.ReactNode }) {
  return <p className="lg-micro text-[var(--lg-faint)]">{children}</p>;
}
