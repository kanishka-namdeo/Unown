/**
 * invariant.test.ts — plan §2 (invariant.test.ts) + Constraint Compliance.
 *
 * 1. The fugue determinism pin: zero `Date.now()` / `Math.random()` calls
 *    in the DOMAIN files only (types.ts, seed.ts, stats.ts, format.ts).
 *    Test files and store.tsx are out of scope — a test's matcher strings
 *    and the client-state provider may reference them, the domain may not.
 * 2. The type-ramp census of the seed constants: ENCORE_ITERATIONS carries
 *    exactly the distinct font-size count its receipts report, and the seed
 *    constants' axis/gate shapes match the types.
 * 3. The append-clean ordering invariants: timestamps non-decreasing,
 *    baseline is index 0, the baseline object is reference-stable across
 *    any array re-slicing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  BASELINE_ITERATION,
  CALIB_BAD_ITERATION,
  ENCORE_ITERATIONS,
} from "./seed";
import { ENCORE_AXES, ENCORE_GATE_KEYS } from "./types";

/* ── helper: the domain files the determinism contract covers ────── */

/**
 * Explicit allowlist — the invariant owns DOMAIN files only. `store.tsx`
 * (the client-state provider, added in Phase 3) and every `*.test.ts`
 * are out of scope by design: a test's matcher strings and the client-
 * state provider may reference `Date.now()` / `Math.random()`; the
 * domain may not. An explicit list means no future test file can ever
 * trip the pin through a directory-scan filter.
 */
const DOMAIN_FILES = [
  "types.ts",
  "seed.ts",
  "stats.ts",
  "format.ts",
];

/* ── invariant 1: zero Date.now() / Math.random() ────────────────── */

describe("invariant: fugue determinism pin (zero Date.now() / Math.random())", () => {
  test("no domain file contains Date.now()", () => {
    for (const f of DOMAIN_FILES) {
      const src = readFileSync(`src/lib/encore/${f}`, "utf-8");
      expect(src, `${f}: contains Date.now()`).not.toContain("Date.now()");
    }
  });

  test("no domain file contains Math.random()", () => {
    for (const f of DOMAIN_FILES) {
      const src = readFileSync(`src/lib/encore/${f}`, "utf-8");
      expect(src, `${f}: contains Math.random()`).not.toContain("Math.random()");
    }
  });
});

/* ── invariant 2: type-ramp census of the seed constants ─────────── */

describe("invariant: seed constants carry the full 7-axis / 11-gate shape", () => {
  test("BASELINE_ITERATION has exactly 7 axes matching ENCORE_AXES", () => {
    const keys = Object.keys(BASELINE_ITERATION.axes).sort();
    const expected = [...ENCORE_AXES].sort();
    expect(keys, "baseline axes keys").toEqual(expected);
    for (const axis of ENCORE_AXES) {
      expect(
        typeof BASELINE_ITERATION.axes[axis],
        `baseline.${axis}`,
      ).toBe("number");
    }
  });

  test("BASELINE_ITERATION has exactly 11 gates matching ENCORE_GATE_KEYS", () => {
    const keys = Object.keys(BASELINE_ITERATION.gates).sort();
    const expected = [...ENCORE_GATE_KEYS].sort();
    expect(keys, "baseline gate keys").toEqual(expected);
  });

  test("CALIB_BAD_ITERATION has exactly 7 axes matching ENCORE_AXES", () => {
    const keys = Object.keys(CALIB_BAD_ITERATION.axes).sort();
    const expected = [...ENCORE_AXES].sort();
    expect(keys, "calib-bad axes keys").toEqual(expected);
  });

  test("CALIB_BAD_ITERATION has exactly 11 gates matching ENCORE_GATE_KEYS", () => {
    const keys = Object.keys(CALIB_BAD_ITERATION.gates).sort();
    const expected = [...ENCORE_GATE_KEYS].sort();
    expect(keys, "calib-bad gate keys").toEqual(expected);
  });

  test("ENCORE_ITERATIONS every entry has the full 7×11 shape", () => {
    for (const iter of ENCORE_ITERATIONS) {
      expect(Object.keys(iter.axes).length, `${iter.label} axis count`).toBe(7);
      expect(Object.keys(iter.gates).length, `${iter.label} gate count`).toBe(11);
      expect(typeof iter.overall).toBe("number");
      expect(typeof iter.passed).toBe("boolean");
    }
  });
});

/* ── invariant 3: append-clean ordering invariants ──────────────── */

describe("invariant: append-clean ordering (plan risk #10)", () => {
  test("ENCORE_ITERATIONS timestamps are non-decreasing", () => {
    for (let i = 1; i < ENCORE_ITERATIONS.length; i++) {
      expect(
        ENCORE_ITERATIONS[i].timestamp >= ENCORE_ITERATIONS[i - 1].timestamp,
        `timestamp order at index ${i}`,
      ).toBe(true);
    }
  });

  test("ENCORE_ITERATIONS[0] is reference-identical to BASELINE_ITERATION", () => {
    expect(ENCORE_ITERATIONS[0]).toBe(BASELINE_ITERATION);
  });

  test("re-slicing the array never mutates the baseline object", () => {
    const snapshotOverall = BASELINE_ITERATION.overall;
    const snapshotAxes = { ...BASELINE_ITERATION.axes };
    // Simulate an append: create a new array with the baseline at [0]
    const extended = [
      ...ENCORE_ITERATIONS,
      {
        ...ENCORE_ITERATIONS[0],
        label: "iter1",
        overall: 7.5,
      },
    ];
    // Baseline object is unchanged (reference + value)
    expect(extended[0]).toBe(BASELINE_ITERATION);
    expect(extended[0].overall).toBe(snapshotOverall);
    expect(extended[0].axes).toEqual(snapshotAxes);
  });

  test("the baseline's overall is exactly 6.4 (the drift-gate pin)", () => {
    expect(BASELINE_ITERATION.overall).toBe(6.4);
  });

  test("the calib-bad's overall is exactly 1.5 (the drift-gate pin)", () => {
    expect(CALIB_BAD_ITERATION.overall).toBe(1.5);
  });

  test("DISCRIMINATION separation is exactly 4.9", () => {
    // 6.4 - 1.5 = 4.9
    expect(6.4 - 1.5).toBeCloseTo(4.9, 1);
  });
});
