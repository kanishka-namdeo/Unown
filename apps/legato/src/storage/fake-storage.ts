/**
 * FakeStorage — the in-memory StoragePort implementation (PLAN §1.1,
 * §6.1: "the unit lane is IDB-free and network-free").
 *
 * Constructible with an optional seed `LegatoData`. Synchronous
 * behavior behind the async interface. Two test hooks:
 *
 * - `failNextSave` — when set, the next `save()` throws the given
 *   error (typically a `QuotaExceededError`), leaving the committed
 *   state untouched (S-2 pin).
 * - `interruptNextSave` — when set, the next `save()` simulates a
 *   mid-write interruption: the temp key is written, the commit is
 *   skipped, and `recover()` on the next call discards the orphan
 *   (S-3 pin).
 *
 * No DOM, no IDB, no Node builtins — runs green in both lane A
 * (DOM-free) and lane B (DOM-masked).
 */
import type { LegatoData } from "../domain/types.js";
import { QuotaExceededError } from "../domain/types.js";
import type { StoragePort } from "./storage-port.js";

/** Internal store shape: the Ostinato temp-key + commit-swap pattern. */
type Internal = {
  committed: LegatoData | null;
  /** set when a save was interrupted after writing the temp record */
  temp: LegatoData | null;
};

export class FakeStorage implements StoragePort {
  private store: Internal;
  private _migrating = false;

  /**
   * Test hook: set before calling `save()` to make it throw.
   * `null` = no failure injected.
   */
  failNextSave: QuotaExceededError | null = null;

  /**
   * Test hook: when true, the next `save()` simulates a mid-write
   * interruption — the temp record is written, the commit is skipped.
   * Resets to false after one interrupted save.
   */
  private interruptNext = false;

  constructor(seed: LegatoData | null = null) {
    this.store = { committed: seed ? JSON.parse(JSON.stringify(seed)) : null, temp: null };
  }

  /** Inject a QuotaExceededError for the next `save()` call (S-2 pin). */
  injectQuotaFailure(message = "quota exceeded"): void {
    this.failNextSave = new QuotaExceededError(message);
  }

  /** Simulate an interrupted write for the next `save()` call (S-3 pin). */
  injectInterruptedWrite(): void {
    this.interruptNext = true;
  }

  async load(): Promise<LegatoData | null> {
    // S-4: during a pending migration, return the pre-migration view
    if (this._migrating) {
      return this.store.committed ? JSON.parse(JSON.stringify(this.store.committed)) : null;
    }
    return this.store.committed ? JSON.parse(JSON.stringify(this.store.committed)) : null;
  }

  async save(data: LegatoData): Promise<void> {
    // Quota failure hook (S-2)
    if (this.failNextSave) {
      const err = this.failNextSave;
      this.failNextSave = null;
      throw err;
    }

    // Interrupted-write hook (S-3): write temp, skip commit
    if (this.interruptNext) {
      this.interruptNext = false;
      this.store.temp = JSON.parse(JSON.stringify(data));
      // The commit is deliberately skipped — the store now has an
      // orphaned temp that recover() must discard.
      return;
    }

    // Normal atomic path: temp then commit (the Ostinato pattern)
    this.store.temp = JSON.parse(JSON.stringify(data));
    this.store.committed = JSON.parse(JSON.stringify(data));
    this.store.temp = null;
  }

  async recover(): Promise<void> {
    // Discard orphaned temp (interrupted save) — the committed
    // record, when present, is the last known-good state.
    this.store.temp = null;
  }

  isMigrating(): boolean {
    return this._migrating;
  }

  /**
   * Test-only: mark the store as in-migration (S-4 pin).
   * `load()` during this window returns the pre-migration committed
   * view, never a torn mix.
   */
  __setMigrating(m: boolean): void {
    this._migrating = m;
  }
}
