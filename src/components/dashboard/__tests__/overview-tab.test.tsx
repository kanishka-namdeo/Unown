// Component tests for src/components/dashboard/overview-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states per tab with engine responses stubbed, plus the
// run-task mutation (success → qk.overview invalidation; 409-busy → warning
// toast, no false success).
//
// Runs under `bun test src` with the happy-dom global preload (src/test-dom-setup.ts).
// Toast assertions go through the sonner toast spy (see helpers.tsx header for
// why the Toaster is not mounted).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qk } from "@/lib/agent-api";
import { OverviewTab } from "../overview-tab";
import * as fx from "./fixtures";
import {
  busyResponse,
  createEngine,
  type EngineStub,
  installToastSpy,
  renderWithProviders,
  resetActivityStore,
  resetToasts,
  toastsWithTitle,
} from "./helpers";

installToastSpy();

const engine: EngineStub = createEngine();

beforeEach(() => {
  engine.install();
  resetActivityStore();
  resetToasts();
});

afterEach(() => {
  cleanup();
  engine.restore();
});

function routeHappy() {
  engine.route("/api/overview", fx.overviewResponse());
  engine.route("/api/tasks", fx.tasksResponse());
  engine.route("/api/jobs", fx.jobsResponse());
}

describe("OverviewTab — happy state", () => {
  test("renders KPI row, the 5 patterns, and benchmark task rows from engine data", async () => {
    routeHappy();
    renderWithProviders(<OverviewTab />);

    // KPI row: values from the overview fixture.
    expect(await screen.findByText("fix login flow redirect")).toBeTruthy();
    expect(screen.getByText("84%")).toBeTruthy(); // pass rate
    expect(screen.getByText("6/12")).toBeTruthy(); // learning suite
    expect(screen.queryAllByText("saturated")).toHaveLength(0); // suite.saturated=false → badge absent
    expect(screen.getAllByText("4").length).toBeGreaterThan(0); // improvements shipped

    // The 5 patterns strip.
    expect(screen.getByText("Tiered Memory")).toBeTruthy();
    expect(screen.getByText("Self-Improving Harness")).toBeTruthy();

    // Task table rows: provenance badges from task minting.
    expect(screen.getByText("parse csv headers robustly")).toBeTruthy();
    expect(screen.getAllByText("minted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("capability").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /run cycle/i })).toHaveLength(2);

    // Live activity card renders its empty feed (no SSE in this harness).
    expect(screen.getByText("No live events yet")).toBeTruthy();
  });

  test("cumulative-pass chart renders when trend data exists", async () => {
    routeHappy();
    renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");
    // recharts ResponsiveContainer renders an svg surface for the area chart.
    expect(document.querySelector(".recharts-responsive-container")).toBeTruthy();
    expect(screen.queryAllByText("No passes yet")).toHaveLength(0);
  });
});

describe("OverviewTab — empty state", () => {
  test("zero KPIs, no chart data, and the no-tasks empty surface", async () => {
    engine.route(
      "/api/overview",
      fx.overviewResponse({
        kpis: {
          totalRuns: 0,
          passed: 0,
          failed: 0,
          errors: 0,
          passRate: 0,
          tasks: 0,
          improvementsShipped: 0,
          dreams: 0,
          notes: { total: 0, pending: 0 },
          hooks: { total: 0, denies: 0 },
          tokens: { in: 0, out: 0 },
          suite: null,
        },
        trend: [],
        memoryVersions: { policy: 0, project: 0, user: 0, local: 0 },
      })
    );
    engine.route("/api/tasks", { tasks: [] });
    engine.route("/api/jobs", { jobs: [] });

    renderWithProviders(<OverviewTab />);

    expect(await screen.findByText("No tasks loaded")).toBeTruthy();
    expect(screen.getByText("No passes yet")).toBeTruthy(); // trend chart empty state
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("awaiting engine task minting")).toBeTruthy(); // suite absent
  });
});

describe("OverviewTab — error state", () => {
  test("fetch rejections degrade to zeroed KPIs and empty surfaces, no crash", async () => {
    engine.route("/api/overview", new TypeError("engine unreachable"));
    engine.route("/api/tasks", new TypeError("engine unreachable"));
    engine.route("/api/jobs", new TypeError("engine unreachable"));

    renderWithProviders(<OverviewTab />);

    // Static structure still renders; data-backed surfaces fall back to defaults.
    expect(await screen.findByText("The 5 patterns")).toBeTruthy();
    expect(screen.getByText("Benchmark tasks")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText("No tasks loaded")).toBeTruthy();
  });
});

describe("OverviewTab — run-cycle mutation", () => {
  test("success: POSTs the task run endpoint, toasts, and invalidates qk.overview", async () => {
    routeHappy();
    engine.route("/api/tasks/fix-login-flow/run", (call) => {
      expect(call.method).toBe("POST");
      return { started: true };
    });

    const user = userEvent.setup();
    const view = renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");

    await user.click(screen.getAllByRole("button", { name: /run cycle/i })[0]);

    expect(toastsWithTitle("Cycle started")).toHaveLength(1);
    expect(toastsWithTitle("Cycle started")[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.overview);
    expect(engine.callsFor("/api/tasks/fix-login-flow/run")).toHaveLength(1);
  });

  test("409-busy: warning toast, no false success, no invalidation", async () => {
    routeHappy();
    engine.route("/api/tasks/fix-login-flow/run", busyResponse());

    const user = userEvent.setup();
    const view = renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");

    await user.click(screen.getAllByRole("button", { name: /run cycle/i })[0]);

    const busy = toastsWithTitle("Engine busy — a background job is learning right now");
    expect(busy).toHaveLength(1);
    expect(busy[0]?.kind).toBe("warning");
    expect(toastsWithTitle("Cycle started")).toHaveLength(0); // no false success
    expect(view.invalidatedKeys()).not.toContainEqual(qk.overview);
  });
});
