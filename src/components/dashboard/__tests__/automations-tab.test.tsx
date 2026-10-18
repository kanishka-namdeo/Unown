// Component tests for src/components/dashboard/automations-tab.tsx.
//
// Backlog reference: docs/testing-strategy.md §4.1 "Component" tests — happy /
// empty states with engine responses stubbed, plus the automations mutations:
// create (POST /api/automations → toast + qk.automations invalidation; the
// client-side cron/delay guards keep an incomplete form from POSTing; a 400
// from the engine surfaces its error message), run-now (POST
// /api/automations/<id>/run → toast + automations/automation-runs
// invalidation; 409-busy degrades to a warning toast with no false success),
// and the destructive lifecycle/delete actions, which confirm via AlertDialog
// before PATCHing { lifecycle } / DELETEing the definition.
//
// fixtures.ts has no automation builders yet — realistic fixtures are built
// inline here, typed against agent-types.ts like the shared factories.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { qk } from "@/lib/agent-api";
import type {
  Automation,
  AutomationRun,
  AutomationsResponse,
  AutomationRunsResponse,
} from "@/lib/agent-types";
import { AutomationsTab } from "../automations-tab";
import {
  busyResponse,
  createEngine,
  type EngineStub,
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

// ---- inline automation fixtures (no shared builders exist yet) ----

const now = () => Date.now();
const minutesAgo = (m: number) => now() - m * 60_000;

function automationRun(over: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "arun-0001",
    automation_id: "auto-morning-brief",
    trigger_kind: "schedule",
    scheduled_at: minutesAgo(12),
    status: "succeeded",
    started_at: minutesAgo(12),
    ended_at: minutesAgo(11),
    exit_code: 0,
    output: "Brief ready: 2 merged PRs, 1 regression flagged, 0 flaky tests.",
    error: null,
    turns: 6,
    tokens_in: 4200,
    tokens_out: 800,
    ...over,
  };
}

function automation(over: Partial<Automation> = {}): Automation {
  return {
    id: "auto-morning-brief",
    title: "morning brief",
    prompt: "Scan the repo since the last brief and post a digest of merges, regressions and flaky tests.",
    cron_expr: "0 9 * * 1-5",
    delay_ms: null,
    workspace: "/home/dev/unown",
    mode: "read-only",
    model: null,
    max_runs: null,
    run_count: 12,
    scheduled_run_count: 11,
    lifecycle: "active",
    next_run_at: now() + 3_600_000,
    last_run_at: minutesAgo(12),
    created_at: minutesAgo(6000),
    updated_at: minutesAgo(12),
    schedule: "At 09:00, Mon-Fri",
    lastRun: automationRun(),
    ...over,
  };
}

/** Two cards: an active cron automation with a succeeded lastRun, and a
 *  paused standard-mode one-shot that never ran. */
function automationsResponse(): AutomationsResponse {
  return {
    automations: [
      automation(),
      automation({
        id: "auto-deploy-check",
        title: "deploy check",
        prompt: "Verify the staging deploy landed and summarise artefact sizes.",
        cron_expr: null,
        delay_ms: now() + 86_400_000,
        mode: "standard",
        max_runs: 1,
        run_count: 0,
        scheduled_run_count: 0,
        lifecycle: "paused",
        next_run_at: null,
        last_run_at: null,
        created_at: minutesAgo(3000),
        updated_at: minutesAgo(60),
        schedule: "One-shot · fires once",
        lastRun: null,
      }),
    ],
  };
}

function automationRunsResponse(): AutomationRunsResponse {
  return {
    runs: [
      automationRun(),
      automationRun({
        id: "arun-0002",
        trigger_kind: "manual",
        scheduled_at: null,
        status: "failed",
        started_at: minutesAgo(40),
        ended_at: minutesAgo(39) + 30_000,
        exit_code: 1,
        output: null,
        error: "sandbox timed out after 300s",
        turns: 3,
        tokens_in: 1200,
        tokens_out: 300,
      }),
    ],
  };
}

