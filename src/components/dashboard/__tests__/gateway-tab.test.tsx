// Component tests for src/components/dashboard/gateway-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty states with the GET /api/bridge response stubbed: KPI row,
// per-model breakdown counts, request table rows, formatTokens sums, and the
// no-requests empty surface.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import type { BridgeLogEntry, BridgeResponse } from "@/lib/agent-types";
import { GatewayTab } from "../gateway-tab";
import { createEngine, type EngineStub, renderWithProviders } from "./helpers";

const engine: EngineStub = createEngine();

beforeEach(() => {
  engine.install();
  engine.reset();
});

afterEach(() => {
  cleanup();
  engine.restore();
});

const minutesAgo = (m: number) => Date.now() - m * 60_000;

function bridgeEntry(over: Partial<BridgeLogEntry> = {}): BridgeLogEntry {
  return {
    ts: minutesAgo(10),
    model: "kimi-k2.5",
    stream: true,
    messages: 6,
    tools: 8,
    finishReason: "stop",
    contentChars: 1200,
    toolCalls: 2,
    promptTokens: 4200,
    completionTokens: 800,
    durationMs: 8200,
    ...over,
  };
}

function routeBridge(log: BridgeLogEntry[], over: Partial<BridgeResponse> = {}) {
  const response: BridgeResponse = {
    log,
    requests: log.length,
    errors: 0,
    url: "http://localhost:3031",
    ...over,
  };
  engine.route("/api/bridge", response);
}

describe("GatewayTab — happy state", () => {
  test("renders KPIs, model breakdown counts, and request table rows from engine data", async () => {
    routeBridge(
      [
        bridgeEntry({
          ts: minutesAgo(2),
          model: "kimi-k2.5",
          messages: 12,
          tools: 3,
          promptTokens: 1500,
          completionTokens: 300,
          durationMs: 4000,
        }),
        bridgeEntry({
          ts: minutesAgo(5),
          model: "kimi-k2.5",
          promptTokens: 2500,
          completionTokens: 500,
          durationMs: 2000,
        }),
        bridgeEntry({
          ts: minutesAgo(8),
          model: "qwen3.7-plus",
          stream: false,
          promptTokens: 1000,
          completionTokens: 200,
          durationMs: 6000,
        }),
      ],
      { requests: 42, errors: 3 }
    );
    renderWithProviders(<GatewayTab />);

    // Model names appear once in the breakdown plus once per table row.
    expect((await screen.findAllByText("kimi-k2.5")).length).toBe(3);
    expect(screen.getAllByText("qwen3.7-plus").length).toBe(2);

    // KPI row: the requests counter and its errors sub.
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("3 errors")).toBeTruthy();

    // Model breakdown: per-model request counts (kimi-k2.5 x2, qwen3.7-plus x1).
    expect(screen.getByText("2 reqs")).toBeTruthy();
    expect(screen.getByText("1 reqs")).toBeTruthy();

    // Request table: 3 body rows; the msgs/tools cell; stream flags.
    expect(document.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(screen.getByText("12 · 3")).toBeTruthy();
    expect(screen.getAllByText("yes").length).toBe(2);
    expect(screen.getAllByText("no").length).toBe(1);

    // Latency sparkline: recharts renders its responsive-container surface.
    expect(document.querySelector(".recharts-responsive-container")).toBeTruthy();
  });
});

describe("GatewayTab — empty state", () => {
  test("empty log and zero requests render the no-requests surface", async () => {
    routeBridge([], { requests: 0, errors: 0 });
    renderWithProviders(<GatewayTab />);

    expect(await screen.findByText("No requests yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Every model call the engine makes lands here — run a cycle or a console prompt."
      )
    ).toBeTruthy();
    // Static heading survives; the breakdown/table surfaces are gone.
    expect(screen.getByText("Gateway")).toBeTruthy();
    expect(screen.queryAllByText("2 reqs")).toHaveLength(0);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(0);
  });
});

describe("GatewayTab — token sums", () => {
  test("KPI token sums are formatted via formatTokens (4k in / 800 out)", async () => {
    routeBridge([
      bridgeEntry({
        ts: minutesAgo(2),
        model: "kimi-k2.5",
        promptTokens: 1500,
        completionTokens: 300,
        durationMs: 4000,
      }),
      bridgeEntry({
        ts: minutesAgo(5),
        model: "kimi-k2.5",
        promptTokens: 2500,
        completionTokens: 500,
        durationMs: 2000,
      }),
    ]);
    renderWithProviders(<GatewayTab />);

    // formatTokens: 1500 + 2500 = 4000 → "4k"; 300 + 500 = 800 → "800"
    // (agent-format.ts strips a trailing ".0" below 100k).
    expect(await screen.findByText("4k")).toBeTruthy();
    expect(screen.getByText("800")).toBeTruthy();
  });
});
