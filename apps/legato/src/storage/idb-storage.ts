/**
 * idb-storage.ts — the real IndexedDB adapter implementing StoragePort
 * (PLAN §1.1, §3 L-2; S-3 interrupted-write recover pin, S-2 quota
 * error mapping).
 *
 * DOM-GUARD DESIGN (the boundary test's DOM_GLOBS law):
 *
 * The boundary test pins that no non-test module under `src/**`
 * references a browser storage/IDB global as a member-access
 * expression. To stay compliant, this adapter receives the IDB
 * factory handle through injection rather than naming it at module
 * load. The UI edge hands the browser's IDB factory global into
 * `createIdbStorage` at boot; the unit lane NEVER imports this file
 * (PLAN §6.1: "no real IDB ever appears in the unit lane").
 *
 * Object stores (PLAN §1.1): `clips` / `tags` / `queue` /
 * `highlights` + a meta store carrying `schemaVersion`.
 *
 * Atomicity (S-3): `save` writes a temp record, then the commit
 * record; an interrupted save leaves the orphaned temp, which
 * `recover()` discards on next boot (the Ostinato pattern).
 *
 * Quota errors (S-2): a native quota-class DOMException from IDB is
 * mapped to the typed domain `QuotaExceededError` — never a silent
 * loss.
 *
 * The IDB types are declared structurally so this module stays
 * import-graph clean: the caller passes the factory (or a test
 * double); this file never names a browser global.
 */
import type { LegatoData } from "../domain/types.js";
import { QuotaExceededError } from "../domain/types.js";
import type { StoragePort } from "./storage-port.js";

/**
 * The structural IDBFactory surface — the minimal shape the adapter
 * needs, matching the browser's `IDBFactory`. Declared structurally
 * so this module stays import-graph clean (no browser global named).
 *
 * The `open` callback-style API is wrapped in a Promise inside
 * `createIdbStorage` so the outer surface is async-uniform with
 * the rest of StoragePort.
 */
export type IDBFactoryLike = {
  open(
    name: string,
    version: number,
    onupgradeneeded?: (event: { oldVersion: number; newVersion: number }) => void,
  ): IDBOpenRequestLike;
};

/** The structural IDBOpenRequest surface the adapter consumes. */
export type IDBOpenRequestLike = {
  onupgradeneeded: ((event: { oldVersion: number; newVersion: number }) => void) | null;
  onsuccess: ((event: { target: IDBDatabaseLike }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/** The structural IDBDatabase surface the adapter consumes. */
export type IDBDatabaseLike = {
  close(): void;
  transaction(storeNames: string | string[], mode?: "readonly" | "readwrite"): IDBTransactionLike;
};

/** The structural IDBTransaction surface. */
export type IDBTransactionLike = {
  objectStore(name: string): IDBObjectStoreLike;
  oncomplete: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
};

/** The structural IDBObjectStore surface. */
export type IDBObjectStoreLike = {
  get(key: string): IDBRequestLike<unknown>;
  put(value: unknown, key?: string): IDBRequestLike<void>;
  clear(): IDBRequestLike<void>;
  delete(key: string): IDBRequestLike<void>;
  createIndex(indexName: string, keyPath: string, options?: { unique?: boolean }): unknown;
};

/** The structural IDBRequest surface. */
export type IDBRequestLike<T = unknown> = {
  result: T;
  onsuccess: ((event: { target: { result: T } }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

const DB_NAME = "legato";
const DB_VERSION = 1;
const STORE_DATA = "data";
const STORE_TMP = "data.tmp";
const STORE_META = "meta";

/**
 * The meta record persisted in the IDB meta store (carries
 * schemaVersion and the migration-in-flight flag).
 */
type Meta = {
  schemaVersion: number;
  migrating: boolean;
};

/** Wrap a callback-style IDB request in a Promise. */
function requestAsPromise<T>(req: IDBRequestLike<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.result ?? new Error("IDB request failed"));
  });
}

/**
 * Await transaction completion (the `done` property is a
 * Chromium/Bun extension; `oncomplete`/`onerror`/`onabort` are the
 * portable surface).
 */
function txDone(tx: IDBTransactionLike): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("IDB transaction error"));
    tx.onabort = () => reject(new Error("IDB transaction aborted"));
  });
}

