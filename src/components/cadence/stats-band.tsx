"use client";

/**
 * The Stats view: a KPI row (total checkoffs, best current streak, 30-day
 * completion rate, best day-of-week), the 52-week bar chart, and a
 * per-habit mini table. All data from `useCadence` + the pure `stats.ts`
 * helpers, memoized against the store's inputs.
 */
import { useMemo } from "react";
import { useCadence } from "@/lib/cadence/store";
import { cadenceStats, toWeeklyBars } from "@/lib/cadence/stats";
import { bestStreak, currentStreak } from "@/lib/cadence/streaks";
import type { CheckoffDate } from "@/lib/cadence/types";
import { Kpi } from "./primitives";
import { StatsChart } from "./stats-chart";
import { todayKey } from "./format";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function StatsBand({ asOf }: { asOf?: CheckoffDate }) {
  const { state } = useCadence();
  const day = asOf ?? todayKey(new Date());
  const { habits, entries } = state;

  const stats = useMemo(
    () => cadenceStats(entries, habits, day),
    [entries, habits, day],
  );
  const bars = useMemo(
    () => toWeeklyBars(entries, habits, day),
    [entries, habits, day],
  );
  const target = useMemo(
    () => Math.round(bars[0]?.target ?? 0),
    [bars],
  );
  const topStreak = useMemo(() => {
    let best = 0;
    let bestHabit = "";
    for (const h of habits) {
      const s = currentStreak(h, entries[h.id] ?? [], day);
      if (s > best) {
        best = s;
        bestHabit = h.name;
      }
    }
    return best === 0 ? { days: 0, habit: "" } : { days: best, habit: bestHabit };
  }, [habits, entries, day]);

  const rows = useMemo(
    () =>
      habits.map((h) => {
        const hEntries = entries[h.id] ?? [];
        const { last30 } = cadenceStats({ [h.id]: hEntries }, [h], day);
        return {
          habit: h,
          current: currentStreak(h, hEntries, day),
          best: bestStreak(hEntries),
          rate30: last30.percent,
          total: hEntries.length,
        };
      }),
    [habits, entries, day],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Stats</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Total checkoffs" value={String(stats.totalCheckoffs)} />
        <Kpi
          label="Best current streak"
          value={topStreak.days + "d"}
          delta={topStreak.habit ? topStreak.habit : undefined}
        />
        <Kpi
          label="30-day completion"
          value={stats.last30.percent.toFixed(0) + "%"}
          delta={stats.last30.done + " of " + stats.last30.total + " days"}
        />
        <Kpi
          label="Best day"
          value={stats.bestDay ? DAY_NAMES[stats.bestDay.dayIndex].slice(0, 3) : "\u2014"}
          delta={stats.bestDay ? stats.bestDay.count + " checkoffs" : undefined}
        />
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-bold">Completions — last 52 weeks</h2>
        <StatsChart bars={bars} target={target} />
      </div>

      {rows.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-bold">Per-habit</h2>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Habit</th>
                <th className="py-2 pr-3 font-medium">Current</th>
                <th className="py-2 pr-3 font-medium">Best</th>
                <th className="py-2 pr-3 font-medium">30d</th>
                <th className="py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.habit.id} className="border-b border-line/50">
                  <td className="py-2 pr-3">
                    <span aria-hidden="true">{r.habit.glyph || "•"} </span>
                    {r.habit.name}
                  </td>
                  <td className="py-2 pr-3">{r.current}d</td>
                  <td className="py-2 pr-3">{r.best}d</td>
                  <td className="py-2 pr-3">{r.rate30.toFixed(0)}%</td>
                  <td className="py-2">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
