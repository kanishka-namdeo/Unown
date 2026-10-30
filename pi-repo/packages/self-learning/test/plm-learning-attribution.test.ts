/**
 * plm-learning-attribution.test.ts — the learning ledger: every claimed
 * improvement carries its proof chain, retention is only ever set by an
 * observed rerun, regression checks record their outcome, and the analytics
 * stay receipts-only (nulls when unmeasured).
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import {
	attributeLearning,
	getAttribution,
	learningAnalytics,
	listAttributions,
	markRegression,
	markRetained,
} from "../src/plm/learning-attribution.ts";

describe("attributeLearning", () => {
	test("writes the full proof chain", () => {
		const id = attributeLearning({
			failure: "spec detection missed the context limit",
			improvement: "learned spec from the upstream 400 (learned provenance)",
			improvementId: "imp-1",
			tool: "models verify",
			benchmark: "task:spec-gate",
			scoreBefore: "0/1",
			scoreAfter: "1/1",
			measuredGain: "+1 task",
		});
		expect(id).toBeGreaterThan(0);
		const row = getAttribution(id)!;
		expect(row.failure).toContain("spec detection");
		expect(row.improvement).toContain("learned spec");
		expect(row.improvement_id).toBe("imp-1");
		expect(row.benchmark).toBe("task:spec-gate");
		expect(row.score_before).toBe("0/1");
		expect(row.score_after).toBe("1/1");
		expect(row.measured_gain).toBe("+1 task");
		expect(row.retained).toBeNull(); // never guessed
		expect(row.regression_check).toBe("pending");
	});
	test("minimal input still lands (improvement is the only required field)", () => {
		const id = attributeLearning({ improvement: "memory rule: always run typecheck" });
		const row = getAttribution(id)!;
		expect(row.failure).toBeNull();
		expect(row.benchmark).toBeNull();
	});
});

describe("retention + regression", () => {
	test("markRetained sets the verdict + evidence", () => {
		const id = attributeLearning({ improvement: "retention candidate" });
		expect(markRetained(id, true, "survived rerun on 2026-10-31")).toBe(true);
		const row = getAttribution(id)!;
		expect(row.retained).toBe(1);
		expect(row.regression_check).toContain("survived rerun");
	});
	test("a failed retention reads as a regression", () => {
		const id = attributeLearning({ improvement: "doomed patch" });
		markRetained(id, false, "regressed on cycle 47 — auto-unshipped");
		expect(getAttribution(id)!.retained).toBe(0);
	});
	test("markRegression records its outcome without touching retention", () => {
		const id = attributeLearning({ improvement: "checked patch" });
		markRegression(id, "pass", "sweep green");
		const row = getAttribution(id)!;
		expect(row.regression_check).toContain("pass");
		expect(row.retained).toBeNull();
	});
	test("unknown ids refuse honestly", () => {
		expect(markRetained(999999, true, "x")).toBe(false);
		expect(markRegression(999999, "pass")).toBe(false);
	});
});

describe("learningAnalytics", () => {
	test("counts totals, retention and the skills/memory joins", () => {
		const analytics = learningAnalytics();
		expect(analytics.total).toBeGreaterThanOrEqual(4);
		expect(analytics.retained).toBeGreaterThanOrEqual(1);
		expect(analytics.regressions).toBeGreaterThanOrEqual(1);
		expect(analytics.pending).toBeGreaterThanOrEqual(1);
		expect(analytics.retentionRate).not.toBeNull();
		expect(analytics.recent.length).toBeGreaterThan(0);
		// skills + memory joins read the real tables (may be zero on a fresh DB —
		// but the fields exist and are numbers).
		expect(typeof analytics.skills.shipped).toBe("number");
		expect(typeof analytics.memoryVersions).toBe("number");
	});
	test("listAttributions is newest-first", () => {
		const list = listAttributions(50);
		for (let i = 1; i < list.length; i++) {
			expect(list[i]!.ts).toBeLessThanOrEqual(list[i - 1]!.ts);
		}
	});
});
