/**
 * C-3 — the palette enumeration pin (P0 #4's "every P0 action
 * reachable — pinned by enumeration").
 *
 * Lane semantics (the Ostinato el.test.ts pattern):
 *   Lane A — `cd apps/chaconne && bun test`: the palette module is
 *            DOM-FREE (pure data + filter math) → these pins RUN in
 *            both lanes.
 *   Lane B — `bun test apps/chaconne` from the root: also runs
 *            (the module has no DOM dependence).
 *
 * The pins:
 *   1. The P0 action list — every P0 action has a row: new-recipe,
 *      edit-recipe, delete-recipe, run-recipe, view-run,
 *      view-artifact, export, import (+ the honest delete-run +
 *      route rows). The count assertion (11) fails if a row is
 *      silently dropped.
 *   2. filterCommands: "" → the full table in stable order; a query
 *      matches label/id/group/hint.
 *   3. isCommandEnabled: the Selection + route gate (edit-recipe
 *      dims without a selection, view-artifact dims without
 *      artifacts, export is always enabled).
 */
import { test, expect } from "bun:test";
import {
  PALETTE_COMMANDS,
  PALETTE_COMMAND_COUNT,
  PALETTE_BY_ID,
  filterCommands,
  isCommandEnabled,
  COMMAND_KEY_DISPATCH,
  type Selection,
} from "./palette.js";

const NO_SELECTION: Selection = {
  recipeId: null,
  runId: null,
  runHasArtifacts: false,
  artifactRunId: null,
};

// ─── 1. The P0 action enumeration ────────────────────────────────────────────

test("PALETTE_COMMANDS: every P0 action has a row (the enumeration pin)", () => {
  const p0Actions = [
    "new-recipe",
    "edit-recipe",
    "delete-recipe",
    "run-recipe",
    "view-run",
    "view-artifact",
    "export",
    "import",
  ];
  for (const id of p0Actions) {
    expect(PALETTE_BY_ID[id]).toBeDefined();
  }
});

test("PALETTE_COMMAND_COUNT: pinned at 11 (the full table)", () => {
  expect(PALETTE_COMMAND_COUNT).toBe(11);
});

test("PALETTE_COMMANDS: ids are unique (one row per id)", () => {
  const ids = PALETTE_COMMANDS.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

// ─── 2. filterCommands ────────────────────────────────────────────────────────

test("filterCommands: empty query → the full table in stable order", () => {
  const all = filterCommands("");
  expect(all).toHaveLength(11);
  expect(all.map((c) => c.id)).toEqual(PALETTE_COMMANDS.map((c) => c.id));
});

test("filterCommands: 'export' matches the data row by label", () => {
  const hits = filterCommands("export");
  const ids = hits.map((c) => c.id);
  expect(ids).toContain("export");
  expect(ids.length).toBeLessThan(11);
});

test("filterCommands: a query matching nothing → empty (never invents rows)", () => {
  expect(filterCommands("zzzz-no-match")).toEqual([]);
});

// ─── 3. isCommandEnabled (the Selection + route gate) ────────────────────────

test("isCommandEnabled: export/import are always enabled", () => {
  expect(isCommandEnabled(PALETTE_BY_ID["export"], NO_SELECTION, "recipes")).toBe(true);
  expect(isCommandEnabled(PALETTE_BY_ID["import"], NO_SELECTION, "runs")).toBe(true);
});

test("isCommandEnabled: edit-recipe dims without a selection, enables with one", () => {
  expect(isCommandEnabled(PALETTE_BY_ID["edit-recipe"], NO_SELECTION, "recipes")).toBe(false);
  const withRecipe: Selection = { ...NO_SELECTION, recipeId: 1 };
  expect(isCommandEnabled(PALETTE_BY_ID["edit-recipe"], withRecipe, "recipes")).toBe(true);
});

test("isCommandEnabled: view-artifact dims without artifacts, enables with runHasArtifacts", () => {
  expect(isCommandEnabled(PALETTE_BY_ID["view-artifact"], NO_SELECTION, "runs")).toBe(false);
  const withArtifacts: Selection = { ...NO_SELECTION, runId: 5, runHasArtifacts: true };
  expect(isCommandEnabled(PALETTE_BY_ID["view-artifact"], withArtifacts, "runs")).toBe(true);
});

test("isCommandEnabled: view-run dims without a run selection", () => {
  expect(isCommandEnabled(PALETTE_BY_ID["view-run"], NO_SELECTION, "runs")).toBe(false);
  const withRun: Selection = { ...NO_SELECTION, runId: 3 };
  expect(isCommandEnabled(PALETTE_BY_ID["view-run"], withRun, "runs")).toBe(true);
});

// ─── 4. COMMAND_KEY_DISPATCH (the letter keys the palette rows advertise) ────

test("COMMAND_KEY_DISPATCH: the advertised letters route into command ids", () => {
  expect(COMMAND_KEY_DISPATCH["n"]).toBe("new-recipe");
  expect(COMMAND_KEY_DISPATCH["e"]).toBe("edit-recipe");
  expect(COMMAND_KEY_DISPATCH["r"]).toBe("run-recipe");
  expect(COMMAND_KEY_DISPATCH["v"]).toBe("view-run");
  expect(COMMAND_KEY_DISPATCH["a"]).toBe("view-artifact");
  expect(COMMAND_KEY_DISPATCH["1"]).toBe("go-recipes");
  expect(COMMAND_KEY_DISPATCH["2"]).toBe("go-runs");
});
