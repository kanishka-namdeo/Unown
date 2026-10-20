// Component tests for src/components/dashboard/webcache-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed, plus the two
// maintenance mutations: Clear store (destructive — AlertDialog confirm →
// POST /api/webcache/clear → toast + qk.webcache invalidation) and Sweep now
// (POST /api/webcache/sweep → toast incl. the nothing-to-evict branch).
// The webcache:cleared SSE invalidation itself is covered in sse-bridge.test.tsx.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qk } from "@/lib/agent-api";
import { WebCacheTab } from "../webcache-tab";
import * as fx from "./fixtures";
import {
  createEngine,
  type EngineStub,
  installToastSpy,
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

describe("WebCacheTab — happy state", () => {
  test("renders the KPI row, config card, activity table and provider traffic from engine data", async () => {
    engine.route("/api/webcache", fx.webCacheStatsResponse());
    renderWithProviders(<WebCacheTab />);

    expect(await screen.findByText("Web results store")).toBeTruthy();

    // KPI row: hit rate (12+4)/(12+4+9) = 64%, 16 saved, 1.2 MiB of 256 MiB, 3 entries.
    expect(screen.getByText("64%")).toBeTruthy();
    expect(screen.getByText("16")).toBeTruthy(); // requests saved
    expect(screen.getByText("1.2 MiB")).toBeTruthy(); // cached size
    expect(screen.getByText("of 256 MiB cap")).toBeTruthy();
    expect(screen.getByText("1 stale")).toBeTruthy(); // entries KPI sub (fixture totals.stale = 1)
    expect(screen.getByText("12 hits")).toBeTruthy();
    expect(screen.getByText("4 revalidated")).toBeTruthy();
    expect(screen.getByText("9 misses")).toBeTruthy();

    // Config card: resolved TTLs in human units, stale windows, byte cap, root.
    expect(screen.getByText("enabled")).toBeTruthy();
    expect(screen.getByText("Search freshness")).toBeTruthy();
    expect(screen.getByText("1h")).toBeTruthy();
    expect(screen.getByText("30m")).toBeTruthy();
    expect(screen.getByText("1d")).toBeTruthy();
    expect(screen.getByText("7d")).toBeTruthy();
    expect(screen.getByText("256 MiB")).toBeTruthy(); // byte-cap row
    expect(screen.getByText("/home/dev/.unown/cache/web")).toBeTruthy();

    // Trend chart: 2 hit/revalidated events → the recharts surface renders.
    expect(document.querySelector(".recharts-responsive-container")).toBeTruthy();

    // Activity table: one row per recent event, kind pills + details + ages.
    for (const detail of ["bun sqlite", "bun.sh/docs", "react 19 release notes", "example.com"]) {
      expect(screen.getByText(detail)).toBeTruthy();
    }
    expect(screen.getAllByText("2 entries (0.4 MiB) — LRU sweep")).toHaveLength(1);
    for (const kind of ["hit", "revalidated", "miss", "stale", "evict"]) {
      expect(screen.getAllByText(kind)).toHaveLength(1); // exactly the kind pill
    }
    expect(screen.getByText("2h")).toBeTruthy(); // revalidated ageMs (2 * 3_600_000)
    expect(screen.getByText("25h")).toBeTruthy(); // stale ageMs

    // byTool StatChips in the activity heading: webfetch appears once as the
    // chip label plus twice as activity-table tool cells; fetch_url only as
    // the chip (no fetch_url events in the fixture).
    expect(screen.getAllByText("webfetch")).toHaveLength(3);
    expect(screen.getAllByText("fetch_url")).toHaveLength(1);

    // Provider traffic: sorted desc — duckduckgo leads with 10 of 25 (40%).
    // duckduckgo also appears as the hit event's provider cell in the activity table.
    expect(screen.getAllByText("duckduckgo")).toHaveLength(2);
    expect(screen.getByText("searxng")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("32%")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });

  test("a disabled store flips the status pill and shows the re-enable hint", async () => {
    engine.route("/api/webcache", fx.webCacheStatsResponse({ enabled: false }));
    renderWithProviders(<WebCacheTab />);

    expect(await screen.findByText("disabled")).toBeTruthy();
    expect(screen.getByText((c) => c.includes("UNOWN_WEB_CACHE=1"))).toBeTruthy();
  });
});

describe("WebCacheTab — clear store (destructive)", () => {
  test("clearing confirms, POSTs, toasts the freed counts, and invalidates qk.webcache", async () => {
    engine.route("/api/webcache", fx.webCacheStatsResponse());
    engine.route("/api/webcache/clear", { ok: true, removed: 3, bytes: 1_234_567 });

    const user = userEvent.setup();
    const view = renderWithProviders(<WebCacheTab />);
    expect(await screen.findByText("64%")).toBeTruthy();

    // Destructive: the confirm dialog gates the POST.
    await user.click(screen.getByRole("button", { name: "Clear store" }));
    expect(engine.callsFor("/api/webcache/clear")).toHaveLength(0);

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Clear the web results store?")).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Clear store" }));

    expect(engine.callsFor("/api/webcache/clear")).toHaveLength(1);
    expect(engine.callsFor("/api/webcache/clear")[0]?.method).toBe("POST");
    const cleared = toastsWithTitle("Web cache cleared");
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.kind).toBe("success");
    expect(cleared[0]?.description).toBe("3 entries dropped · 1.2 MiB freed");
    expect(view.invalidatedKeys()).toContainEqual(qk.webcache);
  });

  test("cancelling the confirm dialog leaves the store untouched", async () => {
    engine.route("/api/webcache", fx.webCacheStatsResponse());
    engine.route("/api/webcache/clear", { ok: true, removed: 0, bytes: 0 });

    const user = userEvent.setup();
    renderWithProviders(<WebCacheTab />);
    expect(await screen.findByText("64%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear store" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(engine.callsFor("/api/webcache/clear")).toHaveLength(0);
  });
});

