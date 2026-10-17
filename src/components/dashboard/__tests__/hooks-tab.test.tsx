// Component tests for src/components/dashboard/hooks-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed. The tab is
// display-only (no mutations): the guardrail policy explainer, the per-hook
// decision counts, and the decision-log table with its expandable JSON details.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HooksTab } from "../hooks-tab";
import * as fx from "./fixtures";
import { createEngine, type EngineStub, renderWithProviders, resetActivityStore } from "./helpers";

const engine: EngineStub = createEngine();

beforeEach(() => {
  engine.install();
  engine.reset();
  resetActivityStore();
});

afterEach(() => {
  cleanup();
  engine.restore();
});

describe("HooksTab — happy state", () => {
  test("renders the 6 policy layers with per-hook counts and the decision log table", async () => {
    engine.route("/api/hooks", fx.hooksResponse());
    renderWithProviders(<HooksTab />);

    // Policy explainer: all six hook layers are present.
    expect(await screen.findByText("Policy — 6 hook layers")).toBeTruthy();
    for (const name of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(1);
    }

    // Per-hook counts from the fixture: PreToolUse 2×, UserPromptSubmit 1×, rest 0×.
    expect(screen.getByText("2×")).toBeTruthy();
    expect(screen.getByText("1×")).toBeTruthy();
    expect(screen.getAllByText("0×")).toHaveLength(4);

    // Decision log stats: 3 events, 1 deny, 0 augments.
    expect(screen.getByText("Decision log")).toBeTruthy();
    expect(screen.getByText("events")).toBeTruthy();
    expect(screen.getByText("denies")).toBeTruthy();
    expect(screen.getByText("augments")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    // Table rows: reasons, decisions, tools.
    expect(screen.getByText("command allowed")).toBeTruthy();
    expect(screen.getByText("rm -rf / is blocked")).toBeTruthy();
    expect(screen.getByText("prompt logged")).toBeTruthy();
    expect(screen.getAllByText("allow")).toHaveLength(1); // DecisionBadge
    expect(screen.getAllByText("deny")).toHaveLength(1);
    expect(screen.getAllByText("log")).toHaveLength(1);
    expect(screen.getAllByText("bash")).toHaveLength(2); // two bash tool cells
  });

  test("expanding the deny row's details reveals the pretty-printed hook JSON", async () => {
    engine.route("/api/hooks", fx.hooksResponse());
    const user = userEvent.setup();
    renderWithProviders(<HooksTab />);
    expect(await screen.findByText("rm -rf / is blocked")).toBeTruthy();

    // Only the deny entry carries details → a single "json" expand trigger.
    await user.click(screen.getByRole("button", { name: "json" }));
    expect(
      await screen.findByText((content) => content.includes('"cmd": "rm -rf /"'))
    ).toBeTruthy();
  });
});

describe("HooksTab — empty state", () => {
  test("no hook decisions, policy layers zeroed", async () => {
    engine.route("/api/hooks", { hooks: [] });
    renderWithProviders(<HooksTab />);

    expect(await screen.findByText("No hook decisions yet")).toBeTruthy();
    expect(screen.getAllByText("0×")).toHaveLength(6); // every policy layer at 0
  });
});

describe("HooksTab — error state", () => {
  test("fetch rejection degrades to the empty log, no crash", async () => {
    engine.route("/api/hooks", new TypeError("engine unreachable"));
    renderWithProviders(<HooksTab />);

    expect(await screen.findByText("No hook decisions yet")).toBeTruthy();
    expect(screen.getByText("Policy — 6 hook layers")).toBeTruthy(); // static heading survived
  });
});
