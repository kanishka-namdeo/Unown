/**
 * Bolero domain invariants (PLAN §2 round-trip pin law item 3) — the
 * shape + closed-set checks shared by BOTH hosts. The runner and the
 * server run the SAME `assertWatch` / `assertReport`; any breach
 * throws `DomainInvariantError` with the DOTTED PATH of the offending
 * value in the message (the V-41 law — dotted names THROW; a server
 * that rejects a well-formed report IS a pin failure).
 */
import type { RunReport, Step, WatchSpec } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { RUN_STATUSES, STEP_KINDS, ARTIFACT_EXTS, SCHEMA_VERSION } from "./sets.js";

const STEP_KIND_SET = new Set<string>(STEP_KINDS);
const STATUS_SET = new Set<string>(RUN_STATUSES);
const EXT_SET = new Set<string>(ARTIFACT_EXTS);

/** 64-char lowercase hex (a sha256 digest). */
const SHA256_RE = /^[0-9a-f]{64}$/;

/** An ISO-8601 timestamp string (the domain is Date-free by law). */
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Content-addressed artifact name grammar (PLAN §2 run-report draft):
 * `<watchId>_r<runSeq>_sha256:<64hex>.<ext>`.
 */
const ARTIFACT_NAME_RE = /^\d+_r\d+_sha256:[0-9a-f]{64}\.[A-Za-z0-9]+$/;

/** A non-empty string check with a dotted-path message. */
function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainInvariantError(`${path} must be a non-empty string (got ${JSON.stringify(value)})`);
  }
  return value;
}

/** A positive-integer check with a dotted-path message. */
function requirePositiveInt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new DomainInvariantError(`${path} must be a positive integer (got ${String(value)})`);
  }
  return value;
}

/** Validate one step's shape (PLAN §2: `{ id, kind, selector, value?, timeoutMs?, intoFrame? }`). */
export function assertStep(step: Step, ctx: string): void {
  requirePositiveInt(step.id, `${ctx}.id`);
  if (typeof step.kind !== "string" || !STEP_KIND_SET.has(step.kind)) {
    throw new DomainInvariantError(`${ctx}.kind not in the closed step-kind set [${STEP_KINDS.join("|")}] (got ${String(step.kind)})`);
  }
  requireNonEmptyString(step.selector, `${ctx}.selector`);
  if (step.timeoutMs !== undefined && (typeof step.timeoutMs !== "number" || step.timeoutMs <= 0)) {
    throw new DomainInvariantError(`${ctx}.timeoutMs must be a positive number when present (got ${String(step.timeoutMs)})`);
  }
  if (step.value !== undefined && typeof step.value !== "string") {
    throw new DomainInvariantError(`${ctx}.value must be a string when present (got ${String(step.value)})`);
  }
  if (step.intoFrame !== undefined && typeof step.intoFrame !== "string") {
    throw new DomainInvariantError(`${ctx}.intoFrame must be a string when present (got ${String(step.intoFrame)})`);
  }
}

/** Validate the optional recurrence (PLAN §2 `Schedule` shape). */
function assertSchedule(schedule: unknown, ctx: string): void {
  if (schedule === undefined) return;
  if (typeof schedule !== "object" || schedule === null || Array.isArray(schedule)) {
    throw new DomainInvariantError(`${ctx} must be a schedule object (got ${JSON.stringify(schedule)})`);
  }
  const s = schedule as Record<string, unknown>;
  if (s.kind !== "one-shot" && s.kind !== "interval") {
    throw new DomainInvariantError(`${ctx}.kind must be "one-shot" or "interval" (got ${String(s.kind)})`);
  }
  if (s.everyMs !== undefined && (typeof s.everyMs !== "number" || !Number.isInteger(s.everyMs) || s.everyMs <= 0)) {
    throw new DomainInvariantError(`${ctx}.everyMs must be a positive integer when present (got ${String(s.everyMs)})`);
  }
  if (s.nextDueIso !== undefined && (typeof s.nextDueIso !== "string" || !ISO8601_RE.test(s.nextDueIso))) {
    throw new DomainInvariantError(`${ctx}.nextDueIso must be an ISO-8601 string (got ${JSON.stringify(s.nextDueIso)})`);
  }
  if (s.lastFiredIso !== undefined && (typeof s.lastFiredIso !== "string" || !ISO8601_RE.test(s.lastFiredIso))) {
    throw new DomainInvariantError(`${ctx}.lastFiredIso must be an ISO-8601 string (got ${JSON.stringify(s.lastFiredIso)})`);
  }
}

/**
 * Assert `watch` satisfies the FROZEN watch-spec grammar
 * (PLAN §2). Both hosts share this check; every violation throws
 * `DomainInvariantError` with the DOTTED PATH (e.g. `watch.name`).
 *
 * @throws {DomainInvariantError} on the first breach
 */
