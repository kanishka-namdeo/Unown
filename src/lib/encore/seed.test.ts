/**
 * THE DRIFT GATE (plan §6.1).
 *
 * Reads the ACTUAL committed receipt JSONs from
 * `benchmarks/website-excellence-round/critiques/` at test time and asserts
 * every seed constant equals the parsed receipt — field by field (overall,
 * every axis, every gate value/pass, passed). A receipt edited under the
 * seed fails the suite; the test IS the gate.
 *
 * No module-load I/O — `fs` is called only inside the test bodies.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  BASELINE_ITERATION,
  CALIB_BAD_ITERATION,
  DISCRIMINATION,
  ENCORE_ITERATIONS,
  F_LEDGER,
  ITER0,
  ITER1,
  ITER2,
  ITER3,
  TOOL_CARDS,
  TIMELINE,
} from "./seed";
import { ENCORE_AXES, ENCORE_GATE_KEYS } from "./types";
import type { EncoreReceipt, Iteration } from "./types";

/* ── receipt-path helpers ────────────────────────────────────────── */

const CRITIQUES_DIR = "benchmarks/website-excellence-round/critiques";

function readReceipt(name: string): EncoreReceipt {
  const path = `${CRITIQUES_DIR}/${name}`;
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as EncoreReceipt;
}

function allReceipts(): EncoreReceipt[] {
  if (!existsSync(CRITIQUES_DIR)) {
    throw new Error(`critiques dir missing: ${CRITIQUES_DIR}`);
  }
  return readdirSync(CRITIQUES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readReceipt(f));
}

/* ── field-by-field comparison ───────────────────────────────────── */

function assertIterationEqualsReceipt(iter: Iteration, r: EncoreReceipt, label: string) {
  const ctx = `${label} (${r.label})`;

  // label + timestamp (from generatedAt) + passed
  expect(iter.label, `${ctx} label`).toBe(r.label);
  expect(iter.timestamp, `${ctx} timestamp`).toBe(r.generatedAt);
  expect(iter.passed, `${ctx} passed`).toBe(r.passed);
  expect(iter.overall, `${ctx} overall`).toBe(r.axisMeans.overall);

  // receiptPath points at the file that produced this iteration
  const expectedPath = `${CRITIQUES_DIR}/${r.label === "baseline" ? "20261029-145746-baseline-root.json" : r.label === "calib-bad" ? "20261029-145834-calib-bad-root.json" : "…"}`;
  if (r.label === "baseline" || r.label === "calib-bad") {
    expect(iter.receiptPath, `${ctx} receiptPath`).toBe(expectedPath);
  } else {
    // The critique-loop receipts (iter0–iter3) are committed under
    // their own names — assert the seed's receiptPath actually points
    // at a file in the critiques dir.
    expect(iter.receiptPath, `${ctx} receiptPath`).toContain(
      `${CRITIQUES_DIR}/`,
    );
  }

  // every axis
  for (const axis of ENCORE_AXES) {
    expect(iter.axes[axis], `${ctx} axis ${axis}`).toBe(r.axisMeans[axis]);
  }

  // every gate: value + pass (floor/max/failures are secondary — we pin value/pass)
  for (const key of ENCORE_GATE_KEYS) {
    const ig = iter.gates[key];
    const rg = r.gates[key];
    expect(ig.value, `${ctx} gate ${key} value`).toEqual(rg.value);
    expect(ig.pass, `${ctx} gate ${key} pass`).toBe(rg.pass);
  }
}

/* ── seed.test.ts: THE DRIFT GATE ────────────────────────────────── */

