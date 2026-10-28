"use client";

/**
 * Pure-SVG weekly completions chart: 52 bars from `stats.toWeeklyBars`,
 * the Bazaar Chart14Day pattern (gridlines, y-axis ticks, `<title>` tooltips,
 * x labels every 13th bar). Zero state: an empty grid still renders with
 * the axis labels.
 */
import type { WeeklyBar } from "@/lib/cadence/types";
import { monthShort, weekdayShort } from "./format";

const W = 640;
const H = 200;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 26;

export function StatsChart({ bars, target }: { bars: WeeklyBar[]; target: number }) {
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...bars.map((b) => b.count));
  // Round the axis top up to a multiple of 5 so the ticks stay clean.
  const top = Math.max(5, Math.ceil(max / 5) * 5);
  const ticks = [0, Math.round(top / 2), top];
  const bw = plotW / Math.max(1, bars.length);
  const yFor = (v: number) => PAD_T + plotH - (v / top) * plotH;

  return (
    <svg
      viewBox={"0 0 " + W + " " + H}
      role="img"
      aria-label="Completions per week, last 52 weeks"
      className="mt-3 w-full"
    >
      {/* gridlines + y-axis ticks */}
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            y1={yFor(t)}
            x2={W - PAD_R}
            y2={yFor(t)}
            stroke="var(--border)"
            strokeWidth={1}
            strokeDasharray={t === 0 ? undefined : "2 3"}
          />
          <text x={PAD_L - 6} y={yFor(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
            {t}
          </text>
        </g>
      ))}

      {/* the target line (avg completions per week across all habits) */}
      {target > 0 && target <= top && (
        <g>
          <line
            x1={PAD_L}
            y1={yFor(target)}
            x2={W - PAD_R}
            y2={yFor(target)}
            stroke="var(--warn)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
          <text
            x={W - PAD_R}
            y={yFor(target) - 4}
            textAnchor="end"
            fontSize={9}
            fill="var(--muted)"
          >
            target {target}
          </text>
        </g>
      )}

      {/* bars — zero weeks render a 1px floor so the week is still visible */}
      {bars.map((b, i) => {
        const h = b.count === 0 ? 2 : Math.max(3, (b.count / top) * plotH);
        const x = PAD_L + i * bw + bw * 0.15;
        return (
          <rect
            key={b.weekStart}
            x={x}
            y={yFor(Math.max(b.count, (h / plotH) * top))}
            width={Math.max(2, bw - 1.5)}
            height={h}
            rx={2}
            fill={b.count > 0 ? "var(--accent-strong)" : "var(--surface-2)"}
            opacity={b.count > 0 ? 1 : 0.6}
          >
            <title>
              {monthShort(b.weekStart)} {weekdayShort(b.weekStart)} wk — {b.count}{" "}
              {b.count === 1 ? "completion" : "completions"}
            </title>
          </rect>
        );
      })}

      {/* x labels: every 13th bar + the last one */}
      {bars.map((b, i) =>
        i % 13 === 0 || i === bars.length - 1 ? (
          <text
            key={b.weekStart + "-x"}
            x={PAD_L + i * bw + bw / 2}
            y={H - 6}
            textAnchor="middle"
            fontSize={9}
            fill="var(--muted)"
          >
            {monthShort(b.weekStart)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
