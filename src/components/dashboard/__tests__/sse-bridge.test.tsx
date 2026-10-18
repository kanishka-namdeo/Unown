// Component tests for the SSE bridge in src/components/dashboard/providers.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" > "SSE bridge":
// mocked EventSource delivering `run:finished` invalidates the run/overview
// queries (observed as real refetches of the mounted probe queries); an
// unknown event is a no-op for queries; a malformed JSON frame is ignored
// without crashing; `router:error` surfaces a sonner error toast.
//
// The EventSource double is the FakeEventSource from helpers.tsx — happy-dom
// ships no EventSource implementation, and providers.tsx reads the global.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { api, qk } from "@/lib/agent-api";
import { useActivityStore, useRunStreamStore } from "@/lib/agent-store";
import { DashboardProviders } from "../providers";
import * as fx from "./fixtures";
import {
  createEngine,
  type EngineStub,
  type EventSourceStub,
  installFakeEventSource,
  installToastSpy,
  resetActivityStore,
  resetToasts,
  toastsWithTitle,
} from "./helpers";

installToastSpy();

const engine: EngineStub = createEngine();
let esStub: EventSourceStub;

beforeEach(() => {
  engine.install();
  engine.reset();
  esStub = installFakeEventSource();
  resetActivityStore();
  resetToasts();
});

afterEach(() => {
  cleanup();
  engine.restore();
  esStub.restore();
});

/** Probe: mounts two of the queries that `run:finished` invalidates. */
function Probe() {
  const runs = useQuery({ queryKey: qk.runs, queryFn: () => api.runs() });
  const overview = useQuery({ queryKey: qk.overview, queryFn: api.overview });
  return (
    <div>
      <p>probe-runs: {runs.data?.runs.length ?? "-"} runs</p>
      <p>probe-overview: {overview.data?.kpis.totalRuns ?? "-"} total</p>
    </div>
  );
}

function frame(event: string, payload: Record<string, unknown> = {}): string {
  return JSON.stringify({ event, payload, ts: Date.now() });
}

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function renderWithProbe() {
  engine.route("/api/runs", fx.runsResponse());
  engine.route("/api/overview", fx.overviewResponse());
  render(
    <DashboardProviders>
      <Probe />
    </DashboardProviders>
  );
  expect(await screen.findByText("probe-runs: 3 runs")).toBeTruthy();
  expect(screen.getByText("probe-overview: 25 total")).toBeTruthy();
  const sse = esStub.latest();
  sse.simulateOpen();
  expect(useActivityStore.getState().connected).toBe(true);
  return sse;
}

describe("SseBridge (providers.tsx)", () => {
  test("run:finished invalidates and refetches the mounted run + overview queries", async () => {
    const sse = await renderWithProbe();
    expect(engine.callsFor("/api/runs")).toHaveLength(1);
    expect(engine.callsFor("/api/overview")).toHaveLength(1);

    sse.deliver(frame("run:finished", { taskId: "fix-login-flow", status: "passed", durationMs: 61_000 }));

    await waitFor(() => expect(engine.callsFor("/api/runs").length).toBe(2));
    await waitFor(() => expect(engine.callsFor("/api/overview").length).toBe(2));

    // The event also lands in the activity feed store with its described text.
    expect(useActivityStore.getState().items[0]?.text).toBe("run finished · fix-login-flow · passed · 61s");
  });

  test("unknown event is a query no-op (no refetch, no crash)", async () => {
    const sse = await renderWithProbe();

    sse.deliver(frame("mystery-mode"));
    await settle(120);

    expect(engine.callsFor("/api/runs")).toHaveLength(1);
    expect(engine.callsFor("/api/overview")).toHaveLength(1);
    // describe() still surfaces unknown events as raw activity lines.
    expect(useActivityStore.getState().items[0]?.text).toBe("mystery-mode");
  });

  test("malformed JSON frame is ignored without crashing the tree", async () => {
    const sse = await renderWithProbe();

    sse.deliver("{not valid json");
    await settle(120);

    expect(engine.callsFor("/api/runs")).toHaveLength(1);
    expect(engine.callsFor("/api/overview")).toHaveLength(1);
    expect(screen.getByText("probe-runs: 3 runs")).toBeTruthy(); // probe still rendered
  });

  test("router:error fires an error toast and invalidates the overview query", async () => {
    const sse = await renderWithProbe();

    sse.deliver(frame("router:error", { error: "cycle crashed: exit 1" }));

    const toasts = toastsWithTitle("Router error");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.description).toBe("cycle crashed: exit 1");

    await waitFor(() => expect(engine.callsFor("/api/overview").length).toBe(2));
    expect(engine.callsFor("/api/runs")).toHaveLength(1); // run list untouched by router errors
    expect(useActivityStore.getState().items[0]?.text).toBe("router error · cycle crashed: exit 1");
  });
});

