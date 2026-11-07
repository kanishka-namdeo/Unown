/**
 * Storage seam (PLAN §1.1).
 *
 * `StoragePort` interface over IndexedDB: object stores clips / tags /
 * queue / highlights, a schemaVersion + migration frame. The real IDB
 * adapter (idb-storage.ts, L-2) is touched live only by L-11's e2e;
 * the in-memory FakeStorage (fake-storage.ts, L-2) keeps the unit
 * lane IDB-free and network-free and pins IDB quota-class errors
 * deterministically (S-2).
 *
 * Deliberate departure from the house localStorage pattern: clip
 * bodies exceed localStorage quota. Interrupted-write recovery
 * (S-3) reuses the Ostinato temp-key + commit-swap atomic-write
 * pattern; the v1→v2-with-data migration frame + named design note
 * (the W3 retention axis) lands at L-2.
 *
 * L-1 placeholder: the layer contract lives in this comment; the
 * seam lands at L-2.
 */
export {};
