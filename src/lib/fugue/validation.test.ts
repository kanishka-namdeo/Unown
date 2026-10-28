import { test, expect } from "bun:test";
import { validateFlow } from "./validation";
import type { FlowDraft } from "./types";

const ctx = {
  id: "fl_test",
  workspaceId: "ws_test",
  now: "2025-01-01T00:00:00.000Z",
  enabled: true,
};

function draft(overrides: Partial<FlowDraft> = {}): FlowDraft {
  return {
    name: "Test Flow",
    description: "a test",
    steps: [
      {
        id: "st_1",
        type: "enrich",
        name: "Enrich",
        config: { fields: { a: 1 } },
        retry: { maxAttempts: 2 },
      },
    ],
    ...overrides,
  } as FlowDraft;
}

test("valid flow passes validation", () => {
  const result = validateFlow(draft(), ctx);
  expect(result.ok).toBe(true);
});

test("unknown step type is rejected with field-addressed error", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "bogus" as unknown as "enrich",
          name: "Bogus",
          config: {},
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[0].type")).toBe(true);
  }
});

test("empty step name is rejected", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "enrich",
          name: "",
          config: { fields: {} },
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[0].name")).toBe(true);
  }
});

test("retry.maxAttempts < 1 is rejected", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "enrich",
          name: "Enrich",
          config: { fields: {} },
          retry: { maxAttempts: 0 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[0].retry.maxAttempts")).toBe(true);
  }
});

test("branch target that does not exist is rejected", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "branch",
          name: "Branch",
          config: { when: [{ field: "x", target: "st_nonexistent" }] },
          retry: { maxAttempts: 1 },
        },
        {
          id: "st_2",
          type: "enrich",
          name: "Enrich",
          config: { fields: {} },
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(
      result.errors.some(
        (e) => e.path === "steps[0].config.when[0].target" && e.message.includes("st_nonexistent"),
      ),
    ).toBe(true);
  }
});

test("branch target 'end' is valid", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "branch",
          name: "Branch",
          config: { when: [{ field: "x", target: "end" }] },
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(true);
});

test("transform step requires template string", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "transform",
          name: "Transform",
          config: { template: "" },
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[0].config.template")).toBe(true);
  }
});

test("classify step requires non-empty rules object", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "classify",
          name: "Classify",
          config: { rules: {} },
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[0].config.rules")).toBe(true);
  }
});

test("classify keywords must be arrays of strings", () => {
  const result = validateFlow(
    draft({
      steps: [
        {
          id: "st_1",
          type: "classify",
          name: "Classify",
          config: { rules: { urgent: "not-array" } },
          retry: { maxAttempts: 1 },
        },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[0].config.rules.urgent")).toBe(true);
  }
});

test("duplicate step ids are rejected", () => {
  const result = validateFlow(
    draft({
      steps: [
        { id: "st_x", type: "enrich", name: "A", config: { fields: {} }, retry: { maxAttempts: 1 } },
        { id: "st_x", type: "enrich", name: "B", config: { fields: {} }, retry: { maxAttempts: 1 } },
      ],
    }),
    ctx,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "steps[1].id" && e.message.includes("duplicate"))).toBe(
      true,
    );
  }
});

test("empty flow name is rejected", () => {
  const result = validateFlow(draft({ name: "  " }), ctx);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.errors.some((e) => e.path === "name")).toBe(true);
  }
});
