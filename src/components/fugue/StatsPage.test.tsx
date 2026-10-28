/**
 * StatsPage unit tests — the /fugue/stats client surface, in the same lane
 * as RunsPage.test.tsx (its fetchRouter helper + NATIVE_FETCH restore,
 * copied verbatim below).
 *
 * Pins: the workspace default (first workspace, or the ?workspaceId=
 * deep-link when it names a known workspace), the aggregate cards over a
 * seeded stats payload (total runs / pass rate / mean duration / most used
 * step), the pure-CSS bar chart (bars are count/max widths, PLAN.md §7 —
 * no chart lib), and the failure branch (fetch throws → the alert).
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// Host-embedding adaptation: bun runs all test files in one process — restore the
// NATIVE fetch (never `undefined`) so later suites (cadence, bazaar) keep a
// working global. Captured at module load, before any router patches it.
const NATIVE_FETCH = globalThis.fetch;
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import StatsPage from "./StatsPage";
import { withSearch } from "./dom-helpers";
import type { Workspace, WorkspaceStats } from "@/lib/fugue/types";

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

// A seeded stats payload: the aggregates the cards show, and per-step-type
// counts whose max is transform (5) — so the CSS-bar widths are exact.
const STATS: WorkspaceStats = {
  totalRuns: 12,
  passRate: 0.75,
  meanDurationMs: 120,
  mostUsedStepType: "transform",
  stepTypeCounts: { transform: 5, classify: 3, enrich: 2, branch: 1, notify: 1 },
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

// ── the stats dashboard: workspace default, aggregates, CSS bars ──

describe("stats page", () => {
  it("defaults to the first workspace and renders the aggregates + CSS bars", async () => {
    const router = fetchRouter((url) => {
      if (url.includes("/stats?workspaceId=ws_atlas")) return { stats: STATS };
      return null;
    });
    render(<StatsPage workspaces={[WS]} />);
    await waitFor(() => {
      expect(screen.getByText("12")).toBeDefined(); // Total runs card
    }, { timeout: 1500 });

    // The aggregate cards over the seeded payload.
    expect(screen.getByText("workspace: Atlas")).toBeDefined();
    expect(screen.getByText("75%")).toBeDefined(); // pass rate (0.75 → rounded)
    expect(screen.getByText("120ms")).toBeDefined(); // mean duration
    // "Transform" renders twice: the most-used-step card + the bar label.
    expect(screen.getAllByText("Transform").length).toBe(2);

    // The pure-CSS bar chart: one bar per step type, width = count/max.
    const chart = screen.getByRole("img", { name: "Step type usage bar chart" });
    const bars = chart.querySelectorAll("div.h-3");
    expect(bars.length).toBe(5);
    expect(bars[0]!.getAttribute("style")).toContain("100%"); // transform: 5/5
    expect(bars[1]!.getAttribute("style")).toContain("60%"); // classify: 3/5
    expect(bars[2]!.getAttribute("style")).toContain("40%"); // enrich: 2/5
    expect(bars[3]!.getAttribute("style")).toContain("20%"); // branch: 1/5
    expect(bars[4]!.getAttribute("style")).toContain("20%"); // notify: 1/5
    // The per-type counts render in order next to their bars.
    const counts = [...chart.querySelectorAll("span.w-10")].map((el) => el.textContent);
    expect(counts).toEqual(["5", "3", "2", "1", "1"]);

    router.dispose();
  });

  it("deep-links the workspace from ?workspaceId= (when it names a known workspace)", async () => {
    const router = fetchRouter((url) => {
      if (url.includes("/stats?workspaceId=ws_atlas")) return { stats: STATS };
      return null;
    });
    await withSearch("workspaceId=ws_atlas", async () => {
      render(<StatsPage workspaces={[WS]} />);
      await waitFor(() => {
        expect(screen.getByText("workspace: Atlas")).toBeDefined();
      }, { timeout: 1500 });
      // The stats fetch used the deep-linked workspace id, not the default.
      expect(router.calls.some((c) => c.url.includes("/stats?workspaceId=ws_atlas"))).toBe(true);
    });
    router.dispose();
  });

  it("shows the error alert when the stats fetch fails", async () => {
    const router = fetchRouter(() => null); // every route throws
    render(<StatsPage workspaces={[WS]} />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeDefined();
    }, { timeout: 1500 });
    expect(screen.getByRole("alert").textContent).toBe("Failed to load stats");
    router.dispose();
  });
});
