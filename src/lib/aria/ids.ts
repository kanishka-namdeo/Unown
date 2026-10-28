/**
 * Deterministic id generation for aria.
 *
 * Two schemes (the plan's §1 conventions):
 *  - Seed rows: seed-constant prefixed ids (`acr_seed_01` style — the
 *    parley `cnv-seed-NN` discipline), owned by `seed.ts`.
 *  - Live rows: `${prefix}_${seq}` from the store's `seq` counter
 *    (the fugue `seq` pattern; the store owns the counter, `nextId`
 *    is in `store.ts`).
 *
 * `mulberry32` is shared for anything the seed draws from a fixed
 * integer seed — no `Math.random()` anywhere.
 */

/** mulberry32 — a tiny deterministic PRNG (fixed integer seed). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format an rng draw as a hex-4 suffix. */
export function hex4(rng: () => number): string {
  return Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

/**
 * A session id, deterministic given the RNG + an explicit counter.
 * Live session rows are minted by `sessions.ts` via `createSession`
 * (the parley shape), so this helper exists for the seed lane where
 * a fixed counter keeps two seeds deep-equal.
 */
export function newSessionId(prefix: string, rng: () => number, counter: number): string {
  return `${prefix}_${hex4(rng)}_${String(counter).padStart(4, "0")}`;
}
