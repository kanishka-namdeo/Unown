import { test, expect, beforeEach } from "bun:test";
import { runTransform, runClassify, runEnrich, runBranch, runNotify } from "./index";
import type { FlowStep, Run } from "../types";
import type { EngineCtx } from "../engine";

function ctx(): EngineCtx {
  let t = 1000000;
  return {
    now: () => new Date(t).toISOString(),
    nextRunId: () => "run_x",
    measure: () => 5,
    snapshot: (p) => p,
  };
}

const st = (type: FlowStep["type"], config: FlowStep["config"]): FlowStep => ({
  id: "st_1",
  type,
  name: "step",
  config,
  retry: { maxAttempts: 1 },
});

test("transform: applies template with {{input}} placeholder", () => {
  const step = st("transform", { template: "Hello {{input}}!" });
  const { payload, error } = runTransform({ input: "world" }, step, ctx());
  expect(error).toBeUndefined();
  expect(payload).toEqual({ input: "world", text: "Hello world!" });
});

test("transform: uses text field when input is missing", () => {
  const step = st("transform", { template: "Got: {{input}}" });
  const { payload, error } = runTransform({ text: "from text" }, step, ctx());
  expect(error).toBeUndefined();
  expect((payload as Record<string, unknown>).text).toBe("Got: from text");
});

test("transform: missing text field → honest error", () => {
  const step = st("transform", { template: "{{input}}" });
  const { payload, error } = runTransform({}, step, ctx());
  expect(error).toBe("transform: payload has no text field");
  expect(payload).toEqual({});
});

test("transform: resolves named field placeholders", () => {
  const step = st("transform", { template: "{{name}} ({{level}})" });
  const { payload, error } = runTransform({ input: "x", name: "Alice", level: "P1" }, step, ctx());
  expect(error).toBeUndefined();
  expect((payload as Record<string, unknown>).text).toBe("Alice (P1)");
});

test("classify: first matching label wins (case-insensitive)", () => {
  const step = st("classify", {
    rules: {
      urgent: ["URGENT", "critical"],
      routine: ["routine", "normal"],
    },
  });
  const { payload, error } = runClassify({ text: "this is URGENT" }, step, ctx());
  expect(error).toBeUndefined();
  const labels = (payload as Record<string, unknown>).labels as string[];
  expect(labels).toEqual(["urgent"]);
});

test("classify: no match → empty labels, no error", () => {
  const step = st("classify", { rules: { urgent: ["urgent"] } });
  const { payload, error } = runClassify({ text: "nothing matches" }, step, ctx());
  expect(error).toBeUndefined();
  expect((payload as Record<string, unknown>).labels).toEqual([]);
});

test("classify: dedupes labels (does not re-add an existing label)", () => {
  const step = st("classify", { rules: { urgent: ["urgent"], routine: ["routine"] } });
  const { payload, error } = runClassify({ text: "urgent and routine", labels: ["urgent"] }, step, ctx());
  expect(error).toBeUndefined();
  const labels = (payload as Record<string, unknown>).labels as string[];
  // "urgent" already present → not re-added; "routine" is new → added
  expect(labels).toEqual(["urgent", "routine"]);
});

test("enrich: shallow-merges config.fields onto payload", () => {
  const step = st("enrich", { fields: { source: "fugue", extra: 42 } });
  const { payload, error } = runEnrich({ source: "original", keep: true }, step, ctx());
  expect(error).toBeUndefined();
  const p = payload as Record<string, unknown>;
  expect(p.keep).toBe(true);
  expect(p.extra).toBe(42);
  expect(p.source).toBe("original");
});

test("branch: passes payload through unchanged", () => {
  const step = st("branch", { when: [{ field: "x", target: "st_y" }] });
  const input = { a: 1 };
  const { payload, error } = runBranch(input, step, ctx());
  expect(error).toBeUndefined();
  expect(payload).toBe(input);
});

test("notify: pushes a notification entry onto the run", () => {
  const step = st("notify", { message: "custom message" });
  const run: Run = {
    id: "run_1",
    flowId: "fl_1",
    workspaceId: "ws_1",
    status: "running",
    startedAt: "2025-01-01T00:00:00.000Z",
    endedAt: null,
    payload: {},
    attempts: [],
    notifications: [],
  };
  const c = ctx();
  const { error } = runNotify({}, step, c, run);
  expect(error).toBeUndefined();
  expect(run.notifications.length).toBe(1);
  expect(run.notifications[0].message).toBe("custom message");
  expect(run.notifications[0].stepId).toBe("st_1");
});

test("notify: falls back to step.name when message is absent", () => {
  const step = st("notify", {});
  const run: Run = {
    id: "run_1",
    flowId: "fl_1",
    workspaceId: "ws_1",
    status: "running",
    startedAt: "2025-01-01T00:00:00.000Z",
    endedAt: null,
    payload: {},
    attempts: [],
    notifications: [],
  };
  const { error } = runNotify({}, step, ctx(), run);
  expect(error).toBeUndefined();
  expect(run.notifications[0].message).toBe("step");
});
