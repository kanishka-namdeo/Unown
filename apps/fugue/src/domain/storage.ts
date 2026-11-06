/**
 * storage.ts — the localStorage adapter pattern (the house's Ostinato
 * law: atomic temp-key + commit-swap; corrupt-store detection returning
 * a typed error, NEVER a silent wipe).
 *
 * The domain owns the CONTRACT; a host adapter (the browser's
 * localStorage) satisfies `StorageLike` at the edge. The functions here
 * are pure over that seam so the boundary test stays DOM-free.
 */
import type { FugueData } from "./types.js";

/** The minimal host-storage surface an adapter needs (the seam). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The typed corrupt-store error (E-07 — surfaced, never wiped). */
export class CorruptStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptStoreError";
  }
}

/** Committed + orphan-temp key names. */
const COMMIT_KEY = "fugue.committed.v1";
const TEMP_KEY = "fugue.temp.v1";

/** Read the committed bytes; null when absent. Throws CorruptStoreError
 *  only when the committed value is present but undecodable — the caller
 *  then surfaces the recovery panel (export-the-wreckage), never wipes. */
export function load(storage: StorageLike): FugueData | null {
  const raw = storage.getItem(COMMIT_KEY);
  if (raw === null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new CorruptStoreError("committed value is not a plain object");
    }
    return data as FugueData;
  } catch (e) {
    if (e instanceof CorruptStoreError) throw e;
    throw new CorruptStoreError(
      `corrupt committed store (undecodable bytes): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Atomically persist canonical bytes. Writes the TEMP key first, then
 * swaps it into the COMMIT key; an interrupted save leaves an orphaned
 * temp that boot `recover()` discards while the committed key survives.
 * The bytes are stored EXACTLY as given (byte-stability law).
 */
export function save(storage: StorageLike, canonicalBytes: string): void {
  storage.setItem(TEMP_KEY, canonicalBytes);
  storage.setItem(COMMIT_KEY, canonicalBytes);
  storage.removeItem(TEMP_KEY);
}

/**
 * Crash-recovery pass, called on boot before `load()`: an orphaned temp
 * key (interrupted save) is discarded; the committed key, when present,
 * is the last known-good state (never wiped).
 */
export function recover(storage: StorageLike): void {
  storage.removeItem(TEMP_KEY);
}
