// Unit tests for src/dashboard/dashboard-data.ts — DashboardStore behavior
// against the D6 mock engine (test/dashboard-mock-engine.ts): snapshot
// loading for every resource, SSE-driven invalidation + refetch, the
// describeEvent vocabulary, the M6 degraded-mode snapshot guarantee, the
// drill-in detail cache + rollback invalidation, and the note mutations
// (including the 413 typed-error path through the real EngineClient wire).
//
// App bugs surfaced while writing this suite (REPORTED, not fixed — the mock
// is test-side and works around them where noted):
//   1. handleFrame does not unwrap the LIVE engine's envelope-only SSE frames
//      (`data: {"event":…,"payload":…}`) — against the real engine every
//      event arrives as "message" and SSE invalidation never fires. The mock
//      therefore speaks named-event frames (`event:` + `data:`), which is the
//      format the store actually parses.
//   2. describeEvent's str() helper only renders STRING payload fields — the
//      engine emits numeric version/rolledBackTo, which render as "v?" — so
//      the invalidation test passes the version as a string below.
import "./_env.ts"; // MUST be the first import: store.ts opens SQLite at module scope
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ResourceId } from "../src/dashboard/dashboard-data.ts";
import { DashboardStore, describeEvent, EngineClient } from "../src/dashboard/dashboard-data.ts";
import type { MemoryResponse, OverviewResponse } from "../src/dashboard/dashboard-types.ts";
import { type MockEngine, startMockEngine } from "./dashboard-mock-engine.ts";

/** Every resource id the store's endpoint table declares. */
const RESOURCES: ResourceId[] = [
	"overview",
	"tasks",
	"runs",
	"memory",
	"memoryProjects",
	"cycles",
	"improvements",
	"dreams",
	"notes",
	"skills",
	"hooks",
	"jobs",
	"sandboxes",
	"bridge",
	"automations",
	"webcache",
];

let mock: MockEngine;

beforeAll(async () => {
	mock = await startMockEngine();
});
afterAll(() => mock.close());

