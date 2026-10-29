/**
 * Encore stats — pure aggregations over iterations (plan §2, §6.1).
 *
 * No wall-clock reads, no RNG, zero I/O. All functions take
 * explicit inputs; the seed constants come from `seed.ts`.
 */

import type {
  EncoreAxis,
  EncoreAxisMap,
  EncoreStats,
  Iteration,
} from "./types";
import { ENCORE_AXES, ENCORE_GATE_KEYS } from "./types";

/* ── rounding helper ──────────────────────────────────────────────── */

/** Round to 2 decimals (the plan's `2-decimal` pin). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── axisDelta ────────────────────────────────────────────────────── */

/**
 * Per-axis delta `a − b` (latest − baseline in the common case),
 * 2-decimal rounded. `a` is the "after", `b` is the "before".
 */
export function axisDelta(a: EncoreAxisMap, b: EncoreAxisMap): EncoreAxisMap {
  const out = {} as EncoreAxisMap;
  for (const axis of ENCORE_AXES) {
    out[axis] = round2(a[axis] - b[axis]);
  }
  return out;
}

/* ── gatePasses ───────────────────────────────────────────────────── */

/** Count of the 11 gates that pass for `iter`. */
export function gatePasses(iter: Iteration): number {
  let n = 0;
  for (const key of ENCORE_GATE_KEYS) {
    if (iter.gates[key].pass) n++;
  }
  return n;
}

/* ── calibrationSeparation ────────────────────────────────────────── */

/**
 * The known-bad fixture vs the baseline: `baseline.overall − calibBad.overall`.
 * Pin: 6.4 − 1.5 = 4.9 (2-decimal).
 */
export function calibrationSeparation(
  baseline: Iteration,
  calibBad: Iteration,
): number {
  return round2(baseline.overall - calibBad.overall);
}

/* ── improvementStats ─────────────────────────────────────────────── */

/**
 * Build the full `EncoreStats` object from a chronological iteration array.
 *
 * `iterations` must be non-empty; `latest` = the last element;
 * `baseline` = the first element (index 0). The calibration fixture is
 * NOT in `iterations` — it is a separate comparison, passed as `calibBad`.
 */
export function improvementStats(
  iterations: Iteration[],
  calibBad: Iteration,
  failures: EncoreStats["failures"],
  tools: EncoreStats["tools"],
): EncoreStats {
  if (iterations.length === 0) throw new Error("improvementStats: empty iterations");
  const baseline = iterations[0];
  const latest = iterations[iterations.length - 1];
  return {
    iterations,
    latest,
    axisDelta: axisDelta(latest.axes, baseline.axes),
    gatePasses: gatePasses(latest),
    gatePassesBaseline: gatePasses(baseline),
    calibrationSeparation: calibrationSeparation(baseline, calibBad),
    failures,
    tools,
  };
}
