/**
 * io.ts — canonical JSON + the schema gate (fugue.v1, PLAN §2).
 *
 * - `exportFugue`: canonical JSON — object keys sorted deep, arrays keep
 *   index order (the document's semantic law), compact separators.
 *   Same dataset → same bytes on every boot (the round-trip pin law).
 * - `parseFugue`: parse → schema gate → `assertData`. Accepts ONLY
 *   schema "fugue.v1"; a foreign or FUTURE schema (including "fugue.v2")
 *   is REFUSED with a structured dry-run report {ok:false, reason,
 *   details} — never a partial import, never a mid-parse throw.
 */
import type { FugueData } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";

/** The only accepted schema value (PLAN §2). */
export const SCHEMA_VERSION = "fugue.v1";

/** Recursively sort object keys (depth-first). Arrays keep index order. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Serialize to canonical JSON: sorted keys, compact separators. */
export function toCanonicalJson(data: FugueData): string {
  const sorted = sortKeysDeep(JSON.parse(JSON.stringify(data)));
  return JSON.stringify(sorted);
}

/** Export the store to its canonical bytes (asserts first). */
export function exportFugue(data: FugueData): string {
  assertData(data);
  return toCanonicalJson(data);
}

/** The structured dry-run refusal (never a partial import). */
export interface DryRunRefusal {
  ok: false;
  reason: "foreign-schema" | "not-json" | "invariant";
  /** The offending schema literal, when the refusal is schema-based. */
  schema?: string;
  details: string;
}

/** The import outcome: a validated document, or a refusal. */
export type ParseFugueResult =
  | { ok: true; data: FugueData }
  | DryRunRefusal;

/**
 * Parse + validate a document. A foreign/future schema is refused with
 * the dry-run report (the store stays byte-identical to pre-import —
 * the caller persists nothing on `ok:false`). Invariant breaches on a
 * fugue.v1 document throw DomainInvariantError (the document claims to
 * be ours but is corrupt — surfaced honestly).
 */
export function parseFugue(text: string): ParseFugueResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      reason: "not-json",
      details: `import: not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    };
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return {
      ok: false,
      reason: "not-json",
      details: "import: root must be a plain object with 'jobs' and 'runs'",
    };
  }
  const rec = root as Record<string, unknown>;
  // The schema gate (PLAN §2 / E-08): foreign or future schema refused
  // with the dry-run report — never a partial import.
  if (rec.schema !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "foreign-schema",
      schema: typeof rec.schema === "string" ? rec.schema : undefined,
      details: `schema is ${rec.schema === undefined ? "absent" : JSON.stringify(rec.schema)}; this import accepts only "${SCHEMA_VERSION}" — no partial import, the store is unchanged`,
    };
  }
  try {
    const data = rec as unknown as FugueData;
    assertData(data);
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      reason: "invariant",
      details: e instanceof DomainInvariantError ? e.message : String(e),
    };
  }
}
