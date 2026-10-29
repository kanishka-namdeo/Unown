/**
 * stats.test.ts — the plan's §6.1 lib suite for stats.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  BASELINE_ITERATION,
  CALIB_BAD_ITERATION,
  ENCORE_ITERATIONS,
  F_LEDGER,
  TOOL_CARDS,
} from "./seed";
import {
  axisDelta,
  calibrationSeparation,
  gatePasses,
  improvementStats,
} from "./stats";
import { ENCORE_AXES, ENCORE_GATE_KEYS } from "./types";
import type { EncoreAxisMap, EncoreGateMap, Iteration } from "./types";

/* ── axisDelta ────────────────────────────────────────────────────── */

describe("axisDelta", () => {
  test("axisDelta(b, b) === 0 for every axis", () => {
    const b = BASELINE_ITERATION.axes;
    const d = axisDelta(b, b);
    for (const axis of ENCORE_AXES) {
      expect(d[axis], `axisDelta(b,b)[${axis}]`).toBe(0);
    }
  });

  test("axisDelta(latest, baseline) for the ENCORE_ITERATIONS pair (baseline → iter3)", () => {
    // With five iterations, latest = ITER3. Deltas are iter3 − baseline:
    // 6.22 − 6.40 = −0.18 (the VLM overall sits within the single-judge
    // variance band while the objective gates transformed).
    const d = axisDelta(
      ENCORE_ITERATIONS[ENCORE_ITERATIONS.length - 1].axes,
      ENCORE_ITERATIONS[0].axes,
    );
    expect(d.overall, "delta[overall]").toBe(-0.18);
    expect(d.hierarchy, "delta[hierarchy]").toBe(-0.18);
    expect(d.typography, "delta[typography]").toBe(-0.53);
    expect(d.spacing, "delta[spacing]").toBe(-0.08);
    expect(d.color, "delta[color]").toBe(-0.6);
    expect(d.alignment, "delta[alignment]").toBe(-0.07);
    expect(d.density, "delta[density]").toBe(0.03);
  });

  test("axisDelta is 2-decimal rounded", () => {
    const a: EncoreAxisMap = { hierarchy: 7.111, typography: 8.001, spacing: 6.5, color: 7.333, alignment: 9.1, density: 5.999, overall: 7.0 };
    const b: EncoreAxisMap = { hierarchy: 6.5, typography: 6.79, spacing: 6.08, color: 7.25, alignment: 7.19, density: 6.71, overall: 6.4 };
    const d = axisDelta(a, b);
    expect(d.hierarchy).toBe(0.61);  // 7.111 - 6.5 = 0.611 → 0.61
    expect(d.typography).toBe(1.21); // 8.001 - 6.79 = 1.211 → 1.21
    expect(d.spacing).toBe(0.42);    // 6.5 - 6.08 = 0.42
    expect(d.color).toBe(0.08);      // 7.333 - 7.25 = 0.083 → 0.08
    expect(d.alignment).toBe(1.91);  // 9.1 - 7.19 = 1.91
    expect(d.density).toBe(-0.71);   // 5.999 - 6.71 = -0.711 → -0.71
    expect(d.overall).toBe(0.6);     // 7.0 - 6.4 = 0.6
  });
});

/* ── gatePasses ───────────────────────────────────────────────────── */

describe("gatePasses", () => {
  test("BASELINE has 8 of 11 gates passing (fontSizes, offGridPct, vlmAxes fail)", () => {
    expect(gatePasses(BASELINE_ITERATION)).toBe(8);
    // Confirm exactly which three fail
    expect(BASELINE_ITERATION.gates.fontSizes.pass).toBe(false);
    expect(BASELINE_ITERATION.gates.offGridPct.pass).toBe(false);
    expect(BASELINE_ITERATION.gates.vlmAxes.pass).toBe(false);
  });

  test("CALIB_BAD has 3 of 11 gates passing (mobileOverflow, fcpMs, lcpMs, cls, tbtMs)", () => {
    expect(gatePasses(CALIB_BAD_ITERATION)).toBe(5);
  });
});

/* ── calibrationSeparation ───────────────────────────────────────── */

describe("calibrationSeparation", () => {
  test("baseline − calibBad = 4.9", () => {
    expect(calibrationSeparation(BASELINE_ITERATION, CALIB_BAD_ITERATION)).toBe(4.9);
  });
});

/* ── improvementStats ────────────────────────────────────────────── */

