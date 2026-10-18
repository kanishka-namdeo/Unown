// Component tests for src/components/dashboard/sandboxes-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty states with the GET /api/sandboxes response stubbed: labeled and
// unlabeled workspace cards, the stats strip (total / summed files / oldest
// age), and the no-sandboxes empty surface.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import type { Sandbox } from "@/lib/agent-types";
import { SandboxesTab } from "../sandboxes-tab";
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

function sandbox(over: Partial<Sandbox> = {}): Sandbox {
  return {
    id: "sbx-abc123def456",
    createdAt: minutesAgo(12),
    label: "run-0001",
    files: 5,
    ...over,
  };
}

function routeSandboxes(sandboxes: Sandbox[]) {
  engine.route("/api/sandboxes", { sandboxes });
}

// Two workspaces: one labeled (harness run), one unlabeled (console-spun
// agent) that must fall back to the 12-char id prefix ("sbx-fallback").
function twoSandboxes(): Sandbox[] {
  return [
    sandbox({ id: "sbx-labeled-0001", label: "run-0001", files: 5, createdAt: minutesAgo(12) }),
    sandbox({ id: "sbx-fallback99xyz", label: "", files: 3, createdAt: minutesAgo(3) }),
  ];
}

describe("SandboxesTab — happy state", () => {
  test("renders labeled and unlabeled sandbox cards with file counts and ages", async () => {
    routeSandboxes(twoSandboxes());
    renderWithProviders(<SandboxesTab />);

    // Labeled card: the label is the heading.
    expect(await screen.findByText("run-0001")).toBeTruthy();
    // Unlabeled card falls back to id.slice(0, 12) as the heading.
    expect(screen.getByText("sbx-fallback")).toBeTruthy();
    // The short ids render as Mono text on both cards.
    expect(screen.getByText("sbx-labeled-0001")).toBeTruthy();
    expect(screen.getByText("sbx-fallback99xyz")).toBeTruthy();

    // File counts (the "files" suffix sits in its own span).
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    // Created ages; the oldest also feeds the stats strip, so expect ≥1.
    expect(screen.getAllByText("12m ago").length).toBeGreaterThan(0);
    expect(screen.getByText("3m ago")).toBeTruthy();

    // Static copy: heading + the sandbox-gc explainer.
    expect(screen.getByText("Sandboxes")).toBeTruthy();
    expect(
      screen.getByText("the sandbox-gc router job prunes stale workspaces every 15 minutes")
    ).toBeTruthy();
  });

  test("computes the stats strip: sandbox total, summed files, oldest age", async () => {
    routeSandboxes(twoSandboxes());
    renderWithProviders(<SandboxesTab />);

    expect(await screen.findByText("run-0001")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // total sandboxes
    expect(screen.getByText("8")).toBeTruthy(); // 5 + 3 files summed
    expect(screen.getByText("total files")).toBeTruthy(); // StatChip label
    // Oldest = min(createdAt) → also rendered on the older card itself.
    expect(screen.getAllByText("12m ago").length).toBeGreaterThan(0);
  });
});

describe("SandboxesTab — empty state", () => {
  test("no sandboxes renders the empty surface and a dash for oldest", async () => {
    routeSandboxes([]);
    renderWithProviders(<SandboxesTab />);

    expect(await screen.findByText("No sandboxes yet")).toBeTruthy();
    expect(
      screen.getByText(
        "Workspaces appear when the harness runs a task cycle or the console spins up an agent."
      )
    ).toBeTruthy();
    // Oldest age degrades to an em dash when there is nothing to age.
    expect(screen.getByText("—")).toBeTruthy();
    // No cards rendered (negative assertion via queryAllByText per helpers.tsx).
    expect(screen.queryAllByText("files")).toHaveLength(0);
  });
});
