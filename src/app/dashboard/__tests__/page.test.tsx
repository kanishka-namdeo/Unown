// Component tests for src/app/dashboard/page.tsx (the dashboard shell).
//
// Backlog reference: docs/testing-strategy.md §6 gate 9 (changed-line
// coverage) — page.tsx was never imported by a test (0% on a one-line change,
// run 39102353721). This renders the REAL page tree — its own
// DashboardProviders (QueryClient + SseBridge + Toaster), Header, the radix
// tab strip with all twelve tabs, and the footer — with the engine fetch
// double and the FakeEventSource from the shared harness.
//
// Scope note: tab switching and SSE frame delivery are integration flows —
// they are covered end-to-end by the e2e suite (e2e/smoke.spec.ts clicks all
// twelve tabs and asserts the SSE feed against a real browser); here they
// would only fight happy-dom's animation timing (framer-motion enter fades).
// The unit scope is the shell itself: header, tab strip, default panel,
// footer, and the EventSource connection the page's SseBridge opens.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, screen } from "@testing-library/react";
import Page from "../page";
import * as fx from "../../../components/dashboard/__tests__/fixtures";
import {
  createEngine,
  installFakeEventSource,
  installToastSpy,
  resetActivityStore,
  resetToasts,
  type EngineStub,
  type EventSourceStub,
} from "../../../components/dashboard/__tests__/helpers";

installToastSpy();

const engine: EngineStub = createEngine();
let es: EventSourceStub;

beforeEach(() => {
  engine.install();
  es = installFakeEventSource();
  resetActivityStore();
  resetToasts();
});

afterEach(() => {
  cleanup();
  engine.restore();
  es.restore();
});

function routeOverview() {
  engine.route("/api/overview", fx.overviewResponse());
  engine.route("/api/tasks", fx.tasksResponse());
  engine.route("/api/jobs", fx.jobsResponse());
}

describe("dashboard page shell", () => {
  test("renders header, all twelve tabs, the Overview panel, the footer — and connects the SSE stream", async () => {
    routeOverview();
    render(<Page />);

    // Header (own query inside the page's providers).
    expect(await screen.findByText("unown · self-learning agent")).toBeTruthy();

    // The full tab strip from the page's tabs array.
    for (const name of ["Overview", "Learning Lab", "Memory", "Dreams", "Hooks", "Console", "Sandboxes", "Gateway", "Providers", "Router", "Automations", "Web Cache"]) {
      expect(screen.getByRole("tab", { name })).toBeTruthy();
    }

    // Default panel renders Overview content from the engine fixtures.
    expect(await screen.findByText("84%")).toBeTruthy(); // KPI pass rate

    // Footer strip (the page's own chrome).
    expect(screen.getByText(/LLM gateway :3031 · engine :3030/)).toBeTruthy();

    // The page's SseBridge connected exactly once, to the engine's events
    // endpoint, and is still open (single render: no between-test animation
    // residue — see the scope note above the describe).
    expect(es.instances.length).toBe(1);
    expect(es.latest().url).toContain("/api/events");
    expect(es.latest().closed).toBe(false);

    // Let framer-motion's enter animations (TabFade, 0.22s) run to completion
    // before cleanup: unmounting mid-flight makes happy-dom's Animation
    // reject with an unhandled DOMException, which bun counts as a suite
    // error and the coverage gate treats as a red suite.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  });
});
