// Component tests for src/components/dashboard/header.tsx.
//
// Backlog reference: docs/testing-strategy.md §6 gate 9 (changed-line
// coverage) — header.tsx was never imported by a test, so a one-line change
// read as 0% and failed the gate (run 39102353721). These tests cover the
// real states: engine data (title, layer chip, provider, bridge state, LIVE
// indicator) and the loading placeholder.
//
// Runs under `bun test src` with the happy-dom global preload.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Header } from "../header";
import { useCommandPaletteStore } from "../command-palette";
import * as fx from "./fixtures";
import { createEngine, installToastSpy, renderWithProviders, resetActivityStore, resetToasts, type EngineStub } from "./helpers";

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

describe("Header — engine data present", () => {
  test("renders the agent title, layer chip and provider from the overview query", async () => {
    engine.route("/api/overview", fx.overviewResponse());
    renderWithProviders(<Header />);

    expect(await screen.findByText("unown · self-learning agent")).toBeTruthy();
    expect(screen.getByText("pi harness")).toBeTruthy(); // layer chip
    expect(screen.getByTitle("LLM provider").textContent).toContain("zai-bridge/kimi-k2.5");
  });

  test("bridge health drives the status pill and LIVE indicator", async () => {
    engine.route(
      "/api/overview",
      fx.overviewResponse({
        agent: {
          name: "unown",
          layer: "pi harness",
          provider: "zai-bridge/kimi-k2.5",
          bridge: fx.bridgeInfo({ ok: false, requests: 10, errors: 3 }),
        },
      }),
    );
    renderWithProviders(<Header />);

    // bridge down: the title flips to the down wording; the connected LIVE
    // pill follows the activity store, not the bridge.
    expect(await screen.findByTitle("bridge down")).toBeTruthy();
  });

  test("SSE-connected store state shows the LIVE stream pill", async () => {
    engine.route("/api/overview", fx.overviewResponse());
    renderWithProviders(<Header />);
    const { useActivityStore } = await import("@/lib/agent-store");

    await act(async () => {
      useActivityStore.getState().setConnected(true);
    });
    expect(screen.getByTitle("live event stream connected")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
  });
});

describe("Header — loading state", () => {
  test("shows placeholders while the overview query is in flight", () => {
    engine.route("/api/overview", new Promise(() => {})); // never resolves
    renderWithProviders(<Header />);

    expect(screen.getByText("unown · self-learning agent")).toBeTruthy();
    expect(screen.getByText("provider")).toBeTruthy(); // provider placeholder
    // Clock: placeholder or the mounted time (happy-dom may flush the effect
    // synchronously — either is the correct no-hydration-flash behaviour).
    expect(screen.getByText(/^(--:--:--|\d{2}:\d{2}:\d{2})$/)).toBeTruthy();
  });
});

describe("Header — engine down + command palette", () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false });
  });

  afterEach(() => {
    // The palette store is a module singleton shared with every later test
    // file (the page-shell test renders the real Page). Leaving it open would
    // mount a modal CommandDialog there that aria-hides the whole page.
    useCommandPaletteStore.setState({ open: false });
  });

  test("engine-down renders the alert banner with a retry button that refetches", async () => {
    engine.route("/api/overview", new TypeError("engine unreachable"));

    const user = userEvent.setup();
    renderWithProviders(<Header />);

    // retry:false in the harness → isError settles on the first rejection.
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("engine unreachable");
    expect(screen.getByText(/retrying every 5s/)).toBeTruthy();

    const retry = screen.getByRole("button", { name: /retry now/i });
    expect(retry).toBeTruthy();

    const before = engine.callsFor("/api/overview").length;
    await user.click(retry);
    // The retry invalidates everything → the mounted overview query refetches
    // (and fails again — the banner stays, no crash).
    await waitFor(() => expect(engine.callsFor("/api/overview").length).toBeGreaterThan(before));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  test("the ⌘K button opens the command palette store; the home link points at /", async () => {
    engine.route("/api/overview", fx.overviewResponse());

    const user = userEvent.setup();
    renderWithProviders(<Header />);
    expect(await screen.findByText("unown · self-learning agent")).toBeTruthy();

    expect(useCommandPaletteStore.getState().open).toBe(false);
    await user.click(screen.getByRole("button", { name: "open command palette" }));
    expect(useCommandPaletteStore.getState().open).toBe(true);

    // The static home link rides along in the header chrome.
    const home = screen.getByTitle("back to the landing page");
    expect(home.getAttribute("href")).toBe("/");
  });
});
