/**
 * plm-recovery-engine.test.ts — the recovery engine: failure classification
 * through the taxonomy, deterministic planning (root cause + action + next
 * step), the ledger lifecycle (planned → executed → validated / failed /
 * abandoned), the bounded attempt counter, job-outcome validation, and the
 * analytics the Recovery View renders.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import { classifyFailure, isRetryable, recoveryActionFor, rootCauseHint } from "../src/plm/failure-taxonomy.ts";
import {
	listRecoveryEvents,
	markAbandoned,
	markExecuted,
	markFailed,
	markValidated,
	planRecovery,
	recordFailure,
	recoveryAnalytics,
	recoverySeverityRank,
	validateJobRecovery,
} from "../src/plm/recovery-engine.ts";
import { store } from "../src/store.ts";

describe("classifyFailure — the deterministic taxonomy", () => {
	test("model failures read their own markers", () => {
		expect(classifyFailure("upstream 429 rate limit")).toBe("model");
		expect(classifyFailure("401 unauthorized")).toBe("model");
		expect(classifyFailure("degenerate completion: zero content")).toBe("model");
	});
	test("infrastructure markers (timeout/watchdog/sandbox)", () => {
		expect(classifyFailure("watchdog: job exceeded 60s")).toBe("infrastructure");
		expect(classifyFailure("spawn enoent")).toBe("infrastructure");
		expect(classifyFailure("bwrap failed")).toBe("infrastructure");
	});
	test("dependency markers (network/upstream/5xx)", () => {
		expect(classifyFailure("fetch failed: socket hang up")).toBe("dependency");
		expect(classifyFailure("upstream 502")).toBe("dependency");
	});
	test("context, memory, workflow, logic, planning", () => {
		expect(classifyFailure("context window exceeded")).toBe("context");
		expect(classifyFailure("shipped patch regressed — rollback")).toBe("memory");
		expect(classifyFailure("router is busy with another job")).toBe("workflow");
		expect(classifyFailure("invalid json: parse error")).toBe("logic");
		expect(classifyFailure("no such task")).toBe("planning");
	});
	test("the tool hint defaults exec tools to tool, else infrastructure", () => {
		expect(classifyFailure("weird opaque failure", "bash")).toBe("tool");
		expect(classifyFailure("weird opaque failure", "edit")).toBe("infrastructure");
	});
});

describe("planRecovery — classify → root cause → action → next step", () => {
	test("a rate-limit failure plans a backoff retry", () => {
		const plan = planRecovery("upstream 429 rate limit");
		expect(plan.category).toBe("model");
		expect(plan.retryable).toBe(true);
		expect(plan.action).toBe("backoff-retry");
		expect(plan.nextStep).toContain("backoff");
		expect(plan.rootCause).toContain("model endpoint");
	});
	test("a context failure is NOT retryable (a repeat fails the same way)", () => {
		const plan = planRecovery("context window exceeded");
		expect(plan.retryable).toBe(false);
		expect(plan.action).toBe("re-plan");
	});
	test("a memory failure plans rollback", () => {
		expect(planRecovery("regression sweep failed, rollback").action).toBe("rollback");
	});
	test("every category has a root cause and an action", () => {
		for (const text of [
			"429",
			"watchdog x",
			"fetch failed",
			"context window exceeded",
			"rollback",
			"router is busy",
			"parse error",
			"no such task",
			"opaque",
		]) {
			const plan = planRecovery(text);
			expect(plan.rootCause.length).toBeGreaterThan(10);
			expect(plan.nextStep.length).toBeGreaterThan(5);
			expect(typeof plan.action).toBe("string");
		}
	});
	test("isRetryable and recoveryActionFor agree with the plan", () => {
		const plan = planRecovery("upstream 429");
		expect(plan.retryable).toBe(isRetryable(plan.category));
		expect(plan.action).toBe(recoveryActionFor(plan.category));
		expect(rootCauseHint(plan.category)).toBe(plan.rootCause);
	});
});

describe("the recovery ledger", () => {
	test("recordFailure writes a planned row with the full diagnosis", () => {
		const id = recordFailure({
			failure: "job harness-cycle: watchdog: job exceeded 60s",
			jobId: "harness-cycle",
			tool: null,
		});
		expect(id).toBeGreaterThan(0);
		const rows = listRecoveryEvents(10);
		const row = rows.find((r) => r.id === id);
		expect(row?.status).toBe("planned");
		expect(row?.category).toBe("infrastructure");
		expect(row?.retryable).toBe(1);
		expect(row?.root_cause).toContain("host/sandbox");
	});
	test("the lifecycle planned → executed → validated", () => {
		const id = recordFailure({ failure: "upstream 502 bad gateway" });
		expect(markExecuted(id, { outcome: "backoff scheduled, retried" })).toBe(true);
		expect(markValidated(id, "next attempt succeeded")).toBe(true);
		const row = listRecoveryEvents(50).find((r) => r.id === id);
		expect(row?.status).toBe("validated");
		expect(row?.executed_at).toBeGreaterThan(0);
		expect(row?.validated_at).toBeGreaterThan(0);
		expect((row?.detail ?? "").includes("validationEvidence")).toBe(true);
	});
	test("a failed recovery and an abandoned one", () => {
		const a = recordFailure({ failure: "parse error in output" });
		expect(markFailed(a, "re-run made it worse")).toBe(true);
		const b = recordFailure({ failure: "no such task" });
		expect(markAbandoned(b, "superseded by mint")).toBe(true);
		const rows = listRecoveryEvents(50);
		expect(rows.find((r) => r.id === a)?.status).toBe("failed");
		expect(rows.find((r) => r.id === b)?.status).toBe("abandoned");
	});
});

describe("validateJobRecovery — outcomes validate or age the plan", () => {
	test("an ok job finish validates the job's open rows", () => {
		const id = recordFailure({ failure: "job auto-dream: fetch failed", jobId: "auto-dream-validate-test" });
		validateJobRecovery("auto-dream-validate-test", true);
		const row = listRecoveryEvents(50).find((r) => r.id === id);
		expect(row?.status).toBe("validated");
	});
	test("a repeat failure ages the attempt and exhausts honestly at 3", () => {
		const id = recordFailure({ failure: "job sandbox-gc: watchdog: exceeded", jobId: "sandbox-gc-validate-test" });
		validateJobRecovery("sandbox-gc-validate-test", false, "watchdog again");
		let row = listRecoveryEvents(50).find((r) => r.id === id);
		expect(row?.attempt).toBe(2);
		validateJobRecovery("sandbox-gc-validate-test", false, "and again");
		row = listRecoveryEvents(50).find((r) => r.id === id);
		expect(row?.attempt).toBe(3);
		validateJobRecovery("sandbox-gc-validate-test", false, "third strike");
		row = listRecoveryEvents(50).find((r) => r.id === id);
		expect(row?.status).toBe("failed");
		expect(row?.outcome).toContain("exhausted");
	});
});

describe("recoveryAnalytics", () => {
	test("counts by status/category and computes honest rates", () => {
		const analytics = recoveryAnalytics(365); // wide window to catch everything above
		expect(analytics.total).toBeGreaterThanOrEqual(6);
		expect(analytics.byStatus["validated"]).toBeGreaterThanOrEqual(2);
		expect(analytics.byCategory.some((c) => c.name === "infrastructure")).toBe(true);
		expect(analytics.executionRate).not.toBeNull();
		expect(analytics.recoverySuccessRate).not.toBeNull();
		expect(analytics.topActions.length).toBeGreaterThan(0);
		expect(analytics.windowDays).toBe(365);
	});
	test("the severity rank orders the dashboard worst-first", () => {
		expect(recoverySeverityRank("planned")).toBeLessThan(recoverySeverityRank("executed"));
		expect(recoverySeverityRank("executed")).toBeLessThan(recoverySeverityRank("failed"));
		expect(recoverySeverityRank("unknown-status")).toBeGreaterThan(recoverySeverityRank("abandoned"));
	});
});

describe("the ledger respects the kill switch", () => {
	test("UNOWN_PLM=0 records nothing", () => {
		process.env.UNOWN_PLM = "0";
		try {
			const before = (store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM recovery_events`) ?? { n: 0 }).n;
			expect(recordFailure({ failure: "anything" })).toBe(0);
			const after = (store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM recovery_events`) ?? { n: 0 }).n;
			expect(after).toBe(before);
		} finally {
			delete process.env.UNOWN_PLM;
		}
	});
});
