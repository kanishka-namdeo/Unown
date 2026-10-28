import { test, expect } from "bun:test";
import { seedState, emptyStepTypeCounts, DEMO_USER_EMAIL } from "./seed";

test("seedState: 2 workspaces with fixed ids", () => {
  const s = seedState();
  expect(s.workspaces.length).toBe(2);
  expect(s.workspaces[0].id).toBe("ws_atlas");
  expect(s.workspaces[1].id).toBe("ws_borealis");
  expect(s.workspaces[0].slug).toBe("atlas");
  expect(s.workspaces[1].slug).toBe("borealis");
});

test("seedState: 1 demo user with fixed email", () => {
  const s = seedState();
  expect(s.users.length).toBe(1);
  expect(s.users[0].email).toBe(DEMO_USER_EMAIL);
  expect(s.users[0].id).toBe("usr_demo");
});

test("seedState: 1 demo flow per workspace", () => {
  const s = seedState();
  expect(s.flows.length).toBe(2);
  const atlasFlow = s.flows.find((f) => f.workspaceId === "ws_atlas")!;
  const borealisFlow = s.flows.find((f) => f.workspaceId === "ws_borealis")!;
  expect(atlasFlow).toBeDefined();
  expect(borealisFlow).toBeDefined();
  expect(atlasFlow.enabled).toBe(true);
});

test("seedState: demo flow has transform → classify → branch → notify", () => {
  const s = seedState();
  const flow = s.flows[0];
  const types = flow.steps.map((st) => st.type);
  expect(types[0]).toBe("transform");
  expect(types.some((t) => t === "classify")).toBe(true);
  expect(types.some((t) => t === "branch")).toBe(true);
  expect(types.some((t) => t === "notify")).toBe(true);
});

test("seedState: 3 seeded runs per workspace (6 total)", () => {
  const s = seedState();
  expect(s.runs.length).toBe(6);
  const atlasRuns = s.runs.filter((r) => r.workspaceId === "ws_atlas");
  const borealisRuns = s.runs.filter((r) => r.workspaceId === "ws_borealis");
  expect(atlasRuns.length).toBe(3);
  expect(borealisRuns.length).toBe(3);
});

test("seedState: fixed timestamps (no clock leakage)", () => {
  const s = seedState();
  // All seeded timestamps should be in 2025 (the SEED_TS month), never the current year.
  for (const ws of s.workspaces) {
    expect(ws.createdAt.startsWith("2025")).toBe(true);
  }
  for (const run of s.runs) {
    expect(run.startedAt.startsWith("2025")).toBe(true);
  }
});

test("seedState: byte-stable across calls", () => {
  expect(JSON.stringify(seedState())).toBe(JSON.stringify(seedState()));
});

test("seedState: seq counter is set to avoid id collisions", () => {
  const s = seedState();
  expect(s.seq).toBeGreaterThanOrEqual(15);
});

test("emptyStepTypeCounts: all 5 types at zero", () => {
  const counts = emptyStepTypeCounts();
  expect(Object.keys(counts)).toHaveLength(5);
  for (const v of Object.values(counts)) {
    expect(v).toBe(0);
  }
});

test("seedState: fixed version tag", () => {
  const s = seedState();
  expect(s.version).toBe(1);
});
