/**
 * Chaconne Import/Export port — PRD P0 #1, PLAN §2/§5 (rows 8, 9, 10).
 *
 * - `exportData`: canonical JSON — object keys sorted deep, arrays keep
 *   index order (`runs` order IS the history; `steps` order is the
 *   recipe), compact separators. Byte-stable across boots (matrix
 *   lane I-1, the Ostinato law; golden-file pinned at C-8).
 * - `importData`: parse → schema gate → `assertData` → throw
 *   DomainInvariantError on any invariant breach. A foreign/future
 *   schema (edge case 9/10) NEVER throws mid-import: it returns the
 *   dry-run report — what WOULD import and why it was refused — and no
 *   partial import ever happens.
 */
import type { ChaconneData, DryRunReport, ImportExportPort } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";

/** The only accepted schema value (PLAN §2). */
export const SCHEMA_VERSION = "chaconne.v1";

/**
 * Recursively sort object keys (depth-first). Arrays keep their index
 * order — the semantic law of this document (run history, step order).
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

/**
 * Serialize to canonical JSON: sorted object keys, compact separators
 * (no whitespace). Same dataset → same bytes, every boot.
 */
export function toCanonicalJson(data: ChaconneData): string {
  const sorted = sortKeysDeep(JSON.parse(JSON.stringify(data)));
  return JSON.stringify(sorted);
}

/**
 * The ImportExportPort implementation. The singleton `importExport` is
 * what the UI shell (C-3) and the disk store (C-2) consume.
 */
export function createImportExport(): ImportExportPort {
  return {
    exportData(data: ChaconneData): string {
      assertData(data);
      return toCanonicalJson(data);
    },

    importData(json: string):
      | { data: ChaconneData; rejected?: false; report?: never }
      | { data?: never; rejected: true; report: DryRunReport } {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new DomainInvariantError("import: not valid JSON");
      }

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new DomainInvariantError("import: root must be a plain object with 'recipes' and 'runs'");
      }

      const root = parsed as Record<string, unknown>;

      // — the schema gate (PRD edge case 9 / PLAN §5 row 10): a
      // foreign or future schema is REFUSED with a dry-run report,
      // never a partial import and never a mid-parse throw.
      if (root.schema !== SCHEMA_VERSION) {
        const report: DryRunReport = {
          schema: typeof root.schema === "string" ? root.schema : undefined,
          wouldImport: {
            recipes: Array.isArray(root.recipes) ? root.recipes.length : 0,
            runs: Array.isArray(root.runs) ? root.runs.length : 0,
          },
          reasons: [
            `schema is ${root.schema === undefined ? "absent" : JSON.stringify(root.schema)}; this import accepts only "${SCHEMA_VERSION}"`,
            "no partial import — the store is unchanged",
          ],
        };
        return { rejected: true, report };
      }

      // — structural pre-checks before the full invariant sweep.
      if (!Array.isArray(root.recipes)) {
        throw new DomainInvariantError("import: 'recipes' must be an array");
      }
      if (!Array.isArray(root.runs)) {
        throw new DomainInvariantError("import: 'runs' must be an array");
      }

      const data = root as ChaconneData;
      assertData(data);
      return { data, rejected: false };
    },
  };
}

/** Convenience: the singleton port (the app uses one instance). */
export const importExport: ImportExportPort = createImportExport();