// GET /api/automations serves the list; POST on the same path is the create
// mutation — dispatch on method (same pattern as the dreams note responder).
function routeAutomations(postResponder: object | Response = { ok: true }) {
  engine.route(
    "/api/automations",
    (call) => (call.method === "POST" ? postResponder : automationsResponse())
  );
}

function routeHappy() {
  routeAutomations();
  engine.route("/api/automations/auto-morning-brief/runs", automationRunsResponse());
}

describe("AutomationsTab — happy state", () => {
  test("renders both automation cards; expanding the first fetches its run history", async () => {
    routeHappy();
    const user = userEvent.setup();
    renderWithProviders(<AutomationsTab />);

    // Titles + ids.
    expect(await screen.findByText("morning brief")).toBeTruthy();
    expect(screen.getByText("deploy check")).toBeTruthy();
    expect(screen.getByText("auto-morning-brief")).toBeTruthy();
    expect(screen.getByText("auto-deploy-check")).toBeTruthy();

    // Schedule hints (REST-added human hint), lifecycle and mode pills.
    expect(screen.getByText("At 09:00, Mon-Fri")).toBeTruthy();
    expect(screen.getByText("One-shot · fires once")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByText("paused")).toBeTruthy();
    expect(screen.getByText("read-only")).toBeTruthy();
    expect(screen.getByText("standard")).toBeTruthy();

    // Run counts — bare, and capped with /max_runs on the one-shot.
    expect(screen.getByText("12 runs")).toBeTruthy();
    expect(screen.getByText("0/1 runs")).toBeTruthy();

    // lastRun summary on the cron card; the paused one-shot never ran.
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.getByText("exit 0")).toBeTruthy();
    expect(screen.getByText("4.2k / 800 tokens")).toBeTruthy();
    expect(screen.getByText("never ran")).toBeTruthy();

    // Only the active card shows the next fire.
    expect(screen.getAllByText((c) => c.startsWith("next:"))).toHaveLength(1);

    // Per-card actions + the create entry point in the heading.
    expect(screen.getAllByRole("button", { name: "Run now" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "pause morning brief" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "resume deploy check" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "delete morning brief" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "delete deploy check" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New automation" })).toBeTruthy();

    // Expanding fetches the runs — but only once opened.
    expect(engine.callsFor("/api/automations/auto-morning-brief/runs")).toHaveLength(0);
    await user.click(screen.getAllByRole("button", { name: "Run history" })[0]);

    const hist = await screen.findByLabelText("automation run history");
    await within(hist).findByText("failed"); // second run's badge
    expect(within(hist).getAllByText("succeeded")).toHaveLength(1);
    // Triggers, started-ago, durations, turns, tokens, exit codes.
    expect(within(hist).getAllByText("schedule")).toHaveLength(1);
    expect(within(hist).getByText("manual")).toBeTruthy();
    expect(within(hist).getByText("1m")).toBeTruthy(); // run 1 duration
    expect(within(hist).getByText("1m 30s")).toBeTruthy(); // run 2 duration
    expect(within(hist).getByText("6 turns")).toBeTruthy();
    expect(within(hist).getByText("4.2k / 800 tokens")).toBeTruthy();
    expect(within(hist).getByText("1.2k / 300 tokens")).toBeTruthy();
    expect(within(hist).getByText("exit 1")).toBeTruthy();
    // Output/error text survives truncation for findability.
    expect(within(hist).getByText("sandbox timed out after 300s")).toBeTruthy();
    expect(
      within(hist).getByText("Brief ready: 2 merged PRs, 1 regression flagged, 0 flaky tests.")
    ).toBeTruthy();
    expect(engine.callsFor("/api/automations/auto-morning-brief/runs")).toHaveLength(1);
  });
});

describe("AutomationsTab — empty state", () => {
  test("no automations yet", async () => {
    engine.route("/api/automations", { automations: [] });
    renderWithProviders(<AutomationsTab />);

    expect(await screen.findByText("No automations yet")).toBeTruthy();
    expect(
      screen.getByText("Schedule the agent to run on its own — cron rhythms or one-shots, read-only by default.")
    ).toBeTruthy();
    expect(screen.getByText("Automations")).toBeTruthy(); // static heading survived
    expect(screen.getByRole("button", { name: "New automation" })).toBeTruthy();
    expect(
      screen.getByText(
        "definitions live in the engine DB — never in repo files; read-only mode keeps every run observation-only."
      )
    ).toBeTruthy();
  });
});

describe("AutomationsTab — create flow", () => {
  test("creating an automation POSTs the definition, toasts, closes the dialog, invalidates", async () => {
    routeHappy();
    routeAutomations({ automation: automation({ id: "auto-nightly-changelog", title: "nightly changelog" }) });

    const user = userEvent.setup();
    const view = renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New automation" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New automation")).toBeTruthy();

    await user.type(within(dialog).getByLabelText("automation title"), "nightly changelog");
    await user.type(within(dialog).getByLabelText("automation prompt"), "Summarise the day's commits into a changelog.");
    await user.type(within(dialog).getByLabelText("cron expression"), "0 9 * * 1-5");

    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const posts = engine.callsFor("/api/automations").filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      title: "nightly changelog",
      prompt: "Summarise the day's commits into a changelog.",
      cron: "0 9 * * 1-5",
      mode: "read-only",
    });

    const created = toastsWithTitle("Automation created");
    expect(created).toHaveLength(1);
    expect(created[0]?.kind).toBe("success");

    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
    expect(view.invalidatedKeys()).toContainEqual(qk.automations);
  });

  test("cron mode with an empty expression keeps Create disabled — nothing POSTs", async () => {
    routeHappy();
    const user = userEvent.setup();
    renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New automation" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("automation title"), "nightly changelog");
    await user.type(within(dialog).getByLabelText("automation prompt"), "Summarise the day's commits.");

    const create = within(dialog).getByRole("button", { name: "Create" });
    expect(isDisabled(create)).toBe(true);

    // Even a stray click on the disabled submit fires no POST.
    await user.click(create);
    expect(engine.callsFor("/api/automations").filter((c) => c.method === "POST")).toHaveLength(0);
  });

  test("one-shot mode requires a numeric delay and POSTs delayMinutes instead of cron", async () => {
    routeHappy();
    routeAutomations({ automation: automation({ id: "auto-one", title: "one-shot check" }) });

    const user = userEvent.setup();
    renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New automation" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("automation title"), "one-shot check");
    await user.type(within(dialog).getByLabelText("automation prompt"), "Check the deploy once.");
    await user.click(within(dialog).getByRole("button", { name: "one-shot" }));

    // Switched the schedule input, but the delay is still empty → disabled.
    expect(isDisabled(within(dialog).getByRole("button", { name: "Create" }))).toBe(true);

    await user.type(within(dialog).getByLabelText("delay minutes"), "30");
    expect(isDisabled(within(dialog).getByRole("button", { name: "Create" }))).toBe(false);

    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const posts = engine.callsFor("/api/automations").filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({
      title: "one-shot check",
      prompt: "Check the deploy once.",
      delayMinutes: 30,
      mode: "read-only",
    });

    expect(toastsWithTitle("Automation created")).toHaveLength(1);
  });

  test("engine 400 → error toast carrying the engine's message, dialog stays open, no invalidation", async () => {
    routeHappy();
    routeAutomations(
      new Response(JSON.stringify({ error: "invalid cron expression" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );

    const user = userEvent.setup();
    const view = renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "New automation" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("automation title"), "nightly changelog");
    await user.type(within(dialog).getByLabelText("automation prompt"), "Summarise the day's commits.");
    await user.type(within(dialog).getByLabelText("cron expression"), "not a cron");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));

    const failed = toastsWithTitle("Failed to create automation");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.kind).toBe("error");
    expect(failed[0]?.description).toBe("invalid cron expression");
    expect(toastsWithTitle("Automation created")).toHaveLength(0); // no false success
    expect(screen.getAllByRole("dialog")).toHaveLength(1); // still open for correction
    expect(view.invalidatedKeys()).not.toContainEqual(qk.automations);
  });
});

