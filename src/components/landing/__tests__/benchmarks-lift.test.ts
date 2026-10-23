import { describe, expect, test } from "bun:test";
import { SELFIMPROVE } from "../benchmarks-data";
import { COLD_BAR_W, LIFT_SCALE } from "../benchmarks";

/**
 * The memory-lift chart's derived domain. The axis used to be typed at 125%
 * and the agnes-3.0-flash receipt's warm run (+197.1% of its cold run)
 * rendered at 237.7% of the track — an unclipped absolutely-positioned bar
 * painting across the token label, the panel border and the page. These tests
 * pin the derivation and the no-spill invariant so no future receipt can
 * break the chart again.
 */
describe("the memory-lift chart's derived domain", () => {
  test("the axis always runs past the cold baseline", () => {
    expect(LIFT_SCALE).toBeGreaterThanOrEqual(125);
  });

  test("the axis is the smallest 25-multiple that covers the biggest warm share", () => {
    const biggestWarmShare = Math.max(
      ...SELFIMPROVE.map((r) => (r.warmIn / r.coldIn) * 100),
    );
    expect(LIFT_SCALE).toBe(
      Math.max(125, Math.ceil(biggestWarmShare / 25) * 25),
    );
  });

  test("the cold bar and the baseline tick share one width", () => {
    // COLD_BAR_W is both the cold bars' width and the tick's position — the
    // tick marks where 100%-of-cold ends, so the two are the same number.
    expect(COLD_BAR_W).toBe((100 / LIFT_SCALE) * 100);
    expect(COLD_BAR_W).toBeLessThanOrEqual(100);
  });

  test("every bar stays inside the track — the spill regression", () => {
    // The tiny tolerance only absorbs float noise at an exact boundary
    // (a warm run at exactly the axis top renders the full track); anything
    // visibly past it fails here before it can paint past the panel.
    for (const r of SELFIMPROVE) {
      expect((r.warmIn / r.coldIn) * COLD_BAR_W).toBeLessThanOrEqual(
        100 + 1e-9,
      );
    }
  });
});
