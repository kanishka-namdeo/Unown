// Component tests for src/components/dashboard/memory-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests —
// happy/empty/error states with engine responses stubbed, plus the destructive
// action flows: memory rollback via AlertDialog confirmation (invalidates
// qk.memory), a 409-busy rollback (no false success), and skill retire
// confirmation (invalidates qk.skills).
//
// Note on 409: memory-tab's rollback onError has no dedicated busy branch
// (unlike overview/router/console) — it degrades to a toast.error carrying the
// engine's busy string. The contract tested here is the one that matters:
// no crash, no false success, no invalidation.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qk } from "@/lib/agent-api";
import { MemoryTab } from "../memory-tab";
import * as fx from "./fixtures";
import {
  busyResponse,
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
  engine.route("/api/overview", fx.overviewResponse());
  engine.route("/api/memory/project/history", fx.memoryHistoryResponse());
  engine.route("/api/memory", fx.memoryResponse());
  engine.route("/api/skills", fx.skillsResponse());
}

describe("MemoryTab — happy state", () => {
  test("renders the 4 tier cards, version history with rollback actions, and minted skills", async () => {
    routeHappy();
    renderWithProviders(<MemoryTab />);

    // Tier cards: labels, contents and resolved-chars subtitle.
    expect(await screen.findByText("Tier 1 · Project")).toBeTruthy();
    expect(screen.getByText("Tier 0 · Policy")).toBeTruthy();
    expect(screen.getByText("Tier 2 · User")).toBeTruthy();
    expect(screen.getByText("Tier 3 · Local")).toBeTruthy();
    expect(screen.getByText("Never exfiltrate secrets.")).toBeTruthy();
    // Project content appears in the tier card AND every history entry (v1–v3).
    expect(screen.getAllByText("This repo uses bun; run tests with `bun test src`.")).toHaveLength(4);
    expect(screen.getByText("187 chars resolved into every system prompt")).toBeTruthy();

    // Dream-now button carries the pending-notes badge (overview kpis.notes.pending).
    expect(screen.getByRole("button", { name: /dream now/i })).toBeTruthy();

    // Version history: project selected by default, 3 versions, current pinned.
    expect(screen.getByText("project history")).toBeTruthy();
    expect(screen.getByText("3 versions")).toBeTruthy();
    expect(screen.getByText("current")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Rollback" })).toHaveLength(2); // v2 + v1 (v3 is current)
    expect(screen.getByText("consolidated from session notes")).toBeTruthy();
    expect(screen.getByText("shipped improvement imp-0001")).toBeTruthy();
    expect(screen.getAllByText("autodream")).toHaveLength(1); // ChangedByBadge
    expect(screen.getAllByText("harness")).toHaveLength(1);
    expect(screen.getAllByText("seed")).toHaveLength(1);

    // Skills section: two minted skills with status badges and actions.
    expect(screen.getByText("bun-test-conventions")).toBeTruthy();
    expect(screen.getByText("sandbox-gates")).toBeTruthy();
    expect(screen.getByText("2 minted")).toBeTruthy();
    expect(screen.getAllByText("shipped")).toHaveLength(1); // skill status badge
    expect(screen.getAllByText("retired")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Rollback to v1" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Retire" })).toHaveLength(1); // retired skill has none
  });
});