describe("AutomationsTab — run now", () => {
  test("Run now POSTs the dispatch, toasts, and invalidates automations + its runs", async () => {
    routeHappy();
    engine.route("/api/automations/auto-morning-brief/run", { ok: true });

    const user = userEvent.setup();
    const view = renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Run now" })[0]);

    const calls = engine.callsFor("/api/automations/auto-morning-brief/run");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");

    const started = toastsWithTitle("Automation started");
    expect(started).toHaveLength(1);
    expect(started[0]?.kind).toBe("success");
    expect(started[0]?.description).toBe("A headless session is dispatching — watch the run history.");
    expect(view.invalidatedKeys()).toContainEqual(qk.automations);
    expect(view.invalidatedKeys()).toContainEqual(qk.automationRuns("auto-morning-brief"));
  });

  test("409-busy: warning toast with the engine's error, no false success, no invalidation", async () => {
    routeHappy();
    engine.route(
      "/api/automations/auto-morning-brief/run",
      busyResponse("an automation run is already in flight")
    );

    const user = userEvent.setup();
    const view = renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: "Run now" })[0]);

    const warn = toastsWithTitle("Automation did not start");
    expect(warn).toHaveLength(1);
    expect(warn[0]?.kind).toBe("warning");
    expect(warn[0]?.description).toContain("already in flight");
    expect(toastsWithTitle("Automation started")).toHaveLength(0); // no false success
    expect(view.invalidatedKeys()).not.toContainEqual(qk.automations);
  });
});

