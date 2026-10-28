"use client";

/**
 * The 52-week activity grid: one column per ISO week (Mondays from
 * `streaks.isoWeekStarts`), seven rows Mon→Sun. Cell color =
 * `streaks.heatmapLevel` bucket 0–4 via the shared level classes; each
 * cell carries a `<title>` with its date. The grid is 370px wide — on
 * narrow viewports it scrolls horizontally inside its panel.
 *
 * Props in, SVG/HTML out: no store, no DOM.
 */
import type { CheckoffDate, Habit } from "@/lib/cadence/types";
import { entryCountForDay, heatmapLevel, isoWeekStarts } from "@/lib/cadence/streaks";
import { levelClass } from "./primitives";
import { monthShort } from "./format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** dayKey + n days, as a day key. */
function addDays(day: CheckoffDate, n: number): CheckoffDate {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function Heatmap({
  habit,
  entries,
  asOf,
}: {
  habit: Habit;
  entries: CheckoffDate[];
  /** the day key the 52 trailing weeks end at */
  asOf: CheckoffDate;
}) {
  const weeks = isoWeekStarts(52, asOf);
  // Month labels: the first week of the month that starts a column.
  const monthLabels = weeks.map((w) => (Number(w.slice(8)) <= 7 ? monthShort(w) : ""));

  return (
    <div className="overflow-x-auto">
      <div
        role="grid"
        aria-label={"Weekly activity, last 52 weeks"}
        className="inline-block min-w-[370px]"
      >
        {/* month label row */}
        <div className="mb-1 ml-8 flex text-[10px] text-muted">
          {monthLabels.map((m, i) => (
            <div key={i} className="w-[14px] shrink-0">
              {m}
            </div>
          ))}
        </div>
        {DAYS.map((day, row) => (
          <div key={day} className="mb-[2px] flex items-center" role="row">
            <div className="w-8 shrink-0 text-[10px] text-muted">{day}</div>
            <div className="flex" role="row" aria-label={day}>
              {weeks.map((w) => {
                const cellKey = addDays(w, row);
                const count = entryCountForDay(entries, cellKey);
                const level = heatmapLevel(count, habit);
                return (
                  <div key={cellKey} role="cell" className="h-[14px] w-[14px] p-[1px]">
                    <div
                      className={"h-full w-full rounded-[3px] " + levelClass(level)}
                      title={cellKey}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
