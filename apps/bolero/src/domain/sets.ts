/**
 * Bolero closed sets (PLAN §2, ticket S-1) — the constants the
 * invariants + io gate check against. Single declaration site; both
 * hosts import from here, so a drift in a closed set REDS at test
 * time (the V-41 law), never at 422 time.
 */
import type { Step } from "./types.js";

/** The 9-kind step vocabulary — verbatim Chaconne's frozen `STEP_KINDS`. */
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

/**
 * The 7-entry run-status taxonomy (PLAN §2: Chaconne's 5-entry
 * closed set extended with two host-lane statuses).
 */
export type RunStatus =
  | "ok"
  | "step-failed"
  | "selector-not-found"
  | "timeout"
  | "invalid-recipe"
  | "runner-offline"
  | "screenshot-failed";

export const RUN_STATUSES: readonly RunStatus[] = [
  "ok",
  "step-failed",
  "selector-not-found",
  "timeout",
  "invalid-recipe",
  "runner-offline",
  "screenshot-failed",
];

/** The only accepted schema value (the gate constant, PLAN §2). */
export const SCHEMA_VERSION = "bolero.v1";

/** The closed artifact-extension set for `ArtifactRef.ext`. */
export const ARTIFACT_EXTS: readonly ("png" | "json" | "log")[] = [
  "png",
  "json",
  "log",
];

/** A `Step` reference re-export (the two are declared separately to
 * keep types.ts's frozen-shape block self-contained). */
export type { Step };
