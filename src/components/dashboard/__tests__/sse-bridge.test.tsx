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
import { useActivityStore } from "@/lib/agent-store";
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
