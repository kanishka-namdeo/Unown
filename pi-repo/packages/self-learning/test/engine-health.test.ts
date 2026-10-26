// engine-health.test.ts — H3 + H4 (2026-10-26 hardening round): the engine's
// lifecycle phases, the cheap /api/health probe, and the router's in-flight
// drain registry.
//
// H3: /api/health answers {ok, phase, pid, uptimeMs, drainBudgetMs, version}
// without the 500-run scan /api/overview pays; the phase is warming → ready →
// draining and flips to draining BEFORE the drain does its work; the drain
// budget is UNOWN_ENGINE_DRAIN_BUDGET_MS (floor 500, default 10s).
//
// H4: the router tracks the promise of the work holding the busy mutex;
// beginDraining() refuses every NEW job; drainInFlight(budget) awaits the
// in-flight work bounded; a rejected job counts as drained (finalized, not
// orphaned). The OpenAI codex-app-server-daemon lifecycle contract and
// Cognee's background-task drain registry are the published precedents.
//
// Conventions: handleApi is called directly (the unit pattern — server-busy.test.ts);
// the Router class is constructed in-process against the redirected test store.
import { describe, expect, test } from "bun:test";
import { Router } from "../src/router.ts";
import { ENGINE_DRAIN_BUDGET_MS, engineLifecyclePhaseNow, handleApi, isEngineBusyError } from "../src/server.ts";
import "./_env.ts";

const REQ = {
	method: "GET",
	query: new URLSearchParams(),
	body: null as any,
};

async function bodyOf(res: Response): Promise<any> {
	return JSON.parse(await res.text());
}

describe("engine health route (H3)", () => {
	test("GET /api/health answers the phase payload — cheap, additive, version-carrying", async () => {
		const res = await handleApi({ ...REQ, path: "/api/health" });
		expect(res.status).toBe(200);
		const body = await bodyOf(res);
		expect(body.ok).toBe(true);
		// The phase is one of the three contract values; a unit-process import
		// (no startServer) reports "warming" — the engine-only meaningfulness.
		expect(["warming", "ready", "draining"]).toContain(body.phase);
		expect(Number.isFinite(body.pid)).toBe(true);
		expect(Number.isFinite(body.uptimeMs)).toBe(true);
		expect(body.drainBudgetMs).toBe(ENGINE_DRAIN_BUDGET_MS);
		expect(body.version).toBeDefined();
	});

	test("HEAD /api/health answers too (a bare liveness poll needs no body)", async () => {
		const res = await handleApi({ ...REQ, method: "HEAD", path: "/api/health" });
		expect(res.status).toBe(200);
	});

	test("GET /api/overview carries the additive phase + drainBudgetMs fields", async () => {
		const res = await handleApi({ ...REQ, path: "/api/overview" });
		expect(res.status).toBe(200);
		const body = await bodyOf(res);
		expect(["warming", "ready", "draining"]).toContain(body.phase);
		expect(body.drainBudgetMs).toBe(ENGINE_DRAIN_BUDGET_MS);
	});

	test("the phase reader is exported and starts at warming in a non-engine process", () => {
		// A CLI/unit import never runs startServer: the module default is warming.
		expect(engineLifecyclePhaseNow()).toBe("warming");
	});

	test("ENGINE_DRAIN_BUDGET_MS defaults to 10s (the suite leaves the env unset)", () => {
		expect(ENGINE_DRAIN_BUDGET_MS).toBe(10_000);
	});
});

describe("router drain registry (H4)", () => {
	test("withBusy tracks the in-flight promise; inFlightJob() mirrors it; idle after settle", async () => {
		const r = new Router();
		expect(r.inFlightJob()).toBeNull();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const work = r.withBusy(async () => {
			await gate;
			return "done-value";
		});
		expect(r.isBusy()).toBe(true);
		// Identity note: withBusy is async, so the caller's promise WRAPS the
		// registry's tracked promise — settlement-equivalent, never reference-equal.
		expect(r.inFlightJob()).not.toBeNull();
		release();
		await expect(work).resolves.toBe("done-value");
		expect(r.isBusy()).toBe(false);
		expect(r.inFlightJob()).toBeNull();
	});

	test("drainInFlight awaits a settled job and reports drained:true with the job name", async () => {
		const r = new Router();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const work = r.withBusy(async () => {
			await gate;
		});
		const drained = r.drainInFlight(2_000);
		release();
		await work;
		const verdict = await drained;
		expect(verdict.drained).toBe(true);
	});

	test("drainInFlight honors the budget when the job never settles", async () => {
		const r = new Router();
		const never = new Promise<void>(() => {});
		const work = r.withBusy(async () => {
			await never;
		});
		const t0 = Date.now();
		const verdict = await r.drainInFlight(50);
		expect(verdict.drained).toBe(false);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(40); // the budget bounded the wait
		// The zombie never settles; the registry slot stays occupied — correct,
		// drainInFlight reports what it saw instead of lying.
		expect(r.inFlightJob()).not.toBeNull();
	});

	test("a REJECTED in-flight job counts as drained (finalized, not orphaned)", async () => {
		const r = new Router();
		const work = r.withBusy(async () => {
			throw new Error("job failed");
		});
		await expect(work).rejects.toThrow("job failed");
		const verdict = await r.drainInFlight(100);
		expect(verdict.drained).toBe(true);
		expect(r.isBusy()).toBe(false); // the mutex released despite the failure
	});

	test("beginDraining() refuses every new job with the draining conflict (the 409 class)", async () => {
		const r = new Router();
		r.beginDraining();
		expect(() => r.startFireAndForget(async () => 1)).toThrow("router is draining for shutdown");
		await expect(r.withBusy(async () => 1)).rejects.toThrow("router is draining for shutdown");
		await expect(r.execute("note-sync")).rejects.toThrow("router is draining for shutdown");
		// The draining conflict joins the engine-busy error class (the 409 shape).
		expect(isEngineBusyError(new Error("router is draining for shutdown"))).toBe(true);
	});

	test("draining does not disturb an in-flight job — it finishes under the drain", async () => {
		const r = new Router();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const work = r.withBusy(async () => {
			await gate;
			return "finished-under-drain";
		});
		r.beginDraining(); // shutdown began MID-FLIGHT
		release();
		await expect(work).resolves.toBe("finished-under-drain");
		const verdict = await r.drainInFlight(100);
		expect(verdict.drained).toBe(true);
	});

	test("the idle drain is instant (no in-flight work to wait for)", async () => {
		const r = new Router();
		const t0 = Date.now();
		const verdict = await r.drainInFlight(5_000);
		expect(verdict).toEqual({ job: "", drained: true });
		expect(Date.now() - t0).toBeLessThan(100);
	});
});
