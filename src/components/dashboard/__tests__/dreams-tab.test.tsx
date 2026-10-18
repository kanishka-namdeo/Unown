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

describe("DreamsTab — notes pipeline (manual note + outbox sync)", () => {
  test("delivering a manual note POSTs /api/notes with the content and project path, then clears the textarea", async () => {
    routeHappy();
    // The list GET and the note POST share the /api/notes path — dispatch on
    // method so the POST gets the create-response shape.
    engine.route("/api/notes", (call) =>
      call.method === "POST" ? { ok: true, id: "note-99" } : fx.notesResponse()
    );

    const user = userEvent.setup();
    const view = renderWithProviders(<DreamsTab />);
    expect(await screen.findByText("dream-00")).toBeTruthy();

    const textarea = screen.getByLabelText("manual note") as HTMLTextAreaElement;
    await user.type(textarea, "cookie scope must be checked before redirecting");

    await user.click(screen.getByRole("button", { name: /deliver note/i }));

    const posts = engine.callsFor("/api/notes").filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      content: "cookie scope must be checked before redirecting",
      project_path: ".",
    });

    expect(textarea.value).toBe(""); // draft cleared on success

    const delivered = toastsWithTitle("Note delivered");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.notes);
  });

  test("sync outbox POSTs /api/notes/sync and toasts the synced count", async () => {
    routeHappy();
    engine.route("/api/notes/sync", { ok: true, synced: 3 });

    const user = userEvent.setup();
    const view = renderWithProviders(<DreamsTab />);
    expect(await screen.findByText("dream-00")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /sync outbox/i }));

    const syncs = engine.callsFor("/api/notes/sync");
    expect(syncs).toHaveLength(1);
    expect(syncs[0]?.method).toBe("POST");

    const synced = toastsWithTitle("Synced 3 notes");
    expect(synced).toHaveLength(1);
    expect(synced[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.notes);
    expect(toastsWithTitle("Outbox empty")).toHaveLength(0); // not the empty branch
  });

  test("sync outbox with 0 synced shows the empty info toast, no false success", async () => {
    routeHappy();
    engine.route("/api/notes/sync", { ok: true, synced: 0 });

    const user = userEvent.setup();
    renderWithProviders(<DreamsTab />);
    expect(await screen.findByText("dream-00")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /sync outbox/i }));

    expect(engine.callsFor("/api/notes/sync")).toHaveLength(1);
    const empty = toastsWithTitle("Outbox empty");
    expect(empty).toHaveLength(1);
    expect(empty[0]?.kind).toBe("info");
    expect(toastsWithTitle("Synced 0 notes")).toHaveLength(0); // no false success
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
