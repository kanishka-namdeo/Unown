/**
 * plm-wiring.test.ts — the PLM round's integration pins:
 *   1. the engine's HTTP surface serves the five new resource families
 *      (/api/plm, /api/processes(+/:id), /api/tools(+invocations+report),
 *      /api/recovery, /api/checkpoints(+/:id), /api/learning/attribution);
 *   2. the router's job execution writes a full process lifecycle
 *      (CREATED → RUNNING → SUCCEEDED) with the run as its child;
 *   3. the boot orphan-heal path (recoverOrphans) lands the PLM heal too;
 *   4. wirePlm's improvement listeners write the attribution ledger
 *      on improvement:shipped / improvement:regressed.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import { emit } from "../src/bus.ts";
import { wirePlm } from "../src/plm/index.ts";
import { listAttributions } from "../src/plm/learning-attribution.ts";
import { getProcess, getProcessEvents, listProcesses } from "../src/plm/process-registry.ts";
import { listRecoveryEvents } from "../src/plm/recovery-engine.ts";
import { router } from "../src/router.ts";
import { handleApi, recoverOrphans } from "../src/server.ts";
import { store } from "../src/store.ts";

async function req(method: string, path: string, body?: unknown): Promise<Response> {
	return handleApi({ method, path, query: new URLSearchParams(), body: body ?? null });
}

async function json(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

describe("the PLM HTTP surface", () => {
	test("/api/plm serves the KPI rollup", async () => {
		const res = await req("GET", "/api/plm");
		expect(res.status).toBe(200);
		const data = await json(res);
		expect(data.enabled).toBe(true);
		expect((data.processes as Record<string, unknown>).total).toBeGreaterThan(0);
		expect((data.tools as Record<string, unknown>).totals).toBeTruthy();
		expect((data.recovery as Record<string, unknown>).total).toBeGreaterThanOrEqual(0);
		expect((data.learning as Record<string, unknown>).total).toBeGreaterThanOrEqual(0);
	});
	test("/api/processes lists and /api/processes/:id details with events + children", async () => {
		const list = await json(await req("GET", "/api/processes"));
		const processes = list.processes as Array<Record<string, unknown>>;
		expect(processes.length).toBeGreaterThan(0);
		const id = processes[0]!.id as string;
		const detail = await json(await req("GET", `/api/processes/${id}`));
		expect(detail.process).toBeTruthy();
		expect(Array.isArray(detail.events)).toBe(true);
		expect(Array.isArray(detail.children)).toBe(true);
	});
	test("/api/processes/:id 404s on unknown ids", async () => {
		expect((await req("GET", "/api/processes/nope")).status).toBe(404);
	});
	test("/api/tools + /api/tools/invocations serve the tool lifecycle", async () => {
		const tools = await json(await req("GET", "/api/tools"));
		expect(Array.isArray(tools.tools)).toBe(true);
		expect(Array.isArray(tools.recommendations)).toBe(true);
		expect((tools.totals as Record<string, unknown>).invocations).toBeGreaterThanOrEqual(0);
		const invocations = await json(await req("GET", "/api/tools/invocations"));
		expect(Array.isArray(invocations.invocations)).toBe(true);
	});
	test("POST /api/tools/report ingests a terminal batch", async () => {
		const res = await req("POST", "/api/tools/report", {
			items: [
				{ tool: "edit", success: true, durationMs: 8 },
				{ tool: "bash", success: false, error: "rate limit 429", durationMs: 20 },
			],
			sessionId: "plm-wiring-test",
		});
		expect(res.status).toBe(200);
		expect((await json(res)).written).toBe(2);
	});
	test("/api/recovery + /api/checkpoints + /api/learning/attribution serve their families", async () => {
		const recovery = await json(await req("GET", "/api/recovery"));
		expect(Array.isArray(recovery.events)).toBe(true);
		expect(recovery.analytics).toBeTruthy();
		const checkpoints = await json(await req("GET", "/api/checkpoints"));
		expect(Array.isArray(checkpoints.checkpoints)).toBe(true);
		const attribution = await json(await req("GET", "/api/learning/attribution"));
		expect(Array.isArray(attribution.attributions)).toBe(true);
		expect(attribution.analytics).toBeTruthy();
	});
	test("/api/checkpoints/:id 404s on unknown ids", async () => {
		expect((await req("GET", "/api/checkpoints/nope")).status).toBe(404);
	});
});

describe("the router writes the job process lifecycle", () => {
	test("a job execution creates a process that walks to SUCCEEDED", async () => {
		const before = store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM processes WHERE kind = 'job'`)?.n ?? 0;
		// Seed the job row (router.start() normally seeds it; intervals are too
		// heavy here) — then execute the non-learning, side-effect-free job.
		store.run(
			`INSERT OR IGNORE INTO jobs (id, name, kind, schedule_ms, enabled, next_run, run_count, status, description)
                         VALUES ('sandbox-gc', 'Sandbox GC', 'interval', 900000, 1, NULL, 0, 'idle', 'test-seeded')`,
		);
		const result = await router.execute("sandbox-gc");
		expect(result).toBeTruthy();
		const after = store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM processes WHERE kind = 'job'`)?.n ?? 0;
		expect(after).toBeGreaterThan(before);
		const row = listProcesses({ kind: "job", limit: 1 })[0]!;
		// The tightened pin (the first dogfooding run caught jobs landing
		// ABANDONED-with-success-outcome via the illegal CREATED→RUNNING
		// shortcut — a successful job MUST walk to SUCCEEDED).
		expect(row.status).toBe("SUCCEEDED");
		expect(row.owner).toBe("router");
		const events = getProcessEvents(row.id);
		expect(events.map((e) => e.to_status)).toEqual(["CREATED", "QUEUED", "RUNNING", "SUCCEEDED"]);
	});
});

describe("recoverOrphans heals PLM rows", () => {
	test("a RUNNING process row is moved to FAILED by the boot heal", () => {
		// mint a stuck row directly (simulating a crashed boot) — random id,
		// the test DB persists across runs
		const stuckId = `stuck-proc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
		store.run(
			`INSERT INTO processes (id, kind, objective, owner, status, created_at, started_at)
                         VALUES (?, 'run', 'stuck', 'runner', 'RUNNING', ?, ?)`,
			[stuckId, Date.now(), Date.now()],
		);
		recoverOrphans();
		const row = getProcess(stuckId);
		expect(row?.status).toBe("FAILED");
		expect(row?.status_reason).toContain("orphaned");
	});
});

describe("wirePlm listeners", () => {
	test("improvement:shipped writes the attribution ledger", async () => {
		wirePlm();
		// an improvements row to attribute (random id — the test DB persists
		// across runs, a fixed id would collide on the second run)
		const impId = `plm-wire-imp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
		store.run(
			`INSERT INTO improvements (id, task_id, diagnosis, proposal, patch, status, created_at)
                         VALUES (?, 'some-task', 'the failure diagnosis', 'the proposal', 'the patch line', 'shipped', ?)`,
			[impId, Date.now()],
		);
		emit("improvement:shipped", { id: impId });
		// the listener is async (onAsync) — let the immediate queue drain
		await new Promise((r) => setTimeout(r, 20));
		const rows = listAttributions(50);
		const row = rows.find((r) => r.improvement_id === impId);
		expect(row).toBeTruthy();
		expect(row?.failure).toBe("the failure diagnosis");
		expect(row?.improvement).toBe("the patch line");
	});
	test("a run that errored becomes a classified recovery event", async () => {
		wirePlm();
		emit("run:finished", { id: "no-such-run", status: "error" });
		await new Promise((r) => setTimeout(r, 20));
		const events = listRecoveryEvents(10);
		expect(events.some((e) => (e.failure_summary ?? "").includes("run errored"))).toBe(true);
	});
});
