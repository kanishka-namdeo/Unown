// Component tests for src/components/dashboard/dreams-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed, plus the dream-run
// mutation (trigger → POST /api/dreams/run → toast + qk.dreams/qk.notes/qk.overview
// invalidation; the "skipped" branch surfaces an info toast, no false success).

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qk } from "@/lib/agent-api";
import { DreamsTab } from "../dreams-tab";
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

function routeHappy() {
  engine.route("/api/dreams/dream-0001/notes", fx.dreamNotesResponse());
  engine.route("/api/dreams", fx.dreamsResponse());
  engine.route("/api/notes", fx.notesResponse());
}

describe("DreamsTab — happy state", () => {
  test("renders dream cards with stats and the pending-notes column", async () => {
    routeHappy();
    renderWithProviders(<DreamsTab />);

    expect(await screen.findByText("consolidation complete")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy(); // DreamStatusBadge
    expect(screen.getByText("dream-00")).toBeTruthy(); // id.slice(0, 8)

    // StatChips: value and label are separate text nodes.
    expect(screen.getByText("notes in")).toBeTruthy();
    expect(screen.getByText("merged")).toBeTruthy();
    expect(screen.getByText("pruned")).toBeTruthy();
    expect(screen.getByText("added")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy(); // notes_in
    expect(screen.getByText("2")).toBeTruthy(); // entries_merged

    // Pending notes: only the undreamed note (dream_id null) is listed.
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getByText("Redirect drops session when cookie path is /auth.")).toBeTruthy();
    expect(screen.queryAllByText("Already consolidated note.")).toHaveLength(0);
  });

  test("expanding a dream fetches its consumed notes and shows the output", async () => {
    routeHappy();
    const user = userEvent.setup();
    renderWithProviders(<DreamsTab />);
    expect(await screen.findByText("dream-00")).toBeTruthy();

    await user.click(screen.getByText("dream-00").closest("button") as HTMLElement);

    expect(await screen.findByText("Merged cookie-scope lessons into project memory.")).toBeTruthy();
    // "consumed notes (1)" is split across two elements — assert both parts.
    expect(screen.getByText("consumed notes")).toBeTruthy();
    expect(screen.getByText("(1)")).toBeTruthy();
    expect(screen.getByText("Cookie scoped to /auth was dropped before the redirect landed.")).toBeTruthy();
    expect(engine.callsFor("/api/dreams/dream-0001/notes")).toHaveLength(1);
  });
});

describe("DreamsTab — dream-run mutation", () => {
  test("trigger POSTs /api/dreams/run, toasts, and invalidates dreams/notes/overview", async () => {
    routeHappy();
    engine.route("/api/dreams/run", { started: true, pendingNotes: 2 });

    const user = userEvent.setup();
    const view = renderWithProviders(<DreamsTab />);
    expect(await screen.findByText("dream-00")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /run autodream/i }));

    expect(engine.callsFor("/api/dreams/run")).toHaveLength(1);
    expect(engine.callsFor("/api/dreams/run")[0]?.method).toBe("POST");
    const started = toastsWithTitle("AutoDream started");
    expect(started).toHaveLength(1);
    expect(started[0]?.kind).toBe("success");
    expect(started[0]?.description).toBe("Consolidating 2 pending notes.");
    expect(view.invalidatedKeys()).toContainEqual(qk.dreams);
    expect(view.invalidatedKeys()).toContainEqual(qk.notes);
    expect(view.invalidatedKeys()).toContainEqual(qk.overview);
  });

  test("skipped dream: info toast with the engine's reason, no false start", async () => {
    routeHappy();
    engine.route("/api/dreams/run", { skipped: "only 1 pending note — below the 3-note threshold" });

    const user = userEvent.setup();
    const view = renderWithProviders(<DreamsTab />);
    expect(await screen.findByText("dream-00")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /run autodream/i }));

    const skipped = toastsWithTitle("AutoDream skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.kind).toBe("info");
    expect(skipped[0]?.description).toContain("below the 3-note threshold");
    expect(toastsWithTitle("AutoDream started")).toHaveLength(0); // no false success
    expect(view.invalidatedKeys()).toContainEqual(qk.dreams); // list still refreshed
  });
});

describe("DreamsTab — empty state", () => {
  test("no dreams, no pending notes", async () => {
    engine.route("/api/dreams", { dreams: [] });
    engine.route("/api/notes", { notes: [] });

    renderWithProviders(<DreamsTab />);

    expect(await screen.findByText("No dreams yet")).toBeTruthy();
    expect(screen.getByText("No pending notes")).toBeTruthy();
    expect(screen.getByText("0 waiting")).toBeTruthy();
  });
});

describe("DreamsTab — error state", () => {
  test("fetch rejections degrade to the empty surfaces, no crash", async () => {
    engine.route("/api/dreams", new TypeError("engine unreachable"));
    engine.route("/api/notes", new TypeError("engine unreachable"));

    renderWithProviders(<DreamsTab />);

    expect(await screen.findByText("No dreams yet")).toBeTruthy();
    expect(screen.getByText("No pending notes")).toBeTruthy();
    expect(screen.getByText("Dreams")).toBeTruthy(); // static section heading survived
  });
});
