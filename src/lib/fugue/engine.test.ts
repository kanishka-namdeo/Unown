import { test, expect } from "bun:test";
import { runFlow, prodCtx, type EngineCtx } from "./engine";
import type { Flow, FlowStep } from "./types";

// ── helpers ──

function makeCtx(startMs = 1000000): EngineCtx & { clock: () => string } {
  let t = startMs;
  const clock = () => new Date(t).toISOString();
  t += 5; // advance 5ms each call
  let idCounter = 0;
  return {
    now: () => new Date(t).toISOString(),
    nextRunId: (flowId: string) => {
      idCounter += 1;
      return `run_test_${flowId}_${idCounter}`;
    },
    measure: () => 5,
    snapshot: (p: unknown) => p,
    clock,
  };
}

function simpleFlow(steps: FlowStep[]): Flow {
  return {
    id: "fl_test",
    workspaceId: "ws_test",
    name: "test flow",
    description: "test",
    enabled: true,
    updatedAt: "2025-01-01T00:00:00.000Z",
    steps,
  };
}

const st = (id: string, type: FlowStep["type"], name = id, config: FlowStep["config"] = {}, retry = { maxAttempts: 1 }): FlowStep => ({
  id,
  type,
  name,
  config,
  retry,
});

// ── tests ──

