/**
 * Invariants + ids test — PRD P0 #1 ("validation on every boundary")
 * and the deterministic-id law (PLAN §1/§2: max+1 kin, never random).
 */
import { test, expect } from "bun:test";
import {
  addRecipe,
  addRun,
  emptyData,
  recordSchedule,
  removeRecipe,
  updateRecipe,
} from "./model.js";
import { assertData, assertStep } from "./invariants.js";
import { nextCollectionId, nextId, nextStepId } from "./ids.js";
import type { ChaconneData, RunRecord } from "./types.js";
import { DomainInvariantError } from "./types.js";

const NOW = "2026-11-06T00:00:00Z";

function okRun(recipeId: number, version: number, extra: Record<string, unknown> = {}) {
  return {
    recipeId,
    recipeVersion: version,
    status: "ok" as const,
    startedAt: NOW,
    finishedAt: NOW,
    committedPrefix: 0,
    artifacts: [],
    ...extra,
  } as Omit<RunRecord, "id">;
}

test("ids: deterministic max+1, empty starts at 1", () => {
  expect(nextId([])).toBe(1);
  expect(nextId([3, 1, 7])).toBe(8);
  expect(nextCollectionId([{ id: 2 }, { id: 5 }])).toBe(6);
  expect(nextStepId([{ id: 9 }])).toBe(10);
});

test("model: addRecipe assigns deterministic ids globally", () => {
  let d = emptyData();
  const a = addRecipe(d, "flow", [
    { kind: "goto", selector: "https://example.com" },
    { kind: "click", selector: "a#btn" },
  ]);
  d = a.data;
  expect(a.recipe.id).toBe(1);
  expect(a.recipe.steps.map((s) => s.id)).toEqual([1, 2]);
  const b = addRecipe(d, "other", [{ kind: "wait", selector: ".marker", timeoutMs: 5000 }]);
  expect(b.recipe.id).toBe(2);
  expect(b.recipe.steps[0].id).toBe(3);
});

test("model: updateRecipe bumps version and re-stamps step ids", () => {
  let d = emptyData();
  d = addRecipe(d, "flow", [{ kind: "goto", selector: "https://x" }]).data;
  const v1 = d.recipes[0].version;
  d = updateRecipe(d, 1, { steps: [{ kind: "fill", selector: "input#q", value: "hi" }] });
  expect(d.recipes[0].version).toBe(v1 + 1);
  expect(d.recipes[0].steps[0].id).toBe(2); // re-stamped from the global space
  assertData(d);
});

test("model: addRun snapshots the recipe's CURRENT version (edge case 6)", () => {
  let d = emptyData();
  d = addRecipe(d, "flow", [
    { kind: "goto", selector: "https://x" },
    { kind: "click", selector: "a#btn" },
  ]).data;
  const r1 = addRun(d, 1, okRun(1, 1, { committedPrefix: 2 }));
  d = r1.data;
  // edit the recipe → version 2; a run started against the edit
  // snapshots 2, the earlier run keeps 1.
  d = updateRecipe(d, 1, { name: "flow v2" });
  const r2 = addRun(d, 1, okRun(1, 2, { committedPrefix: 2 }));
  expect(r2.run.recipeVersion).toBe(2);
  expect(d.runs[0].recipeVersion).toBe(1);
  assertData(d);
});

test("model: recordSchedule sets + null-deletes (byte-stability law)", () => {
  let d = emptyData();
  d = addRecipe(d, "flow", [{ kind: "goto", selector: "https://x" }]).data;
  d = recordSchedule(d, 1, { kind: "interval", everyMs: 60_000, nextDueIso: NOW });
  expect(d.recipes[0].schedule).not.toBeUndefined();
  expect(d.recipes[0].version).toBe(2);
  d = recordSchedule(d, 1, null);
  expect(d.recipes[0].schedule).toBeUndefined();
  expect(d.recipes[0].version).toBe(3);
});

test("model: removeRecipe refuses while run history exists", () => {
  let d = emptyData();
  d = addRecipe(d, "flow", [{ kind: "goto", selector: "https://x" }]).data;
  d = addRun(d, 1, okRun(1, 1)).data;
  expect(() => removeRecipe(d, 1)).toThrow(DomainInvariantError);
  // no runs → clean removal
  const bare = addRecipe(emptyData(), "nobody", [{ kind: "goto", selector: "https://x" }]);
  const out = removeRecipe(bare.data, bare.recipe.id);
  expect(out.recipes).toHaveLength(0);
});

