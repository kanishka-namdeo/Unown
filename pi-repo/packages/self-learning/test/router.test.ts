// Unit tests for src/router.ts — the busy-mutex contract.
//
// Backlog reference: docs/testing-strategy.md §4.2 (self-learning engine).
// Only the in-process-constructible surface is tested: the Router class
// mutex (withBusy / execute / isBusy) and the JOB_DEFS schedule table,
// against the redirected test store (see ./_env.ts). tick() and
// runJobInternal() are module-private (needs extraction for unit coverage of
// the due-job query and per-job runners); start()/stop() are smoke-tested
// against the jobs table only.
//
// These tests run on `bun test` (bun:test is built in — zero new deps).
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { describe, expect, test } from "bun:test";
import { JOB_DEFS, listJobs, Router, router } from "../src/router.ts";

describe("JOB_DEFS", () => {
	test("defines the seven engine jobs", () => {
		expect(JOB_DEFS.map((d) => d.id).sort()).toEqual([
			"auto-dream",
			"dream-check",
			"harness-cycle",
			"note-sync",
			"regression-on-ship",
			"sandbox-gc",
			"task-mint",
		]);
	});

	test("ids are unique", () => {
		expect(new Set(JOB_DEFS.map((d) => d.id)).size).toBe(JOB_DEFS.length);
	});

	test("every interval job has a positive schedule", () => {
		const intervals = JOB_DEFS.filter((d) => d.kind === "interval");
		expect(intervals.length).toBeGreaterThan(0);
		for (const d of intervals) expect(d.scheduleMs).toBeGreaterThan(0);
	});

	test("event jobs bind to their documented bus events", () => {
		const events = Object.fromEntries(JOB_DEFS.filter((d) => d.kind === "event").map((d) => [d.id, d.event]));
		expect(events).toEqual({
			"regression-on-ship": "improvement:shipped",
			"dream-check": "run:finished",
		});
	});
});

describe("Router busy mutex (withBusy / execute / isBusy)", () => {
	test("withBusy returns the fn's value and reports busy only while running", async () => {
		const r = new Router();
		let release!: () => void;
		const gate = new Promise<void>((res) => (release = res));
		const job = r.withBusy(async () => {
			expect(r.isBusy()).toBe(true);
			await gate;
			return 42;
		});
		expect(r.isBusy()).toBe(true);
		release();
		await expect(job).resolves.toBe(42);
		expect(r.isBusy()).toBe(false);
	});

	test("withBusy error path: rejects AND restores busy=false", async () => {
		const r = new Router();
		await expect(r.withBusy(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
		expect(r.isBusy()).toBe(false);
		// the router accepts work again afterwards
		await expect(r.withBusy(async () => "ok")).resolves.toBe("ok");
	});

	test("reentrancy: a nested withBusy call is rejected", async () => {
		const r = new Router();
		await r.withBusy(async () => {
			await expect(r.withBusy(async () => "never")).rejects.toThrow("engine is busy with another job");
		});
		expect(r.isBusy()).toBe(false);
	});

	test("reentrancy: execute() while busy is rejected (manual-trigger guard)", async () => {
		const r = new Router();
		let release!: () => void;
		const gate = new Promise<void>((res) => (release = res));
		const job = r.withBusy(() => gate.then(() => "done"));
		expect(r.isBusy()).toBe(true);
		await expect(r.execute("harness-cycle")).rejects.toThrow("router is busy with another job");
		release();
		await expect(job).resolves.toBe("done");
	});

	test("execute() of an unknown job rejects and still restores the mutex", async () => {
		const r = new Router();
		await expect(r.execute("does-not-exist")).rejects.toThrow("unknown job: does-not-exist");
		expect(r.isBusy()).toBe(false);
	});

	test("module singleton is a Router instance, initially idle", () => {
		expect(router instanceof Router).toBe(true);
		expect(router.isBusy()).toBe(false);
	});
});

describe("Router.start()/stop() (jobs table on the redirected test store)", () => {
	test("start seeds the jobs table exactly once per job; stop clears timers", async () => {
		const r = new Router();
		await r.start();
		expect(listJobs().length).toBe(JOB_DEFS.length);
		const r2 = new Router();
		await r2.start(); // same defs — no duplicate rows
		expect(listJobs().length).toBe(JOB_DEFS.length);
		r.stop();
		r2.stop();
	});
});
