/**
 * localStorage + atomic-writes adapter — the HOST edge (O-2 storage
 * decision; contract in `src/domain/storage.ts`).
 *
 * LIVES OUTSIDE `src/domain/` on purpose: the boundary test bans
 * `localStorage.` references in domain modules. This file is host
 * code (like the UI shell) that implements the domain's `StoragePort`
 * over the host's `StorageLike` (e.g. `window.localStorage`).
 *
 * Atomicity: `save` writes the temp key first, then the commit key;
 * a crash between the two leaves an orphaned temp that `recover`
 * discards on boot. The committed key always holds the last complete
 * state.
 */
import type { OstinatoData, } from "../domain/types.js";
import type { StoragePort, StorageLike } from "../domain/storage.js";

/** Canonical committed key + atomic temp key (the app's namespace). */
export const STORAGE_KEY = "ostinato.data";
export const STORAGE_TMP_KEY = "ostinato.tmp";

/**
 * Create a `StoragePort` backed by a `StorageLike` (the UI edge passes
 * `window.localStorage`). See `src/domain/storage.ts` for the design
 * receipt (localStorage + atomic-writes, not IndexedDB).
 */
export function createLocalStorageAdapter(storage: StorageLike): StoragePort {
  return {
    async load(): Promise<OstinatoData | null> {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as OstinatoData;
      } catch {
        // Undecodable committed bytes: surface as "no data" so the
        // boot path can run importData(io) and throw the honest
        // DomainInvariantError rather than crash on the raw parse.
        return null;
      }
    },

    async save(_data: OstinatoData, rawJson: string): Promise<void> {
      // The adapter stores EXACTLY the canonical bytes the caller
      // produced (io.exportData) — no re-encode, byte-stable by
      // construction (matrix lane I-1).
      storage.setItem(STORAGE_TMP_KEY, rawJson);
      storage.setItem(STORAGE_KEY, rawJson);
      try {
        storage.removeItem(STORAGE_TMP_KEY);
      } catch {
        // best-effort: the commit already succeeded; a failed temp
        // cleanup is harmless (recover() will tidy it next boot).
      }
    },

    async recover(): Promise<void> {
      // Orphaned temp (interrupted save) → discard. The commit key,
      // when present, is the last complete state.
      if (storage.getItem(STORAGE_TMP_KEY) !== null) {
        try {
          storage.removeItem(STORAGE_TMP_KEY);
        } catch {
          // ignore — next boot retries
        }
      }
    },
  };
}
