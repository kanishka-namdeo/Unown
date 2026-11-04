/**
 * Ostinato — the port seams, pinned at O-1 as a single entry point.
 *
 * Re-exports `Scheduler` + `ImportExportPort` (and the model shapes
 * they name) from `./types.js` so O-2/O-3 can import the ports from
 * one named seam: `import { Scheduler, ImportExportPort } from
 * "./ports.js"`. This module is a pure re-export with no logic of its
 * own (O-2 implements `Scheduler`, O-2/O-4 implement
 * `ImportExportPort`); it exists so the domain-boundary test has a
 * stable "ports" file to assert on, and so the import-graph check
 * stays meaningful as the directory grows.
 */
export type {
  Scheduler,
  ImportExportPort,
  Grade,
  OstinatoData,
  Card,
  Deck,
  ReviewEvent,
} from "./types.js";
export { DomainInvariantError } from "./types.js";
export type { StoragePort, StorageLike } from "./storage.js";

/**
 * The clock seam (O-3, P0 #3/#6 + the PRD's hardening table "no
 * Date.now() inside domain-facing logic"): Ostinato's runner-side
 * time source. An ISO-8601 instant as a plain string — the same
 * discipline as the Scheduler port's injected `now`, never a wall
 * clock read. Tests inject a fixed string; the browser edge passes
 * `new Date().toISOString()`.
 */
export type Clock = () => string;
