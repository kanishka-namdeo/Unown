/**
 * Id generation — pure, deterministic, integer (PLAN §1/§2 ruling:
 * max+1 kin, NEVER random — byte-stability of exports across boots is
 * the Ostinato law; a random id would make two identical datasets
 * export different bytes).
 *
 * Coda/Ostinato put randomness at the edge; Chaconne's PLAN is stricter
 * — the whole app is offline-deterministic, so the helpers take the
 * "taken" set and return max+1. If the set is empty, ids start at 1.
 */

export type IdKind = "recipe" | "run" | "step";

/**
 * Deterministic next id: 1 + max of the taken ids (1 when empty).
 *
 * @throws DomainInvariantError is NOT involved — this helper is pure
 * math; the caller is expected to pass a consistent taken set.
 */
export function nextId(taken: readonly number[]): number {
  let max = 0;
  for (const id of taken) {
    if (id > max) max = id;
  }
  return max + 1;
}

/** Convenience: next id for a collection of objects with numeric `id`. */
export function nextCollectionId<T extends { id: number }>(items: readonly T[]): number {
  return nextId(items.map((i) => i.id));
}

/**
 * Next STEP id within a recipe: steps share the global id space across
 * all recipes in the store (unique per collection is the invariant,
 * but steps are one collection — `ChaconneData` keeps no per-recipe
 * step array outside `recipe.steps`; uniqueness is global).
 */
export function nextStepId(allSteps: readonly { id: number }[]): number {
  return nextId(allSteps.map((s) => s.id));
}

/** Extract the taken id set for one collection kind. */
export function recipeIds(recipes: readonly { id: number }[]): number[] {
  return recipes.map((r) => r.id);
}

export function runIds(runs: readonly { id: number }[]): number[] {
  return runs.map((r) => r.id);
}
