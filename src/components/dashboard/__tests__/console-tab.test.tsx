// Component tests for src/components/dashboard/console-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed, plus the prompt
// mutation: POST /api/agent/prompt → toast + interactive-runs invalidation;
// the submit button is disabled while busy (pending / searching / running);
// a 409-busy response degrades to a warning toast with no false success.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRunStreamStore } from "@/lib/agent-store";
import type { Run } from "@/lib/agent-types";
import { ConsoleTab } from "../console-tab";
import { DashboardProviders } from "../providers";
import * as fx from "./fixtures";
import {
  busyResponse,
  createEngine,
  type EngineStub,
  type EventSourceStub,
  installFakeEventSource,
  installToastSpy,
  isDisabled,
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

function routeInteractive(runs: Run[]) {
  engine.route("kind=interactive", { runs });
}

describe("ConsoleTab — happy state", () => {
  test("renders session history and the prompt console; submit disabled on empty prompt", async () => {
    routeInteractive([fx.run({ id: "run-0004", kind: "interactive", status: "passed" })]);
    renderWithProviders(<ConsoleTab />);

    expect(await screen.findByText("Sessions")).toBeTruthy();
    expect(screen.getByText("run-0004")).toBeTruthy(); // id.slice(0, 18)
    expect(screen.getByText("9 tools")).toBeTruthy();
    expect(screen.getByText("5k tok")).toBeTruthy();

    expect(screen.getByText("Console")).toBeTruthy();
    expect(screen.getByLabelText("agent prompt")).toBeTruthy();
    expect(screen.getByText("Nothing streaming")).toBeTruthy();
    expect(screen.getByText("Ctrl/⌘ + Enter to run")).toBeTruthy();

    // Empty prompt → Run agent stays disabled.
    const submit = screen.getByRole("button", { name: "Run agent" });
    expect(isDisabled(submit)).toBe(true);
  });

  test("clicking a session loads its run detail into the live transcript", async () => {
    routeInteractive([fx.run({ id: "run-0004", kind: "interactive", status: "passed" })]);
    engine.route("/api/runs/", fx.runDetailResponse({ id: "run-0004", kind: "interactive" }));

    const user = userEvent.setup();
    renderWithProviders(<ConsoleTab />);
    expect(await screen.findByText("run-0004")).toBeTruthy();

    await user.click(screen.getByText("run-0004").closest("button") as HTMLElement);

    expect(await screen.findByText("I will start by reproducing the bug.")).toBeTruthy();
    expect(screen.getByText("Reproduce the login redirect bug and fix it.")).toBeTruthy();
    expect(screen.getByText("run finished")).toBeTruthy();
    expect(engine.callsFor("/api/runs/run-0004")).toHaveLength(1);
  });

  test("a running session shows the streaming state and keeps the console disabled while busy", async () => {
    routeInteractive([fx.run({ id: "run-0005", kind: "interactive", status: "running", ended_at: null })]);
    engine.route(
      "/api/runs/",
      fx.runDetailResponse({ id: "run-0005", kind: "interactive", status: "running", ended_at: null, prompt: null, transcript: [], verify_output: null })
    );

    const user = userEvent.setup();
    renderWithProviders(<ConsoleTab />);
    expect(await screen.findByText("run-0005")).toBeTruthy();

    await user.click(screen.getByText("run-0005").closest("button") as HTMLElement);

    expect(await screen.findByText("waiting for first token…")).toBeTruthy();
    expect(screen.getByText("run in progress — polling every 3s")).toBeTruthy();
    const submit = screen.getByRole("button", { name: /working/i });
    expect(isDisabled(submit)).toBe(true); // busy while the run is streaming
  });
});

describe("ConsoleTab — prompt mutation", () => {
  test("submitting a prompt POSTs it, toasts, invalidates interactive runs, and disables while busy", async () => {
    routeInteractive([fx.run({ id: "run-0004", kind: "interactive", status: "passed" })]);
    engine.route("/api/agent/prompt", { started: true });

    const user = userEvent.setup();
    const view = renderWithProviders(<ConsoleTab />);
    expect(await screen.findByText("run-0004")).toBeTruthy();

    await user.type(screen.getByLabelText("agent prompt"), "reverse a linked list");
    expect(isDisabled(screen.getByRole("button", { name: "Run agent" }))).toBe(false);

    await user.click(screen.getByRole("button", { name: "Run agent" }));

    const submitted = toastsWithTitle("Prompt submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.kind).toBe("success");
    expect(engine.callsFor("/api/agent/prompt")).toHaveLength(1);
    expect(engine.callsFor("/api/agent/prompt")[0]?.method).toBe("POST");
    expect(engine.callsFor("/api/agent/prompt")[0]?.body).toEqual({ prompt: "reverse a linked list" });
    expect(view.invalidatedKeys()).toContainEqual(["runs", "interactive"]);

    // The invalidation refetched the interactive list…
    await waitFor(() => expect(engine.callsFor("kind=interactive").length).toBe(2));

    // …but no new run appeared, so the console stays searching → button busy.
    const busyButton = screen.getByRole("button", { name: /working/i });
    expect(isDisabled(busyButton)).toBe(true);
    // A second click while busy must not fire another POST.
    await user.click(busyButton);
    expect(engine.callsFor("/api/agent/prompt")).toHaveLength(1);
  });

  test("409-busy: warning toast, no false success, console returns to idle", async () => {
    routeInteractive([fx.run({ id: "run-0004", kind: "interactive", status: "passed" })]);
    engine.route("/api/agent/prompt", busyResponse());

    const user = userEvent.setup();
    const view = renderWithProviders(<ConsoleTab />);
    expect(await screen.findByText("run-0004")).toBeTruthy();

    await user.type(screen.getByLabelText("agent prompt"), "reverse a linked list");
    await user.click(screen.getByRole("button", { name: "Run agent" }));

    const busy = toastsWithTitle("Engine busy — a background job is learning right now");
    expect(busy).toHaveLength(1);
    expect(busy[0]?.kind).toBe("warning");
    expect(toastsWithTitle("Prompt submitted")).toHaveLength(0); // no false success
    expect(view.invalidatedKeys()).not.toContainEqual(["runs", "interactive"]);

    // Mutation failed → not busy anymore, submit is usable again.
    const submit = await screen.findByRole("button", { name: "Run agent" });
    expect(isDisabled(submit)).toBe(false);
  });
});

describe("ConsoleTab — live SSE streaming (run:tool / run:text)", () => {
  let esStub: EventSourceStub;

  beforeEach(() => {
    esStub = installFakeEventSource();
    useRunStreamStore.setState({ streams: {} }); // module singleton — fresh buffers
  });

  afterEach(() => {
    esStub.restore();
    useRunStreamStore.setState({ streams: {} });
  });

  test("run:tool / run:text SSE frames render live transcript lines while the run is running, without new fetches", async () => {
    routeInteractive([fx.run({ id: "run-0009", kind: "interactive", status: "running", ended_at: null })]);
    engine.route(
      "/api/runs/",
      fx.runDetailResponse({
        id: "run-0009",
        kind: "interactive",
        status: "running",
        ended_at: null,
        prompt: null,
        transcript: [{ type: "text", ts: 1000, text: "old entry from the 3s poll" }],
        verify_output: null,
      })
    );

    const user = userEvent.setup();
    // DashboardProviders mounts the SseBridge that forwards run:tool/run:text
    // frames into useRunStreamStore; ConsoleTab renders them ahead of the poll.
    render(
      <DashboardProviders>
        <ConsoleTab />
      </DashboardProviders>
    );
    expect(await screen.findByText("run-0009")).toBeTruthy();

    await user.click(screen.getByText("run-0009").closest("button") as HTMLElement);
    expect(await screen.findByText("old entry from the 3s poll")).toBeTruthy();
    expect(screen.getByText("run in progress — polling every 3s")).toBeTruthy();
    const fetchesBefore = engine.callsFor("/api/runs/run-0009").length;

    const sse = esStub.latest();
    sse.simulateOpen();
    sse.deliver(
      JSON.stringify({
        event: "run:text",
        payload: { runId: "run-0009", preview: "live SSE token line" },
        ts: 5000,
      })
    );
    sse.deliver(
      JSON.stringify({
        event: "run:tool",
        payload: { runId: "run-0009", tool: "bash", phase: "start" },
        ts: 6000,
      })
    );

    // The live text preview and the tool name render in the transcript area…
    expect(await screen.findByText("live SSE token line")).toBeTruthy();
    expect(screen.getByText("bash")).toBeTruthy();
    // …the old polled entry is still there…
    expect(screen.getByText("old entry from the 3s poll")).toBeTruthy();
    // …the SSE banner replaces the polling hint…
    expect(screen.getByText("streaming live over SSE")).toBeTruthy();
    // …and no new fetch happened: the frames carried the update, not the poll.
    expect(engine.callsFor("/api/runs/run-0009").length).toBe(fetchesBefore);
  });
});

describe("ConsoleTab — run search timeout", () => {
  // SEARCH_TIMEOUT_MS = 25s: patch globalThis.setTimeout to record (and still
  // forward) every 25s callback so the give-up path can be driven manually —
  // bun:test has no fake-timers API.
  const searchTimeouts: Array<() => void> = [];
  let realSetTimeout: (...args: unknown[]) => unknown;

  beforeEach(() => {
    searchTimeouts.length = 0;
    realSetTimeout = globalThis.setTimeout as unknown as (...args: unknown[]) => unknown;
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = (
      cb: unknown,
      delay?: number,
      ...rest: unknown[]
    ) => {
      if (typeof cb === "function" && delay === 25_000) searchTimeouts.push(cb as () => void);
      return realSetTimeout(cb, delay, ...rest);
    };
  });

  afterEach(() => {
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout as typeof globalThis.setTimeout;
  });

  test("the run search gives up after 25s with a warning toast and frees the console", async () => {
    routeInteractive([fx.run({ id: "run-0004", kind: "interactive", status: "passed" })]);
    engine.route("/api/agent/prompt", { started: true });

    const user = userEvent.setup();
    renderWithProviders(<ConsoleTab />);
    expect(await screen.findByText("run-0004")).toBeTruthy();

    await user.type(screen.getByLabelText("agent prompt"), "reverse a linked list");
    await user.click(screen.getByRole("button", { name: "Run agent" }));

    // Submitted and now searching for the engine to create the run — the
    // 25s give-up timer is scheduled.
    expect(await screen.findByRole("button", { name: /working/i })).toBeTruthy();
    expect(searchTimeouts.length).toBeGreaterThan(0);

    // Fire the give-up callback manually (time has "elapsed").
    await act(async () => {
      searchTimeouts[0]();
    });

    const warn = toastsWithTitle("The engine did not start the run");
    expect(warn).toHaveLength(1);
    expect(warn[0]?.kind).toBe("warning");
    expect(warn[0]?.description).toContain("unreachable");
    // Searching cleared → the console is usable again (idle hint, idle button).
    expect(screen.getByText("Ctrl/⌘ + Enter to run")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run agent" })).toBeTruthy();
  });
});

describe("ConsoleTab — empty state", () => {
  test("no sessions, nothing streaming", async () => {
    routeInteractive([]);
    renderWithProviders(<ConsoleTab />);

    expect(await screen.findByText("No sessions yet")).toBeTruthy();
    expect(screen.getByText("Nothing streaming")).toBeTruthy();
  });
});

describe("ConsoleTab — error state", () => {
  test("fetch rejection degrades to empty surfaces, no crash", async () => {
    engine.route("kind=interactive", new TypeError("engine unreachable"));
    renderWithProviders(<ConsoleTab />);

    expect(await screen.findByText("No sessions yet")).toBeTruthy();
    expect(screen.getByText("Nothing streaming")).toBeTruthy();
    expect(screen.getByText("Console")).toBeTruthy(); // static heading survived
  });
});
