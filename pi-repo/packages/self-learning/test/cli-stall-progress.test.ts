/**
 * cli-stall-progress.test.ts — the print-mode stall-progress milestones
 * (the 2026-10 dogfood round): the pure stepper that ends the silent-stall
 * failure mode measured live against the Agnes upstream.
 */
import { describe, expect, test } from "bun:test";
import { nextStallMilestone, STALL_PROGRESS_FRACTIONS } from "../src/cli.ts";

describe("nextStallMilestone — the pure stepper", () => {
	test("nothing due before the first milestone", () => {
		expect(nextStallMilestone(0, 180_000, [])).toBeNull();
		expect(nextStallMilestone(89_999, 180_000, [])).toBeNull();
	});
	test("50% of a 180s budget due at 90s", () => {
		expect(nextStallMilestone(90_000, 180_000, [])).toBe(0.5);
	});
	test("milestones fire once each, in order, and never again", () => {
		expect(nextStallMilestone(180_000, 180_000, [])).toBe(0.5); // earliest due first
		expect(nextStallMilestone(180_000, 180_000, [0.5])).toBe(0.75);
		expect(nextStallMilestone(180_000, 180_000, [0.5, 0.75])).toBe(0.9);
		expect(nextStallMilestone(180_000, 180_000, [0.5, 0.75, 0.9])).toBeNull(); // all spent
	});
	test("the full window never re-emits (silence stays bounded)", () => {
		let emitted: number[] = [];
		// Simulate the 1s poll over a 180s window: count total lines.
		for (let t = 0; t <= 180_000; t += 1_000) {
			const next = nextStallMilestone(t, 180_000, emitted);
			if (next !== null) emitted = [...emitted, next];
		}
		expect(emitted).toEqual([...STALL_PROGRESS_FRACTIONS]);
	});
	test("a non-positive budget never emits", () => {
		expect(nextStallMilestone(1_000_000, 0, [])).toBeNull();
	});
});
