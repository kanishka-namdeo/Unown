/**
 * Storage port — the persistence seam (P0 #6 + the O-2 [U] design gate).
 *
 * The domain owns the CONTRACT; host adapters live at the edge. This
 * file defines `StoragePort` (a plain async interface over
 * `OstinatoData` bytes) and `StorageLike` (the minimal host storage
 * surface an adapter needs). The concrete host adapter — the
 * localStorage + atomic-writes implementation — lives OUTSIDE the
 * domain (`src/storage/local-storage.ts`), because the boundary law
 * keeps `src/domain/**` DOM-free: the domain owns the seam, not the
 * host.
 *
 * DESIGN DECISION (the PRD's `[U]`, decided + justified at O-2 — the
 * full receipt is `.unown/receipts/o2.md`):
 *
 *   CHOICE: localStorage + atomic-writes (canonical JSON → temp key →
 *   commit key), NOT IndexedDB.
 *
 *   1. Byte-stability (matrix lane I-1): the adapter persists the
 *      EXACT bytes of `io.exportData` — no second serialization layer,
 *      no structured-clone drift. Two sequential boots → identical
 *      export bytes.
 *   2. Crash-safety (lane R-1): the "temp-write + commit" pair is the
 *      localStorage analogue of the PRD's "temp-write + rename"
 *      row; an interrupted save leaves the temp key, which boot
 *      recovery discards while the committed key survives.
 *   3. Sync reads (P0 #3/#6): the review runner needs queue state
 *      without a promise hop; localStorage is synchronous, IndexedDB
 *      is not. The port stays async so the seam survives a future
 *      adapter swap.
 *   4. Test-pinning: a `StorageLike` mock unit-tests both lanes
 *      without a browser; IndexedDB adapters need integration.
 *   5. Quota (5 MB) is ample for thousands of cards; if it is ever
 *      hit, the port seam makes an IndexedDB adapter a drop-in.
 */
import type { OstinatoData } from "./types.js";

/**
 * The storage contract. Implementations MUST be byte-lossless:
 * `load()` after `save(data, rawJson)` returns the same data set.
 * All methods are async so the seam is uniform across sync (host
 * storage) and async (future) adapters.
 */
export type StoragePort = {
  /**
   * Load the persisted data set. `null` on first boot or when the
   * committed key holds undecodable bytes (the caller then surfaces
   * the corruption — the port never silently swallows it).
   */
  load(): Promise<OstinatoData | null>;

  /**
   * Atomically persist `data`. `rawJson` is the canonical bytes the
   * caller produced via the ImportExportPort (`exportData` output) —
   * the adapter stores EXACTLY those bytes, no re-encode.
   */
  save(data: OstinatoData, rawJson: string): Promise<void>;

  /**
   * Crash-recovery pass, called on boot before `load()`: an orphaned
   * temp key (interrupted save) is discarded; the committed key,
   * when present, is the last known-good state.
   */
  recover(): Promise<void>;
};

/**
 * The minimal host storage surface an adapter needs — the seam keeps
 * the domain free of any host-storage reference. The UI shell (O-3)
 * hands the host's browser storage object into the host adapter
 * (src/storage/local-storage.ts).
 */
export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