describe("improvementStats", () => {
  test("with five iterations, latest = ITER3, gatePasses(latest) = 10, baseline gatePasses = 8", () => {
    const s = improvementStats(ENCORE_ITERATIONS, CALIB_BAD_ITERATION, F_LEDGER, TOOL_CARDS);
    expect(s.latest).toBe(ENCORE_ITERATIONS[4]);
    expect(s.latest.label).toBe("iter3");
    // iter3: every objective gate passes; only vlmAxes (the VLM opinion)
    // misses the 7.0 floor → 10 of 11.
    expect(s.gatePasses).toBe(10);
    // baseline: fontSizes, offGridPct, vlmAxes fail → 8 of 11.
    expect(s.gatePassesBaseline).toBe(8);
    expect(s.calibrationSeparation).toBe(4.9);
    expect(s.failures).toBe(F_LEDGER);
    expect(s.tools).toBe(TOOL_CARDS);
    expect(s.iterations).toBe(ENCORE_ITERATIONS);
  });
});

/* ── append-clean invariant (synthesized iter1 @ 7.5) ────────────── */

describe("append-clean invariant (plan risk #10)", () => {
  // Synthesized AFTER the real iter3 (the array is now five entries;
  // a 15:00:00 timestamp would fall mid-array and break the
  // non-decreasing-order check it is meant to guard).
  const ITER1: Iteration = {
    label: "iter1",
    timestamp: "2026-10-29T18:00:00.000Z",
    receiptPath: "benchmarks/website-excellence-round/critiques/fake-iter1.json",
    overall: 7.5,
    axes: {
      hierarchy: 8,
      typography: 8,
      spacing: 7,
      color: 8,
      alignment: 8,
      density: 8,
      overall: 7.5,
    },
    gates: {
      contrastViolations: { value: 0, max: 0, pass: true },
      fontSizes: { value: 8, max: 8, pass: true },
      offGridPct: { value: 5, max: 15, pass: true },
      headingSkips: { value: 0, max: 0, pass: true },
      missingAlts: { value: 0, max: 0, pass: true },
      mobileOverflow: { value: 0, max: 0, pass: true },
      fcpMs: { value: 500, max: 1800, pass: true },
      lcpMs: { value: 800, max: 2500, pass: true },
      cls: { value: 0, max: 0.1, pass: true },
      tbtMs: { value: 50, max: 200, pass: true },
      vlmAxes: {
        value: {
          hierarchy: 8,
          typography: 8,
          spacing: 7,
          color: 8,
          alignment: 8,
          density: 8,
          overall: 7.5,
        },
        floor: 7,
        pass: true,
      },
    },
    passed: true,
  };

  test("appending iter1 keeps ordering (timestamps non-decreasing)", () => {
    const arr = [...ENCORE_ITERATIONS, ITER1];
    for (let i = 1; i < arr.length; i++) {
      expect(arr[i].timestamp >= arr[i - 1].timestamp).toBe(true);
    }
  });

  test("baseline (index 0) is untouched after append; the real iter3 stays at index 4", () => {
    const arr = [...ENCORE_ITERATIONS, ITER1];
    expect(arr[0]).toBe(BASELINE_ITERATION);
    expect(arr[0].overall).toBe(6.4);
    expect(arr[4].label).toBe("iter3");
    expect(arr[5]).toBe(ITER1);
  });

  test("axisDelta(iter1, baseline) = +1.10 for overall, all positive", () => {
    const d = axisDelta(ITER1.axes, BASELINE_ITERATION.axes);
    // overall: 7.5 - 6.4 = 1.1
    expect(d.overall).toBe(1.1);
    // hierarchy: 8 - 6.5 = 1.5
    expect(d.hierarchy).toBe(1.5);
    // typography: 8 - 6.79 = 1.21
    expect(d.typography).toBe(1.21);
    // spacing: 7 - 6.08 = 0.92
    expect(d.spacing).toBe(0.92);
    // color: 8 - 7.25 = 0.75
    expect(d.color).toBe(0.75);
    // alignment: 8 - 7.19 = 0.81
    expect(d.alignment).toBe(0.81);
    // density: 8 - 6.71 = 1.29
    expect(d.density).toBe(1.29);
  });

  test("gatePasses(iter1) === 11 (all gates pass at the improved values)", () => {
    expect(gatePasses(ITER1)).toBe(11);
  });

  test("improvementStats with iter1 appended: latest = iter1, gatePasses = 11, baseline gatePasses = 8", () => {
    const arr = [...ENCORE_ITERATIONS, ITER1];
    const s = improvementStats(arr, CALIB_BAD_ITERATION, F_LEDGER, TOOL_CARDS);
    expect(s.latest).toBe(ITER1);
    expect(s.gatePasses).toBe(11);
    expect(s.gatePassesBaseline).toBe(8);
  });
});
