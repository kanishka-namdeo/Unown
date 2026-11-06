/**
 * Storage port — the persistence seam (PLAN §2, Ostinato law).
 *
 * The domain owns the CONTRACT; host adapters live at the edge. This
 * file defines `StoragePort` (a plain async interface over
 * `ChaconneData` bytes) and `StorageLike` (the minimal host storage
 * surface an adapter needs). The concrete host adapter — the
 * localStorage + atomic-writes implementation — lives OUTSIDE the
 * domain (`src/storage/local-storage.ts`), because the boundary law
 * keeps `src/domain/**` DOM-free: the domain owns the seam, not the
 * host.
 *
 * Ostinato's decision receipt carries over verbatim: the browser's
 * host storage (the storage object the edge passes in) over
 * IndexedDB — byte-stability (the adapter persists the EXACT bytes of
 * `io.exportData`), crash-safety (temp key + commit key: an
 * interrupted save leaves an orphaned temp that boot `recover()`
 * discards while the committed key survives), sync reads, mockable
 * tests, ample 5 MB quota.
 */
import type { ChaconneData } from "./types.js";

/**
 * The storage contract. Implementations MUST be byte-lossless:
 * `load()` after `save(data, rawJson)` returns the same data set.
 */
export type StoragePort = {
  /**
   * Load the persisted data set. `null` on first boot or when the
   * committed key holds undecodable bytes (the caller then surfaces
   * the honest corrupt-panel state — never a silent wipe, never a
   * crash; the port never swallows corruption silently).
   */
  load(): Promise<ChaconneData | null>;

  /**
   * Atomically persist `data`. `rawJson` is the canonical bytes the
   * caller produced via the ImportExportPort (`exportData` output) —
   * the adapter stores EXACTLY those bytes, no re-encode.
   */
  save(_data: ChaconneData, rawJson: string): Promise<void>;

  /**
   * Crash-recovery pass, called on boot before `load()`: an orphaned
   * temp key (interrupted save) is discarded; the committed key, when
   * present, is the last known-good state.
   */
  recover(): Promise<void>;
};

/**
 * The minimal host storage surface an adapter needs — the seam keeps
 * the domain free of any host-storage reference. The UI shell (C-3)
 * hands the host's browser storage object into the host adapter.
 */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