describe("seed.test.ts — THE DRIFT GATE (field-by-field against receipts)", () => {
  test("BASELINE_ITERATION equals 20261029-145746-baseline-root.json", () => {
    const r = readReceipt("20261029-145746-baseline-root.json");
    assertIterationEqualsReceipt(BASELINE_ITERATION, r, "BASELINE_ITERATION");
  });

  test("CALIB_BAD_ITERATION equals 20261029-145834-calib-bad-root.json", () => {
    const r = readReceipt("20261029-145834-calib-bad-root.json");
    assertIterationEqualsReceipt(CALIB_BAD_ITERATION, r, "CALIB_BAD_ITERATION");
  });

  test("ENCORE_ITERATIONS is baseline + iter0–iter3 (chronological, five entries)", () => {
    const receipts = allReceipts();
    // ENCORE_ITERATIONS tracks route-critique iterations: the landing
    // baseline (entry 0) + the critique loop's four encore receipts.
    // The calib-bad receipt is a calibration fixture (different URL,
    // different purpose) and lives in DISCRIMINATION, not in this
    // array. New landing-page receipts append: one constant + one
    // appended test (the gate grows, it does not rot).
    expect(ENCORE_ITERATIONS.length, "iteration count").toBe(5);
    expect(
      ENCORE_ITERATIONS.map((i) => i.label),
      "chronological labels",
    ).toEqual(["baseline", "iter0", "iter1", "iter2", "iter3"]);
    for (const iter of ENCORE_ITERATIONS) {
      const matching = receipts.find((r) => r.label === iter.label);
      expect(matching, `no receipt for iteration ${iter.label}`).toBeDefined();
      assertIterationEqualsReceipt(iter, matching!, "ENCORE_ITERATIONS");
    }
  });

  /* ── Phase 4: the critique loop's receipts (the gate grows) ────── */

  test("ITER0 equals 20261029-161216-iter0-encore.json (first both-scheme critique, overflow 42px FAIL)", () => {
    const r = readReceipt("20261029-161216-iter0-encore.json");
    expect(ITER0.receiptPath, "ITER0 receiptPath").toBe(
      `${CRITIQUES_DIR}/20261029-161216-iter0-encore.json`,
    );
    assertIterationEqualsReceipt(ITER0, r, "ITER0");
  });

  test("ITER1 equals 20261029-162927-iter1-encore.json (overall 6.0, overflow 42px still FAIL)", () => {
    const r = readReceipt("20261029-162927-iter1-encore.json");
    expect(ITER1.receiptPath, "ITER1 receiptPath").toBe(
      `${CRITIQUES_DIR}/20261029-162927-iter1-encore.json`,
    );
    assertIterationEqualsReceipt(ITER1, r, "ITER1");
  });

  test("ITER2 equals 20261029-165327-iter2-encore.json (overflow 0px PASS, 27 light-scheme contrast violations FAIL)", () => {
    const r = readReceipt("20261029-165327-iter2-encore.json");
    expect(ITER2.receiptPath, "ITER2 receiptPath").toBe(
      `${CRITIQUES_DIR}/20261029-165327-iter2-encore.json`,
    );
    assertIterationEqualsReceipt(ITER2, r, "ITER2");
  });

  test("ITER3 equals 20261029-170148-iter3-encore.json (all objective gates PASS)", () => {
    const r = readReceipt("20261029-170148-iter3-encore.json");
    expect(ITER3.receiptPath, "ITER3 receiptPath").toBe(
      `${CRITIQUES_DIR}/20261029-170148-iter3-encore.json`,
    );
    assertIterationEqualsReceipt(ITER3, r, "ITER3");
  });

  test("ITER3's objective gates all pass — only vlmAxes (the VLM opinion) misses the floor", () => {
    const r = readReceipt("20261029-170148-iter3-encore.json");
    for (const key of ENCORE_GATE_KEYS) {
      if (key === "vlmAxes") continue;
      expect(
        r.gates[key].pass,
        `iter3 gate ${key} (objective)`,
      ).toBe(true);
    }
    expect(r.gates.vlmAxes.pass, "iter3 vlmAxes").toBe(false);
  });

  test("DISCRIMINATION constants match the receipts", () => {
    const baseline = readReceipt("20261029-145746-baseline-root.json");
    const calibBad = readReceipt("20261029-145834-calib-bad-root.json");
    expect(DISCRIMINATION.baseline).toBe(baseline.axisMeans.overall);
    expect(DISCRIMINATION.calibBad).toBe(calibBad.axisMeans.overall);
    expect(DISCRIMINATION.separation).toBe(4.9);
  });
});

describe("F_LEDGER — the F-ledger entries (from the nocturne round)", () => {
  test("F10 is present with the correct facts", () => {
    const f10 = F_LEDGER.find((f) => f.code === "F10");
    expect(f10).toBeDefined();
    expect(f10!.what).toContain("page.tsx");
    expect(f10!.what).toContain("route.ts");
    expect(f10!.outcome).toContain("pre-push checklist");
    expect(f10!.fixRef).toContain("3c4cf87");
    expect(f10!.fixRef).toContain("docs/website-excellence-session.md");
  });

  test("F11 is present with the correct facts", () => {
    const f11 = F_LEDGER.find((f) => f.code === "F11");
    expect(f11).toBeDefined();
    expect(f11!.what).toContain("lint");
    expect(f11!.outcome).toContain("lint");
    expect(f11!.fixRef).toContain("89535c6");
    expect(f11!.fixRef).toContain("docs/website-excellence-session.md");
  });

  test("F_LEDGER has at least 2 entries (F10, F11)", () => {
    expect(F_LEDGER.length).toBeGreaterThanOrEqual(2);
    const codes = F_LEDGER.map((f) => f.code);
    expect(codes).toContain("F10");
    expect(codes).toContain("F11");
  });
});

