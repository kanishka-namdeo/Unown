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
import { cleanup, screen, waitFor } from "@testing-library/react";
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

describe("OverviewTab — mint-task mutation", () => {
  // The file-level beforeEach installs the engine but does not reset it;
  // reset here so the per-test /api/tasks/mint call counts stay isolated.
  beforeEach(() => {
    engine.reset();
  });

  test("minted outcome POSTs /api/tasks/mint, toasts success, invalidates qk.tasks + qk.overview", async () => {
    routeHappy();
    engine.route("/api/tasks/mint", {
      ok: true,
      outcome: {
        status: "minted",
        taskId: "minted-001",
        reason: "authored from failure mining",
        source: "failed-run",
      },
    });

    const user = userEvent.setup();
    const view = renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");

    await user.click(screen.getByRole("button", { name: /mint task/i }));

    const mints = engine.callsFor("/api/tasks/mint");
    expect(mints).toHaveLength(1);
    expect(mints[0]?.method).toBe("POST");

    const minted = toastsWithTitle("Task minted — minted-001");
    expect(minted).toHaveLength(1);
    expect(minted[0]?.kind).toBe("success");
    expect(minted[0]?.description).toBe("authored from failure mining");
    expect(view.invalidatedKeys()).toContainEqual(qk.tasks);
    expect(view.invalidatedKeys()).toContainEqual(qk.overview);
  });

  test("skipped outcome surfaces an info toast, no false success", async () => {
    routeHappy();
    engine.route("/api/tasks/mint", {
      ok: true,
      outcome: { status: "skipped", reason: "no unmined failed runs" },
    });

    const user = userEvent.setup();
    const view = renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");

    await user.click(screen.getByRole("button", { name: /mint task/i }));

    const skipped = toastsWithTitle("Minting skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.kind).toBe("info");
    expect(skipped[0]?.description).toBe("no unmined failed runs");
    expect(toastsWithTitle("Task minted — minted-001")).toHaveLength(0); // no false success
    expect(engine.callsFor("/api/tasks/mint")).toHaveLength(1);
    expect(engine.callsFor("/api/tasks/mint")[0]?.method).toBe("POST");
    expect(view.invalidatedKeys()).toContainEqual(qk.tasks); // list still refreshed
  });

  test("409-busy: warning toast, no false success, no invalidation", async () => {
    routeHappy();
    engine.route("/api/tasks/mint", busyResponse());

    const user = userEvent.setup();
    const view = renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");

    await user.click(screen.getByRole("button", { name: /mint task/i }));

    const busy = toastsWithTitle("Engine busy — a background job is learning right now");
    expect(busy).toHaveLength(1);
    expect(busy[0]?.kind).toBe("warning");
    expect(toastsWithTitle("Task minted — minted-001")).toHaveLength(0); // no false success
    expect(toastsWithTitle("Minting skipped")).toHaveLength(0);
    expect(view.invalidatedKeys()).not.toContainEqual(qk.tasks);
    expect(view.invalidatedKeys()).not.toContainEqual(qk.overview);
    expect(engine.callsFor("/api/tasks/mint")).toHaveLength(1);
  });
});

describe("OverviewTab — task detail dialog", () => {
  beforeEach(() => {
    engine.reset();
  });

  test("clicking a task name opens the task detail dialog (prompt, files, verify) and Escape closes it", async () => {
    routeHappy();
    engine.route("/api/tasks/fix-login-flow", {
      task: {
        ...fx.task(),
        files: { "a.js": "content" },
        verify: "node --test",
        prompt: "fix it",
      },
    });

    const user = userEvent.setup();
    renderWithProviders(<OverviewTab />);
    await screen.findByText("fix login flow redirect");

    // The task name is a button in the tasks table.
    await user.click(screen.getByText("fix login flow redirect").closest("button") as HTMLElement);

    expect(await screen.findByText("AGENT PROMPT", { exact: false })).toBeTruthy();
    expect(screen.getByText("fix it")).toBeTruthy();
    expect(screen.getByText("a.js")).toBeTruthy();
    expect(screen.getByText("node --test")).toBeTruthy();
    expect(engine.callsFor("/api/tasks/fix-login-flow")).toHaveLength(1);

    // Escape dismisses the dialog.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(screen.queryAllByText("fix it")).toHaveLength(0);
  });
});
