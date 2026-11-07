/**
 * io-view.ts — the F-8 import/export view models (DOM-free, the F-1 kin).
 *
 * The E2E IO battery's unit lane: the pure view models behind the
 * export/import wiring — the canonical bytes come from the domain's
 * `exportFugue` (byte-stable by construction, never re-serialized ad
 * hoc), and the dry-run refusal panel's shape is a pure function of the
 * `DryRunRefusal` so the store NEVER mutates on a refusal.
 */
import type { FugueData } from "../domain/types.js";
import {
  exportFugue,
  parseFugue,
  type DryRunRefusal,
  type ParseFugueResult,
} from "../domain/io.js";

/** The export's filename (the house's zero-dep law: one constant). */
export const EXPORT_FILENAME = "fugue-export.json";

/**
 * The export's honest toast: an empty store still exports (the schema +
 * empty arrays — the byte-stable golden for a fresh install), and the
 * toast says so.
 */
export function exportToastLine(data: FugueData): string {
  const jobs = data.jobs.length;
  const runs = data.runs.length;
  if (jobs === 0 && runs === 0) {
    return `exported the empty store (schema + empty arrays) — ${EXPORT_FILENAME}`;
  }
  return `exported ${jobs} jobs, ${runs} runs — ${EXPORT_FILENAME}`;
}

/** The import's honest ok-summary (N jobs, M runs imported). */
export function importOkLine(data: FugueData): string {
  return `imported ${data.jobs.length} jobs, ${data.runs.length} runs`;
}

/** The refusal panel's view model: reason + the offending schema
 *  literal (when present) + the details, VERBATIM (never summarized,
 *  never swallowed — the E-05 kin applied to the import lane). */
export interface ImportRefusalView {
  reason: DryRunRefusal["reason"];
  schemaLiteral: string;
  details: string;
}

/** Build the refusal panel's view model from a DryRunRefusal.
 *  Invariant breaches on a fugue.v1 document surface through the
 *  domain's structured refusal lane (never a throw) — `parseFugue`
 *  catches the DomainInvariantError and maps it to a reason-
 *  'invariant' report, so `importDocument` never propagates a throw
 *  (corrupt documents stay the same refusal panel, never a crash). */
export function refusalViewModel(r: DryRunRefusal): ImportRefusalView {
  return {
    reason: r.reason,
    schemaLiteral: r.schema !== undefined ? r.schema : "absent",
    details: r.details,
  };
}

/** The import outcome: a validated document, a refusal, or a corrupt
 *  fugue.v1 document (the DomainInvariantError — surfaced honestly,
 *  never a crash). */
export type ImportOutcome =
  | { ok: true; data: FugueData }
  | { ok: false; refusal: ImportRefusalView };

/**
 * The import decision: parse `text` through the domain's `parseFugue`
 * (the schema gate + `assertData` — the store is NEVER partially
 * imported). A structured refusal maps to the panel's view model; a
 * thrown DomainInvariantError (a corrupt fugue.v1 document) is caught
 * and surfaced as its honest error line. The caller persists NOTHING
 * on `ok: false` (the store stays byte-identical to pre-import).
 */
export function importDocument(text: string): ImportOutcome {
  const result: ParseFugueResult = parseFugue(text);
  if (result.ok) {
    return { ok: true, data: result.data };
  }
  return { ok: false, refusal: refusalViewModel(result) };
}

/** The export's canonical bytes (the domain's serializer, untouched). */
export function exportBytes(data: FugueData): string {
  return exportFugue(data);
}
