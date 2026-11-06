/**
 * Chaconne domain core — DOM-free invariant checks (PRD P0 #1:
 * "validation on every boundary").
 *
 * `assertData` is run by EVERY mutation helper in `model.ts` and by the
 * import path in `io.ts`. Any breach throws DomainInvariantError so a
 * corrupt document is surfaced honestly, never silently repaired.
 */
import type { ArtifactRef, ChaconneData, RunRecord, Schedule, Step } from "./types.js";
import { DomainInvariantError, RUN_STATUSES, STEP_KINDS } from "./types.js";

const STEP_KIND_SET = new Set<string>(STEP_KINDS);
const STATUS_SET = new Set<string>(RUN_STATUSES);

/**
 * Content-addressed artifact name grammar (PRD edge case 7):
 * `<stepIdx>_r<runId>_sha256:<64hex>.<ext>`
 * e.g. `3_r12_sha256:ab12...cd.png` (64 hex chars, one dot, ext >= 1).
 */
const ARTIFACT_NAME_RE = /^\d+_r\d+_sha256:[0-9a-f]{64}\.[A-Za-z0-9]+$/;

/** 64-char lowercase hex (a sha256 digest). */
const SHA256_RE = /^[0-9a-f]{64}$/;

/** An ISO-8601 timestamp string (the domain is Date-free by law). */
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Validate one step's shape (selector non-empty, closed kind set,
 * optional fields well-typed). Shared by assertData and the import
 * path so the boundary rule is written exactly once.
 */
export function assertStep(step: Step, ctx: string): void {
  if (typeof step.id !== "number" || !Number.isInteger(step.id) || step.id < 1) {
    throw new DomainInvariantError(`${ctx}: step id must be a positive integer (got ${String(step.id)})`);
  }
  if (typeof step.kind !== "string" || !STEP_KIND_SET.has(step.kind)) {
    throw new DomainInvariantError(`${ctx}: step ${step.id}: kind must be one of [${STEP_KINDS.join("|")}] (got ${String(step.kind)})`);
  }
  if (typeof step.selector !== "string" || step.selector.length === 0) {
    throw new DomainInvariantError(`${ctx}: step ${step.id}: selector must be a non-empty string`);
  }
  if (step.timeoutMs !== undefined && (typeof step.timeoutMs !== "number" || step.timeoutMs <= 0)) {
    throw new DomainInvariantError(`${ctx}: step ${step.id}: timeoutMs must be a positive number`);
  }
  if (step.value !== undefined && typeof step.value !== "string") {
    throw new DomainInvariantError(`${ctx}: step ${step.id}: value must be a string when present`);
  }
  if (step.intoFrame !== undefined && typeof step.intoFrame !== "string") {
    throw new DomainInvariantError(`${ctx}: step ${step.id}: intoFrame must be a string when present`);
  }
}

/** Validate an optional schedule shape (C-4 owns the logic; the shape is C-1's). */
function assertSchedule(schedule: Schedule | undefined, ctx: string): void {
  if (schedule === undefined) return;
  if (typeof schedule !== "object" || schedule === null || Array.isArray(schedule)) {
    throw new DomainInvariantError(`${ctx}: schedule must be an object`);
  }
  if (schedule.kind !== "one-shot" && schedule.kind !== "interval") {
    throw new DomainInvariantError(`${ctx}: schedule.kind must be "one-shot" or "interval"`);
  }
  if (schedule.kind === "interval" && schedule.everyMs !== undefined && (schedule.everyMs <= 0 || !Number.isInteger(schedule.everyMs))) {
    throw new DomainInvariantError(`${ctx}: schedule.everyMs must be a positive integer`);
  }
  if (schedule.nextDueIso !== undefined && !ISO8601_RE.test(schedule.nextDueIso)) {
    throw new DomainInvariantError(`${ctx}: schedule.nextDueIso must be an ISO-8601 string`);
  }
  if (schedule.lastFiredIso !== undefined && !ISO8601_RE.test(schedule.lastFiredIso)) {
    throw new DomainInvariantError(`${ctx}: schedule.lastFiredIso must be an ISO-8601 string`);
  }
}

/** Validate an artifact ref (content-addressed name + matching digest). */
function assertArtifact(artifact: ArtifactRef, ctx: string): void {
  if (typeof artifact.name !== "string" || !ARTIFACT_NAME_RE.test(artifact.name)) {
    throw new DomainInvariantError(`${ctx}: artifact name must match the content-addressed grammar "<stepIdx>_r<runId>_sha256:<64hex>.<ext>" (got ${JSON.stringify(artifact.name)})`);
  }
  if (typeof artifact.sha256 !== "string" || !SHA256_RE.test(artifact.sha256)) {
    throw new DomainInvariantError(`${ctx}: artifact sha256 must be 64 lowercase hex chars`);
  }
  // The digest EMBEDDED in the name must equal the field (the name IS the hash).
  const embedded = artifact.name.match(/sha256:([0-9a-f]{64})/)?.[1];
  if (embedded !== artifact.sha256) {
    throw new DomainInvariantError(`${ctx}: artifact ${artifact.name} embeds a different digest than its sha256 field`);
  }
}