/** Probe mounting the queries the minted-entity events invalidate. */
function WideProbe() {
  const skills = useQuery({ queryKey: qk.skills, queryFn: () => api.skills() });
  const tasks = useQuery({ queryKey: qk.tasks, queryFn: () => api.tasks() });
  const improvements = useQuery({ queryKey: qk.improvements, queryFn: () => api.improvements() });
  const memory = useQuery({ queryKey: qk.memory, queryFn: () => api.memory() });
  const notes = useQuery({ queryKey: qk.notes, queryFn: () => api.notes() });
  const bridge = useQuery({ queryKey: qk.bridge, queryFn: () => api.bridge() });
  return (
    <div>
      <p>probe-skills: {skills.data?.skills.length ?? "-"} skills</p>
      <p>probe-tasks: {tasks.data?.tasks.length ?? "-"} tasks</p>
      <p>probe-improvements: {improvements.data?.improvements.length ?? "-"} improvements</p>
      <p>probe-memory: {memory.data?.tiers.length ?? "-"} tiers</p>
      <p>probe-notes: {notes.data?.notes.length ?? "-"} notes</p>
      <p>probe-bridge: {bridge.data?.requests ?? "-"} requests</p>
    </div>
  );
}

async function renderWithWideProbe() {
  engine.route("/api/skills", fx.skillsResponse());
  engine.route("/api/tasks", fx.tasksResponse());
  engine.route("/api/improvements", fx.improvementsResponse());
  engine.route("/api/memory", fx.memoryResponse());
  engine.route("/api/notes", fx.notesResponse());
  engine.route("/api/bridge", fx.bridgeResponse());
  render(
    <DashboardProviders>
      <WideProbe />
    </DashboardProviders>
  );
  expect(await screen.findByText("probe-skills: 2 skills")).toBeTruthy();
  expect(screen.getByText("probe-tasks: 2 tasks")).toBeTruthy();
  expect(screen.getByText("probe-improvements: 2 improvements")).toBeTruthy();
  expect(screen.getByText("probe-memory: 4 tiers")).toBeTruthy();
  expect(screen.getByText("probe-notes: 2 notes")).toBeTruthy();
  expect(screen.getByText("probe-bridge: 42 requests")).toBeTruthy();
  const sse = esStub.latest();
  sse.simulateOpen();
  return sse;
}

