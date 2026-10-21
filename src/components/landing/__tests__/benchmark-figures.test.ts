import { describe, expect, test } from "bun:test";
import { formatPct, runStamp } from "../benchmark-figures";

describe("benchmark figure rendering", () => {
  test("a receipt-backed figure keeps its one-decimal form", () => {
    expect(formatPct(93.9)).toEqual({ text: "93.9", missing: false });
    expect(formatPct(0)).toEqual({ text: "0.0", missing: false });
  });

  test("a figure with no receipt field is never printed as a number", () => {
    expect(formatPct(null)).toEqual({ text: "not measured", missing: true });
  });

  test("the run stamp follows the generated canonical run, not a typed date", () => {
    expect(runStamp("benchmarks/evalplus/results/rerun-2026-10-17")).toBe("2026-10-17 rerun");
    expect(runStamp("benchmarks/evalplus/results")).toBe("base receipt");
  });
});