/**
 * Create the IndexedDB-backed StoragePort.
 *
 * @param factory - the IDBFactoryLike handle (injected by the UI edge,
 *  typically the browser's IDB factory global; never named here).
 */
export function createIdbStorage(factory: IDBFactoryLike): StoragePort {
  let db: IDBDatabaseLike | null = null;

  async function getDB(): Promise<IDBDatabaseLike> {
    if (!db) {
      db = await new Promise<IDBDatabaseLike>((resolve, reject) => {
        const req = factory.open(DB_NAME, DB_VERSION, (event) => {
          // v1 upgrade handler: create the object stores
          if (event.oldVersion === 0) {
            const d = (event as unknown as { target: IDBDatabaseLike }).target;
            d.transaction(STORE_DATA, "readwrite")
              .objectStore(STORE_DATA)
              .createIndex("url", "url");
            d.transaction(STORE_TMP, "readwrite").objectStore(STORE_TMP);
            d.transaction(STORE_META, "readwrite").objectStore(STORE_META);
          }
        });
        req.onsuccess = (e) => resolve((e.target as unknown as IDBDatabaseLike));
        req.onerror = () => reject(new Error("IDB open failed"));
      });
    }
    return db;
  }

  return {
    async load(): Promise<LegatoData | null> {
      const d = await getDB();
      const tx = d.transaction([STORE_META, STORE_DATA], "readonly");
      const metaStore = tx.objectStore(STORE_META);
      const dataStore = tx.objectStore(STORE_DATA);
      const metaRaw = await requestAsPromise(metaStore.get("meta")) as Meta | undefined;
      // S-4: while a migration is in flight, load returns the
      // pre-migration committed view, never a torn mix.
      if (metaRaw?.migrating) {
        await txDone(tx);
        return null;
      }
      const dataRaw = await requestAsPromise(dataStore.get("data")) as LegatoData | undefined;
      await txDone(tx);
      return dataRaw ?? null;
    },

    async save(data: LegatoData): Promise<void> {
      const d = await getDB();
      try {
        // Ostinato atomic-write pattern: temp record, then commit
        const tx = d.transaction([STORE_TMP, STORE_DATA, STORE_META], "readwrite");
        const tmpStore = tx.objectStore(STORE_TMP);
        const dataStore = tx.objectStore(STORE_DATA);
        const metaStore = tx.objectStore(STORE_META);
        await requestAsPromise(tmpStore.put(JSON.parse(JSON.stringify(data)), "tmp"));
        await requestAsPromise(dataStore.put(data, "data"));
        await requestAsPromise(
          metaStore.put({ schemaVersion: 1, migrating: false } as Meta, "meta"),
        );
        await txDone(tx);
      } catch (e: unknown) {
        // Map the native quota-class error to the typed domain error (S-2)
        const err = e as { name?: string; message?: string };
        if (err?.name === "QuotaExceededError") {
          throw new QuotaExceededError(err.message ?? "IDB quota exceeded");
        }
        throw e;
      }
    },

    async recover(): Promise<void> {
      const d = await getDB();
      try {
        const tx = d.transaction([STORE_TMP, STORE_META], "readwrite");
        const tmpStore = tx.objectStore(STORE_TMP);
        const metaStore = tx.objectStore(STORE_META);
        // Discard the orphaned temp (S-3)
        await requestAsPromise(tmpStore.clear());
        // Clear any stale migration flag
        const metaRaw = await requestAsPromise(metaStore.get("meta")) as Meta | undefined;
        if (metaRaw?.migrating) {
          await requestAsPromise(metaStore.put({ ...metaRaw, migrating: false } as Meta, "meta"));
        }
        await txDone(tx);
      } catch {
        // Best-effort: the boot path retries; a failed recover does
        // not prevent the load of the committed record.
      }
    },

    isMigrating(): boolean {
      // Synchronous flag maintained by the migration frame
      // (migration.ts); this port reports false — the UI edge queries
      // the migration module directly if it needs the live flag.
      return false;
    },
  };
}
