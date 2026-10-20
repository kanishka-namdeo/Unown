// Tests for src/components/dashboard/command-palette.tsx and tab-store.ts.
//
// The palette is a cmdk dialog driven by the shared command-open store; tab
// jumps go through the tab store (which owns the ?tab= URL sync). These tests
// pin: open/close, the navigate action wiring, the refresh action's query
// invalidation, and the tab store's URL contract (setTab writes ?tab=,
// invalid ids are ignored, syncTabFromUrl hydrates from the URL).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CommandPalette, useCommandPaletteStore } from "../command-palette";
import { DASHBOARD_TABS, syncTabFromUrl, useTabStore } from "../tab-store";
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

// happy-dom's history.replaceState does not update window.location (probed:
// search stays "" and href stays about:blank), so URL writes are asserted by
// recording replaceState calls; URL reads go through the location.search
// setter, which happy-dom DOES implement.
let replaceCalls: string[];
let realReplace: typeof window.history.replaceState;

beforeEach(() => {
  engine.install();
  engine.reset();
  resetActivityStore();
  resetToasts();
  useCommandPaletteStore.setState({ open: false });
  useTabStore.setState({ tab: "overview" });
  replaceCalls = [];
  realReplace = window.history.replaceState.bind(window.history);
  (window.history as unknown as { replaceState: typeof window.history.replaceState }).replaceState = ((
    _s: unknown,
    _t: string,
    url?: string | URL
  ) => {
    replaceCalls.push(String(url));
  }) as typeof window.history.replaceState;
  (window.location as unknown as { search: string }).search = "";
});

afterEach(() => {
  cleanup();
  engine.restore();
  (window.history as unknown as { replaceState: typeof window.history.replaceState }).replaceState = realReplace;
  // Both stores are module singletons shared with every later test file
  // (the page-shell test renders the real Page). Leaving the palette open
  // here mounts a modal CommandDialog there that aria-hides the whole page
  // (radix dialog scroll-lock); leaving tab != "overview" would flip the
  // default panel. Reset both so no state escapes this file.
  useCommandPaletteStore.setState({ open: false });
  useTabStore.setState({ tab: "overview" });
});

function openPalette() {
  act(() => {
    useCommandPaletteStore.getState().setOpen(true);
  });
}

describe("tab store", () => {
  test("setTab updates state and writes ?tab= into the URL", () => {
    useTabStore.getState().setTab("gateway");
    expect(useTabStore.getState().tab).toBe("gateway");
    expect(replaceCalls).toContain("/dashboard?tab=gateway");
  });

  test("unknown ids are ignored — no state change, no URL change", () => {
    useTabStore.getState().setTab("overview");
    expect(replaceCalls).toHaveLength(1); // the valid call wrote the URL
    useTabStore.getState().setTab("evil-tab");
    expect(useTabStore.getState().tab).toBe("overview");
    expect(replaceCalls).toHaveLength(1); // the invalid call wrote nothing
  });

  test("syncTabFromUrl hydrates the store from ?tab= and returns an unsubscriber", () => {
    (window.location as unknown as { search: string }).search = "?tab=lab";
    const unsub = syncTabFromUrl();
    expect(useTabStore.getState().tab).toBe("lab");
    (window.location as unknown as { search: string }).search = "?tab=console";
    syncTabFromUrl();
    expect(useTabStore.getState().tab).toBe("console");
    expect(typeof unsub).toBe("function");
    unsub();
  });

  test("the tab registry covers the dashboard's eleven tabs", () => {
    expect(DASHBOARD_TABS).toHaveLength(11);
    expect([...DASHBOARD_TABS]).toContain("sandboxes");
    expect([...DASHBOARD_TABS]).toContain("gateway");
    expect([...DASHBOARD_TABS]).toContain("automations");
    expect([...DASHBOARD_TABS]).toContain("webcache");
  });
});

describe("CommandPalette", () => {
  test("lists all eleven tabs as navigate actions and opens from the shared store", async () => {
    renderWithProviders(<CommandPalette />);
    openPalette();

    for (const name of ["Overview", "Learning Lab", "Memory", "Dreams", "Hooks", "Console", "Sandboxes", "Gateway", "Router", "Automations", "Web Cache"]) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
    expect(screen.getByText("GitHub repository")).toBeTruthy();
    expect(screen.getByText("Quickstart docs")).toBeTruthy();
    expect(screen.getByText("Refresh all data")).toBeTruthy();
  });

  test("selecting a tab action closes the palette and switches the tab store", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);
    openPalette();

    await user.click(await screen.findByText("Gateway"));
    expect(useCommandPaletteStore.getState().open).toBe(false);
    expect(useTabStore.getState().tab).toBe("gateway");
    expect(replaceCalls).toContain("/dashboard?tab=gateway");
  });

  test("the refresh action invalidates every query", async () => {
    const user = userEvent.setup();
    const view = renderWithProviders(<CommandPalette />);
    // Patch AFTER render: invalidateQueries() with no filter is not captured
    // by the harness recorder (it skips falsy filters), so record it here.
    const noFilterCalls: (unknown | undefined)[] = [];
    const qc = view.queryClient as unknown as { invalidateQueries: (f?: unknown) => Promise<unknown> };
    const real = qc.invalidateQueries.bind(view.queryClient);
    qc.invalidateQueries = ((f?: unknown) => {
      noFilterCalls.push(f);
      return real(f);
    }) as typeof qc.invalidateQueries;

    openPalette();
    await user.click(await screen.findByText("Refresh all data"));

    expect(noFilterCalls).toContainEqual(undefined); // invalidateQueries() — everything
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  test("Ctrl/⌘+K toggles the palette open and closed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommandPalette />);

    await user.keyboard("{Control>}k{/Control}");
    expect(useCommandPaletteStore.getState().open).toBe(true);
    await user.keyboard("{Control>}k{/Control}");
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  test("the footer reflects the live-stream connection state", async () => {
    renderWithProviders(<CommandPalette />);
    openPalette();
    expect(await screen.findByText(/reconnecting…/)).toBeTruthy();
  });
});
