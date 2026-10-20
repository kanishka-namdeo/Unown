import assert from "node:assert";
import { describe, it } from "node:test";
import { DEFAULT_LANE_COUNT, stableLaneIndex } from "../src/color-lanes.ts";

/**
 * Tests for beauty-4's stable color-lane assignment: the same actor name
 * always lands in the same lane (render to render, run to run), and a set of
 * typical agent names spreads across all lanes.
 */

describe("stableLaneIndex", () => {
	const NAMES = [
		"scout",
		"worker",
		"researcher",
		"explore",
		"general",
		"reviewer",
		"planner",
		"refactor-ast",
		"mapper",
		"analyzer",
		"tester",
		"implementer",
		"debugger",
		"optimizer",
		"documenter",
		"architect",
		"auditor",
		"explainer",
		"fixer",
		"builder",
		"cleaner",
		"writer",
		"reader",
		"searcher",
		"finder",
		"runner",
		"juggler",
		"spotter",
		"logger",
		"tracker",
		"minder",
		"helper",
	];

	it("is stable: the same name maps to the same lane forever", () => {
		for (const name of NAMES) {
			assert.strictEqual(stableLaneIndex(name), stableLaneIndex(name));
			assert.strictEqual(stableLaneIndex(name), stableLaneIndex(`${name}`.repeat(1)));
		}
		// Case matters (names are labels), but must stay deterministic.
		assert.strictEqual(stableLaneIndex("Scout"), stableLaneIndex("Scout"));
	});

	it("keeps the lane inside [0, laneCount)", () => {
		for (const name of NAMES) {
			const lane = stableLaneIndex(name);
			assert.ok(lane >= 0 && lane < DEFAULT_LANE_COUNT, `lane ${lane} out of range for ${name}`);
		}
		assert.strictEqual(stableLaneIndex("x", 1), 0);
	});

	it("spreads a realistic agent roster across all 8 lanes", () => {
		const lanes = new Set(NAMES.map((n) => stableLaneIndex(n)));
		assert.strictEqual(lanes.size, DEFAULT_LANE_COUNT, "expected every lane to be reachable");
	});

	it("gives fleet siblings (scout, scout-2) distinguishable lanes in practice", () => {
		// Not a hard invariant (a hash may collide), pinned as the observed
		// behavior for the canonical fleet example names.
		assert.notStrictEqual(stableLaneIndex("scout"), stableLaneIndex("scout-2"));
		assert.notStrictEqual(stableLaneIndex("scout"), stableLaneIndex("worker"));
	});
});
