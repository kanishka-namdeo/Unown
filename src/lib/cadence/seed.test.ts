import { describe, expect, test } from "bun:test";
import { isSeededHabitId, seedCadence } from "./seed";

const NOW = new Date(2026, 6, 15); // 2026-07-15, fixed "today"

describe("seedCadence determinism", () => {
  test("two calls with the same clock deep-equal", () => {
    const a = seedCadence(NOW);
    const b = seedCadence(NOW);
    expect(a).toEqual(b);
  });

  test("a different clock shifts the window but stays deterministic", () => {
    const a = seedCadence(NOW);
    const b = seedCadence(NOW);
    const c = seedCadence(new Date(2026, 5, 15));
    expect(c).not.toEqual(a);
    expect(seedCadence(new Date(2026, 5, 15))).toEqual(c);
  });
});

describe("seedCadence shape", () => {
  test("six habits, each with a non-empty entry list", () => {
    const s = seedCadence(NOW);
    expect(s.habits).toHaveLength(6);
    for (const h of s.habits) {
      expect(Array.isArray(s.entries[h.id])).toBe(true);
      expect(s.entries[h.id].length).toBeGreaterThan(0);
      expect(isSeededHabitId(h.id)).toBe(true);
    }
  });

  test("habit ids are the closed seeded set", () => {
    for (const h of seedCadence(NOW).habits) expect(isSeededHabitId(h.id)).toBe(true);
    expect(isSeededHabitId("user-created")).toBe(false);
  });
});

describe("seedCadence no future dates", () => {
  test("no entry is ever after the asOf day key", () => {
    const s = seedCadence(NOW);
    const nowKey = "2026-07-15";
    for (const h of s.habits) {
      for (const d of s.entries[h.id]) {
        expect(d <= nowKey).toBe(true);
      }
    }
  });

  test("entries are day keys, not full timestamps", () => {
    const s = seedCadence(NOW);
    for (const h of s.habits) {
      for (const d of s.entries[h.id]) {
        expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });
});