test("invariants: closed 9-kind step set is enforced", () => {
  expect(() =>
    assertStep({ id: 1, kind: "hover", selector: "a" } as never, "t"),
  ).toThrow(DomainInvariantError);
});

test("invariants: step selector must be a non-empty string", () => {
  expect(() => assertStep({ id: 1, kind: "click", selector: "" }, "t")).toThrow(
    DomainInvariantError,
  );
  expect(() => assertStep({ id: 1, kind: "click", selector: 7 } as never, "t")).toThrow(
    DomainInvariantError,
  );
});

test("invariants: duplicate recipe / run / step ids are breaches", () => {
  let d = emptyData();
  d = addRecipe(d, "a", [
    { kind: "goto", selector: "https://x" },
    { kind: "click", selector: "a#b" },
  ]).data;
  expect(() => assertData({ ...d, recipes: [d.recipes[0], d.recipes[0]] })).toThrow(
    /duplicate recipe id/,
  );
  expect(() =>
    assertData({
      ...d,
      runs: [
        { ...okRun(1, 1), id: 1 },
        { ...okRun(1, 1), id: 1 },
      ],
    }),
  ).toThrow(/duplicate run id/);
});

test("invariants: run's recipeId must resolve; recipeVersion present", () => {
  const d = addRecipe(emptyData(), "r", [
    { kind: "goto", selector: "https://x" },
    { kind: "click", selector: "a#b" },
  ]).data;
  const base = { schema: "chaconne.v1" as const, recipes: d.recipes };
  expect(() =>
    assertData({ ...base, runs: [{ ...okRun(99, 1), id: 1 }] } as ChaconneData),
  ).toThrow(/unknown recipeId 99/);
  const noVersion = okRun(1, 1);
  delete (noVersion as Record<string, unknown>).recipeVersion;
  expect(() =>
    assertData({ ...base, runs: [{ ...(noVersion as unknown as Omit<RunRecord, "id">), id: 1 }] } as ChaconneData),
  ).toThrow(/recipeVersion is required/);
  // with a recipe present, a fully-valid run passes
  expect(() =>
    assertData({ ...base, runs: [{ ...okRun(1, 1), id: 1 }] } as ChaconneData),
  ).not.toThrow();
});

test("invariants: artifact names must match the content-addressed grammar", () => {
  const hex = "a".repeat(64);
  const d = addRecipe(emptyData(), "s", [
    { kind: "goto", selector: "https://x" },
    { kind: "click", selector: "a#b" },
  ]).data;
  // wrong: digest embedded in the name differs from the field
  expect(() =>
    addRun(d, 1, okRun(1, 1, { artifacts: [{ name: `0_r1_sha256:${hex}.png`, sha256: "b".repeat(64) }] })),
  ).toThrow(/embeds a different digest/);
  // wrong: 63-hex digest
  expect(() =>
    addRun(d, 1, okRun(1, 1, { artifacts: [{ name: `0_r1_sha256:${"a".repeat(63)}.png`, sha256: "a".repeat(64) }] })),
  ).toThrow(/sha256/);
  // right
  const good = addRun(d, 1, okRun(1, 1, { artifacts: [{ name: `0_r1_sha256:${hex}.png`, sha256: hex }] }));
  expect(good.run.artifacts[0].name).toBe(`0_r1_sha256:${hex}.png`);
});

test("invariants: committedPrefix is bounded by the recipe's step count", () => {
  const d = addRecipe(emptyData(), "two", [
    { kind: "goto", selector: "https://x" },
    { kind: "click", selector: "a#btn" },
  ]).data;
  expect(() => addRun(d, 1, okRun(1, 1, { committedPrefix: 3 }))).toThrow(
    /exceeds recipe/,
  );
  expect(addRun(d, 1, okRun(1, 1, { committedPrefix: 2 })).run.committedPrefix).toBe(2);
});

test("invariants: status is the closed 5-entry taxonomy", () => {
  const d = addRecipe(emptyData(), "f", [{ kind: "goto", selector: "https://x" }]).data;
  expect(() => addRun(d, 1, okRun(1, 1, { status: "crashed" } as never))).toThrow(
    /status must be one of/,
  );
  for (const s of ["ok", "step-failed", "selector-not-found", "timeout", "invalid-recipe"] as const) {
    expect(() => addRun(d, 1, okRun(1, 1, { status: s, committedPrefix: 0 }))).not.toThrow();
  }
});
