/**
 * Coda IndexedDB adapter — the ONLY file allowed to touch `indexedDB`.
 *
 * The domain layer stays DOM/IO-free; this module is the single seam
 * between the domain's serialized state and on-disk persistence.
 *
 * Schema decision (whole-state document): one database, one object
 * store, one key. The domain store is designed as ONE serializable
 * unit (`store.ts` serialize/deserialize), so we persist exactly that
 * JSON document under a fixed key. No per-record schemas — inventing
 * them would fork the serialization format and break export/import.
 */

const DB_NAME = "coda";
const DB_VERSION = 1;
const STORE_NAME = "state";
const STATE_KEY = "coda-data";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    });
  }
  return dbPromise;
}

/**
 * Load the persisted state. Returns null when the database is empty
 * (first run) — NOT an error.
 */
export async function loadState(): Promise<string | null> {
  const db = await openDb();
  return await new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(STATE_KEY);
    req.onsuccess = () => resolve(req.result === undefined ? null : String(req.result));
    req.onerror = () => reject(req.error ?? new Error("read failed"));
  });
}

/** Write the serialized state (write-through on every mutation). */
export async function saveState(serialized: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(serialized, STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("write aborted"));
  });
}

/** Wipe persisted state (the "reset" choice on corrupt data). */
export async function clearState(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(STATE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
    tx.onabort = () => reject(tx.error ?? new Error("clear aborted"));
  });
}