describe("WebCacheTab — sweep now", () => {
  test("sweeping POSTs, toasts the evicted counts, and invalidates qk.webcache", async () => {
    engine.route("/api/webcache", fx.webCacheStatsResponse());
    engine.route("/api/webcache/sweep", { ok: true, evicted: 2, freedBytes: 500_000, totalBytes: 1_234_567 });

    const user = userEvent.setup();
    const view = renderWithProviders(<WebCacheTab />);
    expect(await screen.findByText("64%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Sweep now" }));

    expect(engine.callsFor("/api/webcache/sweep")).toHaveLength(1);
    expect(engine.callsFor("/api/webcache/sweep")[0]?.method).toBe("POST");
    const swept = toastsWithTitle("Sweep complete");
    expect(swept).toHaveLength(1);
    expect(swept[0]?.kind).toBe("success");
    expect(swept[0]?.description).toContain("2 entries evicted");
    expect(view.invalidatedKeys()).toContainEqual(qk.webcache);
  });

  test("a no-op sweep is an info toast, not a false success", async () => {
    engine.route("/api/webcache", fx.webCacheStatsResponse());
    engine.route("/api/webcache/sweep", { ok: true, evicted: 0, freedBytes: 0, totalBytes: 12_000 });

    const user = userEvent.setup();
    renderWithProviders(<WebCacheTab />);
    expect(await screen.findByText("64%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Sweep now" }));

    const swept = toastsWithTitle("Sweep complete");
    expect(swept).toHaveLength(1);
    expect(swept[0]?.kind).toBe("info");
    expect(swept[0]?.description).toContain("under the byte cap");
  });
});

describe("WebCacheTab — empty state", () => {
  test("an empty store zeroes the KPIs and renders every empty surface", async () => {
    engine.route(
      "/api/webcache",
      fx.webCacheStatsResponse({
        entries: 0,
        bytes: 0,
        savedRequests: 0,
        totals: { hit: 0, revalidated: 0, miss: 0, stale: 0, bypass: 0, evict: 0, clear: 0, error: 0 },
        byTool: {},
        byProvider: {},
        recentEvents: [],
      }),
    );
    renderWithProviders(<WebCacheTab />);

    expect(await screen.findByText("No cache events yet")).toBeTruthy();
    expect(screen.getByText("No saves yet")).toBeTruthy();
    expect(screen.getByText("No provider traffic yet")).toBeTruthy();
    expect(screen.getByText("0 B")).toBeTruthy(); // cached size KPI
    expect(screen.getByText("—")).toBeTruthy(); // hit rate with no lookups yet
    expect(screen.getByText("enabled")).toBeTruthy(); // config still renders
  });
});

describe("WebCacheTab — error state", () => {
  test("fetch rejection degrades to the empty surfaces, no crash", async () => {
    engine.route("/api/webcache", new TypeError("engine unreachable"));
    renderWithProviders(<WebCacheTab />);

    expect(await screen.findByText("No cache events yet")).toBeTruthy();
    expect(screen.getByText("Web results store")).toBeTruthy(); // static heading survived
    expect(screen.getByText("Store stats unavailable")).toBeTruthy();
    expect(screen.getByText("No saves yet")).toBeTruthy();
    expect(screen.getByText("0 B")).toBeTruthy(); // KPIs degrade to zeros
  });
});
