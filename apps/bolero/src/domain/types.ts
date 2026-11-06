/**
 * Bolero domain types — pure, serializable, DOM-free, Date-free.
 *
 * The FROZEN artifact grammar (PLAN §2, ticket S-1). Single declaration
 * site for both hosts: the runner CONSTRUCTS these shapes, the server
 * VALIDATES them — neither re-declares any field. Plain JSON only: no
 * class instances, no `Date` objects, timestamps are ISO-8601 strings,
 * ids are deterministic integers (`ids.ts`, max+1, never random).
 *
 * `Step` re-uses Chaconne's 9-kind step vocabulary VERBATIM (the frozen
 * reference at `apps/chaconne/src/domain/types.ts`); the `StepKind`/
 * `RunStatus` closed sets live in `sets.ts`.
 */
/**
 * A single step in a recipe — re-uses Chaconne's 9-kind semantics
 * VERBATIM (`apps/chaconne/src/domain/types.ts` `Step`):
 * - `goto`/`click`/`screenshot` — url or selector-driven;
 * - `fill`/`select` — `value` is the input text / selected option;
 * - `assert-text` — `value` is the expected text (textContent match);
 * - `wait`/`assert-element` — presence waits, capped by `timeoutMs`;
 * - `extract` — reads textContent into the run report's extracted map.
 * `selector` is ALWAYS a non-empty string (`goto` uses it as the URL).
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
  /** same-origin iframe name to resolve first. */
  intoFrame?: string;
};

/** A watch's recurrence (PLAN §2: Chaconne `Schedule` semantics, skip-and-record misfire). */
export type Schedule = {
  kind: "one-shot" | "interval";
  /** interval only: the period in ms (bounded below by the pool's rate). */
  everyMs?: number;
  /** ISO-8601; one-shot: the due instant; interval: next due. */
  nextDueIso?: string;
  /** ISO-8601; the last fire. */
  lastFiredIso?: string;
};

/** A registered watch: what a watch says (PLAN §2 watch-spec draft, exact). */
export type WatchSpec = {
  /** the top-level gate value (the schema law, PLAN §2 round-trip). */
  schema: "bolero.v1";
  watch: {
    /** deterministic integer id. */
    id: number;
    /** unique per registry (server invariant — edge case E-04). */
    name: string;
    /** the frozen 9-kind recipe, verbatim Chaconne `Recipe.steps`. */
    steps: Step[];
    /** where the recipe's goto targets (real-site: public https, no credentials). */
    baseUrl: string;
    /** the recurrence (skip-and-record misfire). */
    schedule?: Schedule;
    /** alert lane: fail N consecutive times before the watch alerts. */
    alertAfter?: number;
    /** the recipe version snapshot the runner executes (edge E-09 kin). */
    recipeVersion?: number;
  };
};

/** A content-addressed artifact reference (the name IS the sha256; collision-proof). */
export type ArtifactRef = {
  name: string;
  sha256: string;
  ext: "png" | "json" | "log";
};

/** The cross-host artifact: what a run says (PLAN §2 run-report draft, exact). */
export type RunReport = {
  /** the only accepted schema value; anything else → server 422. */
  schema: "bolero.v1";
  report: {
    /** the watch this run belongs to (must resolve in the registry — E-09). */
    watchId: number;
    /** the recipe version the run SNAPPED at start (edge E-09 kin). */
    recipeVersion: number;
    /** the 7-entry closed taxonomy (PLAN §2: Chaconne's 5 + two host-lane entries). */
    status:
      | "ok"
      | "step-failed"
      | "selector-not-found"
      | "timeout"
      | "invalid-recipe"
      | "runner-offline"
      | "screenshot-failed";
    /** ISO-8601. */
    startedAt: string;
    /** ISO-8601; absent when the run was killed. */
    finishedAt?: string;
    /** how many steps fully completed (the committed-prefix law, crash honesty). */
    committedPrefix: number;
    /** which step index failed, when status is not "ok". */
    failedStepIdx?: number;
    /** extracted values keyed by step index (the `extract` kind). */
    extracted?: Record<string, string>;
    /** content-addressed refs; grammar `<watchId>_r<runSeq>_sha256:<64hex>.<ext>`. */
    artifacts: ArtifactRef[];
    /** per-run honest log, bounded (E-07 oversized report caps total bytes). */
    log?: string;
  };
};

/**
 * The domain's guard failure. Both hosts surface it: `assertWatch` /
 * `assertReport` throw it with the DOTTED PATH of the breach in the
 * message (the V-41 law, PLAN §2 round-trip pin law item 3).
 */
export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}
