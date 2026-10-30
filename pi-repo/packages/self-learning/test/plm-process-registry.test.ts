/**
 * plm-process-registry.test.ts — the registry's lifecycle contract: creation
 * writes a row + birth event, transitions validate against the state machine
 * and append history, terminal writes are sticky, usage/lessons/checkpoint
 * land, orphan recovery heals non-terminal rows, and analytics count what
 * actually happened. Store-backed — _env.ts redirects the DB first.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import {
	archiveProcess,
	beginProcess,
	getProcess,
	getProcessChildren,
	getProcessEvents,
	listProcesses,
	plmEnabled,
	processAnalytics,
	recoverOrphanProcesses,
	transitionProcess,
} from "../src/plm/process-registry.ts";
import { store } from "../src/store.ts";

function countProcesses(): number {
	return store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM processes`)?.n ?? 0;
}

describe("beginProcess", () => {
	test("creates the row + the birth event + emits nothing that throws", () => {
		const before = countProcesses();
		const handle = beginProcess({ owner: "test", objective: "do the thing", kind: "job", taskRef: "harness-cycle" });
		expect(handle.id).toBeTruthy();
		expect(countProcesses()).toBe(before + 1);
		const row = getProcess(handle.id!);
		expect(row?.status).toBe("CREATED");
		expect(row?.kind).toBe("job");
		expect(row?.objective).toBe("do the thing");
		const events = getProcessEvents(handle.id!);
		expect(events.length).toBe(1);
		expect(events[0]?.to_status).toBe("CREATED");
	});
	test("an unknown kind is honestly reclassified, never dropped", () => {
		const handle = beginProcess({ owner: "test", objective: "x", kind: "not-a-kind" });
		const row = getProcess(handle.id!);
		expect(row?.kind).toBe("plm-internal");
	});
	test("late attach births straight into RUNNING with both events", () => {
		const handle = beginProcess({ owner: "test", objective: "late", kind: "run", started: true });
		const row = getProcess(handle.id!);
		expect(row?.status).toBe("RUNNING");
		expect(row?.started_at).toBeGreaterThan(0);
		const events = getProcessEvents(handle.id!);
		expect(events.map((e) => e.to_status)).toEqual(["CREATED", "RUNNING"]);
	});
});

describe("transitionProcess", () => {
	test("a legal walk appends history and stamps first-start/terminal times", () => {
		const handle = beginProcess({ owner: "test", objective: "walk", kind: "job" });
		const id = handle.id!;
		expect(transitionProcess(id, "QUEUED", "scheduled")).toBe(true);
		expect(transitionProcess(id, "RUNNING", "dispatched")).toBe(true);
		expect(transitionProcess(id, "VALIDATING", "verify")).toBe(true);
		expect(transitionProcess(id, "SUCCEEDED", "done")).toBe(true);
		const row = getProcess(id)!;
		expect(row.status).toBe("SUCCEEDED");
		expect(row.started_at).toBeGreaterThan(0);
		expect(row.ended_at).toBeGreaterThan(0);
		expect(row.duration_ms).toBeGreaterThanOrEqual(0);
		const events = getProcessEvents(id);
		expect(events.length).toBe(5);
	});
	test("an illegal edge is refused with no row damage", () => {
		const handle = beginProcess({ owner: "test", objective: "guard", kind: "job" });
		const id = handle.id!;
		expect(transitionProcess(id, "SUCCEEDED", "shortcut")).toBe(false);
		expect(getProcess(id)?.status).toBe("CREATED");
	});
	test("RETRYING bumps the attempt counter", () => {
		const handle = beginProcess({ owner: "test", objective: "retry", kind: "run", started: true });
		const id = handle.id!;
		expect(transitionProcess(id, "RETRYING", "first failure")).toBe(true);
		expect(getProcess(id)?.attempt).toBe(2);
		expect(transitionProcess(id, "RUNNING", "attempt 2")).toBe(true);
		expect(transitionProcess(id, "RETRYING", "second failure")).toBe(true);
		expect(getProcess(id)?.attempt).toBe(3);
	});
});

describe("terminal writes", () => {
	test("succeed/fail write outcome + usage and are sticky", () => {
		const handle = beginProcess({ owner: "test", objective: "term", kind: "job", started: true });
		handle.setUsage({ toolCalls: 5, toolErrors: 1, tokensIn: 100, tokensOut: 50, costUsd: 0.01 });
		handle.succeed("all good", { toolCalls: 5, tokensIn: 100, tokensOut: 50 });
		const row = getProcess(handle.id!)!;
		expect(row.status).toBe("SUCCEEDED");
		expect(row.outcome).toBe("all good");
		expect(JSON.parse(row.tool_usage!)).toEqual({ calls: 5, errors: 1 });
		expect(JSON.parse(row.token_usage!)).toEqual({ in: 100, out: 50 });
		// sticky: a second finalize is refused
		handle.fail("late zombie finalize");
		expect(getProcess(handle.id!)?.status).toBe("SUCCEEDED");
	});
	test("a never-started process finishes honestly as ABANDONED, not SUCCEEDED", () => {
		const handle = beginProcess({ owner: "test", objective: "skip", kind: "job" });
		handle.fail("failed before running");
		expect(getProcess(handle.id!)?.status).toBe("ABANDONED");
	});
	test("lessons land through the handle", () => {
		const handle = beginProcess({ owner: "test", objective: "lesson", kind: "job" });
		handle.setLessons("watch the mutex");
		expect(getProcess(handle.id!)?.lessons).toBe("watch the mutex");
	});
});

describe("parent/child", () => {
	test("children name their parent and list back", () => {
		const parent = beginProcess({ owner: "router", objective: "job", kind: "job" });
		const child = beginProcess({ owner: "runner", objective: "baseline run", kind: "run", parentId: parent.id });
		expect(getProcess(child.id!)?.parent_id).toBe(parent.id);
		expect(getProcessChildren(parent.id!).map((c) => c.id)).toContain(child.id);
	});
});

describe("analytics + orphan recovery", () => {
	test("analytics counts current census and historical entries", () => {
		const a = beginProcess({ owner: "t", objective: "a", kind: "job", started: true });
		transitionProcess(a.id!, "SUCCEEDED", "ok");
		const b = beginProcess({ owner: "t", objective: "b", kind: "run", started: true });
		const analytics = processAnalytics();
		expect(analytics.current["SUCCEEDED"]).toBeGreaterThanOrEqual(1);
		expect(analytics.current["RUNNING"]).toBeGreaterThanOrEqual(1);
		expect(analytics.entered["CREATED"]).toBeGreaterThanOrEqual(2);
		expect(analytics.total).toBeGreaterThanOrEqual(2);
		expect(analytics.transitionCounts.length).toBeGreaterThan(0);
		expect(analytics.byKind.some((k) => k.kind === "job")).toBe(true);
		expect(b.id).toBeTruthy();
	});
	test("orphan recovery moves non-terminal rows to FAILED", () => {
		const orphan = beginProcess({ owner: "t", objective: "orphan", kind: "run", started: true });
		const finished = beginProcess({ owner: "t", objective: "done", kind: "run", started: true });
		transitionProcess(finished.id!, "SUCCEEDED", "ok");
		const healed = recoverOrphanProcesses();
		expect(healed).toBeGreaterThanOrEqual(1);
		expect(getProcess(orphan.id!)?.status).toBe("FAILED");
		expect(getProcess(orphan.id!)?.status_reason).toContain("orphaned");
		// the finished row is untouched
		expect(getProcess(finished.id!)?.status).toBe("SUCCEEDED");
	});
	test("archive is explicit and only legal from terminal states", () => {
		const handle = beginProcess({ owner: "t", objective: "arch", kind: "job", started: true });
		expect(archiveProcess(handle.id!)).toBe(false); // RUNNING cannot archive
		transitionProcess(handle.id!, "SUCCEEDED", "ok");
		expect(archiveProcess(handle.id!)).toBe(true);
		expect(getProcess(handle.id!)?.status).toBe("ARCHIVED");
	});
});

describe("listProcesses filters", () => {
	test("status + kind filters and the limit cap", () => {
		const h = beginProcess({ owner: "t", objective: "filter", kind: "job", started: true });
		const byStatus = listProcesses({ status: "RUNNING" });
		expect(byStatus.every((p) => p.status === "RUNNING")).toBe(true);
		const byKind = listProcesses({ kind: "job" });
		expect(byKind.every((p) => p.kind === "job")).toBe(true);
		const capped = listProcesses({ limit: 1 });
		expect(capped.length).toBe(1);
		expect(h.id).toBeTruthy();
	});
});

describe("the kill switch", () => {
	test("UNOWN_PLM=0 yields the null handle and zero writes", () => {
		const before = countProcesses();
		process.env.UNOWN_PLM = "0";
		try {
			expect(plmEnabled()).toBe(false);
			const handle = beginProcess({ owner: "t", objective: "silent", kind: "job" });
			expect(handle.id).toBeNull();
			handle.transition("RUNNING", "never happens");
			handle.succeed("also nothing");
			expect(countProcesses()).toBe(before);
		} finally {
			delete process.env.UNOWN_PLM;
		}
	});
});