describe("SseBridge — minted entities, invalidation fan-out and run streams", () => {
  beforeEach(() => {
    useRunStreamStore.setState({ streams: {} }); // module singleton — fresh buffers
  });

  test("skill:minted invalidates qk.skills and renders friendly text", async () => {
    const sse = await renderWithWideProbe();
    expect(engine.callsFor("/api/skills")).toHaveLength(1);

    sse.deliver(frame("skill:minted", { id: "s1", name: "use-workspace-leak", project: "proj" }));

    await waitFor(() => expect(engine.callsFor("/api/skills").length).toBe(2));
    expect(useActivityStore.getState().items[0]?.text).toBe("skill minted · use-workspace-leak → proj");
    expect(useActivityStore.getState().items[0]?.event).toBe("skill:minted");
  });

  test("task:minted, improvement:regressed, notes:synced and run:finished each fan out to their query keys", async () => {
    const sse = await renderWithWideProbe();

    sse.deliver(frame("task:minted", { id: "t9", name: "fix-csv-escaping", source: "failed-run" }));
    await waitFor(() => expect(engine.callsFor("/api/tasks").length).toBe(2));

    sse.deliver(frame("improvement:regressed", { taskId: "fix-login-flow", rolledBackTo: 2 }));
    await waitFor(() => expect(engine.callsFor("/api/improvements").length).toBe(2));
    await waitFor(() => expect(engine.callsFor("/api/memory").length).toBe(2));

    sse.deliver(frame("notes:synced", { count: 2 }));
    await waitFor(() => expect(engine.callsFor("/api/notes").length).toBe(2));

    sse.deliver(frame("run:finished", { taskId: "fix-login-flow", status: "passed", durationMs: 61_000 }));
    // run:finished also invalidates qk.bridge — LLM calls landed in the
    // bridge request log…
    await waitFor(() => expect(engine.callsFor("/api/bridge").length).toBe(2));
    // …and qk.tasks again (the suite stats moved).
    await waitFor(() => expect(engine.callsFor("/api/tasks").length).toBe(3));

    // All four events surfaced as friendly feed lines, newest first.
    const texts = useActivityStore.getState().items.map((i) => i.text);
    expect(texts[0]).toBe("run finished · fix-login-flow · passed · 61s");
    expect(texts[1]).toBe("2 terminal notes synced from the outbox");
    expect(texts[2]).toBe("improvement regressed · unshipped, memory rolled back to v2");
    expect(texts[3]).toBe("task minted · fix-csv-escaping (failed-run)");
  });

  test("run:tool and run:text frames are forwarded into the run-stream store, not the activity feed or queries", async () => {
    const sse = await renderWithProbe();
    const itemsBefore = useActivityStore.getState().items.length;
    expect(engine.callsFor("/api/runs")).toHaveLength(1);
    expect(engine.callsFor("/api/overview")).toHaveLength(1);

    sse.deliver(frame("run:tool", { runId: "run-x", tool: "bash", phase: "start" }));
    sse.deliver(frame("run:text", { runId: "run-x", preview: "live text preview" }));

    await settle(120);

    const entries = useRunStreamStore.getState().streams["run-x"] ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("tool");
    expect((entries[0] as { tool?: string }).tool).toBe("bash");
    expect((entries[0] as { phase?: string }).phase).toBe("start");
    expect((entries[0] as { isError?: boolean }).isError).toBe(false);
    expect(entries[1]?.kind).toBe("text");
    expect((entries[1] as { preview?: string }).preview).toBe("live text preview");

    // No activity-feed item and no query invalidation for streaming frames.
    expect(useActivityStore.getState().items.length).toBe(itemsBefore);
    expect(engine.callsFor("/api/runs")).toHaveLength(1);
    expect(engine.callsFor("/api/overview")).toHaveLength(1);
  });
});

