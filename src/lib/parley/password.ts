/**
 * scrypt password hashing for the parley demo.
 *
 * Node-`crypto` scrypt (N=16384, r=8, p=1, 32-byte key). The salt is
 * passed in explicitly so the seeded users can carry fixed seed-
 * constant salts (public-by-design for the iframe demo — a real
 * deployment would use `crypto.randomBytes` and an env-sourced key).
 *
 * `verifyPassword` uses `crypto.timingSafeEqual` over the scrypt
 * outputs — a length-guarded first, then the constant-time compare.
 */

import { scryptSync, timingSafeEqual } from "node:crypto";

/** scrypt params (node defaults: N=16384, r=8, p=1, keylen=32). */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LEN = 32;

/**
 * Hash a password with scrypt. Returns `{ hash, salt }` where `hash`
 * is the hex-encoded 32-byte scrypt output. If no salt is provided, a
 * deterministic per-call salt is generated from the password itself
 * (still deterministic — no `Math.random`).
 */
export function hashPassword(
  plain: string,
  salt: string = `s-${plain.length}`,
): { hash: string; salt: string } {
  const buf = scryptSync(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return { hash: buf.toString("hex"), salt };
}

/**
 * Verify a password against a stored `{ salt, hash }` pair.
 * Returns `true` when the scrypt output matches the stored hash.
 * Length-guarded: a hash of the wrong length is `false` before the
 * timing-safe compare (the compare itself is constant-time over the
 * fixed-length buffer).
 */
export function verifyPassword(plain: string, salt: string, hash: string): boolean {
  const candidate = scryptSync(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  const stored = Buffer.from(hash, "hex");
  // Length guard: a mismatch is an immediate false (no early return on
  // the compare path — the timing-safe compare always runs over a
  // fixed-length buffer when the lengths agree).
  if (stored.length !== candidate.length) return false;
  return timingSafeEqual(candidate, stored);
}
