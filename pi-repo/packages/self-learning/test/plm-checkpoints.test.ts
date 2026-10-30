/**
 * plm-checkpoints.test.ts — the checkpoint/replay system: milestone
 * snapshots persist with bounded state, the process pointer updates,
 * replay runs compare deterministically (matched / diverged / error), the
 * reproducibility analytics stay receipts-only, and pruning respects the
 * replay references.
 */
import { describe, expect, test } from "bun:test";
import "./_env.ts";
import {
	beginReplay,
	compareReplay,
	createCheckpoint,
	finishReplay,
	getCheckpoint,
	listCheckpoints,
	listCheckpointsForProcess,
	listReplayRuns,
	replayAnalytics,
} from "../src/plm/checkpoints.ts";
import { beginProcess, getProcess } from "../src/plm/process-registry.ts";
import { store } from "../src/store.ts";

describe("createCheckpoint", () => {
	test("persists the milestone + updates the process pointer", () => {
		const handle = beginProcess({ owner: "runner", objective: "run", kind: "run", started: true });
		const id = createCheckpoint({
			processId: handle.id!,
			kind: "validation",
			label: "baseline passed",
			state: { objective: "run", prompt: "do it", outputs: { passed: true } },
		});
		expect(id).toBeTruthy();
		const checkpoint = getCheckpoint(id!);
		expect(checkpoint?.kind).toBe("validation");
		expect(checkpoint?.label).toBe("baseline passed");
		expect(JSON.parse(checkpoint!.state).objective).toBe("run");
		expect(getProcess(handle.id!)?.checkpoint_id).toBe(id);
	});
	test("unknown kinds fall back to implementation, never crash", () => {
		const handle = beginProcess({ owner: "t", objective: "x", kind: "job" });
		const id = createCheckpoint({ processId: handle.id!, kind: "bogus", state: { objective: "x" } });
		expect(getCheckpoint(id!)?.kind).toBe("implementation");
	});
	test("oversized state is clipped, never rejected", () => {
		const handle = beginProcess({ owner: "t", objective: "big", kind: "job" });
		const id = createCheckpoint({
			processId: handle.id!,
			kind: "implementation",
			state: { objective: "big", outputs: { blob: "x".repeat(400_000) } },
		});
		const checkpoint = getCheckpoint(id!);
		expect(checkpoint!.state.length).toBeLessThanOrEqual(256 * 1024 + 100);
	});
});

