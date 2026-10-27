import { describe, expect, it } from "bun:test";
import type { Task } from "@/lib/sigil/types";
import {
  currentStreak,
  dayKeyOf,
  dayKeyNDaysAgo,
  dailyStats,
  focusMinutesPerDay,
  completedTasksPerDay,
  totals,
  toLocalDayKey,
} from "@/lib/sigil/stats";

function iso(d: Date): string {
  return d.toISOString();
}

function dateAt(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

const NOW = dateAt(2026, 4, 15);

describe("stats: completedTasksPerDay", () => {
  it("counts completions only on days within the window", () => {
    const tasks = [
      { completedAt: iso(NOW) }, // today
      { completedAt: iso(dateAt(2026, 4, 14)) }, // yesterday
      { completedAt: iso(dateAt(2026, 3, 1)) }, // outside 3-day window
      { completedAt: null },
    ];
    const rows = completedTasksPerDay(tasks, 3, NOW);
    expect(rows).toHaveLength(3);
    expect(rows[rows.length - 1].completedTasks).toBe(1);
    expect(rows[rows.length - 2].completedTasks).toBe(1);
    expect(rows[0].completedTasks).toBe(0);
  });

  it("returns zeroed rows for an empty window", () => {
    const rows = completedTasksPerDay([], 14, NOW);
    expect(rows).toHaveLength(14);
    expect(rows.every((r) => r.completedTasks === 0)).toBe(true);
  });
});

describe("stats: focusMinutesPerDay", () => {
  it("sums durations per day", () => {
    const log = [
      { startedAt: iso(NOW), durationMin: 25 },
      { startedAt: iso(NOW), durationMin: 15 },
      { startedAt: iso(dateAt(2026, 4, 13)), durationMin: 40 },
    ];
    const rows = focusMinutesPerDay(log, 7, NOW);
    expect(rows[rows.length - 1].focusMinutes).toBe(40);
    expect(rows[rows.length - 2].focusMinutes).toBe(0);
    expect(rows[rows.length - 3].focusMinutes).toBe(40);
  });
});

describe("stats: dailyStats merge", () => {
  it("combines completed tasks and focus minutes into one row set", () => {
    const tasks = [
      {
        id: "t1",
        title: "x",
        description: "",
        priority: "medium",
        labels: [],
        storyPoints: null,
        column: "done",
        createdAt: iso(NOW),
        updatedAt: iso(NOW),
        completedAt: iso(NOW),
        focusSessions: [],
      },
    ] as Task[];
    const log = [{ startedAt: iso(NOW), durationMin: 50 }];
    const rows = dailyStats(tasks, log, 14, NOW);
    expect(rows).toHaveLength(14);
    const last = rows[rows.length - 1];
    expect(last.completedTasks).toBe(1);
    expect(last.focusMinutes).toBe(50);
    expect(rows[0].completedTasks).toBe(0);
  });
});

describe("stats: currentStreak", () => {
  it("counts consecutive active days ending today", () => {
    const days = [
      iso(NOW),
      iso(dateAt(2026, 4, 14)),
      iso(dateAt(2026, 4, 13)),
      iso(dateAt(2026, 4, 12)),
      // gap on 2026-04-11
      iso(dateAt(2026, 4, 10)),
    ];
    expect(currentStreak(days, NOW)).toBe(4);
  });

  it("stays alive when today is inactive but yesterday was active", () => {
    const days = [iso(dateAt(2026, 4, 14)), iso(dateAt(2026, 4, 13))];
    expect(currentStreak(days, NOW)).toBe(2);
  });

  it("is zero when both today and yesterday are inactive", () => {
    const days = [iso(dateAt(2026, 4, 10))];
    expect(currentStreak(days, NOW)).toBe(0);
  });

  it("is zero for an empty history", () => {
    expect(currentStreak([], NOW)).toBe(0);
  });
});

describe("stats: day key helpers", () => {
  it("dayKeyOf maps ISO timestamps to local day keys", () => {
    const key = dayKeyOf(iso(NOW), NOW);
    expect(key).toBe(toLocalDayKey(NOW));
    expect(key).toBe(dayKeyNDaysAgo(0, NOW));
  });

  it("dayKeyNDaysAgo walks back day by day", () => {
    const keys = [0, 1, 2].map((i) => dayKeyNDaysAgo(i, NOW));
    expect(keys[0]).toBe("2026-04-15");
    expect(keys[1]).toBe("2026-04-14");
    expect(keys[2]).toBe("2026-04-13");
  });

  it("totals counts completed tasks and focus minutes all-time", () => {
    const tasks = [{ completedAt: iso(NOW) }, { completedAt: null }];
    const log = [
      { startedAt: iso(NOW), durationMin: 25 },
      { startedAt: iso(NOW), durationMin: 5 },
    ];
    expect(totals(tasks, log)).toEqual({ completed: 1, focusMinutes: 30 });
  });
});
