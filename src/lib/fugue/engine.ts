/**
 * Fugue execution engine — pure, deterministic, no I/O.
 * PLAN.md §3.
 *
 * runFlow(flow, inputPayload, ctx) → Run
 *
 * Control flow:
 *  - Linear execution with optional branch redirect.
 *  - Retry up to step.retry.maxAttempts on failure.
 *  - Retry-exhausted → run.status = "failed", endedAt set, early return.
 *  - All steps done → run.status = "passed".
 *
 * Determinism: ctx.supplies now() and nextId(); no Date.now, no Math.random.
 */
import type {
  Flow,
  FlowStep,
  Run,
  StepType,
} from "./types";
import {
  runTransform,
  runClassify,
  runEnrich,
  runBranch,
  runNotify,
} from "./steps";

/** Injection point for all non-deterministic behaviour. */
export interface EngineCtx {
  /** Current ISO timestamp. Tests inject a fixed clock. */
  now(): string;
  /** Generate the next run id (deterministic counter). */
  nextRunId(flowId: string): string;
  /** Measure step duration; returns ms. Tests inject a fixed increment. */
  measure(step: FlowStep): number;
  /** Snapshot helper — truncate long strings to 500 chars. */
  snapshot(payload: unknown): unknown;
}

const SNAPSHOT_CAP = 500;

export function truncatePayload(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  if (Array.isArray(payload)) {
    return (payload as unknown[]).map((v) => truncatePayload(v));
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    result[k] = typeof v === "string" && v.length > SNAPSHOT_CAP ? v.slice(0, SNAPSHOT_CAP) + "…" : truncatePayload(v);
  }
  return result;
}

/** Default ctx for production: real Date.now, performance-based duration, real ids. */
export function prodCtx(): EngineCtx {
  let runCounter = 0;
  return {
    now: () => new Date().toISOString(),
    nextRunId: (flowId: string) => {
      runCounter += 1;
      return `run_${flowId}_prod_${runCounter}`;
    },
    measure: () => 5, // fixed 5ms per step (placeholder; real timing in P2 API layer)
    snapshot: truncatePayload,
  };
}

/**
 * Execute a flow over an input payload.
 * The input payload must be an object (or null); `payload.input` or `payload.text`
 * is the designated text field for transform steps.
 */
export function runFlow(
  flow: Flow,
  inputPayload: unknown,
  ctx: EngineCtx,
): Run {
  const startedAt = ctx.now();
  const run: Run = {
    id: ctx.nextRunId(flow.id),
    flowId: flow.id,
    workspaceId: flow.workspaceId,
    status: "running",
    startedAt,
    endedAt: null,
    payload: inputPayload,
    attempts: [],
    notifications: [],
  };

  let payload = inputPayload;
  let cursor = 0;

  while (cursor < flow.steps.length) {
    const step = flow.steps[cursor];
    const inputSnapshot = ctx.snapshot(payload);
    let attemptNum = 0;

    // Retry loop — record EVERY attempt (honest evidence for retries).
    let success = false;
    while (attemptNum < step.retry.maxAttempts) {
      attemptNum += 1;
      const result = executeStep(step, payload, ctx, run);
      if (result.error) {
        // Record this failed attempt (evidence that retries happen).
        run.attempts.push({
          stepId: step.id,
          stepType: step.type,
          name: step.name,
          status: "failed",
          error: result.error,
          input: inputSnapshot,
          durationMs: ctx.measure(step),
          attempt: attemptNum,
        });
      } else {
        payload = result.payload;
        success = true;
        // Record the passed attempt.
        run.attempts.push({
          stepId: step.id,
          stepType: step.type,
          name: step.name,
          status: "passed",
          input: inputSnapshot,
          output: ctx.snapshot(payload),
          durationMs: ctx.measure(step),
          attempt: attemptNum,
        });
        break;
      }
    }

    if (!success) {
      run.status = "failed";
      run.endedAt = ctx.now();
      return run;
    }

    // Branch redirect
    if (step.type === "branch") {
      const target = resolveBranch(step, payload);
      if (target === "end") {
        cursor = flow.steps.length;
      } else if (target !== null && target !== undefined) {
        const idx = flow.steps.findIndex((s) => s.id === target);
        cursor = idx === -1 ? cursor + 1 : idx;
      } else {
        cursor += 1; // fall-through
      }
      continue;
    }

    cursor += 1;
  }

  run.status = "passed";
  run.endedAt = ctx.now();
  // Update the final payload on the run object.
  run.payload = payload;
  return run;
}

/** Resolve a branch step's target. Returns step id, "end", or null (fall-through). */
function resolveBranch(step: FlowStep, payload: unknown): string | null {
  const { when } = step.config as { when: Array<{ field: string; equals?: unknown; target?: string }> };
  if (!Array.isArray(when)) return null;

  for (const clause of when) {
    let matched = false;
    if (clause.field.startsWith("labels:")) {
      const label = clause.field.slice(7);
      const labels = (payload as Record<string, unknown> | null)?.labels;
      matched = Array.isArray(labels) && labels.includes(label);
      // "labels:<label>" is a boolean test — no `equals` needed.
    } else {
      const val = (payload as Record<string, unknown> | null)?.[clause.field];
      matched = clause.equals === undefined ? val !== undefined && val !== null : val === clause.equals;
    }
    if (matched) {
      return clause.target ?? null;
    }
  }
  return null; // no clause matched → fall-through
}

/**
 * Execute a single step. Returns the updated payload or an error string.
 * No mutation of the input payload.
 */
function executeStep(
  step: FlowStep,
  payload: unknown,
  ctx: EngineCtx,
  run: Run,
): { payload: unknown; error?: string } {
  switch (step.type as StepType) {
    case "transform":
      return runTransform(payload, step, ctx);
    case "classify":
      return runClassify(payload, step, ctx);
    case "enrich":
      return runEnrich(payload, step, ctx);
    case "branch":
      return runBranch(payload, step, ctx);
    case "notify":
      return runNotify(payload, step, ctx, run);
    default:
      return { payload, error: `unknown step type '${step.type}'` };
  }
}
