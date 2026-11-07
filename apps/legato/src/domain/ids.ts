/**
 * Id allocation — deterministic integer ids (PLAN §1.1, §2).
 *
 * The house pattern (max+1, no reuse within a store generation): a
 * pure function over the data set, no clock, no randomness. Integer
 * ids are assigned sequentially as clips and highlights enter the
 * store; the next id is always `max(existing) + 1`. Deletion is not
 * a v1 operation, so no id is ever reused while the store
 * generation lives.
 *
 * The caller holds the data set and passes in the allocated sets;
 * the domain keeps the allocation logic pure and testable.
 */
import type { LegatoData } from "./types.js";

/**
 * The next clip id for this store generation.
 * Deterministic: `max(clip ids) + 1`, or `1` when the store is empty.
 */
export function nextClipId(data: LegatoData): number {
  let max = 0;
  for (const c of data.clips) {
    if (c.id > max) max = c.id;
  }
  return max + 1;
}

/**
 * The next highlight id for this store generation.
 * Deterministic: `max(highlight ids) + 1`, or `1` when no highlights
 * exist yet. Independent of clip ids — highlights and clips share
 * the same integer space, so the caller must allocate clip ids and
 * highlight ids alternately against the SAME max to avoid
 * collision.
 */
export function nextHighlightId(data: LegatoData): number {
  let max = 0;
  for (const c of data.clips) {
    for (const h of c.highlights) {
      if (h.id > max) max = h.id;
    }
  }
  return max + 1;
}

/**
 * The next id in the SHARED integer space (clips + highlights).
 * Use this when you need a single allocation that will never collide
 * with any existing clip or highlight id.
 */
export function nextId(data: LegatoData): number {
  let max = 0;
  for (const c of data.clips) {
    if (c.id > max) max = c.id;
    for (const h of c.highlights) {
      if (h.id > max) max = h.id;
    }
  }
  return max + 1;
}
