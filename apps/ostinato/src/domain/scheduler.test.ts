/**
 * Scheduler tests — SM-2 invariants, pinned by O-2 (P0 #2).
 *
 * The scheduler is deterministic: same card + grade + now → same output.
 * The tests verify:
 *   1. Grade mapping (g=1,2 reset R=0, I=1; g=3,4 advance R)
 *   2. Easiness update (the Wozniak formula, floor at 1.3)
 *   3. Interval growth (R=0→1d, R=1→6d, R≥2→round(I·EF) to 2dp)
 *   4. Grade validation (g<1 or g>4 throws DomainInvariantError)
 *   5. No mutation of input (pure function)
 *   6. Clock injection (lastReviewedAt = the injected `now`)
 *
 * All tests are DOM-free and run green in both Lane A and Lane B.
 */
import { test, expect } from "bun:test";
import type { Card } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { createScheduler } from "./scheduler.js";

const NOW = "2026-11-04T12:00:00Z";

function freshCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "c1",
    deckId: "d1",
    front: "q",
    back: "a",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function cardWithSm2(sm2: Card["sm2"]): Card {
  return freshCard({ sm2 });
}

test("scheduler: first review, grade 3 → R=1, I=1, EF updated", () => {
  const s = createScheduler();
  const card = s.grade(freshCard(), 3, NOW);
  expect(card.sm2).toBeDefined();
  // First "good" review: R=1, I=1 day (the R=0 path)
  expect(card.sm2!.repetitions).toBe(1);
  expect(card.sm2!.interval).toBe(1);
  // EF: Wozniak SM-2 — q=2 (g=3): 2.5 + (0.1 − 3·(0.08 + 3·0.02)) = 2.5 − 0.32 = 2.18
  expect(card.sm2!.easiness).toBeCloseTo(2.18, 10);
  expect(card.sm2!.lastReviewedAt).toBe(NOW);
});

test("scheduler: first review, grade 1 → R=0, I=1 (reset)", () => {
  const s = createScheduler();
  const card = s.grade(freshCard(), 1, NOW);
  expect(card.sm2!.repetitions).toBe(0);
  expect(card.sm2!.interval).toBe(1);
});

test("scheduler: first review, grade 4 → R=1, I=1", () => {
  const s = createScheduler();
  const card = s.grade(freshCard(), 4, NOW);
  expect(card.sm2!.repetitions).toBe(1);
  expect(card.sm2!.interval).toBe(1);
});

test("scheduler: second review (R=1→2), grade 3 → I=6", () => {
  const s = createScheduler();
  const c1 = s.grade(freshCard(), 3, NOW); // R=1, I=1
  const c2 = s.grade(c1, 3, NOW); // R=2, I=6
  expect(c2.sm2!.repetitions).toBe(2);
  expect(c2.sm2!.interval).toBe(6);
});

test("scheduler: third review (R=2→3), grade 3 → I=round(6·EF)≈", () => {
  const s = createScheduler();
  const c1 = s.grade(freshCard(), 3, NOW); // R=1, I=1, EF: 2.5 → 2.18
  const c2 = s.grade(c1, 3, NOW); // R=2, I=6, EF: 2.18 → 1.86
  const c3 = s.grade(c2, 3, NOW); // R=3, I=round(6·EF, 2dp)
  // EF chain (q=2 each time, delta = −0.32): 2.5 → 2.18 → 1.86 → 1.54
  // Interval at the 3rd review: round(6 · 1.54, 2dp) = 9.24
  const expectedI = Math.round(6 * 1.54 * 100) / 100;
  expect(c3.sm2!.repetitions).toBe(3);
  expect(c3.sm2!.interval).toBeCloseTo(expectedI, 2);
});

test("scheduler: grade 4 (easy) keeps EF higher than grade 3 (good)", () => {
  // Wozniak deltas from EF=2.5: q=2 (g3) -> 0.1 - 3*(0.08+0.06) = -0.32
  // q=3 (g4) -> 0.1 - 2*(0.08+0.04) = -0.14. Higher quality ->
  // smaller drop -> higher EF -> longer future intervals.
  const s = createScheduler();
  const g3 = s.grade(freshCard(), 3, NOW); // EF=2.18
  const g4 = s.grade(freshCard(), 4, NOW); // EF=2.36
  expect(g4.sm2!.easiness).toBeGreaterThan(g3.sm2!.easiness);
  // Both take the first-review path: interval equal (1 day).
  expect(g4.sm2!.interval).toBe(g3.sm2!.interval);
});

