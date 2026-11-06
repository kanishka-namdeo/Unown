/**
 * C-3 — the empty-state + status pins (P0 #4's "honest empty/
 * loading/error states — never a blank screen").
 *
 * Lane semantics: the empty + status modules are DOM-free PAST their
 * el() render → these pins need a DOM to run. The Ostinato
 * el.test.ts pattern: one skipped stub in Lane A (DOM-free by
 * architecture), the real pins RUN in Lane B (happy-dom preload).
 */
import { test, expect, afterEach } from "bun:test";
import type { Recipe, RunRecord } from "../domain/types.js";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("chaconne empty/status pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  function cleanBody(): void {
    document.body.innerHTML = "";
  }

  afterEach(() => {
    cleanBody();
  });

  // ─── empty.ts: the no-recipes / no-runs / no-artifacts panels ──────────

  test("renderEmpty('no-recipes'): the panel lands with the CTA button", async () => {
    const { renderEmpty } = await import("./empty.js");
    cleanBody();

    const panel = renderEmpty("no-recipes", { label: "New recipe (N)", id: "chaconne-cta-new-recipe" });
    document.body.append(panel);

    const empty = document.getElementById("chaconne-empty-no-recipes");
    expect(empty).not.toBeNull();
    expect(empty?.getAttribute("role")).toBe("status");
    const cta = document.getElementById("chaconne-cta-new-recipe") as HTMLButtonElement;
    expect(cta).not.toBeNull();
    expect(cta.textContent).toBe("New recipe (N)");
  });

  test("renderEmpty('no-runs'): the panel lands (no CTA → the copy line only)", async () => {
    const { renderEmpty } = await import("./empty.js");
    cleanBody();

    const panel = renderEmpty("no-runs");
    document.body.append(panel);

    const empty = document.getElementById("chaconne-empty-no-runs");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No runs yet");
  });

  test("renderEmpty('no-artifacts'): the panel lands", async () => {
    const { renderEmpty } = await import("./empty.js");
    cleanBody();

    const panel = renderEmpty("no-artifacts");
    document.body.append(panel);

    const empty = document.getElementById("chaconne-empty-no-artifacts");
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain("No artifacts yet");
  });

  // ─── empty.ts: the failed-run detail panel ─────────────────────────────

  test("renderFailedRun: the panel carries the status + committed prefix", async () => {
    const { renderFailedRun } = await import("./empty.js");
    cleanBody();

    const panel = renderFailedRun({
      recipeName: "My recipe",
      status: "selector-not-found",
      failedStep: "2",
      committedPrefix: 2,
      totalSteps: 5,
    });
    document.body.append(panel);

    const failed = document.getElementById("chaconne-failed-run");
    expect(failed).not.toBeNull();
    expect(failed?.getAttribute("role")).toBe("alert");
    expect(failed?.textContent).toContain("My recipe stopped at step 3");
    expect(failed?.textContent).toContain("selector-not-found");
    expect(failed?.textContent).toContain("Committed prefix: 2 of 5");
  });

  // ─── status.ts: the not-scheduled placeholder + the live row ─────────

  test("renderStatusIdle: the C-3 backward-compatible string call (honest not-scheduled copy)", async () => {
    const { renderStatusIdle } = await import("./status.js");
    cleanBody();

    const panel = renderStatusIdle("My recipe");
    document.body.append(panel);

    const idle = document.getElementById("chaconne-status-idle");
    expect(idle).not.toBeNull();
    expect(idle?.getAttribute("role")).toBe("status");
    expect(idle?.textContent).toContain("My recipe");
    // The C-4 real-state copy:
    expect(idle?.textContent).toContain("has no schedule");
  });

  test("renderStatusIdle: with a schedule shows the real state (C-4)", async () => {
    const { renderStatusIdle } = await import("./status.js");
    cleanBody();

    const panel = renderStatusIdle(
      { name: "My recipe" },
      { kind: "interval", everyMs: 60_000, nextDueIso: "2026-11-06T12:00:00.000Z", lastFiredIso: "2026-11-06T11:59:00.000Z" },
      "2026-11-06T11:59:30.000Z",
    );
    document.body.append(panel);

    const idle = document.getElementById("chaconne-status-idle");
    expect(idle).not.toBeNull();
    expect(idle?.textContent).toContain("interval");
    expect(idle?.textContent).toContain("60s");
    expect(idle?.textContent).toContain("next due");
    expect(idle?.textContent).toContain("last fired");
  });

  test("renderStatusLive: step N of M + elapsed (the live progress row)", async () => {
    const { renderStatusLive } = await import("./status.js");
    cleanBody();

    const panel = renderStatusLive({
      stepIndex: 2,
      totalSteps: 5,
      startedAt: "2026-11-06T10:00:00.000Z",
      finishedAt: "2026-11-06T10:00:09.500Z",
    });
    document.body.append(panel);

    const live = document.getElementById("chaconne-status-live");
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain("Step 3 of 5");
    expect(live?.textContent).toContain("9s");
  });

  test("renderStatusLive: a running run (no finishedAt) shows the (running) marker", async () => {
    const { renderStatusLive } = await import("./status.js");
    cleanBody();

    const panel = renderStatusLive({
      stepIndex: 0,
      totalSteps: 3,
      startedAt: "2026-11-06T10:00:00.000Z",
      nowIso: "2026-11-06T10:00:02.000Z",
    });
    document.body.append(panel);

    const live = document.getElementById("chaconne-status-live");
    expect(live?.textContent).toContain("Step 1 of 3");
    expect(live?.textContent).toContain("(running)");
  });

  test("formatElapsed: 0 → '0m', < 60s → 'Ns', ≥ 60s → 'Xm Ys'", async () => {
    const { formatElapsed } = await import("./status.js");
    expect(formatElapsed(0)).toBe("0m");
    expect(formatElapsed(45_000)).toBe("45s");
    expect(formatElapsed(134_000)).toBe("2m 14s");
  });

  // ─── run-history.ts: the grouped lists + the selection math ──────────

  test("groupRunsByRecipe: runs group under their recipe (the 5-status badges render)", async () => {
    const { groupRunsByRecipe, renderRunHistory } = await import("./run-history.js");
    cleanBody();

    const data = {
      recipes: [{ id: 1, name: "A", version: 1, steps: [] }] as Recipe[],
      runs: [
        {
          id: 1,
          recipeId: 1,
          recipeVersion: 1,
          status: "ok",
          startedAt: "2026-11-06T10:00:00Z",
          committedPrefix: 0,
          artifacts: [],
        },
        {
          id: 2,
          recipeId: 1,
          recipeVersion: 2,
          status: "timeout",
          startedAt: "2026-11-06T11:00:00Z",
          finishedAt: "2026-11-06T11:00:30Z",
          committedPrefix: 2,
          failedStepIdx: 2,
          artifacts: [{ name: "2_r2_sha256:ab.png", sha256: "ab" }],
        },
      ] as RunRecord[],
    };

    const grouped = groupRunsByRecipe(data as { recipes: Recipe[]; runs: RunRecord[] });
    expect([...grouped.get(1)!].map((r) => r.id)).toEqual([1, 2]);

    const wrap = renderRunHistory(
      data.recipes,
      data.runs,
      2,
    );
    document.body.append(wrap);

    // The grouped section + both rows + the badges (the 5-entry
    // taxonomy's honest copy: text is the cue, never color-only).
    const section = document.querySelector(".chaconne-run-group[data-recipe='1']");
    expect(section).not.toBeNull();
    const rows = document.querySelectorAll(".chaconne-run-row");
    expect(rows.length).toBe(2);
    const badges = document.querySelectorAll(".chaconne-badge");
    expect(badges.length).toBe(2);
    expect(Array.from(badges).map((b) => b.textContent)).toEqual(["ok", "timeout"]);

    // The selection pin: the focused row carries aria-current.
    const selected = document.querySelector(".chaconne-run-row[data-run='2']");
    expect(selected?.getAttribute("aria-current")).toBe("true");
  });

  test("renderRunHistory: no runs → the honest no-runs copy (never blank)", async () => {
    const { renderRunHistory } = await import("./run-history.js");
    cleanBody();

    const wrap = renderRunHistory([], [], null);
    document.body.append(wrap);

    expect(document.getElementById("chaconne-empty-runs")?.textContent).toContain("No runs yet");
  });

  // ─── C-4 schedule rows (the new run-history exports) ─────────────

  test("renderScheduleRow: an interval recipe shows kind + interval + next due + last fired", async () => {
    const { renderScheduleRow } = await import("./run-history.js");
    cleanBody();

    const recipe: Recipe = {
      id: 1, name: "A", version: 1, steps: [],
      schedule: { kind: "interval", everyMs: 30_000, nextDueIso: "2026-11-06T12:00:00.000Z", lastFiredIso: "2026-11-06T11:59:30.000Z" },
    };
    const row = renderScheduleRow(recipe, "2026-11-06T11:59:45.000Z");
    document.body.append(row);

    expect(row.textContent).toContain("A");
    expect(row.textContent).toContain("interval");
    expect(row.textContent).toContain("30s");
    expect(row.textContent).toContain("next due");
    expect(row.textContent).toContain("last fired");
  });

  test("renderScheduleRow: a retired one-shot shows the paused state", async () => {
    const { renderScheduleRow } = await import("./run-history.js");
    cleanBody();

    const recipe: Recipe = {
      id: 2, name: "B", version: 1, steps: [],
      schedule: { kind: "one-shot", lastFiredIso: "2026-11-06T11:00:00.000Z" },
    };
    const row = renderScheduleRow(recipe, "2026-11-06T12:00:00.000Z");
    document.body.append(row);

    expect(row.textContent).toContain("retired");
    expect(row.textContent).toContain("paused");
  });

  test("renderScheduleRows: shows only scheduled recipes; empty → the honest copy", async () => {
    const { renderScheduleRows } = await import("./run-history.js");
    cleanBody();

    const recipes: Recipe[] = [
      { id: 1, name: "A", version: 1, steps: [], schedule: { kind: "interval", everyMs: 1000, nextDueIso: "2026-11-06T12:00:00.000Z" } },
      { id: 2, name: "B", version: 1, steps: [] }, // unscheduled → skipped
    ];
    const list = renderScheduleRows(recipes);
    document.body.append(list);

    const rows = document.querySelectorAll(".chaconne-schedule-row");
    expect(rows.length).toBe(1); // only the scheduled recipe

    const empty = renderScheduleRows([]);
    document.body.append(empty);
    expect(document.querySelector(".chaconne-schedule-list .chaconne-state-copy")?.textContent).toContain("No scheduled recipes");
  });

  test("moveRunSelection: wraps + the Home/End kin (j/k WRAP, absolute bounds)", async () => {
    const { moveRunSelection, orderedRunIds } = await import("./run-history.js");
    // Down from the last wraps to the first; up from the first wraps to the last.
    expect(moveRunSelection(2, 1, 3)).toBe(0);
    expect(moveRunSelection(0, -1, 3)).toBe(2);
    expect(moveRunSelection(1, 1, 3)).toBe(2);
    // Empty history → index 0 (no crash).
    expect(moveRunSelection(0, 1, 0)).toBe(0);
  });

  test("orderedRunIds: groups in recipe order, runs in store order", async () => {
    const { orderedRunIds } = await import("./run-history.js");
    const data = {
      recipes: [
        { id: 1, name: "A", version: 1, steps: [] },
        { id: 2, name: "B", version: 1, steps: [] },
      ],
      runs: [
        { id: 10, recipeId: 1 },
        { id: 11, recipeId: 2 },
        { id: 12, recipeId: 1 },
      ] as never,
    };
    expect(orderedRunIds(data as never)).toEqual([10, 12, 11]);
  });

  // ─── artifact-viewer.ts: the screenshot + extracted-value views ──────

  test("renderScreenshotArtifact: the metadata panel (the content-addressed ref)", async () => {
    const { renderScreenshotArtifact } = await import("./artifact-viewer.js");
    cleanBody();

    const panel = renderScreenshotArtifact(
      { name: "1_r3_sha256:abc123.png", sha256: "abc123" },
      "My recipe",
    );
    document.body.append(panel);

    const artifact = document.getElementById("chaconne-artifact-screenshot");
    expect(artifact).not.toBeNull();
    expect(artifact?.textContent).toContain("1_r3_sha256:abc123.png");
    expect(artifact?.textContent).toContain("abc123");
    expect(artifact?.textContent).toContain("runner's disk store");
  });

  test("renderExtractedValues: the values table (step → value rows)", async () => {
    const { renderExtractedValues } = await import("./artifact-viewer.js");
    cleanBody();

    const run = {
      id: 5,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-06T10:00:00Z",
      committedPrefix: 4,
      extracted: { "1": "dubai", "3": "42" },
      artifacts: [],
    } as never;

    const panel = renderExtractedValues(run, "My recipe");
    document.body.append(panel);

    const extracted = document.getElementById("chaconne-artifact-extracted");
    expect(extracted).not.toBeNull();
    const table = extracted?.querySelector(".chaconne-extracted-table");
    expect(table).not.toBeNull();
    const rows = table?.querySelectorAll("tbody tr");
    expect(rows?.length).toBe(2);
    expect(rows?.[0]?.textContent).toContain("dubai");
    expect(rows?.[1]?.textContent).toContain("42");
  });

  test("renderExtractedValues: no extracted map → the honest no-values panel", async () => {
    const { renderExtractedValues } = await import("./artifact-viewer.js");
    cleanBody();

    const run = {
      id: 6,
      recipeId: 1,
      recipeVersion: 1,
      status: "ok",
      startedAt: "2026-11-06T10:00:00Z",
      committedPrefix: 2,
      artifacts: [],
    } as never;

    const panel = renderExtractedValues(run, "My recipe");
    document.body.append(panel);

    expect(document.getElementById("chaconne-artifact-empty")?.textContent).toBe(
      "No extracted values in this run.",
    );
  });

  // C-5: the extraction-report panel (the extract-report artifact's shape).
  test("renderExtractReport: the step-indexed expected-vs-actual table", async () => {
    const { renderExtractReport } = await import("./artifact-viewer.js");
    cleanBody();

    const panel = renderExtractReport(
      {
        "1": [{ selector: "#bottom", attr: "text", actual: "bottom-marker" }],
        "2": [{ selector: "#mid", attr: "data-attr", expected: "mid", actual: "mid" }],
      },
      "My recipe",
    );
    document.body.append(panel);

    const region = document.getElementById("chaconne-artifact-extract-report");
    expect(region).not.toBeNull();
    const table = region?.querySelector(".chaconne-extraction-table");
    expect(table).not.toBeNull();
    const rows = table?.querySelectorAll("tbody tr");
    expect(rows?.length).toBe(2);
    expect(rows?.[0]?.textContent).toContain("#bottom");
    expect(rows?.[0]?.textContent).toContain("bottom-marker");
    expect(rows?.[1]?.textContent).toContain("data-attr");
    // The named expectation renders (expected-vs-actual law, C-5 #1).
    expect(rows?.[1]?.textContent).toContain("mid");
  });

  test("renderExtractReport: an empty report → the honest no-reports panel", async () => {
    const { renderExtractReport } = await import("./artifact-viewer.js");
    cleanBody();

    const panel = renderExtractReport({}, "My recipe");
    document.body.append(panel);

    expect(document.getElementById("chaconne-extract-report-empty")?.textContent).toBe(
      "No extraction report in this run (no extract steps ran).",
    );
  });
}