/**
 * Assert `data` satisfies ChaconneData's invariants:
 *  - the top-level schema literal is "chaconne.v1"
 *  - unique ids per collection (recipes, runs, steps — steps are global)
 *  - every run's recipeId resolves to a recipe
 *  - recipeVersion present (number) on every run
 *  - step selectors non-empty, kinds in the closed 9-kind set
 *  - artifact names match the content-addressed grammar
 *  - committedPrefix <= the recipe's steps.length
 *
 * @throws {DomainInvariantError} on the first breach
 */
export function assertData(data: ChaconneData): void {
  if (data.schema !== "chaconne.v1") {
    throw new DomainInvariantError(`assertData: schema must be "chaconne.v1" (got ${String(data.schema)})`);
  }

  // — recipes —
  const recipeIds = new Set<number>();
  const stepIds = new Set<number>();
  for (const recipe of data.recipes) {
    if (recipeIds.has(recipe.id)) throw new DomainInvariantError(`duplicate recipe id: ${recipe.id}`);
    recipeIds.add(recipe.id);
    if (typeof recipe.name !== "string" || recipe.name.length === 0) {
      throw new DomainInvariantError(`recipe ${recipe.id}: name must be a non-empty string`);
    }
    if (typeof recipe.version !== "number" || !Number.isInteger(recipe.version) || recipe.version < 1) {
      throw new DomainInvariantError(`recipe ${recipe.id}: version must be a positive integer`);
    }
    if (!Array.isArray(recipe.steps)) {
      throw new DomainInvariantError(`recipe ${recipe.id}: steps must be an array`);
    }
    assertSchedule(recipe.schedule, `recipe ${recipe.id}`);
    for (const step of recipe.steps) {
      if (stepIds.has(step.id)) throw new DomainInvariantError(`duplicate step id: ${step.id}`);
      stepIds.add(step.id);
      assertStep(step, `recipe ${recipe.id}`);
    }
  }

  // — runs —
  const runIds = new Set<number>();
  for (const run of data.runs) {
    if (runIds.has(run.id)) throw new DomainInvariantError(`duplicate run id: ${run.id}`);
    runIds.add(run.id);
    if (typeof run.id !== "number" || !Number.isInteger(run.id) || run.id < 1) {
      throw new DomainInvariantError(`run id must be a positive integer (got ${String(run.id)})`);
    }
    if (!recipeIds.has(run.recipeId)) {
      throw new DomainInvariantError(`run ${run.id}: unknown recipeId ${run.recipeId}`);
    }
    if (typeof run.recipeVersion !== "number") {
      throw new DomainInvariantError(`run ${run.id}: recipeVersion is required (the snapshot law)`);
    }
    if (typeof run.status !== "string" || !STATUS_SET.has(run.status)) {
      throw new DomainInvariantError(`run ${run.id}: status must be one of [${RUN_STATUSES.join("|")}] (got ${String(run.status)})`);
    }
    if (typeof run.startedAt !== "string" || !ISO8601_RE.test(run.startedAt)) {
      throw new DomainInvariantError(`run ${run.id}: startedAt must be an ISO-8601 string`);
    }
    if (run.finishedAt !== undefined && !ISO8601_RE.test(run.finishedAt)) {
      throw new DomainInvariantError(`run ${run.id}: finishedAt must be an ISO-8601 string`);
    }
    if (typeof run.committedPrefix !== "number" || !Number.isInteger(run.committedPrefix) || run.committedPrefix < 0) {
      throw new DomainInvariantError(`run ${run.id}: committedPrefix must be a non-negative integer`);
    }
    const recipe = data.recipes.find((r) => r.id === run.recipeId)!;
    if (run.committedPrefix > recipe.steps.length) {
      throw new DomainInvariantError(`run ${run.id}: committedPrefix ${run.committedPrefix} exceeds recipe ${run.recipeId}'s ${recipe.steps.length} steps`);
    }
    if (run.failedStepIdx !== undefined && (!Number.isInteger(run.failedStepIdx) || run.failedStepIdx < 0)) {
      throw new DomainInvariantError(`run ${run.id}: failedStepIdx must be a non-negative integer when present`);
    }
    if (!Array.isArray(run.artifacts)) {
      throw new DomainInvariantError(`run ${run.id}: artifacts must be an array`);
    }
    for (const artifact of run.artifacts) {
      assertArtifact(artifact, `run ${run.id}`);
    }
    if (run.extracted !== undefined) {
      if (typeof run.extracted !== "object" || run.extracted === null || Array.isArray(run.extracted)) {
        throw new DomainInvariantError(`run ${run.id}: extracted must be an object when present`);
      }
      for (const [k, v] of Object.entries(run.extracted)) {
        if (typeof v !== "string") {
          throw new DomainInvariantError(`run ${run.id}: extracted value for '${k}' must be a string`);
        }
      }
    }
  }
}