test("branch redirect: branch routes to target step", () => {
  const flow = simpleFlow([
    st("st_a", "enrich", "Enrich", { fields: { flag: "yes" } }),
    st("st_branch", "branch", "Route", {
      when: [
        { field: "flag", equals: "yes", target: "st_skip_notify" },
      ],
    }),
    st("st_normal", "enrich", "Normal", { fields: { normal: true } }),
    st("st_skip_notify", "enrich", "Skipped branch target", { fields: { skipped: true } }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, {}, ctx);

  expect(run.status).toBe("passed");
  // st_a passed, st_branch passed, st_skip_notify passed — st_normal was skipped
  const stepIds = run.attempts.map((a) => a.stepId);
  expect(stepIds).toEqual(["st_a", "st_branch", "st_skip_notify"]);
  // st_normal should NOT be in the attempts
  expect(stepIds).not.toContain("st_normal");
});

test("branch redirect: no matching when-clause falls through to next step", () => {
  const flow = simpleFlow([
    st("st_a", "enrich", "Enrich", { fields: { flag: "no" } }),
    st("st_branch", "branch", "Route", {
      when: [
        { field: "flag", equals: "yes", target: "st_other" },
      ],
    }),
    st("st_next", "enrich", "Next", { fields: { next: true } }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, {}, ctx);

  expect(run.status).toBe("passed");
  const stepIds = run.attempts.map((a) => a.stepId);
  // flag !== "yes" → fall-through to st_next
  expect(stepIds).toEqual(["st_a", "st_branch", "st_next"]);
});

test("branch redirect: branch targets 'end' terminates the flow", () => {
  const flow = simpleFlow([
    st("st_a", "enrich", "Enrich", { fields: { done: true } }),
    st("st_branch", "branch", "Early exit", {
      when: [{ field: "done", target: "end" }],
    }),
    st("st_unreached", "enrich", "Unreached", { fields: { x: 1 } }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, {}, ctx);

  expect(run.status).toBe("passed");
  const stepIds = run.attempts.map((a) => a.stepId);
  expect(stepIds).toEqual(["st_a", "st_branch"]);
  expect(stepIds).not.toContain("st_unreached");
});

test("retry-exhaustion marks run failed", () => {
  // Use a transform step with no text field → always fails.
  const flowTransform = simpleFlow([
    st("st_tf", "transform", "Transform (no text)", { template: "{{input}}" }, { maxAttempts: 3 }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flowTransform, {}, ctx);

  expect(run.status).toBe("failed");
  expect(run.endedAt).not.toBeNull();
  // 3 attempts (maxAttempts = 3)
  expect(run.attempts.length).toBe(3);
  expect(run.attempts.every((a) => a.status === "failed")).toBe(true);
  expect(run.attempts[0].error).toBe("transform: payload has no text field");
});

test("transform-missing-text retries then fails honestly", () => {
  const flow = simpleFlow([
    st("st_tf", "transform", "Transform", { template: "Text: {{input}}" }, { maxAttempts: 2 }),
    st("st_after", "enrich", "After", { fields: { ok: true } }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, {}, ctx); // no input/text field

  expect(run.status).toBe("failed");
  // 2 attempts of st_tf recorded, st_after never runs
  const tfAttempts = run.attempts.filter((a) => a.stepId === "st_tf");
  expect(tfAttempts.length).toBe(2);
  expect(tfAttempts[0].attempt).toBe(1);
  expect(tfAttempts[1].attempt).toBe(2);
  expect(tfAttempts.every((a) => a.status === "failed")).toBe(true);
  expect(run.attempts.filter((a) => a.stepId === "st_after")).toHaveLength(0);
});

test("classify first-match: first matching label wins", () => {
  const flow = simpleFlow([
    st("st_classify", "classify", "Classify", {
      rules: {
        urgent: ["urgent", "critical"],
        routine: ["routine", "normal"],
      },
    }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, { text: "this is URGENT and also routine" }, ctx);

  expect(run.status).toBe("passed");
  const p = run.payload as Record<string, unknown>;
  const labels = p.labels as string[];
  // "urgent" matches first (case-insensitive) — only the first match is recorded
  expect(labels).toEqual(["urgent"]);
});

test("enrich merge: new fields added, existing preserved", () => {
  const flow = simpleFlow([
    st("st_enrich", "enrich", "Enrich", {
      fields: { source: "fugue", priority: "high" },
    }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, { source: "original", custom: "keep" }, ctx);

  expect(run.status).toBe("passed");
  const p = run.payload as Record<string, unknown>;
  expect(p.custom).toBe("keep");
  expect(p.priority).toBe("high");
  // Existing key preserved (payload takes precedence on conflict)
  expect(p.source).toBe("original");
});

test("notify entry: notification is recorded in the run", () => {
  const flow = simpleFlow([
    st("st_notify", "notify", "Notify", { message: "Hello from notify" }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, { text: "test" }, ctx);

  expect(run.status).toBe("passed");
  expect(run.notifications.length).toBe(1);
  expect(run.notifications[0].stepId).toBe("st_notify");
  expect(run.notifications[0].message).toBe("Hello from notify");
  expect(run.notifications[0].at).not.toBeNull();
});

test("branch redirect: all-clauses-false as last step → fall-through, run still passed", () => {
  const flow = simpleFlow([
    st("st_a", "enrich", "Enrich", { fields: { flag: "no" } }),
    st("st_branch", "branch", "Last", {
      when: [{ field: "flag", equals: "yes", target: "st_z" }],
    }),
  ]);

  const ctx = makeCtx();
  const run = runFlow(flow, {}, ctx);

  expect(run.status).toBe("passed");
  const stepIds = run.attempts.map((a) => a.stepId);
  expect(stepIds).toEqual(["st_a", "st_branch"]);
});

test("determinism: same input + fixed clock produces identical timeline", () => {
  const flow = simpleFlow([
    st("st_a", "enrich", "Enrich", { fields: { a: 1 } }),
    st("st_b", "transform", "Transform", { template: "{{input}} → done" }),
    st("st_c", "notify", "Notify", { message: "done" }),
  ]);

  const payload = { input: "hello", text: "hello" };
  const ctx1 = makeCtx(1000000);
  const ctx2 = makeCtx(1000000);

  const run1 = runFlow(flow, structuredClone(payload), ctx1);
  const run2 = runFlow(flow, structuredClone(payload), ctx2);

  // Compare attempts arrays (excluding run.id which differs by counter)
  expect(JSON.stringify(run1.attempts)).toBe(JSON.stringify(run2.attempts));
  expect(run1.startedAt).toBe(run2.startedAt);
  expect(run1.endedAt).toBe(run2.endedAt);
  expect(JSON.stringify(run1.notifications)).toBe(JSON.stringify(run2.notifications));
});
