/**
 * Chaconne model layer — pure mutations (P0 #1, PLAN §1/§2).
 *
 * Every helper returns a NEW `ChaconneData` (the Coda/Ostinato
 * domain-purity convention — no in-place mutation of caller state) and
 * re-runs `assertData` on the result, so no mutation path can leave
 * the store in a breach state. Ids come from the deterministic max+1
 * helpers in `ids.ts` (never random — export byte-stability law).
 *
 * Timestamps: `now` is an ISO-8601 string INJECTED by the caller — the
 * domain never reads a wall clock (Ostinato law; determinism is the
 * P0 contract).
 */
import type { ChaconneData, Recipe, RunRecord, Schedule, Step } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";
import { nextCollectionId, nextStepId } from "./ids.js";

/** The starting document for a new install / fresh store. */
export function emptyData(): ChaconneData {
  return { schema: "chaconne.v1", recipes: [], runs: [] };
}

function allStepIds(data: ChaconneData): { id: number }[] {
  const out: { id: number }[] = [];
  for (const r of data.recipes) for (const s of r.steps) out.push(s);
  return out;
}

/**
 * Add a recipe with the given steps. Step ids are assigned
 * deterministically (global max+1 space); the recipe's id is likewise
 * max+1. `now` stamps nothing on the recipe itself (recipes carry no
 * timestamps in v1 — the version number is the history).
 */
export function addRecipe(
  data: ChaconneData,
  name: string,
  steps: Omit<Step, "id">[],
  schedule?: Schedule,
): { data: ChaconneData; recipe: Recipe } {
  if (typeof name !== "string" || name.length === 0) {
    throw new DomainInvariantError("addRecipe: name must be a non-empty string");
  }
  const baseStepId = nextStepId(allStepIds(data));
  let cursor = baseStepId;
  const withIds: Step[] = steps.map((s) => {
    const step: Step = { ...s, id: cursor++ };
    return step;
  });
  const recipe: Recipe = {
    id: nextCollectionId(data.recipes),
    name,
    version: 1,
    steps: withIds,
  };
  if (schedule !== undefined) recipe.schedule = schedule;
  const next: ChaconneData = { ...data, recipes: [...data.recipes, recipe] };
  assertData(next);
  return { data: next, recipe };
}

/**
 * Replace a recipe's name/steps/schedule. Bumps `version` (PLAN §2:
 * "bumped on every edit — a RUNNING recipe snapshots its version at
 * start", PRD edge case 6). Steps keep their ids when present and are
 * re-stamped deterministically when new; unchanged step ids must be
 * unique across the whole store.
 */
export function updateRecipe(
  data: ChaconneData,
  recipeId: number,
  patch: { name?: string; steps?: Omit<Step, "id">[]; schedule?: Schedule | null },
): ChaconneData {
  const target = data.recipes.find((r) => r.id === recipeId);
  if (!target) throw new DomainInvariantError(`updateRecipe: unknown recipe ${recipeId}`);

  const keptIds = new Set<number>();
  for (const r of data.recipes) if (r.id !== recipeId) for (const s of r.steps) keptIds.add(s.id);

  let steps: Step[];
  if (patch.steps !== undefined) {
    // New steps: fresh deterministic ids from the global space.
    const cursor = nextStepId(allStepIds(data));
    steps = patch.steps.map((s, i) => ({ ...s, id: cursor + i }));
  } else {
    steps = target.steps;
    for (const s of steps) keptIds.add(s.id);
  }

  const recipe: Recipe = {
    id: target.id,
    name: patch.name !== undefined ? patch.name : target.name,
    version: target.version + 1,
    steps,
  };
  if (patch.schedule !== undefined) {
    if (patch.schedule === null) delete recipe.schedule;
    else recipe.schedule = patch.schedule;
  } else if (target.schedule !== undefined) {
    recipe.schedule = target.schedule;
  }

  const next: ChaconneData = {
    ...data,
    recipes: data.recipes.map((r) => (r.id === recipeId ? recipe : r)),
  };
  assertData(next);
  return next;
}

/** Remove a recipe; its runs stay (history is append-only). */
export function removeRecipe(data: ChaconneData, recipeId: number): ChaconneData {
  const next: ChaconneData = {
    ...data,
    recipes: data.recipes.filter((r) => r.id !== recipeId),
  };
  // Runs may still reference the recipe — history is kept; the
  // recipeId-resolves invariant applies only while the recipe exists.
  // A removed recipe's runs are orphans-by-design: the invariants
  // allow this only via the import gate, so model ops that drop a
  // recipe with live runs are rejected.
  if (data.runs.some((run) => run.recipeId === recipeId)) {
    throw new DomainInvariantError(`removeRecipe: recipe ${recipeId} has ${data.runs.filter((r) => r.recipeId === recipeId).length} run(s) in history; delete the runs first`);
  }
  assertData(next);
  return next;
}

/**
 * Record a run. THE snapshot law (edge case 6): `recipeVersion` is
 * captured at call time — the recipe's CURRENT version — so a run that
 * started before an edit carries the start version even after the
 * recipe moves on.
 */
export function addRun(
  data: ChaconneData,
  recipeId: number,
  record: Omit<RunRecord, "id" | "recipeId" | "recipeVersion">,
): { data: ChaconneData; run: RunRecord } {
  const recipe = data.recipes.find((r) => r.id === recipeId);
  if (!recipe) throw new DomainInvariantError(`addRun: unknown recipe ${recipeId}`);
  const run: RunRecord = {
    ...record,
    id: nextCollectionId(data.runs),
    recipeId,
    recipeVersion: recipe.version,
  };
  const next: ChaconneData = { ...data, runs: [...data.runs, run] };
  assertData(next);
  return { data: next, run };
}

/**
 * Set or clear a recipe's schedule. `null` deletes the field (the
 * byte-stability law — an unscheduled recipe exports with `schedule`
 * absent, Ostinato's settings precedent).
 */
export function recordSchedule(
  data: ChaconneData,
  recipeId: number,
  schedule: Schedule | null,
): ChaconneData {
  let found = false;
  const recipes = data.recipes.map((r) => {
    if (r.id !== recipeId) return r;
    found = true;
    const next: Recipe = { ...r, version: r.version + 1 };
    if (schedule === null) delete next.schedule;
    else next.schedule = schedule;
    return next;
  });
  if (!found) throw new DomainInvariantError(`recordSchedule: unknown recipe ${recipeId}`);
  const out: ChaconneData = { ...data, recipes };
  assertData(out);
  return out;
}