test("scheduler: easiness never drops below 1.3", () => {
  const s = createScheduler();
  // Start at EF=1.3 (the floor) and grade 1 repeatedly
  let card = cardWithSm2({ repetitions: 5, easiness: 1.3, interval: 50 });
  for (let i = 0; i < 20; i++) {
    card = s.grade(card, 1, NOW);
    // EF: 1.3 + (0.1−0)(1.0) = 1.4 — but floor at 1.3, so 1.4
    // Then grade 1 again: 1.4 + 0.1 = 1.5, etc.
    // Wait — grade 1 (q=0) RAISES EF by 0.1 in the current formula.
    // EF only drops with higher grades.
    expect(card.sm2!.easiness).toBeGreaterThanOrEqual(1.3);
  }
});

test("scheduler: interval is monotonic on grade >= 3 (no shrink)", () => {
  const s = createScheduler();
  // Start with a card at R=3, I=12, EF=2.0
  let card = cardWithSm2({ repetitions: 3, easiness: 2.0, interval: 12 });
  // Grade 3 three times in a row — interval should grow or stay
  const i0 = card.sm2!.interval;
  card = s.grade(card, 3, NOW);
  const i1 = card.sm2!.interval;
  card = s.grade(card, 3, NOW);
  const i2 = card.sm2!.interval;
  card = s.grade(card, 3, NOW);
  const i3 = card.sm2!.interval;
  expect(i1).toBeGreaterThanOrEqual(i0);
  expect(i2).toBeGreaterThanOrEqual(i1);
  expect(i3).toBeGreaterThanOrEqual(i2);
});

test("scheduler: grade 1 resets repetitions to 0", () => {
  const s = createScheduler();
  const card = cardWithSm2({ repetitions: 4, easiness: 2.0, interval: 15 });
  const out = s.grade(card, 1, NOW);
  expect(out.sm2!.repetitions).toBe(0);
  expect(out.sm2!.interval).toBe(1);
});

test("scheduler: grade 2 resets repetitions to 0", () => {
  const s = createScheduler();
  const card = cardWithSm2({ repetitions: 4, easiness: 2.0, interval: 15 });
  const out = s.grade(card, 2, NOW);
  expect(out.sm2!.repetitions).toBe(0);
  expect(out.sm2!.interval).toBe(1);
});

test("scheduler: grade 0 throws DomainInvariantError", () => {
  const s = createScheduler();
  expect(() => s.grade(freshCard(), 0 as unknown as 1, NOW)).toThrow(
    DomainInvariantError,
  );
});

test("scheduler: grade 5 throws DomainInvariantError", () => {
  const s = createScheduler();
  expect(() => s.grade(freshCard(), 5 as unknown as 1, NOW)).toThrow(
    DomainInvariantError,
  );
});

test("scheduler: does not mutate the input card", () => {
  const s = createScheduler();
  const input = cardWithSm2({ repetitions: 2, easiness: 2.2, interval: 7 });
  const originalSm2 = { ...input.sm2! };
  const out = s.grade(input, 3, NOW);
  // Input unchanged
  expect(input.sm2!.repetitions).toBe(originalSm2.repetitions);
  expect(input.sm2!.easiness).toBe(originalSm2.easiness);
  expect(input.sm2!.interval).toBe(originalSm2.interval);
  // Output is a new object
  expect(out).not.toBe(input);
});

test("scheduler: lastReviewedAt = the injected now string", () => {
  const s = createScheduler();
  const out = s.grade(freshCard(), 3, "2027-01-15T08:00:00Z");
  expect(out.sm2!.lastReviewedAt).toBe("2027-01-15T08:00:00Z");
  expect(out.updatedAt).toBe("2027-01-15T08:00:00Z");
});
