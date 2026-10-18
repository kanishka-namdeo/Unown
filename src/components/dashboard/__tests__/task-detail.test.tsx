// Component tests for src/components/dashboard/task-detail.tsx.
//
// Covers the GET /api/tasks/:id surface: description, agent prompt, seeded
// files (path → content map), verify script, provenance pills, and the
// run-cycle action passthrough. Files shape mirrors the engine's real
// response (files is an object keyed by path, verified live against :3030).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskDetailDialog } from "../task-detail";
import * as fx from "./fixtures";
import {
  createEngine,
  type EngineStub,
  installToastSpy,
  renderWithProviders,
  resetActivityStore,
  resetToasts,
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

function taskDetailResponse() {
  return {
    task: {
      ...fx.task({ id: "fix-fizzbuzz", name: "Fix FizzBuzz", category: "bugfix" }),
      files: {
        "fizzbuzz.js": "export function fizzbuzz(n) { /* buggy */ }",
        "fizzbuzz.test.mjs": "import { test } from 'node:test';",
      },
      verify: "node --test fizzbuzz.test.mjs",
      prompt: "The file fizzbuzz.js contains a buggy fizzbuzz implementation.",
      source_run_id: "run-0042",
    },
  };
}

describe("TaskDetailDialog", () => {
  test("renders description, agent prompt, seeded files and verify script", async () => {
    engine.route("/api/tasks/fix-fizzbuzz", taskDetailResponse());
    renderWithProviders(
      <TaskDetailDialog taskId="fix-fizzbuzz" open onOpenChange={() => {}} />
    );

    expect(await screen.findByText("Fix FizzBuzz")).toBeTruthy();
    expect(screen.getByText("DESCRIPTION", { exact: false })).toBeTruthy();
    expect(
      screen.getByText("The file fizzbuzz.js contains a buggy fizzbuzz implementation.")
    ).toBeTruthy();
    // Seeded files: path → content map entries.
    expect(screen.getByText("fizzbuzz.js")).toBeTruthy();
    expect(screen.getByText("fizzbuzz.test.mjs")).toBeTruthy();
    expect(screen.getByText("(2)")).toBeTruthy();
    // Verify script section.
    expect(screen.getByText("verification script", { exact: false })).toBeTruthy();
    expect(screen.getByText("node --test fizzbuzz.test.mjs")).toBeTruthy();
    // Provenance: mined-from run chip.
    expect(screen.getByText(/mined from run run-0042/i)).toBeTruthy();
  });

  test("a task with no files shows the authoring empty state", async () => {
    engine.route("/api/tasks/no-files", {
      task: {
        ...fx.task({ id: "no-files", name: "From Scratch" }),
        files: {},
        verify: "node --test x.test.mjs",
      },
    });
    renderWithProviders(
      <TaskDetailDialog taskId="no-files" open onOpenChange={() => {}} />
    );

    expect(await screen.findByText("From Scratch")).toBeTruthy();
    expect(screen.getByText(/no files — the agent authors everything/i)).toBeTruthy();
  });

  test("the run-cycle button calls the passthrough with the task id", async () => {
    engine.route("/api/tasks/fix-fizzbuzz", taskDetailResponse());
    let runCycleArg: string | null = null;
    const user = userEvent.setup();
    renderWithProviders(
      <TaskDetailDialog
        taskId="fix-fizzbuzz"
        open
        onOpenChange={() => {}}
        onRunCycle={(id) => (runCycleArg = id)}
      />
    );

    const btn = await screen.findByRole("button", { name: /run self-improvement cycle/i });
    await user.click(btn);
    // Widen the captured `let` back to its declared type: TS narrows it to
    // `null` (closure assignments are not tracked), which would break
    // bun-types' toBe overload at this assertion.
    expect(runCycleArg as string | null).toBe("fix-fizzbuzz");
  });

  test("no fetch happens while the dialog is closed", () => {
    engine.route("/api/tasks/fix-fizzbuzz", taskDetailResponse());
    renderWithProviders(
      <TaskDetailDialog taskId="fix-fizzbuzz" open={false} onOpenChange={() => {}} />
    );
    expect(engine.callsFor("/api/tasks/fix-fizzbuzz")).toHaveLength(0);
  });
});