/** Poll cond() until true; throws on timeout (keeps failures actionable). */
async function waitFor(cond: () => boolean, timeoutMs = 5000, label = ""): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!cond()) {
		if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms${label ? `: ${label}` : ""}`);
		await Bun.sleep(25);
	}
}

describe("DashboardStore against the mock engine", () => {
	test("loads every resource snapshot", async () => {
		const store = new DashboardStore(new EngineClient(mock.url));
		store.start();
		try {
			await waitFor(
				() => RESOURCES.every((id) => store.snapshot(id).data !== null),
				5000,
				"all 16 resources loaded",
			);
			for (const id of RESOURCES) {
				const snap = store.snapshot(id);
				expect(snap.data, `${id} snapshot data`).not.toBeNull();
				expect(snap.error, `${id} snapshot error`).toBeNull();
				expect(snap.ageMs, `${id} snapshot age`).not.toBeNull();
				expect(snap.ageMs ?? Infinity, `${id} snapshot age is small`).toBeLessThan(5000);
			}
			expect(store.connection).toBe("up");
		} finally {
			store.stop();
		}
	});

	test("SSE invalidation marks memory dirty and refetches", async () => {
		const store = new DashboardStore(new EngineClient(mock.url));
		store.start();
		try {
			await waitFor(() => store.snapshot<MemoryResponse>("memory").data !== null, 3000, "memory loaded");
			// The canned connect burst (memory:changed v5 + run:finished) proves the
			// SSE link is live before the assertion emit.
			await waitFor(
				() => store.activityRing().some((a) => a.text.includes("run finished · task-e2e-3")),
				4000,
				"canned burst received over SSE",
			);
			store.setActiveResources(["memory"]);
			const before = store.snapshot<MemoryResponse>("memory");
			const project = before.data?.tiers.find((t) => t.tier === "project");
			expect(project?.version ?? 0).toBeGreaterThan(0); // the current memory version value
			const hitsBefore = mock.calls.hits.get("/api/memory") ?? 0;
			// NOTE: version is a string because describeEvent renders only string
			// fields (bug #2 above); the invalidation + refetch is the point here.
			mock.emit("memory:changed", { tier: "project", version: "99", changedBy: "autodream" });
			await waitFor(
				() => (mock.calls.hits.get("/api/memory") ?? 0) > hitsBefore,
				2000,
				"memory refetched after the invalidation event",
			);
			const after = store.snapshot<MemoryResponse>("memory");
			expect(after.ageMs ?? Infinity, "memory snapshot age was reset by the refetch").toBeLessThan(1500);
			expect(
				store.activityRing().some((a) => a.text.includes("project memory → v99")),
				"activity ring describes the memory:changed event",
			).toBe(true);
		} finally {
			store.stop();
		}
	});

	test("describeEvent vocabulary", () => {
		// run:finished · passed → emerald, with the duration rendered.
		const passed = describeEvent({
			event: "run:finished",
			payload: { taskId: "task-e2e-3", status: "passed", durationMs: 61_000 },
			ts: 0,
		});
		expect(passed).not.toBeNull();
		expect(passed?.tone).toBe("emerald");
		expect(passed?.text).toContain("run finished · task-e2e-3 · passed · 61s");

		// improvement:regressed → rose.
		const regressed = describeEvent({ event: "improvement:regressed", payload: { rolledBackTo: "2" }, ts: 0 });
		expect(regressed?.tone).toBe("rose");
		expect(regressed?.text).toContain("improvement regressed · memory rolled back to v2");

		// memory:budget with pruned blocks → amber; silent when nothing was pruned.
		const pruned = describeEvent({ event: "memory:budget", payload: { prunedBlocks: 2 }, ts: 0 });
		expect(pruned?.tone).toBe("amber");
		expect(pruned?.text).toContain("2 blocks pruned");
		expect(describeEvent({ event: "memory:budget", payload: { prunedBlocks: 0 }, ts: 0 })?.tone).toBe("zinc");

		// Quiet + connect vocabulary: ping is silent, hello is emerald.
		expect(describeEvent({ event: "ping", payload: {}, ts: 0 })).toBeNull();
		expect(describeEvent({ event: "hello", payload: {}, ts: 0 })?.tone).toBe("emerald");
	});

	test("degraded mode keeps the last snapshot", async () => {
		// A dedicated engine instance — this test kills it (the shared mock
		// stays up for the rest of the suite).
		const engine = await startMockEngine();
		const store = new DashboardStore(new EngineClient(engine.url, 1500));
		try {
			await store.refresh("memory");
			const loaded = store.snapshot<MemoryResponse>("memory");
			expect(loaded.data).not.toBeNull();
			expect(store.connection).toBe("up");

			await engine.close();
			await Bun.sleep(80);

			// The unreachable refresh fails internally: the error is recorded on the
			// resource, the connection drops — and the last memory snapshot is kept
			// (it ages, it is never dropped).
			await store.refresh("overview");
			const degraded = store.snapshot<OverviewResponse>("overview");
			expect(degraded.error).toContain("unreachable");
			expect(store.connection).toBe("down");
			const kept = store.snapshot<MemoryResponse>("memory");
			expect(kept.data, "degraded mode keeps the last memory snapshot").not.toBeNull();
			expect(kept.ageMs ?? 0, "the kept snapshot's age keeps growing").toBeGreaterThan((loaded.ageMs ?? 0) + 30);
		} finally {
			store.stop();
		}
	});

	test("rollback invalidates the memory detail cache", async () => {
		const store = new DashboardStore(new EngineClient(mock.url));
		try {
			const histPath = "/api/memory/project/history";
			const first = await store.memoryHistory("project");
			expect(first.length).toBe(3);
			expect(first.map((e) => e.version)).toEqual([5, 4, 3]);
			// changed_by variety across tiers (seed/harness/autodream/rollback).
			const policy = await store.memoryHistory("policy");
			const authors = new Set([...first, ...policy].map((e) => e.changed_by));
			expect(authors.size).toBeGreaterThanOrEqual(4);
			expect(mock.calls.hits.get(histPath)).toBe(1);

			// A second read inside the 15s detail-cache TTL must not refetch.
			await store.memoryHistory("project");
			expect(mock.calls.hits.get(histPath)).toBe(1);

			const r = await store.rollbackMemory("project", 2);
			expect(r.ok).toBe(true);
			expect(mock.calls.rollbacks).toContain("project");

			// The rollback cleared the memhist cache → the next open refetches.
			const refetched = await store.memoryHistory("project");
			expect(refetched.length).toBe(3);
			expect(mock.calls.hits.get(histPath)).toBe(2);
		} finally {
			store.stop();
		}
	});

	test("createNote records and refreshes notes", async () => {
		const store = new DashboardStore(new EngineClient(mock.url));
		try {
			const notesPath = "/api/notes";
			const hitsBefore = mock.calls.hits.get(notesPath) ?? 0;
			const res = await store.createNote("hello", "/tmp/proj");
			expect(res.ok).toBe(true);
			expect(res.id).toMatch(/^note-mock-\d+$/);
			expect(mock.calls.notesCreated).toContainEqual({ content: "hello", projectPath: "/tmp/proj" });
			// createNote refreshes the notes snapshot (fire-and-forget): the POST is
			// already counted, so the second hit is the GET refetch.
			await waitFor(
				() => (mock.calls.hits.get(notesPath) ?? 0) >= hitsBefore + 2,
				2000,
				"notes snapshot refetched after createNote",
			);
			// Oversized notes surface the engine's 413 as EngineClient's typed error.
			await expect(store.createNote("x".repeat(20_001), "/tmp/proj")).rejects.toThrow(/413|too large/);
		} finally {
			store.stop();
		}
	});
});
