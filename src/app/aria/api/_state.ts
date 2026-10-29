/**
 * The aria API's state access layer.
 *
 * `@/lib/aria/aria-store` is the facade over the file-backed JSON
 * store (the parley `store.ts` single-source pattern, promoted to
 * the aria shapes). It owns the module-scope state cache + the
 * atomic persistence + the audit-append bookkeeping — this helper
 * file exists only so the route files import ONE small surface:
 *
 * - `getAriaState()` → the current state (lazy load; reseeds on
 *   absent/corrupt file).
 * - `ariaReset()` → wipe + reseed, returns the demo session the
 *   `demo/reset` route's cookie is built from.
 * - `ariaReloadFromDisk()` → drop the in-memory cache (test lane).
 *
 * Per-instance semantics: each server instance has its own state +
 * its own mutations (the risk list's accepted Vercel multi-instance
 * property — the file-backed store is per-instance).
 */

import { getAria, resetAria as ariaReseed, _reloadFromDisk } from "@/lib/aria/aria-store";
import type { AriaSession, AriaState } from "@/lib/aria/types";

export type { AriaState };

/** Read the current state (lazy load via the lib file store). */
export function getAriaState(): AriaState {
  return getAria();
}

/** Wipe + reseed (the demo reset + the test lane's `beforeEach`). */
export function ariaReset(): { state: AriaState; demoSession: AriaSession } {
  return ariaReseed();
}

/** Re-read the file store into the module cache (test lane). */
export function ariaReloadFromDisk(): void {
  _reloadFromDisk();
}

/** The lib store's root accessor (routes that need `getAria` directly). */
export { getAria };
