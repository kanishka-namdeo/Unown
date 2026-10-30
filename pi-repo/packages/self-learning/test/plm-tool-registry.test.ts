/**
 * plm-tool-registry.test.ts — the tool lifecycle: invocation recording
 * (engine + terminal lanes), the per-tool stats math (success rate, p95,
 * retry load, failure classes), underperforming-tool recommendations, and
 * the untrusted-input ingestion of POST /api/tools/report batches.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import {
	deriveToolRecommendations,
	deriveToolStats,
	ingestToolReport,
	listToolInvocations,
	recordToolInvocation,
	toolCategory,
	toolSummary,
} from "../src/plm/tool-registry.ts";

describe("toolCategory", () => {
	test("the known tools map to their category", () => {
		expect(toolCategory("read")).toBe("read");
		expect(toolCategory("edit")).toBe("write");
		expect(toolCategory("bash")).toBe("exec");
		expect(toolCategory("web_search")).toBe("net");
		expect(toolCategory("task")).toBe("agent");
		expect(toolCategory("note")).toBe("learn");
		expect(toolCategory("ask_user_question")).toBe("gov");
	});
	test("unknown tools read as other", () => {
		expect(toolCategory("teleport")).toBe("other");
	});
});

describe("deriveToolStats (pure math)", () => {
	test("empty rows produce zeros and null durations", () => {
		const stats = deriveToolStats({ tool: "bash", category: "exec", rows: [] });
		expect(stats.invocations).toBe(0);
		expect(stats.successRate).toBe(0);
		expect(stats.avgDurationMs).toBeNull();
		expect(stats.p95DurationMs).toBeNull();
	});
	test("success rate, averages and lanes aggregate correctly", () => {
		const rows = [
			{ success: 1, duration_ms: 100, retry_count: 0, failure_type: null, ts: 1, lane: "engine" },
			{ success: 1, duration_ms: 300, retry_count: 0, failure_type: null, ts: 2, lane: "engine" },
			{ success: 0, duration_ms: 200, retry_count: 1, failure_type: "model", ts: 3, lane: "terminal" },
		];
		const stats = deriveToolStats({ tool: "bash", category: "exec", rows });
		expect(stats.invocations).toBe(3);
		expect(stats.successRate).toBeCloseTo(2 / 3);
		expect(stats.avgDurationMs).toBe(200);
		expect(stats.lanes).toEqual({ engine: 2, terminal: 1 });
		expect(stats.failureClasses).toEqual([{ type: "model", count: 1 }]);
		expect(stats.retries).toBe(1);
	});
	test("p95 uses the sorted distribution", () => {
		const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000];
		const rows = durations.map((d, i) => ({
			success: 1,
			duration_ms: d,
			retry_count: 0,
			failure_type: null,
			ts: i,
			lane: "engine",
		}));
		const stats = deriveToolStats({ tool: "x", category: "other", rows });
		expect(stats.p95DurationMs).toBe(1000);
	});
});

describe("deriveToolRecommendations (underperforming detection)", () => {
	test("a low success rate with enough samples is flagged high/medium", () => {
		const failing = deriveToolStats({
			tool: "browser",
			category: "net",
			rows: Array.from({ length: 10 }, (_, i) => ({
				success: i < 5 ? 1 : 0,
				duration_ms: 100,
				retry_count: 0,
				failure_type: "dependency",
				ts: i,
				lane: "engine",
			})),
		});
		const recs = deriveToolRecommendations([failing]);
		expect(recs.length).toBeGreaterThan(0);
		expect(recs[0]?.severity).toBe("high");
		expect(recs[0]?.finding).toContain("browser");
		expect(recs[0]?.recommendation.length).toBeGreaterThan(10);
	});
	test("too few samples never flags (honest floor)", () => {
		const small = deriveToolStats({
			tool: "bash",
			category: "exec",
			rows: [
				{ success: 0, duration_ms: 1, retry_count: 0, failure_type: "tool", ts: 1, lane: "engine" },
				{ success: 0, duration_ms: 1, retry_count: 0, failure_type: "tool", ts: 2, lane: "engine" },
			],
		});
		expect(deriveToolRecommendations([small])).toEqual([]);
	});
	test("retry storms flag medium", () => {
		const stormy = deriveToolStats({
			tool: "webfetch",
			category: "net",
			rows: Array.from({ length: 10 }, () => ({
				success: 1,
				duration_ms: 10,
				retry_count: 2,
				failure_type: null,
				ts: 1,
				lane: "engine",
			})),
		});
		const recs = deriveToolRecommendations([stormy]);
		expect(recs.some((r) => r.severity === "medium" && r.finding.includes("retry"))).toBe(true);
	});
});

describe("recordToolInvocation (store lane)", () => {
	test("a success and a failure land with category + failure class", () => {
		recordToolInvocation({
			tool: "edit",
			success: true,
			durationMs: 12,
			purpose: "patch file",
			argsBytes: 40,
			outputBytes: 20,
		});
		const id = recordToolInvocation({ tool: "bash", success: false, durationMs: 99, error: "rate limit hit (429)" });
		expect(id).toBeGreaterThan(0);
		const recent = listToolInvocations(10);
		const bashRow = recent.find((r) => r.tool === "bash");
		const editRow = recent.find((r) => r.tool === "edit");
		expect(bashRow?.success).toBe(0);
		expect(bashRow?.failure_type).toBe("model"); // 429/rate-limit marker
		expect(editRow?.category).toBe("write");
		expect(editRow?.purpose).toBe("patch file");
	});
	test("the summary totals roll up across tools", () => {
		recordToolInvocation({ tool: "read", success: true, durationMs: 5 });
		const summary = toolSummary("all");
		expect(summary.totals.invocations).toBeGreaterThanOrEqual(3); // the two above + this one
		expect(summary.totals.successRate).toBeGreaterThan(0);
		expect(summary.tools.length).toBeGreaterThan(0);
		expect(summary.totals.byCategory.some((c) => c.category === "exec")).toBe(true);
	});
});

describe("ingestToolReport (untrusted input)", () => {
	test("a valid batch writes terminal-lane rows", () => {
		const written = ingestToolReport(
			[
				{ tool: "edit", success: true, durationMs: 10, sessionId: "s1", projectSlug: "demo" },
				{ tool: "bash", success: false, error: "enoent spawn", durationMs: 3 },
			],
			"fallback-session",
			"fallback-slug",
		);
		expect(written).toBe(2);
		const rows = listToolInvocations(10);
		const terminal = rows.filter((r) => r.lane === "terminal");
		expect(terminal.some((r) => r.session_id === "s1" && r.tool === "edit")).toBe(true);
		expect(terminal.some((r) => r.tool === "bash" && r.failure_type === "infrastructure")).toBe(true);
	});
	test("garbage items are skipped, never crash the batch", () => {
		const written = ingestToolReport([
			{ tool: "" },
			{ tool: "read" },
			42,
			null,
			{ tool: "x".repeat(200), success: true },
		] as unknown[]);
		expect(written).toBe(2);
	});
	test("non-array bodies write zero rows", () => {
		expect(ingestToolReport({ tool: "read" })).toBe(0);
		expect(ingestToolReport("nope")).toBe(0);
	});
	test("future timestamps are clamped to now, negatives to zero duration", () => {
		ingestToolReport([{ tool: "read", success: true, ts: Date.now() + 10_000_000, durationMs: -50 }]);
		const row = listToolInvocations(1)[0];
		expect(row.ts).toBeLessThanOrEqual(Date.now() + 60_000);
	});
});
