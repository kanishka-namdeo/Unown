import { describe, expect, test } from "bun:test";
import {
  bestDayOfWeek,
  cadenceStats,
  last30Rate,
  last7Rate,
  toWeeklyBars,
  totalCheckoffs,
} from "./stats";
import type { Habit } from "./types";

const daily: Habit = {
  id: "d",
  name: "Daily",
  glyph: "d",
  frequency: { kind: "daily" },
  createdAt: "2025-01-01",
};
const weekly3: Habit = {
  id: "w3",
  name: "W3",
  glyph: "w",
  frequency: { kind: "weekly", target: 3 },
  createdAt: "2025-01-01",
};

const ENTRIES: Record<string, string[]> = {
  d: ["2026-04-15", "2026-04-14", "2026-04-10"],
  w3: ["2026-04-13"],
};
const END = "2026-04-15"; // Wednesday

describe("completion rates at fixed dates", () => {
  test("last7Rate counts distinct active days in the trailing 7 days", () => {
    const r = last7Rate(ENTRIES, END);
    expect(r.total).toBe(7);
    // active days within 2026-04-09..2026-04-15: 04-15, 04-14, 04-13, 04-10 = 4
    expect(r.done).toBe(4);
    expect(r.percent).toBe(Math.round((4 / 7) * 1000) / 10);
  });

  test("last30Rate over the trailing 30 days", () => {
    const r = last30Rate(ENTRIES, END);
    expect(r.total).toBe(30);
    expect(r.done).toBe(4); // same four days, all inside 30
    expect(r.percent).toBe(Math.round((4 / 30) * 1000) / 10);
  });

  test("empty entries → zero rate, no NaN", () => {
    expect(last7Rate({}, END)).toEqual({ percent: 0, done: 0, total: 7 });
    expect(last30Rate({}, END)).toEqual({ percent: 0, done: 0, total: 30 });
  });
});

describe("bestDayOfWeek", () => {
  test("picks the day with the most checkoffs", () => {
    const entries = {
      d: ["2026-04-15", "2026-04-15", "2026-04-15"], // 2026-04-15 is Wednesday (3)
      w: ["2026-04-13", "2026-04-14"], // Monday (1), Tuesday (1)
    };
    const best = bestDayOfWeek(entries);
    expect(best).not.toBeNull();
    expect(best!.dayIndex).toBe(3); // Wednesday
    expect(best!.count).toBe(3);
  });

  test("null when there is no activity", () => {
    expect(bestDayOfWeek({})).toBeNull();
    expect(bestDayOfWeek({ d: [] })).toBeNull();
  });
});

describe("totalCheckoffs", () => {
  test("sums all entry lists", () => {
    expect(totalCheckoffs(ENTRIES)).toBe(4);
    expect(totalCheckoffs({})).toBe(0);
  });
});

describe("toWeeklyBars", () => {
  test("yields 52 bars by default, ending at asOf's ISO week", () => {
    const bars = toWeeklyBars(ENTRIES, [daily, weekly3], END);
    expect(bars).toHaveLength(52);
    expect(bars[51].weekStart).toBe("2026-04-13"); // current week Monday
    expect(bars[50].weekStart).toBe("2026-04-06"); // prior week Monday
  });

  test("attributes entries to their ISO week", () => {
    const bars = toWeeklyBars(ENTRIES, [daily, weekly3], END);
    const current = bars[51];
    // 3 checkoffs fall in the current week (04-15, 04-14, 04-13); 04-10 lands
    // in the prior week (bars[50]).
    expect(current.count).toBe(3);
    expect(bars[50].count).toBe(1);
  });

  test("zero-activity week has count 0", () => {
    const bars = toWeeklyBars({ d: ["2026-04-15"] }, [daily], END);
    // an earlier week with no entries
    const zero = bars[40]; // well inside the 52-week span, no entries there
    expect(zero.count).toBe(0);
  });

  test("target is the sum of habits' daily shares, one decimal", () => {
    const bars = toWeeklyBars(ENTRIES, [daily, weekly3], END);
    // daily = 7/7 = 1.0/week, weekly3 = 3/7 ≈ 0.428/week → 1.428 → 1.4
    expect(bars[0].target).toBe(1.4);
  });

  test("explicit weeks param shrinks the grid", () => {
    const bars = toWeeklyBars(ENTRIES, [daily], END, 4);
    expect(bars).toHaveLength(4);
    expect(bars[3].weekStart).toBe("2026-04-13");
  });
});

describe("cadenceStats", () => {
  test("combines totals, rates and best day", () => {
    const s = cadenceStats(ENTRIES, [daily, weekly3], END);
    expect(s.totalCheckoffs).toBe(4);
    expect(s.last7.total).toBe(7);
    expect(s.last30.total).toBe(30);
    expect(s.bestDay).not.toBeNull();
    expect(s.bestDay!.dayIndex).toBe(1); // first-seen max wins the tie → Monday
    expect(s.bestDay!.count).toBe(1);
  });

  test("empty state → zero totals, null best day", () => {
    const s = cadenceStats({}, [daily], END);
    expect(s.totalCheckoffs).toBe(0);
    expect(s.bestDay).toBeNull();
    expect(s.last7.percent).toBe(0);
  });
});
