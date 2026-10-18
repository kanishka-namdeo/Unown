// Component tests for src/components/dashboard/router-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed, plus the job
// mutations: toggle (POST /api/jobs/<id>/toggle → toast + qk.jobs invalidation)
// and trigger (POST /api/jobs/<id>/trigger → toast + qk.jobs/qk.overview
// invalidation); a 409-busy trigger degrades to a warning toast, no false
// success. Destructive toggles stay disabled while a toggle is pending.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qk } from "@/lib/agent-api";
import { RouterTab } from "../router-tab";
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
  engine.reset();
  resetActivityStore();
  resetToasts();
});

afterEach(() => {
  cleanup();
  engine.restore();
});

function routeHappy() {
  engine.route("/api/jobs", fx.jobsResponse());
}

describe("RouterTab — happy state", () => {
  test("renders both job cards with schedules, switches and trigger buttons", async () => {
    routeHappy();
    renderWithProviders(<RouterTab />);

    expect(await screen.findByText("Router")).toBeTruthy();
    expect(screen.getByText("harness cycle")).toBeTruthy();
    // The autodream job renders its name AND its id — both read "autodream".
    expect(screen.getAllByText("autodream")).toHaveLength(2);

    // Interval job meta: schedule, run count, next-fire; event job fires on note:created.
    expect(screen.getByText("every 1h")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy(); // run_count (inner span of "runs: 12")
    expect(screen.getAllByText("runs:")).toHaveLength(2); // one per job card
    expect(screen.getByText((content) => content.startsWith("next: "))).toBeTruthy();
    expect(screen.getByText("note:created")).toBeTruthy();

    // Both idle: two idle pills, two enabled trigger buttons, two switches.
    expect(screen.getAllByText("idle")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Trigger" })).toHaveLength(2);
    expect(screen.getAllByRole("switch")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "toggle harness cycle" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "toggle autodream" })).toBeTruthy();

    // Job event feed renders its empty surface (no SSE in this harness).
    expect(screen.getByText("No live events yet")).toBeTruthy();
  });
});

describe("RouterTab — job toggle", () => {
  test("flipping a switch confirms, POSTs the toggle, toasts, and invalidates qk.jobs", async () => {
    routeHappy();
    engine.route("/api/jobs/autodream/toggle", { job: fx.job({ id: "autodream", name: "autodream", enabled: 1 }) });

    const user = userEvent.setup();
    const view = renderWithProviders(<RouterTab />);
    expect(await screen.findByRole("switch", { name: "toggle autodream" })).toBeTruthy();

    // The toggle is destructive (pauses the learning loop) — it now confirms first.
    await user.click(screen.getByRole("switch", { name: "toggle autodream" }));
    expect(engine.callsFor("/api/jobs/autodream/toggle")).toHaveLength(0);

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toBeTruthy();
    expect(screen.getByText('Enable "autodream"?')).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Enable" }));

    expect(engine.callsFor("/api/jobs/autodream/toggle")).toHaveLength(1);
    expect(engine.callsFor("/api/jobs/autodream/toggle")[0]?.method).toBe("POST");
    const enabled = toastsWithTitle('Enabled "autodream"');
    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.jobs);
  });

  test("cancelling the confirm dialog leaves the job untouched", async () => {
    routeHappy();
    engine.route("/api/jobs/autodream/toggle", { job: fx.job({ id: "autodream", name: "autodream", enabled: 1 }) });

    const user = userEvent.setup();
    renderWithProviders(<RouterTab />);
    expect(await screen.findByRole("switch", { name: "toggle autodream" })).toBeTruthy();

    await user.click(screen.getByRole("switch", { name: "toggle autodream" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(engine.callsFor("/api/jobs/autodream/toggle")).toHaveLength(0);
  });
});

describe("RouterTab — job trigger", () => {
  test("triggering harness-cycle POSTs, toasts the long-run hint, and invalidates jobs + overview", async () => {
    routeHappy();
    engine.route("/api/jobs/harness-cycle/trigger", { ok: true });

    const user = userEvent.setup();
    const view = renderWithProviders(<RouterTab />);
    expect(await screen.findByText("harness cycle")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Trigger" })[0]);

    expect(engine.callsFor("/api/jobs/harness-cycle/trigger")).toHaveLength(1);
    expect(engine.callsFor("/api/jobs/harness-cycle/trigger")[0]?.method).toBe("POST");
    const started = toastsWithTitle("Job started");
    expect(started).toHaveLength(1);
    expect(started[0]?.kind).toBe("success");
    expect(started[0]?.description).toContain("takes minutes"); // harness-cycle branch
    expect(view.invalidatedKeys()).toContainEqual(qk.jobs);
    expect(view.invalidatedKeys()).toContainEqual(qk.overview);
  });

  test("409-busy trigger: warning toast, no false success, no invalidation", async () => {
    routeHappy();
    engine.route("/api/jobs/harness-cycle/trigger", busyResponse());

    const user = userEvent.setup();
    const view = renderWithProviders(<RouterTab />);
    expect(await screen.findByText("harness cycle")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Trigger" })[0]);

    const busy = toastsWithTitle("Engine busy — a background job is learning right now");
    expect(busy).toHaveLength(1);
    expect(busy[0]?.kind).toBe("warning");
    expect(toastsWithTitle("Job started")).toHaveLength(0); // no false success
    expect(view.invalidatedKeys()).not.toContainEqual(qk.jobs);
  });
});

describe("RouterTab — empty state", () => {
  test("no jobs registered", async () => {
    engine.route("/api/jobs", { jobs: [] });
    renderWithProviders(<RouterTab />);

    expect(await screen.findByText("No jobs registered")).toBeTruthy();
  });
});

describe("RouterTab — error state", () => {
  test("fetch rejection degrades to the empty surface, no crash", async () => {
    engine.route("/api/jobs", new TypeError("engine unreachable"));
    renderWithProviders(<RouterTab />);

    expect(await screen.findByText("No jobs registered")).toBeTruthy();
    expect(screen.getByText("Router")).toBeTruthy(); // static heading survived
    expect(screen.getByText("No live events yet")).toBeTruthy();
  });
});