describe("AutomationsTab — pause / resume", () => {
  test("pausing confirms via AlertDialog, PATCHes { lifecycle: 'paused' }, toasts, invalidates", async () => {
    routeHappy();
    engine.route(
      "/api/automations/auto-morning-brief",
      (call) => (call.method === "PATCH" ? { automation: automation({ lifecycle: "paused" }) } : { ok: true })
    );

    const user = userEvent.setup();
    const view = renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "pause morning brief" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Pause "morning brief"?')).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Pause" }));

    const calls = engine.callsFor("/api/automations/auto-morning-brief");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.body).toEqual({ lifecycle: "paused" });

    const paused = toastsWithTitle("Automation paused");
    expect(paused).toHaveLength(1);
    expect(paused[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.automations);
  });

  test("cancelling the pause confirm leaves the lifecycle untouched", async () => {
    routeHappy();
    engine.route("/api/automations/auto-morning-brief", { automation: automation() });

    const user = userEvent.setup();
    renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "pause morning brief" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(engine.callsFor("/api/automations/auto-morning-brief")).toHaveLength(0);
  });
});

describe("AutomationsTab — delete", () => {
  test("deleting confirms via AlertDialog, DELETEs the definition, toasts, invalidates", async () => {
    routeHappy();
    engine.route(
      "/api/automations/auto-morning-brief",
      (call) => (call.method === "DELETE" ? { ok: true } : { automation: automation() })
    );

    const user = userEvent.setup();
    const view = renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "delete morning brief" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Delete "morning brief"?')).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const calls = engine.callsFor("/api/automations/auto-morning-brief");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("DELETE");

    const deleted = toastsWithTitle("Automation deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.kind).toBe("success");
    expect(view.invalidatedKeys()).toContainEqual(qk.automations);
  });

  test("cancelling the delete confirm leaves the definition in place", async () => {
    routeHappy();
    engine.route("/api/automations/auto-morning-brief", { automation: automation() });

    const user = userEvent.setup();
    renderWithProviders(<AutomationsTab />);
    expect(await screen.findByText("morning brief")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "delete morning brief" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(engine.callsFor("/api/automations/auto-morning-brief")).toHaveLength(0);
  });
});