describe("MemoryTab — rollback mutation", () => {
  test("confirming the AlertDialog POSTs the rollback, toasts, and invalidates memory queries", async () => {
    routeHappy();
    engine.route("/api/memory/project/rollback", { ok: true });

    const user = userEvent.setup();
    const view = renderWithProviders(<MemoryTab />);
    expect(await screen.findByText("project history")).toBeTruthy();

    // v2 row's rollback button opens the confirmation dialog.
    await user.click(screen.getAllByRole("button", { name: "Rollback" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Rollback project memory to v2?")).toBeTruthy();

    // Confirming fires the POST with the target version.
    await user.click(within(dialog).getByRole("button", { name: "Rollback" }));
    expect(engine.callsFor("/api/memory/project/rollback")).toHaveLength(1);
    expect(engine.callsFor("/api/memory/project/rollback")[0]?.method).toBe("POST");
    expect(engine.callsFor("/api/memory/project/rollback")[0]?.body).toEqual({ version: 2 });

    const rolled = toastsWithTitle("Rolled back");
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.kind).toBe("success");
    expect(rolled[0]?.description).toBe("project memory restored to v2.");
    expect(view.invalidatedKeys()).toContainEqual(qk.memory);
    expect(view.invalidatedKeys()).toContainEqual(qk.overview);
    expect(view.invalidatedKeys()).toContainEqual(qk.memoryHistory("project"));
  });

  test("409-busy: error toast carrying the engine busy string, no false success, no invalidation", async () => {
    routeHappy();
    engine.route("/api/memory/project/rollback", busyResponse("router busy: a background job is learning"));

    const user = userEvent.setup();
    const view = renderWithProviders(<MemoryTab />);
    expect(await screen.findByText("project history")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Rollback" })[0]);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Rollback" }));

    const failed = toastsWithTitle("Rollback failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.kind).toBe("error");
    expect(failed[0]?.description).toContain("router busy");
    expect(toastsWithTitle("Rolled back")).toHaveLength(0); // no false success
    expect(view.invalidatedKeys()).not.toContainEqual(qk.memory);
  });
});

describe("MemoryTab — skill actions", () => {
  test("retiring a skill confirms via AlertDialog, POSTs, and invalidates qk.skills", async () => {
    routeHappy();
    engine.route("/api/skills/skill-0001/retire", { ok: true });

    const user = userEvent.setup();
    const view = renderWithProviders(<MemoryTab />);
    expect(await screen.findByText("bun-test-conventions")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retire" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Retire skill "bun-test-conventions"?')).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Retire" }));
    expect(engine.callsFor("/api/skills/skill-0001/retire")).toHaveLength(1);
    expect(engine.callsFor("/api/skills/skill-0001/retire")[0]?.method).toBe("POST");

    const retired = toastsWithTitle("Skill retired");
    expect(retired).toHaveLength(1);
    expect(retired[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.skills);
  });
});

describe("MemoryTab — empty state", () => {
  test("no tiers, no history, no skills", async () => {
    engine.route("/api/overview", fx.overviewResponse());
    engine.route("/api/memory/project/history", { history: [] });
    engine.route("/api/memory", { tiers: [], resolvedChars: 0 });
    engine.route("/api/skills", { skills: [] });

    renderWithProviders(<MemoryTab />);

    expect(await screen.findByText("No memory loaded")).toBeTruthy();
    expect(screen.getByText("No history for this tier yet")).toBeTruthy();
    expect(screen.getByText("0 versions")).toBeTruthy();
    expect(screen.getByText("No skills minted yet")).toBeTruthy();
    expect(screen.getByText("0 chars resolved into every system prompt")).toBeTruthy();
  });
});

describe("MemoryTab — error state", () => {
  test("fetch rejections degrade to empty surfaces, no crash", async () => {
    engine.route("/api/overview", new TypeError("engine unreachable"));
    engine.route("/api/memory/project/history", new TypeError("engine unreachable"));
    engine.route("/api/memory", new TypeError("engine unreachable"));
    engine.route("/api/skills", new TypeError("engine unreachable"));

    renderWithProviders(<MemoryTab />);

    expect(await screen.findByText("No memory loaded")).toBeTruthy();
    expect(screen.getByText("No history for this tier yet")).toBeTruthy();
    expect(screen.getByText("No skills minted yet")).toBeTruthy();
    expect(screen.getByText("Tiered memory")).toBeTruthy(); // static section heading survived
    expect(screen.getByText("0 chars resolved into every system prompt")).toBeTruthy();
  });
});
