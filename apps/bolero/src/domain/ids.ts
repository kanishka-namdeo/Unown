/**
 * Bolero id generation — pure, deterministic, integer (PLAN §2 ruling:
 * max+1 kin, NEVER random). Byte-stability of exports across boots is
 * the house law (the Ostinato/Chaconne precedent); a random id would
 * make two identical registries export different bytes.
 */

/**
 * Deterministic next id: 1 + max of the taken ids (1 when empty).
 * Pure math — the caller passes a consistent taken set.
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

/** Extract the taken watch ids from a registry of watches. */
export function watchIds(watches: readonly { watch: { id: number } }[]): number[] {
  return watches.map((w) => w.watch.id);
}
