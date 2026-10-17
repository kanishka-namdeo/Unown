// Component tests for src/components/dashboard/learning-lab-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed. Also exercises the
// run-row click path into the shared RunDetailDialog (prompt + transcript).
//
// Note: the runs table renders task ids and status/kind badges, not run ids
// (run ids only appear inside the opened detail dialog).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LearningLabTab } from "../learning-lab-tab";
import * as fx from "./fixtures";
import { createEngine, type EngineStub, renderWithProviders } from "./helpers";

const engine: EngineStub = createEngine();

beforeEach(() => {
  engine.install();
});

afterEach(() => {
  cleanup();
  engine.restore();
});

function routeHappy() {
  engine.route("/api/cycles", fx.cyclesResponse());
  engine.route("/api/improvements", fx.improvementsResponse());
  engine.route("/api/runs", fx.runsResponse());
}

describe("LearningLabTab — happy state", () => {
  test("renders cycle timeline, improvement cards, and the runs table", async () => {
    routeHappy();
    renderWithProviders(<LearningLabTab />);

    // Cycles: statuses + summaries + iteration chips.
    expect(await screen.findByText("shipped a memory patch about cookie scoping")).toBeTruthy();
    expect(screen.getAllByText("improved")).toHaveLength(1);
    expect(screen.getAllByText("no-fix")).toHaveLength(1);
    expect(screen.getAllByText("iter 2").length).toBeGreaterThanOrEqual(2);

    // Improvements: diagnosis/proposal/patch from the fixture.
    expect(screen.getByText("The agent missed that the cookie path was scoped to /auth only.")).toBeTruthy();
    expect(screen.getByText("Teach the agent to check cookie scope before redirecting.")).toBeTruthy();
    expect(screen.getByText("- When a redirect drops the session, check the cookie path first.")).toBeTruthy();
    expect(screen.getAllByText("shipped")).toHaveLength(1);
    expect(screen.getAllByText("proposed")).toHaveLength(1);

    // Runs table: 3 rows (task ids + status/kind badges), counted header.
    expect(screen.getByText("3 runs")).toBeTruthy();
    expect(screen.getAllByText("fix-login-flow").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("baseline")).toHaveLength(1);
    expect(screen.getAllByText("candidate")).toHaveLength(1);
    expect(screen.getAllByText("failed")).toHaveLength(1);
  });

  test("clicking a run row opens the detail dialog with prompt, transcript and verification", async () => {
    routeHappy();
    engine.route("/api/runs/", (call) => fx.runDetailResponse({ id: call.url.split("/").pop() ?? "run-0003" }));

    const user = userEvent.setup();
    renderWithProviders(<LearningLabTab />);
    await screen.findByText("3 runs");

    // The "regression" kind badge is unique to run-0003's row.
    await user.click(screen.getByText("regression"));

    // Dialog fetches the run detail and renders its surfaces.
    expect(await screen.findByText("Reproduce the login redirect bug and fix it.")).toBeTruthy();
    expect(screen.getByText("I will start by reproducing the bug.")).toBeTruthy();
    expect(screen.getByText("PASSED")).toBeTruthy();
    expect(screen.getByText("— 2 checks green")).toBeTruthy(); // rendered as "— {summary}"
    expect(engine.callsFor("/api/runs/run-0003")).toHaveLength(1);
  });

  test("selecting a cycle filters improvements and runs; clicking again clears", async () => {
    routeHappy();
    const user = userEvent.setup();
    renderWithProviders(<LearningLabTab />);
    await screen.findByText("3 runs");

    // Select cycle-0002 → its improvement stays, its task has no runs.
    const cycleButton = screen.getByText("parse csv headers robustly").closest("button") as HTMLElement;
    await user.click(cycleButton);
    expect(screen.getByText("0 runs")).toBeTruthy();
    expect(screen.queryAllByText("No runs yet — trigger a task from Overview")).toHaveLength(1);
    expect(screen.queryAllByText("The agent missed that the cookie path was scoped to /auth only.")).toHaveLength(0);

    // Click again to clear the filter — full lists return.
    await user.click(cycleButton);
    expect(screen.getByText("3 runs")).toBeTruthy();
    expect(screen.getByText("The agent missed that the cookie path was scoped to /auth only.")).toBeTruthy();
  });
});

describe("LearningLabTab — empty state", () => {
  test("empty cycles, improvements and runs surfaces", async () => {
    engine.route("/api/cycles", { cycles: [] });
    engine.route("/api/improvements", { improvements: [] });
    engine.route("/api/runs", { runs: [] });

    renderWithProviders(<LearningLabTab />);

    expect(await screen.findByText("No cycles yet")).toBeTruthy();
    expect(screen.getByText("No improvements yet")).toBeTruthy();
    expect(screen.getByText("No runs yet — trigger a task from Overview")).toBeTruthy();
    expect(screen.getByText("0 runs")).toBeTruthy();
  });
});

describe("LearningLabTab — error state", () => {
  test("fetch rejections degrade to the empty surfaces, no crash", async () => {
    engine.route("/api/cycles", new TypeError("engine unreachable"));
    engine.route("/api/improvements", new TypeError("engine unreachable"));
    engine.route("/api/runs", new TypeError("engine unreachable"));

    renderWithProviders(<LearningLabTab />);

    expect(await screen.findByText("No cycles yet")).toBeTruthy();
    expect(screen.getByText("No improvements yet")).toBeTruthy();
    expect(screen.getByText("No runs yet — trigger a task from Overview")).toBeTruthy();
    expect(screen.getByText("Cycles")).toBeTruthy(); // static section heading survived
  });
});
