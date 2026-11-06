/**
 * localStorage + atomic-writes adapter — the HOST edge (PLAN §2;
 * contract in `src/domain/storage.ts`).
 *
 * LIVES OUTSIDE `src/domain/` on purpose: the boundary test bans
 * `localStorage.` references in domain modules. This file is host
 * code (like the UI shell, C-3) that implements the domain's
 * `StoragePort` over the host's `StorageLike` (e.g. `window.localStorage`).
 *
 * Atomicity: `save` writes the temp key first, then the commit key;
 * a crash between the two leaves an orphaned temp that `recover`
 * discards on boot. The committed key always holds the last complete
 * state.
 */
import type { ChaconneData } from "../domain/types.js";
import type { StoragePort, StorageLike } from "../domain/storage.js";

/** Canonical committed key + atomic temp key (the app's namespace, PLAN §2). */
export const STORAGE_KEY = "chaconne.data";
export const STORAGE_TMP_KEY = "chaconne.tmp";

/**
 * Create a `StoragePort` backed by a `StorageLike` (the UI edge, C-3,
 * passes `window.localStorage`). See `src/domain/storage.ts` for the
 * design receipt (localStorage + atomic-writes, not IndexedDB).
 */
export function createLocalStorageAdapter(storage: StorageLike): StoragePort {
  return {
    async load(): Promise<ChaconneData | null> {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as ChaconneData;
      } catch {
        // Undecodable committed bytes: return null (acceptance (6)) so
        // the boot path surfaces the honest corrupt-panel state — never
        // a silent wipe, never a crash, never a partial parse. The
        // committed bytes are left INTACT for forensics; the caller
        // decides recovery.
        return null;
      }
    },

    async save(_data: ChaconneData, rawJson: string): Promise<void> {
      // The adapter stores EXACTLY the canonical bytes the caller
      // produced (io.exportData) — no re-encode, byte-stable by
      // construction (the Ostinato lane I-1 law).
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
      // Orphaned temp (interrupted save) → discard (acceptance: crash
      // prefix recovery). The commit key, when present, is the last
      // complete state.
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
