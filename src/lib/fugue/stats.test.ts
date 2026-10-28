import { test, expect } from "bun:test";
import { computeStats } from "./stats";
import type { Run, StepType } from "./types";

function makeRun(
  status: "passed" | "failed",
  stepTypes: StepType[],
  durationMs = 100,
): Run {
  const startedAt = new Date("2025-06-01T00:00:00.000Z").toISOString();
  const endedAt = new Date(
    new Date(startedAt).getTime() + durationMs,
  ).toISOString();
  return {
    id: `run_${Math.random().toString(36).slice(2, 6)}`,
    flowId: "fl_1",
    workspaceId: "ws_1",
    status,
    startedAt,
    endedAt,
    payload: {},
    attempts: stepTypes.map((t, i) => ({
      stepId: `st_${i}`,
      stepType: t,
      name: "step",
      status: "passed" as const,
      input: {},
      output: {},
      durationMs: 10,
      attempt: 1,
    })),
    notifications: [],
  };
}

test("computeStats: empty runs → zeroed stats", () => {
  const s = computeStats([]);
  expect(s.totalRuns).toBe(0);
  expect(s.passRate).toBe(0);
  expect(s.meanDurationMs).toBe(0);
  expect(s.mostUsedStepType).toBeNull();
});

test("computeStats: totalRuns and passRate", () => {
  const runs = [
    makeRun("passed", ["transform"]),
    makeRun("failed", ["transform"]),
    makeRun("passed", ["transform"]),
    makeRun("failed", ["transform"]),
  ];
  const s = computeStats(runs);
  expect(s.totalRuns).toBe(4);
  expect(s.passRate).toBe(0.5);
});

test("computeStats: meanDurationMs", () => {
  const runs = [
    makeRun("passed", ["transform"], 100),
    makeRun("passed", ["transform"], 300),
  ];
  const s = computeStats(runs);
  expect(s.meanDurationMs).toBe(200);
});

test("computeStats: mostUsedStepType picks the highest count", () => {
  const runs = [
    makeRun("passed", ["transform", "transform"]),
    makeRun("passed", ["classify"]),
    makeRun("passed", ["classify"]),
  ];
  const s = computeStats(runs);
  expect(s.mostUsedStepType).toBe("transform");
  expect(s.stepTypeCounts.transform).toBe(2);
  expect(s.stepTypeCounts.classify).toBe(2);
  expect(s.stepTypeCounts.enrich).toBe(0);
});

test("computeStats: stepTypeCounts reflects all attempts", () => {
  const runs = [
    makeRun("passed", ["enrich", "notify"]),
    makeRun("failed", ["enrich"]),
  ];
  const s = computeStats(runs);
  expect(s.stepTypeCounts.enrich).toBe(2);
  expect(s.stepTypeCounts.notify).toBe(1);
  expect(s.stepTypeCounts.transform).toBe(0);
});

test("computeStats: runs with null endedAt are skipped in mean duration", () => {
  const runs: Run[] = [
    makeRun("passed", ["transform"], 200),
    { ...makeRun("failed", ["transform"], 0), endedAt: null },
  ];
  // Only the first run contributes to totalMs; formula divides by totalRuns.
  const s = computeStats(runs);
  expect(s.totalRuns).toBe(2);
  expect(s.meanDurationMs).toBe(100); // 200ms / 2 runs
});
