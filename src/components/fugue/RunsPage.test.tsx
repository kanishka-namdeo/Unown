import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Host-embedding adaptation: bun runs all test files in one process — restore the
// NATIVE fetch (never `undefined`) so later suites (cadence, bazaar) keep a
// working global. Captured at module load, before any router patches it.
const NATIVE_FETCH = globalThis.fetch;
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import RunsPage, { RunInspector, StepTimelineRow } from "./RunsPage";
import { withSearch } from "./dom-helpers";
import type { Run, StepAttempt, Workspace } from "@/lib/fugue/types";

// Isolate each test's DOM — testing-library's auto-cleanup can miss prior
// renders when bun test runs multiple files in one process. We clean
// explicitly before and after each test to avoid cross-test element
// collisions AND router leaks into subsequent test files.
beforeEach(() => {
  cleanup();
});
afterEach(() => {
  // RTL cleanup removes the mounted tree; also restore the global fetch so
  // a forgotten dispose() in a test can't leak the router into other files.
  cleanup();
  globalThis.fetch = NATIVE_FETCH;
});

const WS: Workspace = {
  id: "ws_atlas",
  slug: "atlas",
  name: "Atlas",
  description: "test",
  createdAt: "2025-06-01T00:00:00.000Z",
};

const LONG_TEXT = "x".repeat(600);

const RUN: Run = {
  id: "run_fl_atlas_1",
  flowId: "fl_atlas",
  workspaceId: "ws_atlas",
  status: "passed",
  startedAt: "2025-06-01T00:00:00.000Z",
  endedAt: "2025-06-01T00:00:00.020Z",
  payload: { text: "urgent: server down", labels: ["urgent"] },
  attempts: [
    {
      stepId: "st_atlas_transform",
      stepType: "transform",
      name: "Normalise text",
      status: "passed",
      input: { text: "urgent: server down" },
      output: { text: "urgent: server down" },
      durationMs: 5,
      attempt: 1,
    },
    {
      stepId: "st_atlas_classify",
      stepType: "classify",
      name: "Classify urgency",
      status: "passed",
      input: { text: "urgent: server down" },
      output: { text: "urgent: server down", labels: ["urgent"] },
      durationMs: 5,
      attempt: 1,
    },
  ],
  notifications: [
    { stepId: "st_atlas_notify_urgent", message: "Urgent item flagged for review", at: "2025-06-01T00:00:00.010Z" },
  ],
};

function jsonResp(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchRouter(route: (url: string, init?: RequestInit) => unknown | null) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const body = route(url, init);
    if (body === null) throw new TypeError("fetch failed");
    return jsonResp(body);
  }) as typeof fetch;
  return {
    calls,
    dispose() {
      globalThis.fetch = original;
    },
  };
}

// ── run inspector: timeline, expand, truncation, notifications ──

describe("run inspector", () => {
  it("renders the step timeline with status dots and durations", () => {
    render(<RunInspector run={RUN} flowName="Atlas Triage Pipeline" />);
    expect(screen.getByText("Atlas Triage Pipeline")).toBeDefined();
    expect(screen.getByText("Normalise text")).toBeDefined();
    expect(screen.getByText("Classify urgency")).toBeDefined();
    expect(screen.getAllByText("5ms").length).toBeGreaterThanOrEqual(1);
  });

  it("expands a step and shows its input/output snapshots", () => {
    render(<RunInspector run={RUN} flowName="Atlas Triage Pipeline" />);
    const buttons = screen.getAllByRole("button", { name: /Normalise text|▾|▴/ });
    const toggle = buttons.find((b) => b.textContent?.includes("Normalise text"))!;
    fireEvent.click(toggle);
    expect(screen.getByText("Input snapshot")).toBeDefined();
    expect(screen.getByText("Output snapshot")).toBeDefined();
    expect(screen.getAllByText(/urgent: server down/).length).toBeGreaterThan(0);
  });

  it("truncates long snapshots to 500 chars + ellipsis", () => {
    const run: Run = {
      ...RUN,
      attempts: [
        {
          stepId: "s1",
          stepType: "transform",
          name: "T",
          status: "passed",
          input: { text: LONG_TEXT },
          output: { text: LONG_TEXT },
          durationMs: 5,
          attempt: 1,
        },
      ],
    };
    render(<RunInspector run={run} flowName="Long flow" />);
    const toggle = screen.getAllByRole("button", { name: /T/ }).find(
      (b) => b.textContent?.includes("T"),
    )!;
    fireEvent.click(toggle);
    const els = screen.getAllByText(/x{400,}/);
    const text = els[0]?.textContent ?? "";
    expect(text.length).toBeLessThan(600);
    expect(text).toContain("…");
  });

  it("shows failed attempts with the error message", () => {
    const run: Run = {
      ...RUN,
      status: "failed",
      attempts: [
        {
          stepId: "s1",
          stepType: "transform",
          name: "T",
          status: "failed",
          error: "transform: payload has no text field",
          input: { nope: 1 },
          durationMs: 5,
          attempt: 1,
        },
      ],
    };
    render(<RunInspector run={run} flowName="Fail flow" />);
    const toggle = screen.getAllByRole("button", { name: /T/ })[0];
    fireEvent.click(toggle);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => el.textContent?.includes("transform: payload has no text field"))).toBe(true);
  });

  it("renders notifications", () => {
    render(<RunInspector run={RUN} flowName="Atlas Triage Pipeline" />);
    expect(screen.getAllByText("Urgent item flagged for review").length).toBeGreaterThan(0);
  });
});

