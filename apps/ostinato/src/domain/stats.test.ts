/**
 * Stats tests — R-1 review log aggregation (the heatmap's domain half).
 *
 * Pure-function pins for `reviewsPerDay`: the injected-clock contract
 * (no `Date.now()`), zero-filled windows, day-level counting on the
 * `reviewedAt` prefix, window-boundary semantics, and purity
 * (input log never mutated).
 *
 * All tests are DOM-free and run green in both Lane A and Lane B.
 */
import { test, expect } from "bun:test";
import type { ReviewEvent } from "./types.js";
import { reviewsPerDay } from "./stats.js";

function event(
  id: string,
  cardId: string,
  deckId: string,
  grade: 1 | 2 | 3 | 4,
  reviewedAt: string,
): ReviewEvent {
  return { id, cardId, deckId, grade, reviewedAt };
}

test("stats: zero-filled window — no reviews → every day count 0", () => {
  const out = reviewsPerDay([], 5, "2026-11-04");
  expect(out).toEqual([
    { date: "2026-10-31", count: 0 },
    { date: "2026-11-01", count: 0 },
    { date: "2026-11-02", count: 0 },
    { date: "2026-11-03", count: 0 },
    { date: "2026-11-04", count: 0 },
  ]);
});

test("stats: counts land on the reviewedAt day, not today", () => {
  const reviews = [event("r1", "c1", "d1", 3, "2026-11-02T09:00:00Z")];
  const out = reviewsPerDay(reviews, 5, "2026-11-04");
  const byDate = new Map(out.map((e) => [e.date, e.count]));
  expect(byDate.get("2026-11-02")).toBe(1);
  expect(byDate.get("2026-11-04")).toBe(0);
});

test("stats: window boundary — today inclusive, the day before the window dropped", () => {
  const inside = event("r1", "c1", "d1", 4, "2026-11-04T23:59:00Z");
  const outside = event("r2", "c1", "d1", 1, "2026-10-30T00:00:00Z");
  const out = reviewsPerDay([inside, outside], 5, "2026-11-04");
  const byDate = new Map(out.map((e) => [e.date, e.count]));
  // The window is 10-31 … 11-04; 10-30 is the day before the window.
  expect(byDate.get("2026-11-04")).toBe(1);
  expect(byDate.get("2026-10-30")).toBeUndefined();
  expect(out).toHaveLength(5);
});

test("stats: windowDays=1 degenerates to a single entry (today)", () => {
  const reviews = [event("r1", "c1", "d1", 2, "2026-11-04T00:00:00Z")];
  const out = reviewsPerDay(reviews, 1, "2026-11-04");
  expect(out).toEqual([{ date: "2026-11-04", count: 1 }]);
});

test("stats: multiple reviews on the same day aggregate", () => {
  const a = event("r1", "c1", "d1", 3, "2026-11-03T08:00:00Z");
  const b = event("r2", "c2", "d1", 1, "2026-11-03T09:30:00Z");
  const c = event("r3", "c3", "d2", 4, "2026-11-03T21:00:00Z");
  const out = reviewsPerDay([a, b, c], 3, "2026-11-04");
  expect(out).toEqual([
    { date: "2026-11-02", count: 0 },
    { date: "2026-11-03", count: 3 },
    { date: "2026-11-04", count: 0 },
  ]);
});

test("stats: purity — the input array is never mutated", () => {
  const original = [
    event("r1", "c1", "d1", 3, "2026-11-02T00:00:00Z"),
    event("r2", "c2", "d1", 2, "2026-11-03T00:00:00Z"),
  ];
  const snapshot = JSON.stringify(original);
  const lenBefore = original.length;
  reviewsPerDay(original, 3, "2026-11-04");
  expect(original.length).toBe(lenBefore);
  expect(JSON.stringify(original)).toBe(snapshot);
});
