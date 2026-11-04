/**
 * Id generation — pure, no `crypto` import (the boundary test's
 * NODE_BUILTINS gate: `node:crypto` would fail the import scan even
 * in a test file).
 *
 * Coda precedent: the domain keeps ids as plain strings; generation is
 * injected at the edge so the core stays deterministic. `newUniqueId`
 * mixes a base-36 time prefix with 21 random bits (53 - 32) and
 * validates uniqueness against the current sets — the caller retries on
 * the astronomically-unlikely collision.
 */

/** Build the base-36 timestamp prefix shared with Coda's id scheme. */
function timePrefix(): string {
  return Date.now().toString(36);
}

/**
 * Draw 21 random bits from `Math.random()` (the only randomness source
 * the domain is allowed to touch — it is a global, not a module import,
 * and is never called on the scheduler's deterministic path).
 */
function randomTail(): string {
  let n = Math.floor(Math.random() * 0x1000000); // 24 bits, trimmed below
  const bits = (n & 0x1fffff).toString(36); // 21 bits → up to 5 chars
  return bits.padStart(5, "0");
}

/**
 * Generate a card or deck id that is not already present. Retry on
 * collision (max 32 attempts — enough for any realistic set size given
 * 2^21 random space per time tick; throws DomainInvariantError so the
 * caller gets a guard failure, not an infinite loop).
 *
 * `prefix` keeps ids readable (`card_…` / `deck_…`).
 */
export function newUniqueId(
  prefix: "card" | "deck",
  taken: ReadonlySet<string>,
): string {
  const base = timePrefix();
  for (let attempt = 0; attempt < 32; attempt++) {
    const id = `${prefix}_${base}_${randomTail()}`;
    if (!taken.has(id)) return id;
  }
  // Unreachable in practice (birthday bound: 32 draws into 2^21);
  // surface as a guard failure rather than loop.
  throw new Error(`newUniqueId: 32 collisions for prefix ${prefix}`);
}
