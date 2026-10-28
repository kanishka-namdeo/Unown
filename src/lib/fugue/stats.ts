/**
 * Workspace stats — aggregates over retained runs.
 * PLAN.md §2 (WorkspaceStats), brief: total runs, pass rate, mean duration,
 * most-used step type.
 */
import type { Run, StepType, WorkspaceStats } from "./types";
import { STEP_TYPES } from "./types";

/**
 * Compute workspace stats from a list of retained runs.
 * Pure function; no I/O.
 */
export function computeStats(runs: Run[]): WorkspaceStats {
  const totalRuns = runs.length;

  if (totalRuns === 0) {
    return {
      totalRuns: 0,
      passRate: 0,
      meanDurationMs: 0,
      mostUsedStepType: null,
      stepTypeCounts: STEP_TYPES.reduce((acc, t) => {
        acc[t] = 0;
        return acc;
      }, {} as Record<StepType, number>),
    };
  }

  const passed = runs.filter((r) => r.status === "passed").length;
  const passRate = passed / totalRuns;

  // Mean duration: sum of (endedAt - startedAt) in ms.
  const totalMs = runs.reduce((acc, r) => {
    if (!r.endedAt) return acc;
    const start = new Date(r.startedAt).getTime();
    const end = new Date(r.endedAt).getTime();
    return acc + (end - start);
  }, 0);
  const meanDurationMs = Math.round(totalMs / totalRuns);

  // Step-type counts: count each attempt per run (a step appearing twice = 2 counts).
  const counts = STEP_TYPES.reduce(
    (acc, t) => {
      acc[t] = 0;
      return acc;
    },
    {} as Record<StepType, number>,
  );
  for (const run of runs) {
    for (const attempt of run.attempts) {
      counts[attempt.stepType] += 1;
    }
  }

  const totalSteps = Object.values(counts).reduce((a, b) => a + b, 0);
  let mostUsedStepType: StepType | null = null;
  if (totalSteps > 0) {
    let max = 0;
    for (const [t, c] of Object.entries(counts) as [StepType, number][]) {
      if (c > max) {
        max = c;
        mostUsedStepType = t;
      }
    }
  }

  return {
    totalRuns,
    passRate,
    meanDurationMs,
    mostUsedStepType,
    stepTypeCounts: counts,
  };
}
