/**
 * Bolero canonical JSON + schema dry-run gate (PLAN §2 round-trip pin
 * law items 1, 2, 4 — the V-41 law).
 *
 * - `toCanonicalJson`: sorted object keys, compact separators, arrays
 *   keep index order — byte-stable across hosts and boots.
 * - `parseWatch` / `parseReport`: parse → schema gate → invariant
 *   sweep. A payload carrying any `schema` value other than
 *   `bolero.v1` is REFUSED with a dry-run reason, never a partial
 *   parse (E-13 foreign/future schema, PLAN §4).
 */
import type { RunReport, WatchSpec } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { SCHEMA_VERSION } from "./sets.js";
import { assertReport, assertWatch } from "./invariants.js";

/**
 * Recursively sort object keys (depth-first). Arrays keep their index
 * order — the semantic law (run history, step order).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Serialize to canonical JSON: sorted object keys, compact separators. */
export function toCanonicalJson(data: WatchSpec | RunReport): string {
  const sorted = sortKeysDeep(JSON.parse(JSON.stringify(data)));
  return JSON.stringify(sorted);
}

/**
 * The schema gate (E-13). A payload whose `schema` is anything other
 * than `bolero.v1` is refused: the caller gets the dry-run REASON
 * (what it was, what was expected) — never a partial parse, never a
 * mid-validation throw against a foreign grammar.
 *
 * @returns a reason string when refused; `null` when the schema passes.
 */
export function checkSchemaGate(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return `payload must be a plain object carrying "schema": "${SCHEMA_VERSION}"`;
  }
  const schema = (payload as Record<string, unknown>).schema;
  if (schema !== SCHEMA_VERSION) {
    return `payload carrying schema ${schema === undefined ? "(absent)" : JSON.stringify(schema)} — refused, expected "${SCHEMA_VERSION}"`;
  }
  return null;
}

/** Parse + validate a watch-spec payload (schema gate → `assertWatch`). */
export function parseWatch(json: string): WatchSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DomainInvariantError("import: not valid JSON");
  }
  const gate = checkSchemaGate(parsed);
  if (gate !== null) throw new DomainInvariantError(`import: ${gate}`);
  const watch = parsed as WatchSpec;
  assertWatch(watch);
  return watch;
}

/** Parse + validate a run-report payload (schema gate → `assertReport`). */
export function parseReport(json: string): RunReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new DomainInvariantError("import: not valid JSON");
  }
  const gate = checkSchemaGate(parsed);
  if (gate !== null) throw new DomainInvariantError(`import: ${gate}`);
  const report = parsed as RunReport;
  assertReport(report);
  return report;
}
