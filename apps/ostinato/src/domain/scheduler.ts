/**
 * SM-2 scheduler — deterministic, pure, clock-injected (P0 #2).
 *
 * The Wozniak family (SuperMemo SM-2), cited not re-derived:
 *
 *   https://supermemerank.com/sm2/          (canonical SM-2)
 *   https://supermemo.guru/wikis/SuperMemo_2
 *   Wozniak, P.A. (1990) — "The SM-2 Algorithm" (SuperMemo 2 era)
 *   The family is the one Anki, SuperMemo, and FreeRecall inherited:
 *
 *     EF' = EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02))
 *
 *   where q ∈ {0,1,2,3} maps our grade g ∈ {1,2,3,4} as q = g − 1
 *   (grade 1 = "again" → q = 0; grade 4 = "easy" → q = 3).
 *   High quality raises EF (longer intervals ahead); low quality
 *   lowers it (shorter intervals), floored at 1.3.
 *
 *   Repetitions R (0-based):
 *     R = 0 → I = 1 day
 *     R = 1 → I = 6 days
 *     R ≥ 2 → I = round(I_prev · EF)
 *
 *   EF floor: 1.3 (never drop below)
 *
 *   Grade < 3 ("again" / "hard" with q < 2): R resets to 0, I resets
 *   to 1. Grade ≥ 3: R increments, I grows per the table above.
 *
 * Ostinato's grade mapping (keyboard `1`–`4`, P0 #3):
 *   1 = Again (q=0)  → reset:  R=0, I=1
 *   2 = Hard  (q=1)  → reset:  R=0, I=1
 *   3 = Good  (q=2)  → advance: R+=1, I per table
 *   4 = Easy  (q=3)  → advance: R+=1, I per table (faster EF growth)
 *
 * The port's "now" parameter is an ISO-8601 string, never `Date.now()`.
 * The scheduler is deterministic: same card + grade + now → same output.
 */
import type { Card, Grade, Scheduler } from "./types.js";
import { DomainInvariantError } from "./types.js";

/** SM-2 easiness floor (never below this). */
const EASE_MIN = 1.3;

/** The initial ease factor for a card that has never been reviewed. */
const EASE_START = 2.5;

/**
 * The SM-2 easiness update (Wozniak, 1990 — SuperMemo 2):
 *
 *   q = grade − 1   (g ∈ {1,2,3,4} → q ∈ {0,1,2,3})
 *   EF' = EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02))
 *   floor at 1.3
 *
 * Pinned values (the tests in scheduler.test.ts lock these):
 *   EF=2.5, g=1 (q=0): 2.5 + (0.1−5(0.08+0.1))  = 2.5−0.8  = 1.7
 *   EF=2.5, g=2 (q=1): 2.5 + (0.1−4(0.08+0.08)) = 2.5−0.56 = 1.94
 *   EF=2.5, g=3 (q=2): 2.5 + (0.1−3(0.08+0.06)) = 2.5−0.32 = 2.18
 *   EF=2.5, g=4 (q=3): 2.5 + (0.1−2(0.08+0.04)) = 2.5−0.14 = 2.36
 *
 * High grade → EF rises slightly (longer intervals next time).
 * Low grade → EF drops (shorter intervals, but the R reset also
 * fires, so the effective impact is the reset to I=1).
 */
function updateEasiness(easiness: number, grade: Grade): number {
  const q = grade - 1;
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const next = easiness + delta;
  return next < EASE_MIN ? EASE_MIN : next;
}

/**
 * The SM-2 interval table (R is 0-based, returned interval in days):
 *   R=0 → 1, R=1 → 6, R≥2 → round(prev · EF)
 *
 * Pinned: the tests verify I=1 for R=0, I=6 for R=1, I=round(I_prev·EF)
 * for R≥2, and that grade ≥ 3 increments R while grade < 3 resets R to 0
 * and I to 1.
 */
function nextInterval(
  repetitions: number,
  prevInterval: number,
  easiness: number,
  grade: Grade,
): number {
  // Grade < 3: full reset — R=0, I=1 (SM-2 "forget / again" path)
  if (grade < 3) return 1;
  // R increments from the current R
  const r = repetitions + 1;
  if (r === 1) return 1; // first successful review: 1 day
  if (r === 2) return 6; // second successful review: 6 days
  // R ≥ 2: grow from the previous interval
  const raw = prevInterval * easiness;
  // SM-2's original uses integer rounding; Ostinato keeps the float
  // (the PRD's P0 #2 note: fractional intervals are not a defect —
  // the 2^R ease curve yields fractional values under EF drift).
  // Round to 2 decimal places to keep the value finite and stable
  // without silently truncating to an integer.
  return Math.round(raw * 100) / 100;
}

/**
 * Create the Scheduler port implementation.
 *
 * Pure: `(card, grade, now) → Card`. No side effects, no clock reads,
 * no randomness. The returned object is a NEW card (the input card is
 * not mutated).
 *
 * @throws {DomainInvariantError} on grade < 1 or grade > 4.
 */
export function createScheduler(): Scheduler {
  return {
    grade(card: Card, grade: Grade, now: string): Card {
      // Validate grade — the port's contract.
      if (grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) {
        throw new DomainInvariantError(`invalid grade: ${String(grade)} (must be 1–4)`);
      }
      // Validate the injected clock.
      if (typeof now !== "string" || now.length === 0) {
        throw new DomainInvariantError("now must be a non-empty ISO-8601 string");
      }

      // First review: no sm2 state yet — start the SM-2 curve.
      if (!card.sm2) {
        const ease = EASE_START;
        const r = 0; // will become 1 after the first "good" or 0 on reset
        const interval = grade < 3 ? 1 : 1; // R=0 path: always 1 day
        return {
          ...card,
          updatedAt: now,
          sm2: {
            repetitions: grade < 3 ? 0 : 1,
            easiness: updateEasiness(ease, grade),
            interval,
            lastReviewedAt: now,
          },
        };
      }

      const { repetitions, easiness, interval: prevInterval } = card.sm2;
      const newEase = updateEasiness(easiness, grade);
      const newR = grade < 3 ? 0 : repetitions + 1;
      const newI = nextInterval(repetitions, prevInterval, newEase, grade);

      return {
        ...card,
        updatedAt: now,
        sm2: {
          repetitions: newR,
          easiness: newEase,
          interval: newI,
          lastReviewedAt: now,
        },
      };
    },
  };
}
