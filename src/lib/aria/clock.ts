/**
 * The single clock read for the whole aria domain.
 *
 * No `Date.now()` anywhere in a domain module — every time-dependent
 * call takes an explicit `now` param (the cadence `asOf` convention).
 * `clock.now()` is the ONE place a mutable clock is read; tests pin
 * it with `setClock`, restore with `resetClock`.
 */

import { AS_OF } from "./types";

let mutableASOF: string = AS_OF;

/** Read the current pinned clock (ISO string). */
export function now(): string {
  return mutableASOF;
}

/** Pin the clock to a specific ISO timestamp. */
export function setClock(iso: string): void {
  mutableASOF = iso;
}

/** Restore the default pinned clock. */
export function resetClock(): void {
  mutableASOF = AS_OF;
}

/** The default pinned clock (re-exported for convenience). */
export { AS_OF as DEFAULT_AS_OF };
