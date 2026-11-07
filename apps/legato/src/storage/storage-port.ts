/**
 * StoragePort — the persistence seam (PLAN §1.1, §3 L-2).
 *
 * The interface over IndexedDB: object stores `clips` / `tags` /
 * `queue` / `highlights` with a `schemaVersion` + migration frame.
 * Two adapters implement it:
 *
 * - `idb-storage.ts` — the real IDB adapter. Runs in the browser
 *   only; the unit lane NEVER loads it (PLAN §6.1: "no real IDB ever
 *   appears in the unit lane"). The boundary test's DOM_GLOBS law
 *   pins that this module references browser globals only in a
 *   DOM-guarded block, and `bun test` (lane A) runs it in a
 *   DOM-free runtime where the module import itself must not touch
 *   `window`/`indexedDB` at load time.
 * - `fake-storage.ts` — the in-memory fake. Constructible with a
 *   seed, synchronous-behavior behind the async interface, and a
 *   test hook to inject a QuotaExceededError-class failure (S-2).
 *
 * The port is async so the seam is uniform across both adapters;
 * the fake's implementations are trivially-implemented promises.
 */
import type { LegatoData } from "../domain/types.js";

/**
 * The storage contract. Implementations MUST be byte-lossless:
 * `load()` after `save(data)` returns the same data set (canonical
 * JSON is produced by the caller, not the port).
 *
 * All methods are async — the seam survives a future adapter swap
 * without touching callers.
 */
export type StoragePort = {
  /**
   * Load the persisted LegatoData. Returns `null` on first boot
   * (no committed data) or when the committed record is
   * undecodable (the caller surfaces the corruption; the port
   * never silently swallows it).
   *
   * During a pending migration, `load()` returns the PRE-migration
   * view — never a torn mixed-version byte stream (S-4).
   */
  load(): Promise<LegatoData | null>;

  /**
   * Persist `data` atomically. An interrupted write leaves the
   * store loadable: `recover()` on next boot discards the orphaned
   * temp and restores the last committed state (S-3, the Ostinato
   * temp-key + commit-swap pattern).
   *
   * @throws {QuotaExceededError} when the save fails for quota
   *  reasons — a typed error, never a silent loss (S-2).
   */
  save(data: LegatoData): Promise<void>;

  /**
   * Crash-recovery pass, called on boot before `load()`: an
   * orphaned temp record (interrupted save) is discarded; the
   * committed record, when present, is the last known-good state.
   */
  recover(): Promise<void>;

  /**
   * Whether a schema migration is currently in flight. While
   * `true`, `load()` returns the pre-migration view (S-4).
   */
  isMigrating(): boolean;
};
