import assert from "node:assert";
import { describe, it } from "node:test";
import { shimmerWeights } from "../src/shimmer.ts";

/**
 * Tests for beauty-4's pure gradient-step function: a raised-cosine band of
 * light whose per-character weights (in [0, 1]) a consumer maps onto colors per
 * terminal capability. The phase is caller-owned (the working line steps it on
 * the loader's existing 1s tick lane) — the function itself must be
 * deterministic, wrap its phase, and never pump brightness as the band travels.
 */

const closeTo = (actual: number, expected: number, tol = 1e-9) =>
	assert.ok(Math.abs(actual - expected) <= tol, `expected ${actual} ≈ ${expected} (±${tol})`);

describe("shimmerWeights (the pure gradient-step function)", () => {
	it("returns one weight per character, empty for empty labels", () => {
		assert.deepStrictEqual(shimmerWeights(0, 0), []);
		assert.deepStrictEqual(shimmerWeights(7, -3), []);
		const weights = shimmerWeights(4, 12);
		assert.strictEqual(weights.length, 12);
		for (const w of weights) assert.ok(w >= 0 && w <= 1, `weight ${w} outside [0,1]`);
	});

	it("is deterministic: the same phase and length always paint the same band", () => {
		for (let phase = 0; phase < 24; phase++) {
			assert.deepStrictEqual(shimmerWeights(phase, 17), shimmerWeights(phase, 17));
		}
	});

	it("starts the band at the left edge at phase 0: char 0 is fully lit", () => {
		const weights = shimmerWeights(0, 20);
		closeTo(weights[0], 1);
		// …and the band decays to dark within its 0.35 width.
		assert.ok(weights[8] < 0.01, `char 8 should be unlit, got ${weights[8]}`);
	});

	it("travels right as the phase advances (the sweep direction)", () => {
		let lastPeak = -1;
		for (let phase = 0; phase < 12; phase++) {
			const weights = shimmerWeights(phase, 40);
			const peak = weights.indexOf(Math.max(...weights));
			assert.ok(peak > lastPeak, `peak moved backwards: ${peak} after ${lastPeak}`);
			lastPeak = peak;
		}
	});

	it("wraps the phase: phase p === phase p + period, and negatives wrap forward", () => {
		for (let phase = 0; phase < 12; phase++) {
			assert.deepStrictEqual(shimmerWeights(phase, 15), shimmerWeights(phase + 12, 15));
			assert.deepStrictEqual(shimmerWeights(phase + 36, 15), shimmerWeights(phase, 15));
		}
		assert.deepStrictEqual(shimmerWeights(-1, 9), shimmerWeights(11, 9));
		assert.deepStrictEqual(shimmerWeights(-13, 9), shimmerWeights(11, 9));
	});

	it("never pumps brightness: the total lit amount is constant across phases", () => {
		// Raised-cosine energy: sum(weights) ≈ len * width / 2, every phase —
		// the sweep moves light around instead of flashing the whole label.
		const len = 40;
		const sums = Array.from({ length: 12 }, (_, p) => shimmerWeights(p, len).reduce((a, b) => a + b, 0));
		for (const sum of sums) closeTo(sum, (len * 0.35) / 2, 0.05);
		// Small labels discretize the band; only require the no-pump property.
		for (const small of [3, 8, 17]) {
			const smallSums = Array.from({ length: 12 }, (_, p) => shimmerWeights(p, small).reduce((a, b) => a + b, 0));
			const spread = Math.max(...smallSums) - Math.min(...smallSums);
			assert.ok(spread < 1.0, `len ${small}: totals spread ${spread}`);
		}
	});

	it("honours custom period and band width", () => {
		const narrow = shimmerWeights(0, 30, { period: 12, width: 0.1 });
		const wide = shimmerWeights(0, 30, { period: 12, width: 0.6 });
		const narrowLit = narrow.filter((w) => w > 0).length;
		const wideLit = wide.filter((w) => w > 0).length;
		assert.ok(narrowLit < wideLit, `wider band should light more chars (${narrowLit} vs ${wideLit})`);
		assert.ok(narrowLit <= 4, `narrow band should light ≤ 4 of 30 chars, got ${narrowLit}`);
		// A custom period wraps at its own length.
		assert.deepStrictEqual(shimmerWeights(2, 10, { period: 5 }), shimmerWeights(7, 10, { period: 5 }));
	});

	it("degrades unsafe options to the defaults (period 12, width 0.35)", () => {
		assert.deepStrictEqual(
			shimmerWeights(-3, 5, { period: 0, width: 2 }),
			shimmerWeights(9, 5), // -3 wraps forward to phase 9 of the default period
		);
		assert.deepStrictEqual(shimmerWeights(4, 5, { width: 0 }), shimmerWeights(4, 5));
	});
});
