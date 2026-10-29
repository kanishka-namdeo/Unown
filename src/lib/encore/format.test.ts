/**
 * format.test.ts — plan §6.1 (format.ts helpers).
 */

import { describe, expect, test } from "bun:test";
import { axisLabel, delta, gateStatus, pct, score } from "./format";
import { ENCORE_AXES } from "./types";
import type { EncoreAxis, EncoreGate } from "./types";

/* ── pct ──────────────────────────────────────────────────────────── */

describe("pct", () => {
  test("pct(32.7) === '32.7%'", () => {
    expect(pct(32.7)).toBe("32.7%");
  });
  test("pct(100) === '100%'", () => {
    expect(pct(100)).toBe("100%");
  });
  test("pct(0) === '0%'", () => {
    expect(pct(0)).toBe("0%");
  });
  test("pct(15) === '15%'", () => {
    expect(pct(15)).toBe("15%");
  });
  test("pct(0.1) === '0.1%'", () => {
    expect(pct(0.1)).toBe("0.1%");
  });
});

/* ── score ────────────────────────────────────────────────────────── */

describe("score", () => {
  test("score(6.4) === '6.40'", () => {
    expect(score(6.4)).toBe("6.40");
  });
  test("score(1.5) === '1.50'", () => {
    expect(score(1.5)).toBe("1.50");
  });
  test("score(10) === '10.00'", () => {
    expect(score(10)).toBe("10.00");
  });
  test("score(0) === '0.00'", () => {
    expect(score(0)).toBe("0.00");
  });
});

/* ── delta ────────────────────────────────────────────────────────── */

describe("delta", () => {
  test("delta(-3.9) === '−3.90' (Unicode minus)", () => {
    expect(delta(-3.9)).toBe("\u22123.90");
  });
  test("delta(1.2) === '+1.20'", () => {
    expect(delta(1.2)).toBe("+1.20");
  });
  test("delta(0) === '0.00'", () => {
    expect(delta(0)).toBe("0.00");
  });
  test("delta(4.9) === '+4.90'", () => {
    expect(delta(4.9)).toBe("+4.90");
  });
});

/* ── gateStatus ───────────────────────────────────────────────────── */

describe("gateStatus", () => {
  const PASS: EncoreGate = { value: 0, max: 0, pass: true };
  const FAIL: EncoreGate = { value: 23, max: 8, pass: false };
  const UNDER: EncoreGate = {
    value: {
      hierarchy: 6.5,
      typography: 6.79,
      spacing: 6.08,
      color: 7.25,
      alignment: 7.19,
      density: 6.71,
      overall: 6.4,
    },
    floor: 7,
    pass: false,
    failures: ["hierarchy 6.5<7"],
  };

  test("pass gate → 'PASS'", () => {
    expect(gateStatus(PASS)).toBe("PASS");
  });
  test("objective fail gate → 'FAIL'", () => {
    expect(gateStatus(FAIL)).toBe("FAIL");
  });
  test("vlmAxes floor gate → 'UNDER'", () => {
    expect(gateStatus(UNDER)).toBe("UNDER");
  });
});

/* ── axisLabel ────────────────────────────────────────────────────── */

describe("axisLabel", () => {
  test("hierarchy → 'HIERARCHY'", () => {
    expect(axisLabel("hierarchy")).toBe("HIERARCHY");
  });
  test("typography → 'TYPOGRAPHY'", () => {
    expect(axisLabel("typography")).toBe("TYPOGRAPHY");
  });
  test("spacing → 'SPACING'", () => {
    expect(axisLabel("spacing")).toBe("SPACING");
  });
  test("color → 'COLOR'", () => {
    expect(axisLabel("color")).toBe("COLOR");
  });
  test("alignment → 'ALIGNMENT'", () => {
    expect(axisLabel("alignment")).toBe("ALIGNMENT");
  });
  test("density → 'DENSITY'", () => {
    expect(axisLabel("density")).toBe("DENSITY");
  });
  test("overall → 'OVERALL'", () => {
    expect(axisLabel("overall")).toBe("OVERALL");
  });
  test("all 7 axes have distinct labels", () => {
    const labels = ENCORE_AXES.map((a) => axisLabel(a));
    expect(new Set(labels).size).toBe(7);
  });
});
