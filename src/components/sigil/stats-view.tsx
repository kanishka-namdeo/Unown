"use client";

import { useMemo } from "react";
import type { FocusLogEntry, Task } from "@/lib/sigil/types";
import { currentStreak, dailyStats, totals } from "@/lib/sigil/stats";

interface StatsViewProps {
  tasks: Task[];
  focusLog: FocusLogEntry[];
  onReset?: () => void;
}

export function StatsView({ tasks, focusLog, onReset }: StatsViewProps) {
  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => dailyStats(tasks, focusLog, 14, now), [tasks, focusLog, now]);
  const streak = useMemo(() => currentStreak(tasks.map((t) => t.completedAt), now), [tasks, now]);
  const { completed, focusMinutes } = useMemo(
    () => totals(tasks, focusLog),
    [tasks, focusLog],
  );

  const maxCompleted = Math.max(0, ...days.map((d) => d.completedTasks));
  const maxFocus = Math.max(0, ...days.map((d) => d.focusMinutes));
  const hasCompletedData = days.some((d) => d.completedTasks > 0);
  const hasFocusData = days.some((d) => d.focusMinutes > 0);
  const hasAnyData = hasCompletedData || hasFocusData;

  const emptyHint =
    "Complete a task or run a focus session to see charts here.";

  return (
    <section aria-label="Stats" className="mx-auto max-w-3xl space-y-5">
      {/* Summary cards — de-emphasized when no data yet */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard
          label="Streak"
          value={`${streak}d`}
          detail="days with ≥1 completed task"
          muted={streak === 0}
        />
        <SummaryCard
          label="Completed"
          value={String(completed)}
          detail="all time"
          muted={completed === 0}
        />
        <SummaryCard
          label="Focus time"
          value={
            focusMinutes === 0
              ? "0m"
              : `${Math.floor(focusMinutes / 60)}h ${focusMinutes % 60}m`
          }
          detail="all time"
          muted={focusMinutes === 0}
        />
      </div>

      {/* Reset affordance (non-embed only) */}
      {onReset && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-sf-dim">{emptyHint}</p>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-sf-border bg-sf-surface px-3 py-1.5 text-xs font-medium text-sf-dim hover:bg-sf-surface-2 hover:text-sf focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
          >
            Reset board
          </button>
        </div>
      )}

      <ChartCard
        title="Tasks completed (last 14 days)"
        ariaLabel="Bar chart of tasks completed per day over the last 14 days"
        empty={!hasCompletedData}
        emptyHint={emptyHint}
      >
        {hasCompletedData && (
          <BarChart
            values={days.map((d) => d.completedTasks)}
            labels={days.map((d) => shortLabel(d.date))}
            maxValue={Math.max(1, maxCompleted)}
            accent="var(--sf-accent)"
          />
        )}
      </ChartCard>

      <ChartCard
        title="Focus minutes (last 14 days)"
        ariaLabel="Bar chart of focus minutes per day over the last 14 days"
        empty={!hasFocusData}
        emptyHint={emptyHint}
      >
        {hasFocusData && (
          <BarChart
            values={days.map((d) => d.focusMinutes)}
            labels={days.map((d) => shortLabel(d.date))}
            maxValue={Math.max(1, maxFocus)}
            accent="color-mix(in srgb, var(--sf-accent) 60%, transparent)"
          />
        )}
      </ChartCard>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  muted,
}: {
  label: string;
  value: string;
  detail: string;
  muted: boolean;
}) {
  return (
    <div className="rounded-xl border border-sf-border bg-sf-surface p-4 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-sf-dim">{label}</p>
      <p
        className={`mt-1 text-2xl tabular-nums ${
          muted ? "font-normal text-sf-dim/60" : "font-bold"
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-sf-dim">{detail}</p>
    </div>
  );
}

function ChartCard({
  title,
  ariaLabel,
  empty,
  emptyHint,
  children,
}: {
  title: string;
  ariaLabel: string;
  empty: boolean;
  emptyHint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-sf-border bg-sf-surface p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {empty ? (
        <div
          role="img"
          aria-label={`${title}: no data yet`}
          className="flex h-24 items-center justify-center text-sm text-sf-dim"
        >
          {emptyHint}
        </div>
      ) : (
        <div role="img" aria-label={ariaLabel}>
          {children}
        </div>
      )}
    </div>
  );
}

function BarChart({
  values,
  labels,
  maxValue,
  accent,
}: {
  values: number[];
  labels: string[];
  maxValue: number;
  accent: string;
}) {
  const W = 560;
  const H = 120;
  const pad = 8;
  const gap = 4;
  const barW = (W - pad * 2 - gap * (values.length - 1)) / values.length;

  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="w-full" role="presentation">
      <line
        x1={pad}
        x2={W - pad}
        y1={H}
        y2={H}
        stroke="var(--sf-border)"
        strokeWidth="1"
      />
      {values.map((v, i) => {
        const h = maxValue > 0 ? Math.max(2, (v / maxValue) * (H - 8)) : 0;
        const x = pad + i * (barW + gap);
        const y = H - h;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              rx="3"
              fill={accent}
            >
              <title>{`${labels[i]}: ${v}`}</title>
            </rect>
            <text
              x={x + barW / 2}
              y={H + 14}
              textAnchor="middle"
              fontSize="9"
              fill="var(--sf-text-dim)"
            >
              {labels[i]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function shortLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d}/${m}`;
}