describe("TOOL_CARDS — the tool card receipts", () => {
  test("design-critic card has the baseline receipt", () => {
    const dc = TOOL_CARDS.find((t) => t.id === "design-critic");
    expect(dc).toBeDefined();
    expect(dc!.receipt).toContain("benchmarks/website-excellence-round");
    expect(dc!.headline).toContain("6.40");
    expect(dc!.headline).toContain("FAIL");
  });

  test("calibration-fixture card has the calib-bad receipt + evidence", () => {
    const cf = TOOL_CARDS.find((t) => t.id === "calibration-fixture");
    expect(cf).toBeDefined();
    expect(cf!.receipt).toContain("calib-bad");
    expect(cf!.headline).toContain("4.9");
    expect(cf!.evidence.length).toBeGreaterThanOrEqual(1);
    // The evidence before/after values must be consistent with DISCRIMINATION
    const overall = cf!.evidence.find((e) => e.label === "overall");
    expect(overall).toBeDefined();
    expect(overall!.before).toBe(DISCRIMINATION.calibBad);
    expect(overall!.after).toBe(DISCRIMINATION.baseline);
  });
});

describe("TIMELINE — the story beats", () => {
  test("TIMELINE has 6 beats with explicit seq 0–5", () => {
    expect(TIMELINE).toHaveLength(6);
    for (let i = 0; i < TIMELINE.length; i++) {
      expect(TIMELINE[i].seq, `beat ${i} seq`).toBe(i);
    }
  });

  test("CP0 beat carries the baseline receipt", () => {
    const cp0 = TIMELINE.find((t) => t.beat === "CP0");
    expect(cp0?.receipt).toContain("20261029-145746-baseline-root.json");
  });

  test("CP4 beat carries the calib-bad receipt", () => {
    const cp4 = TIMELINE.find((t) => t.beat === "CP4");
    expect(cp4?.receipt).toContain("20261029-145834-calib-bad-root.json");
  });
});

describe("append-clean invariant (plan risk #10)", () => {
  test("ENCORE_ITERATIONS has five chronological entries (baseline + iter0–iter3)", () => {
    for (let i = 1; i < ENCORE_ITERATIONS.length; i++) {
      expect(
        ENCORE_ITERATIONS[i].timestamp >= ENCORE_ITERATIONS[i - 1].timestamp,
        `iteration ${i} out of order`,
      ).toBe(true);
    }
    expect(ENCORE_ITERATIONS.length).toBe(5);
  });

  test("BASELINE_ITERATION is ENCORE_ITERATIONS[0] (no re-count)", () => {
    expect(ENCORE_ITERATIONS[0]).toBe(BASELINE_ITERATION);
  });

  test("synthesized iter1 @ 7.5 keeps ordering + baseline untouched", () => {
    // Synthesize a fake iter1 appended to the array. Its timestamp must
    // land AFTER the real iter3 (2026-10-29T17:01:48.298Z) or the
    // appended array's ordering breaks — a 15:00:00 synthetic would
    // now fall mid-array.
    const iter1: Iteration = {
      label: "iter1",
      timestamp: "2026-10-29T18:00:00.000Z", // after all five committed receipts
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

    const withIter1 = [...ENCORE_ITERATIONS, iter1];

    // Ordering: timestamps still non-decreasing
    for (let i = 1; i < withIter1.length; i++) {
      expect(
        withIter1[i].timestamp >= withIter1[i - 1].timestamp,
      ).toBe(true);
    }

    // Baseline untouched
    expect(withIter1[0]).toBe(BASELINE_ITERATION);
    expect(withIter1[0].overall).toBe(6.4);

    // Latest is now iter1 (appended after the real iter3)
    expect(withIter1[withIter1.length - 1]).toBe(iter1);
    expect(withIter1[4].label, "the real iter3 stays at index 4").toBe("iter3");
  });

  test("appending a synthesized iter4 still keeps the baseline at [0] and the real iter3 at [4]", () => {
    const iter4: Iteration = {
      ...ITER3,
      label: "iter4",
      timestamp: "2026-10-29T18:00:00.000Z",
      receiptPath: "benchmarks/website-excellence-round/critiques/fake-iter4.json",
      overall: 7,
    };
    const extended = [...ENCORE_ITERATIONS, iter4];
    expect(extended[0]).toBe(BASELINE_ITERATION);
    expect(extended[0].overall).toBe(6.4);
    expect(extended[4]).toBe(ITER3);
    expect(extended[5]).toBe(iter4);
  });
});