describe("step timeline row (retries)", () => {
  it("shows the attempt badge for retried attempts", () => {
    const attempt: StepAttempt = {
      stepId: "s1",
      stepType: "transform",
      name: "Retry step",
      status: "passed",
      input: { text: "a" },
      output: { text: "a" },
      durationMs: 5,
      attempt: 2,
    };
    render(<StepTimelineRow attempt={attempt} index={3} />);
    expect(screen.getByText("attempt 2")).toBeDefined();
    expect(screen.getByText("4").textContent).toBeDefined(); // index 3 → "4"
  });
});

// ── runs page: history table + inspector deep-link ──

describe("runs page", () => {
  it("renders the history table with status chips and durations", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/runs?workspaceId=")) return { runs: [RUN] };
      if (url.includes("/flows/fl_atlas")) return { flow: { name: "Atlas Triage Pipeline" } };
      return null;
    });
    withSearch("workspaceId=ws_atlas", () => {
      render(<RunsPage workspaces={[WS]} />);
      return new Promise<void>((resolve, reject) => {
        // BOTH rows asserted inside ONE waitFor: the status chip's
        // aria-label lands in a later commit than the run id (the flow-name
        // fetch re-renders the table), so a single-shot query after the
        // first waitFor races it when earlier test files shift timing
        // (observed live: FlowsPage before this file → late rejection
        // attributed to the NEXT test). Retrying both until timeout is the
        // honest shape.
        waitFor(() => {
          expect(screen.getAllByText("run_fl_atlas_1").length).toBeGreaterThan(0);
          // Status chip carries an accessible name (aria-label="run status passed")
          expect(screen.getByLabelText("run status passed")).toBeDefined();
        }, { timeout: 1000 }).then(
          () => {
            dispose();
            resolve();
          },
          (e) => { dispose(); reject(e); },
        );
      });
    });
  });

  it("deep-links to the inspector via ?id=", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/runs/run_fl_atlas_1")) return { run: RUN };
      if (url.includes("/runs?workspaceId=")) return { runs: [RUN] };
      if (url.includes("/flows/fl_atlas")) return { flow: { name: "Atlas Triage Pipeline" } };
      return null;
    });
    withSearch("?id=run_fl_atlas_1", () => {
      render(<RunsPage workspaces={[WS]} />);
      // The ?id effect fires after mount; wait for the inspector heading.
      return new Promise<void>((resolve, reject) => {
        waitFor(() => {
          expect(screen.getAllByText(/Step timeline \(2 attempts\)/).length).toBeGreaterThan(0);
        }, { timeout: 2000 }).then(
          () => { dispose();; resolve(); },
          (e) => { dispose();; reject(e); },
        );
      });
    });
  });

  it("opens the inspector from the table", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/runs?workspaceId=")) return { runs: [RUN] };
      if (url.includes("/runs/run_fl_atlas_1")) return { run: RUN };
      if (url.includes("/flows/fl_atlas")) return { flow: { name: "Atlas Triage Pipeline" } };
      return null;
    });
    render(<RunsPage workspaces={[WS]} />);
    const link = await waitFor(() => screen.getAllByText("run_fl_atlas_1")[0]);
    fireEvent.click(link);
    await waitFor(() => {
      expect(screen.getAllByText(/Step timeline \(2 attempts\)/).length).toBeGreaterThan(0);
    });
    dispose();
  });

  it("shows the empty state", async () => {
    const { dispose } = fetchRouter((url) => {
      if (url.includes("/runs?workspaceId=")) return { runs: [] };
      return null;
    });
    render(<RunsPage workspaces={[WS]} />);
    await waitFor(() => {
      expect(screen.getByText("No runs in this workspace yet.")).toBeDefined();
    });
    dispose();
  });
});
