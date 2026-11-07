/**
 * Domain core — `legato.v1` grammar (PLAN §1.1, §2).
 *
 * DOM-free + Node-free (the Ostinato law): no document/window/localStorage,
 * no Node builtins. The clip-record grammar is declared ONCE here
 * (types.ts, L-2) and both hosts — the pipeline seam (src/pipeline/)
 * and the storage seam (src/storage/) — import it. Plain JSON at every
 * level: no class instances, no Date objects, ISO-8601 string
 * timestamps.
 *
 * Co-located pure logic lands here as tickets complete: invariants.ts
 * (assertData), ids.ts (deterministic integer ids), io.ts (canonical
 * JSON + import gate, §2), search.ts (L-4), queue.ts (L-6), tags.ts
 * (L-7), highlights.ts (L-8).
 *
 * Executable law: boundary.test.ts — the import-graph pin that scans
 * src/** and bans any import that is not a relative ./ or ../
 * specifier or `bun:test`. That single file IS the network-free-
 * closure proof and the zero-dep law's executable form.
 *
 * L-1 placeholder: the layer contract lives in this comment; the
 * grammar itself lands at L-2 (types.ts + invariants.ts + ids.ts).
 */
export {};