describe("SseBridge — full describe() coverage of the remaining event families", () => {
  beforeEach(() => {
    useRunStreamStore.setState({ streams: {} });
  });

  test("every remaining engine event renders friendly text and its invalidations", async () => {
    const sse = await renderWithWideProbe();

    // run:started → the non-bridge half of the run branch (tasks refetch).
    const tasksBefore = engine.callsFor("/api/tasks").length;
    sse.deliver(frame("run:started", { id: "r1", kind: "baseline", taskId: "fix-login-flow" }));
    await waitFor(() => expect(engine.callsFor("/api/tasks").length).toBeGreaterThan(tasksBefore));

    // Cycle lifecycle.
    sse.deliver(frame("cycle:started", { id: "c1", taskId: "fix-login-flow" }));
    sse.deliver(frame("cycle:finished", { id: "c1", taskId: "fix-login-flow", status: "improved" }));

    // Improvements (proposed + shipped halves).
    const improvementsBefore = engine.callsFor("/api/improvements").length;
    sse.deliver(frame("improvement:proposed", { id: "i1", taskId: "fix-login-flow", iteration: 1 }));
    sse.deliver(frame("improvement:shipped", { id: "i1", taskId: "fix-login-flow", tier: "project", memoryVersion: 6 }));
    await waitFor(() => expect(engine.callsFor("/api/improvements").length).toBeGreaterThan(improvementsBefore));

    // Dreams incl. the gated amber path and the version-suffix branch.
    const notesBefore = engine.callsFor("/api/notes").length;
    sse.deliver(frame("dream:started", { id: "d1", notesIn: 3 }));
    sse.deliver(frame("dream:finished", { id: "d1", status: "gated" }));
    sse.deliver(frame("dream:finished", { id: "d2", status: "done", version: 7 }));
    await waitFor(() => expect(engine.callsFor("/api/notes").length).toBeGreaterThan(notesBefore));

    // Memory incl. the budget pseudo-hook with pruned blocks.
    const memoryBefore = engine.callsFor("/api/memory").length;
    sse.deliver(frame("memory:changed", { tier: "project", version: 8, changedBy: "autodream" }));
    sse.deliver(frame("memory:budget", { prunedBlocks: 2, truncatedTiers: [] }));
    await waitFor(() => expect(engine.callsFor("/api/memory").length).toBeGreaterThan(memoryBefore));

    // Hooks: deny (rose) and warn (amber) tone branches.
    sse.deliver(frame("hook", { runId: "r1", hook: "PreToolUse", tool: "bash", decision: "deny", reason: "rm -rf /" }));
    sse.deliver(frame("hook", { runId: "r1", hook: "MemoryBudget", decision: "warn" }));

    // Note creation.
    sse.deliver(frame("note:created", { id: "n1", runId: "r1", kind: "terminal" }));

    // The remaining skill lifecycle events (rejected/rolled-back/retired).
    const skillsBefore = engine.callsFor("/api/skills").length;
    sse.deliver(frame("skill:rejected", { name: "bad-skill", project: "proj", dreamId: "d1" }));
    sse.deliver(frame("skill:rolled-back", { id: "s1", name: "use-workspace-leak", version: 3 }));
    sse.deliver(frame("skill:retired", { id: "s1", name: "use-workspace-leak", project: "proj" }));
    await waitFor(() => expect(engine.callsFor("/api/skills").length).toBeGreaterThan(skillsBefore));

    // The remaining mint/task lifecycle events.
    sse.deliver(frame("task:mint-discarded", { id: "t8", reason: "self-check failed" }));
    sse.deliver(frame("task:graduated", { id: "t7" }));
    sse.deliver(frame("mint:cascade", { outcome: "local_valid", taskId: "t9" }));

    // Job lifecycle + router:started.
    sse.deliver(frame("job:started", { id: "j1", name: "harness-cycle" }));
    sse.deliver(frame("job:finished", { id: "j1", name: "harness-cycle" }));
    sse.deliver(frame("job:error", { id: "j1", error: "boom" }));
    sse.deliver(frame("router:started", { jobs: 7 }));

    await settle(200);

    // Every family surfaced as friendly text (a sample of the exact strings).
    const texts = useActivityStore.getState().items.map((i) => i.text);
    for (const expected of [
      "router started · 7 jobs scheduled",
      "job error · boom",
      "job finished · harness-cycle",
      "job started · harness-cycle",
      "mint cascade · local_valid",
      "task graduated · t7 now passes — promoted to regression guard",
      "minted draft discarded · self-check failed",
      "skill retired · use-workspace-leak",
      "skill rolled back · use-workspace-leak → v3",
      "skill rejected · bad-skill · guard rules matched",
      "session note captured",
      "hook MemoryBudget · warn",
      "hook PreToolUse · bash · deny",
      "memory budget · 2 blocks pruned to fit the injection cap",
      "project memory → v8 · by autodream",
      "dream finished · done · memory v7",
      "dream finished · gated",
      "autodream started · 3 notes in",
      "improvement shipped · fix-login-flow → project memory",
      "improvement proposed · fix-login-flow · iter 1",
      "cycle finished · fix-login-flow · improved",
      "cycle started · fix-login-flow",
      "run started · fix-login-flow · baseline",
    ]) {
      expect(texts).toContain(expected);
    }

    // The gated dream reads amber, not rose.
    const gatedItem = useActivityStore.getState().items.find((i) => i.text === "dream finished · gated");
    expect(gatedItem?.tone).toBe("amber");
    const denyItem = useActivityStore.getState().items.find((i) => i.text === "hook PreToolUse · bash · deny");
    expect(denyItem?.tone).toBe("rose");
  });

  test("run:tool frames with no runId are dropped; phase end and isError map through", async () => {
    const sse = await renderWithProbe();

    sse.deliver(frame("run:tool", { tool: "bash", phase: "start" })); // no runId
    sse.deliver(frame("run:tool", { runId: "run-y", tool: "edit", phase: "end", isError: true }));
    await settle(120);

    expect(useRunStreamStore.getState().streams["run-y"] ?? []).toEqual([
      { kind: "tool", ts: expect.any(Number), tool: "edit", phase: "end", isError: true },
    ]);
    // The runId-less frame created no buffer.
    expect(Object.keys(useRunStreamStore.getState().streams)).toEqual(["run-y"]);
  });
});
