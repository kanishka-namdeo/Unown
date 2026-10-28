/**
 * Deterministic id generation for parley.
 *
 * ONLY through mulberry32 (the cadence seed's RNG, fixed integer seed,
 * no `Math.random()`). A module-scope counter suffix keeps live
 * (non-seed) ids unique across the server's lifetime — the cadence
 * `generateHabitId` `Date.now()+counter` pattern, here with a
 * deterministic base instead of `Date.now()`.
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

/** Format an rng value as a hex-4 suffix. */
function hex4(rng: () => number): string {
  return Math.floor(rng() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

// Live-id uniqueness counters (the cadence Date.now()+counter pattern,
// but with a deterministic prefix instead of Date.now()).
let conversationCounter = 0;
let messageCounter = 0;
let sessionCounter = 0;
let inviteTokenCounter = 0;

/** A new conversation id, seed-deterministic given the RNG. */
export function newConversationId(rng: () => number): string {
  conversationCounter += 1;
  return `cnv-${hex4(rng)}-${String(conversationCounter).padStart(6, "0")}`;
}

/** A new message id. */
export function newMessageId(rng: () => number): string {
  messageCounter += 1;
  return `msg-${hex4(rng)}-${String(messageCounter).padStart(6, "0")}`;
}

/** A new session id. */
export function newSessionId(rng: () => number): string {
  sessionCounter += 1;
  return `ses-${hex4(rng)}-${String(sessionCounter).padStart(6, "0")}`;
}

/**
 * A new invite token — crypto-random in production shape, but
 * seed-deterministic via the RNG so two seeds → deep-equal holds.
 * The module-scope counter makes live tokens unique across the
 * server's lifetime.
 */
export function newInviteToken(rng: () => number): string {
  inviteTokenCounter += 1;
  return `tok-${hex4(rng)}${hex4(rng)}-${String(inviteTokenCounter).padStart(6, "0")}`;
}