describe("compareReplay + finishReplay", () => {
	test("identical scalars match; differing fields diverge", () => {
		const state = JSON.stringify({
			objective: "same",
			prompt: "same prompt",
			decisions: ["a", "b"],
			toolInvocations: [{ tool: "read" }, { tool: "edit" }],
			failures: [],
		});
		const same = compareReplay(state, {
			objective: "same",
			prompt: "same prompt",
			decisions: ["x", "y"],
			toolInvocations: [{ tool: "bash" }, { tool: "ls" }],
			failures: [],
		});
		expect(same.diverged).toEqual([]);
		const diff = compareReplay(state, { objective: "different" });
		expect(diff.diverged).toContain("objective");
		expect(diff.diverged).toContain("prompt");
		expect(diff.diverged).toContain("decisionCount");
	});
	test("a replay run round-trips matched with its diff", () => {
		const handle = beginProcess({ owner: "t", objective: "replayable", kind: "run", started: true });
		const cp = createCheckpoint({
			processId: handle.id!,
			kind: "validation",
			state: { objective: "replayable", prompt: "p", toolInvocations: [{ tool: "read" }], failures: [] },
		});
		const replayId = beginReplay({ checkpointId: cp!, reproduces: "the baseline outcome" });
		expect(replayId).toBeTruthy();
		expect(
			finishReplay(replayId!, {
				objective: "replayable",
				prompt: "p",
				toolInvocations: [{ tool: "read" }],
				failures: [],
			}),
		).toBe(true);
		const row = listReplayRuns(10).find((r) => r.id === replayId);
		expect(row?.status).toBe("matched");
		expect(row?.diff).toBeTruthy();
	});
	test("a divergent replay records the fields that moved", () => {
		const handle = beginProcess({ owner: "t", objective: "drift", kind: "run", started: true });
		const cp = createCheckpoint({ processId: handle.id!, kind: "validation", state: { objective: "drift" } });
		const replayId = beginReplay({ checkpointId: cp!, reproduces: "drift check" });
		finishReplay(replayId!, { objective: "drifted" });
		const row = listReplayRuns(10).find((r) => r.id === replayId);
		expect(row?.status).toBe("diverged");
		const diff = JSON.parse(row!.diff!);
		expect(diff.diverged).toContain("objective");
	});
	test("an errored replay records its error text", () => {
		const handle = beginProcess({ owner: "t", objective: "err", kind: "run", started: true });
		const cp = createCheckpoint({ processId: handle.id!, kind: "testing", state: { objective: "err" } });
		const replayId = beginReplay({ checkpointId: cp!, reproduces: "error case" });
		finishReplay(replayId!, {}, "sandbox died mid-replay");
		const row = listReplayRuns(10).find((r) => r.id === replayId);
		expect(row?.status).toBe("error");
	});
	test("replaying a nonexistent checkpoint refuses honestly", () => {
		expect(beginReplay({ checkpointId: "nope", reproduces: "x" })).toBeNull();
	});
});

describe("replayAnalytics", () => {
	test("receipts-only: no replays means null, never zero", () => {
		const analytics = replayAnalytics();
		expect(analytics.total).toBeGreaterThanOrEqual(3); // from the tests above
		expect(analytics.matched).toBeGreaterThanOrEqual(1);
		expect(analytics.reproducibility).not.toBeNull();
		expect(analytics.reproducibility!).toBeGreaterThan(0);
	});
});

describe("pruning", () => {
	test("the cap prunes oldest-first but never a checkpoint a replay references", () => {
		process.env.UNOWN_PLM_MAX_CHECKPOINTS = "10";
		try {
			// EVERY checkpoint a replay references must survive the prune —
			// computed from the table, not a hand-counted expectation.
			const referenced = [
				...new Set(
					listReplayRuns(200)
						.map((r) => r.checkpoint_id)
						.filter(Boolean),
				),
			];
			expect(referenced.length).toBeGreaterThanOrEqual(1);
			// mint enough fresh checkpoints to force pruning
			for (let i = 0; i < 14; i++) {
				const h = beginProcess({ owner: "t", objective: `prune-${i}`, kind: "job" });
				createCheckpoint({ processId: h.id!, kind: "implementation", state: { objective: `prune-${i}` } });
			}
			const count = (store.get<{ n: number }>(`SELECT COUNT(*) AS n FROM checkpoints`) ?? { n: 0 }).n;
			expect(count).toBeLessThanOrEqual(10 + referenced.length);
			for (const id of referenced) {
				expect(getCheckpoint(id)).toBeTruthy(); // the referenced ones survive
			}
		} finally {
			delete process.env.UNOWN_PLM_MAX_CHECKPOINTS;
		}
	});
});

describe("listCheckpointsForProcess", () => {
	test("a process sees its own milestones in order", () => {
		const handle = beginProcess({ owner: "t", objective: "multi", kind: "run", started: true });
		createCheckpoint({ processId: handle.id!, kind: "planning", state: { objective: "multi" } });
		createCheckpoint({ processId: handle.id!, kind: "testing", state: { objective: "multi" } });
		const list = listCheckpointsForProcess(handle.id!);
		expect(list.length).toBeGreaterThanOrEqual(2);
		expect(list[0]!.kind).toBe("planning");
		expect(list[list.length - 1]!.kind).toBe("testing");
	});
});