export function assertWatch(watch: WatchSpec): void {
  if (watch.schema !== SCHEMA_VERSION) {
    throw new DomainInvariantError(`schema must be "${SCHEMA_VERSION}" (got ${String(watch.schema)})`);
  }
  const w = watch.watch;
  if (typeof w !== "object" || w === null) {
    throw new DomainInvariantError("watch must be an object");
  }
  requirePositiveInt(w.id, "watch.id");
  requireNonEmptyString(w.name, "watch.name");
  requireNonEmptyString(w.baseUrl, "watch.baseUrl");
  if (!Array.isArray(w.steps)) {
    throw new DomainInvariantError("watch.steps must be an array (got " + JSON.stringify(w.steps) + ")");
  }
  const stepIds = new Set<number>();
  w.steps.forEach((step, idx) => {
    const ctx = `watch.steps[${idx}]`;
    if (typeof step !== "object" || step === null) {
      throw new DomainInvariantError(`${ctx} must be a step object (got ${JSON.stringify(step)})`);
    }
    if (stepIds.has(step.id)) {
      throw new DomainInvariantError(`${ctx}.id ${step.id} duplicates a step id within the watch`);
    }
    stepIds.add(step.id);
    assertStep(step, ctx);
  });
  if (w.alertAfter !== undefined && (typeof w.alertAfter !== "number" || !Number.isInteger(w.alertAfter) || w.alertAfter < 1)) {
    throw new DomainInvariantError(`watch.alertAfter must be a positive integer when present (got ${String(w.alertAfter)})`);
  }
  if (w.recipeVersion !== undefined && (typeof w.recipeVersion !== "number" || !Number.isInteger(w.recipeVersion) || w.recipeVersion < 1)) {
    throw new DomainInvariantError(`watch.recipeVersion must be a positive integer when present (got ${String(w.recipeVersion)})`);
  }
  assertSchedule(w.schedule, "watch.schedule");
}

/**
 * Assert `report` satisfies the FROZEN run-report grammar
 * (PLAN §2). Every violation throws `DomainInvariantError` with the
 * DOTTED PATH (e.g. `report.status` not in the closed set;
 * `report.artifacts[2].sha256` missing) — the V-41 law made
 * executable by `roundtrip.test.ts`.
 *
 * @throws {DomainInvariantError} on the first breach
 */
export function assertReport(report: RunReport): void {
  if (report.schema !== SCHEMA_VERSION) {
    throw new DomainInvariantError(`schema must be "${SCHEMA_VERSION}" (got ${String(report.schema)})`);
  }
  const r = report.report;
  if (typeof r !== "object" || r === null) {
    throw new DomainInvariantError("report must be an object");
  }
  requirePositiveInt(r.watchId, "report.watchId");
  requirePositiveInt(r.recipeVersion, "report.recipeVersion");
  if (typeof r.status !== "string" || !STATUS_SET.has(r.status)) {
    throw new DomainInvariantError(`report.status not in the closed RunStatus set [${RUN_STATUSES.join("|")}] (got ${String(r.status)})`);
  }
  if (typeof r.startedAt !== "string" || !ISO8601_RE.test(r.startedAt)) {
    throw new DomainInvariantError(`report.startedAt must be an ISO-8601 string (got ${JSON.stringify(r.startedAt)})`);
  }
  if (r.finishedAt !== undefined && (typeof r.finishedAt !== "string" || !ISO8601_RE.test(r.finishedAt))) {
    throw new DomainInvariantError(`report.finishedAt must be an ISO-8601 string when present (got ${JSON.stringify(r.finishedAt)})`);
  }
  if (typeof r.committedPrefix !== "number" || !Number.isInteger(r.committedPrefix) || r.committedPrefix < 0) {
    throw new DomainInvariantError(`report.committedPrefix must be a non-negative integer (got ${String(r.committedPrefix)})`);
  }
  if (r.failedStepIdx !== undefined && (!Number.isInteger(r.failedStepIdx) || r.failedStepIdx < 0)) {
    throw new DomainInvariantError(`report.failedStepIdx must be a non-negative integer when present (got ${String(r.failedStepIdx)})`);
  }
  if (r.extracted !== undefined) {
    if (typeof r.extracted !== "object" || r.extracted === null || Array.isArray(r.extracted)) {
      throw new DomainInvariantError("report.extracted must be an object when present (got " + JSON.stringify(r.extracted) + ")");
    }
    for (const [k, v] of Object.entries(r.extracted)) {
      if (typeof v !== "string") {
        throw new DomainInvariantError(`report.extracted["${k}"] must be a string (got ${String(v)})`);
      }
    }
  }
  if (!Array.isArray(r.artifacts)) {
    throw new DomainInvariantError("report.artifacts must be an array (got " + JSON.stringify(r.artifacts) + ")");
  }
  r.artifacts.forEach((artifact, idx) => {
    const ctx = `report.artifacts[${idx}]`;
    if (typeof artifact !== "object" || artifact === null) {
      throw new DomainInvariantError(`${ctx} must be an artifact object (got ${JSON.stringify(artifact)})`);
    }
    requireNonEmptyString(artifact.name, `${ctx}.name`);
    if (typeof artifact.name !== "string" || !ARTIFACT_NAME_RE.test(artifact.name)) {
      throw new DomainInvariantError(`${ctx}.name must match the content-addressed grammar "<watchId>_r<runSeq>_sha256:<64hex>.<ext>" (got ${JSON.stringify(artifact.name)})`);
    }
    if (typeof artifact.sha256 !== "string" || !SHA256_RE.test(artifact.sha256)) {
      throw new DomainInvariantError(`${ctx}.sha256 must be 64 lowercase hex chars (got ${JSON.stringify(artifact.sha256)})`);
    }
    if (typeof artifact.ext !== "string" || !EXT_SET.has(artifact.ext)) {
      throw new DomainInvariantError(`${ctx}.ext not in the closed extension set [${ARTIFACT_EXTS.join("|")}] (got ${String(artifact.ext)})`);
    }
    // The digest EMBEDDED in the name must equal the field (the name IS the hash).
    const embedded = artifact.name.match(/sha256:([0-9a-f]{64})/)?.[1];
    if (embedded !== undefined && embedded !== artifact.sha256) {
      throw new DomainInvariantError(`${ctx}.name embeds a different digest than ${ctx}.sha256`);
    }
  });
  if (r.log !== undefined && typeof r.log !== "string") {
    throw new DomainInvariantError(`report.log must be a string when present (got ${String(r.log)})`);
  }
}
