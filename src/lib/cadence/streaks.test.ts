import { describe, expect, test } from "bun:test";
import {
  bestStreak,
  currentStreak,
  daysBefore,
  heatmapLevel,
  isoWeekStart,
  isoWeekStarts,
  isOnTrack,
  weeklyTarget,
} from "./streaks";
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

describe("currentStreak", () => {
  test("consecutive days ending at asOf", () => {
    const entries = [
      "2026-04-15",
      "2026-04-14",
      "2026-04-13",
      "2026-04-12",
      "2026-04-11",
      "2026-04-08", // gap at 04-10
    ];
    expect(currentStreak(daily, entries, "2026-04-15")).toBe(5);
  });

  test("gap resets — stale asOf with no nearby activity is 0", () => {
    const entries = ["2026-04-01"];
    expect(currentStreak(daily, entries, "2026-04-15")).toBe(0);
  });

  test("stays alive when asOf empty but asOf-1 active", () => {
    const entries = ["2026-04-14", "2026-04-13"];
    expect(currentStreak(daily, entries, "2026-04-15")).toBe(2);
  });

  test("empty entries → 0", () => {
    expect(currentStreak(daily, [], "2026-04-15")).toBe(0);
  });
});

describe("bestStreak", () => {
  test("finds the longest consecutive run", () => {
    expect(
      bestStreak(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-05", "2026-01-06"]),
    ).toBe(3);
  });

  test("single entry → 1, empty → 0", () => {
    expect(bestStreak(["2026-01-01"])).toBe(1);
    expect(bestStreak([])).toBe(0);
  });
});

describe("isOnTrack", () => {
  test("weekly target 3 met when ≥3 entries in current ISO week", () => {
    // 2026-01-05 is a Monday; the week runs 05–11.
    const met = ["2026-01-05", "2026-01-07", "2026-01-09"];
    expect(isOnTrack(weekly3, met, "2026-01-08")).toBe(true);
    const notMet = ["2026-01-05", "2026-01-07"];
    expect(isOnTrack(weekly3, notMet, "2026-01-08")).toBe(false);
  });

  test("weekly counts entries only within the current ISO week", () => {
    // 2026-01-15 (Thursday) is in the week starting Mon 2026-01-12.
    const entries = ["2026-01-12", "2026-01-14", "2026-01-05", "2026-01-07"];
    // only 2 in the 01-12..01-18 week → target 3 not met
    expect(isOnTrack(weekly3, entries, "2026-01-15")).toBe(false);
    const entries2 = ["2026-01-12", "2026-01-14", "2026-01-16", "2026-01-05"];
    expect(isOnTrack(weekly3, entries2, "2026-01-15")).toBe(true);
  });

  test("daily on track when asOf or asOf-1 active", () => {
    expect(isOnTrack(daily, ["2026-04-14"], "2026-04-15")).toBe(true);
    expect(isOnTrack(daily, ["2026-04-13"], "2026-04-15")).toBe(false);
  });
});

describe("heatmapLevel (0–4 buckets)", () => {
  test("0 when no entries", () => {
    expect(heatmapLevel(0, daily)).toBe(0);
  });

  test("daily habit: 1 entry maxes to 4", () => {
    expect(heatmapLevel(1, daily)).toBe(4);
  });

  test("weekly target-3 habit: counts scale against daily share", () => {
    // daily share = 3/7 ≈ 0.43; one entry is well over the share
    expect(heatmapLevel(1, weekly3)).toBeGreaterThanOrEqual(1);
    expect(heatmapLevel(0, weekly3)).toBe(0);
  });

  test("bucket is monotone in count", () => {
    const levels = [0, 1, 2, 3, 4].map((c) => heatmapLevel(c, daily));
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBe(4);
  });
});

describe("isoWeekStart + isoWeekStarts", () => {
  test("Jan-1 boundary: 2026-01-01 (Thursday) → week starts Mon 2025-12-29", () => {
    expect(isoWeekStart("2026-01-01")).toBe("2025-12-29");
  });

  test("leap-year asOf: 2024-02-29 (Thursday) → week starts Mon 2024-02-26", () => {
    expect(isoWeekStart("2024-02-29")).toBe("2024-02-26");
  });

  test("mid-week asOf: 2026-04-15 (Wednesday) → Mon 2026-04-13", () => {
    expect(isoWeekStart("2026-04-15")).toBe("2026-04-13");
  });

  test("Sunday belongs to the week that started the prior Monday", () => {
    // 2026-04-19 is a Sunday; its ISO week starts Mon 2026-04-13
    expect(isoWeekStart("2026-04-19")).toBe("2026-04-13");
  });

  test("isoWeekStarts returns 52 Mondays ending at asOf's week", () => {
    const starts = isoWeekStarts(52, "2026-04-15");
    expect(starts).toHaveLength(52);
    expect(starts[51]).toBe("2026-04-13"); // current week Monday
    expect(starts[50]).toBe("2026-04-06"); // prior week Monday
    // all are Mondays
    for (const s of starts) {
      expect(new Date(s + "T00:00:00Z").getUTCDay()).toBe(1);
    }
  });
});

describe("helpers", () => {
  test("daysBefore walks back n days", () => {
    expect(daysBefore("2026-04-15", 0)).toBe("2026-04-15");
    expect(daysBefore("2026-04-15", 1)).toBe("2026-04-14");
    expect(daysBefore("2026-01-01", 3)).toBe("2025-12-29");
  });

  test("weeklyTarget: daily → 7, weekly → target", () => {
    expect(weeklyTarget(daily)).toBe(7);
    expect(weeklyTarget(weekly3)).toBe(3);
  });
});
