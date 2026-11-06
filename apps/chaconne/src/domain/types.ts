/**
 * Chaconne domain types — pure, serializable, DOM-free.
 *
 * Single source of truth for the app's data model (the Ostinato
 * `types.ts` precedent). Every entity is plain JSON (no class
 * instances, no Date objects); timestamps are ISO-8601 strings. A store
 * serializing to JSON is a lossless, non-rewrite path to import/export
 * (PRD P0 #1: canonical JSON, byte-stable).
 *
 * Ids are INTEGERS (the PLAN §2 ruling): deterministic max+1 helpers in
 * `ids.ts`, never random, so exports are byte-stable across boots.
 */

/** The closed 9-kind step set (PLAN §1: the runner's full vocabulary). */
export type StepKind =
  | "goto"
  | "click"
  | "fill"
  | "select"
  | "wait"
  | "assert-text"
  | "assert-element"
  | "extract"
  | "screenshot";

export const STEP_KINDS: readonly StepKind[] = [
  "goto",
  "click",
  "fill",
  "select",
  "wait",
  "assert-text",
  "assert-element",
  "extract",
  "screenshot",
];

/** The 5-entry run-status taxonomy (PLAN §1 closed set). */
export type RunStatus =
  | "ok"
  | "step-failed"
  | "selector-not-found"
  | "timeout"
  | "invalid-recipe";

export const RUN_STATUSES: readonly RunStatus[] = [
  "ok",
  "step-failed",
  "selector-not-found",
  "timeout",
  "invalid-recipe",
];

/**
 * A single step in a recipe. Kinds shape the optional fields:
 * - `goto`/`click`/`screenshot` — `url` or selector-driven;
 * - `fill`/`select` — `value` is the input text / selected option;
 * - `assert-text` — `value` is the expected text (textContent match);
 * - `wait`/`assert-element` — presence waits, capped by `timeoutMs`;
 * - `extract` — reads textContent into the run record's extracted map.
 * `selector` is ALWAYS a non-empty string (invariant; `goto` uses it as
 * the URL). `intoFrame` targets a same-origin iframe by name.
 */
export type Step = {
  id: number;
  kind: StepKind;
  /** non-empty CSS selector (or URL for `goto`). */
  selector: string;
  /** optional per-step cap in ms; the runner's default applies when absent. */
  timeoutMs?: number;
  /** the value payload for fill/select/assert-text/extract steps. */
  value?: string;
  /** same-origin iframe name to resolve first (PRD edge case 3). */
  intoFrame?: string;
};

/**
 * A browser flow recipe. `version` is bumped on every edit; a RUNNING
 * recipe snapshots its version at start (PRD edge case 6 — the run
 * record carries the START version, not the end-of-run one).
 */
export type Recipe = {
  id: number;
  name: string;
  version: number;
  steps: Step[];
  /** C-4's schedule shape — pinned here as the PLAN §2 schema row. */
  schedule?: Schedule;
};

/** A recipe's recurring schedule (C-4 implements the due/skip logic). */
export type Schedule = {
  kind: "one-shot" | "interval";
  /** interval schedules: the period in ms. */
  everyMs?: number;
  /** ISO-8601; one-shot: the due instant; interval: the next due. */
  nextDueIso?: string;
  /** ISO-8601; the last fire. */
  lastFiredIso?: string;
};

/**
 * A content-addressed artifact reference (PRD edge case 7: the name IS
 * the hash — a collision cannot clobber anything, identical bytes
 * dedupe). Grammar: `<stepIdx>_r<runId>_sha256:<64hex>.<ext>`.
 */
export type ArtifactRef = {
  name: string;
  sha256: string;
};

/**
 * One execution of a recipe. Array order in `ChaconneData.runs` IS the
 * run history (the canonical-JSON law: arrays keep index order).
 */
export type RunRecord = {
  id: number;
  /** must resolve to a Recipe in the same store (invariant). */
  recipeId: number;
  /** the version snapshot law (edge case 6): present on every run. */
  recipeVersion: number;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  /** how many steps fully completed (crash-kill edge case 5). */
  committedPrefix: number;
  /** which step index failed, when status is not "ok". */
  failedStepIdx?: number;
  /** extracted values keyed by step index (the `extract` kind). */
  extracted?: Record<string, string>;
  artifacts: ArtifactRef[];
};

/** The persisted document — top-level schema literal "chaconne.v1". */
export type ChaconneData = {
  schema: "chaconne.v1";
  recipes: Recipe[];
  runs: RunRecord[];
};

/**
 * The domain's guard failure. Every mutation path and every import runs
 * `assertData` (PRD P0 #1: "validation on every boundary"); a breach
 * throws this type so callers surface the honest state, never a silent
 * wipe.
 */
export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}

/**
 * The Import/Export port (PRD P0 #1, the byte-stable lane). `importData`
 * additionally rejects a foreign/future `schema` with a DRY-RUN report —
 * what WOULD import and why it was refused — never a partial import
 * (PRD edge case 9 / PLAN §5 row 10).
 */
export type DryRunReport = {
  /** the offending schema value, when the rejection is schema-based. */
  schema?: string;
  /** rows that WOULD have imported if the schema matched. */
  wouldImport: { recipes: number; runs: number };
  /** why it was refused. */
  reasons: string[];
};

export type ImportExportPort = {
  /** canonical JSON — byte-stable across boots. */
  exportData(data: ChaconneData): string;
  /**
   * Parse + validate. Throws DomainInvariantError on invariant breach.
   * A foreign schema NEVER throws mid-import; it returns the dry-run
   * report so the caller can surface it.
   *
   * @returns `{ data, rejected }` — `rejected === true` means the dry-
   * run report is attached and no import happened.
   */
  importData(json: string):
    | { data: ChaconneData; rejected?: false; report?: never }
    | { data?: never; rejected: true; report: DryRunReport };
};
