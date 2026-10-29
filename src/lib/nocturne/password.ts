/**
 * scrypt password hashing for the Nocturne demo (the parley pattern).
 *
 * Node-`crypto` scrypt (N=16384, r=8, p=1, 32-byte key). The salt is
 * passed in explicitly so the seeded users can carry fixed seed-
 * constant salts (`s-nocturne-<slug>-<user>`, public-by-design for
 * the iframe demo — a real deployment would use `crypto.randomBytes`
 * and an env-sourced key).
 *
 * `verifyPassword` uses `crypto.timingSafeEqual` over the scrypt
 * outputs — a length-guarded first, then the constant-time compare.
 * A corrupt (non-hex) digest returns `false`, never throws.
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
 * deterministic per-call salt is derived from the password itself
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
 * timing-safe compare; a corrupt (non-hex) digest is `false`, never
 * a throw.
 */
export function verifyPassword(plain: string, salt: string, hash: string): boolean {
  let stored: Buffer;
  try {
    stored = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  const candidate = scryptSync(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  if (stored.length !== candidate.length) return false;
  return timingSafeEqual(candidate, stored);
}
