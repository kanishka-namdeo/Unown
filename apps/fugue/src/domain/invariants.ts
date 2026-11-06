/**
 * Fugue domain invariants — "validation on every boundary" (PRD P0 #1).
 *
 * `assertData` runs on every mutation path and every import. Any breach
 * throws DomainInvariantError with a DOTTED-PATH message
 * ("jobs[0].schedule.kind: …") so a corrupt document is surfaced
 * honestly, never silently repaired.
 */
import type { FugueData, Job, RunRecordView } from "./types.js";
import { DomainInvariantError, RUN_STATUSES, SCHEDULE_KINDS } from "./types.js";

/** An ISO-8601 / epoch timestamp field (the domain is Date-free by law). */
const ISO8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * A timestamp field accepts either an ISO-8601 string OR epoch
 * milliseconds — both are plain-JSON (the Ostinato law: the domain
 * stores no Date objects), and schedule.ts's projection takes
 * millisecond numbers. Timestamps stay serializable either way.
 */
function isTimestampString(v: unknown): boolean {
  if (typeof v !== "string") {
    if (typeof v === "number" && Number.isFinite(v)) return true; // epoch ms
    return false;
  }
  if (!ISO8601_RE.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/** Normalize a timestamp (ISO string or epoch ms) to Date.parse-able.
 * ISO strings parse themselves; epoch numbers pass through. */
function tsParse(v: unknown): number {
  return typeof v === "number" ? v : Date.parse(v as string);
}

/**
 * Validate one schedule spec's shape (closed five-kind set with the
 * matching per-kind fields). Shared by assertData and the import path.
 */
export function assertScheduleSpec(
  spec: Job["schedule"],
  ctx: string,
): void {
  if (
    typeof spec !== "object" ||
    spec === null ||
    Array.isArray(spec)
  ) {
    throw new DomainInvariantError(
      `${ctx}.schedule: must be a schedule spec object`,
    );
  }
  const kind = (spec as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !SCHEDULE_KINDS.includes(kind)) {
    throw new DomainInvariantError(
      `${ctx}.schedule.kind: must be one of [${SCHEDULE_KINDS.join("|")}] (got ${String(kind)})`,
    );
  }
  switch (kind) {
    case "cron": {
      const s = spec as { expr?: unknown };
      if (typeof s.expr !== "string" || s.expr.length === 0) {
        throw new DomainInvariantError(
          `${ctx}.schedule.expr: cron specs carry a non-empty cron expression`,
        );
      }
      break;
    }
    case "every":
    case "after": {
      const s = spec as { spec?: unknown };
      if (typeof s.spec !== "string" || s.spec.length === 0) {
        throw new DomainInvariantError(
          `${ctx}.schedule.spec: ${kind} specs carry a non-empty string spec`,
        );
      }
      break;
    }
    case "once": {
      const s = spec as { delayMinutes?: unknown };
      if (
        typeof s.delayMinutes !== "number" ||
        !Number.isInteger(s.delayMinutes) ||
        s.delayMinutes < 1 ||
        s.delayMinutes > 525600
      ) {
        throw new DomainInvariantError(
          `${ctx}.schedule.delayMinutes: must be an integer 1..525600 (got ${String(s.delayMinutes)})`,
        );
      }
      break;
    }
    case "event": {
      const s = spec as { name?: unknown; filter?: unknown };
      if (typeof s.name !== "string" || s.name.length === 0) {
        throw new DomainInvariantError(
          `${ctx}.schedule.name: event specs carry a non-empty event name`,
        );
      }
      if (s.filter !== undefined && typeof s.filter !== "string") {
        throw new DomainInvariantError(
          `${ctx}.schedule.filter: must be a string when present`,
        );
      }
      break;
    }
    default:
      // Unreachable: `kind` is checked against the closed set above.
      throw new DomainInvariantError(
        `${ctx}.schedule.kind: unknown kind ${String(kind)}`,
      );
  }
}

/** Validate one job's shape against the fugue.v1 grammar. */
export function assertJob(job: Job, ctx: string): void {
  if (typeof job.id !== "number" || !Number.isInteger(job.id) || job.id < 1) {
    throw new DomainInvariantError(
      `${ctx}.id: job id must be a positive integer (got ${String(job.id)})`,
    );
  }
  if (typeof job.title !== "string" || job.title.length === 0) {
    throw new DomainInvariantError(
      `${ctx}.title: must be a non-empty string`,
    );
  }
  if (typeof job.prompt !== "string" || job.prompt.length === 0) {
    throw new DomainInvariantError(
      `${ctx}.prompt: must be a non-empty string`,
    );
  }
  assertScheduleSpec(job.schedule, ctx);
  if (job.mode !== "read-only" && job.mode !== "standard") {
    throw new DomainInvariantError(
      `${ctx}.mode: must be "read-only" or "standard" (got ${String(job.mode)})`,
    );
  }
  if (typeof job.model !== "string") {
    throw new DomainInvariantError(
      `${ctx}.model: must be a string`,
    );
  }
  if (typeof job.timezone !== "string") {
    throw new DomainInvariantError(
      `${ctx}.timezone: must be a string (IANA name or "" for engine-local)`,
    );
  }
  if (job.misfire !== "skip" && job.misfire !== "catch-up") {
    throw new DomainInvariantError(
      `${ctx}.misfire: must be "skip" or "catch-up" (got ${String(job.misfire)})`,
    );
  }
  if (
    job.spendCap !== "off" &&
    (typeof job.spendCap !== "number" ||
      !Number.isFinite(job.spendCap) ||
      job.spendCap < 0)
  ) {
    throw new DomainInvariantError(
      `${ctx}.spendCap: must be a non-negative number or "off" (got ${String(job.spendCap)})`,
    );
  }
  for (const f of ["createdAt", "updatedAt"] as const) {
    const v = job[f];
    if (!isTimestampString(v)) {
      throw new DomainInvariantError(
        `${ctx}.${f}: must be an ISO-8601 timestamp string or epoch milliseconds`,
      );
    }
  }
  if (tsParse(job.updatedAt) < tsParse(job.createdAt)) {
    throw new DomainInvariantError(
      `${ctx}.updatedAt: must not precede ${ctx}.createdAt`,
    );
  }
}

/** Validate one run record's shape. */
export function assertRun(
  run: RunRecordView,
  ctx: string,
): void {
  if (typeof run.id !== "number" || !Number.isInteger(run.id) || run.id < 1) {
    throw new DomainInvariantError(
      `${ctx}.id: run id must be a positive integer (got ${String(run.id)})`,
    );
  }
  if (typeof run.taskId !== "number" || !Number.isInteger(run.taskId)) {
    throw new DomainInvariantError(
      `${ctx}.taskId: must be an integer`,
    );
  }
  if (typeof run.kind !== "string" || run.kind.length === 0) {
    throw new DomainInvariantError(
      `${ctx}.kind: must be a non-empty string`,
    );
  }
  if (
    typeof run.status !== "string" ||
    !(RUN_STATUSES as readonly string[]).includes(run.status)
  ) {
    throw new DomainInvariantError(
      `${ctx}.status: must be one of [${RUN_STATUSES.join("|")}] (got ${String(run.status)})`,
    );
  }
  for (const f of ["startedAt", "endedAt"] as const) {
    const v = run[f];
    if (v !== null && !isTimestampString(v)) {
      throw new DomainInvariantError(
        `${ctx}.${f}: must be null or an ISO-8601 timestamp string / epoch milliseconds`,
      );
    }
  }
  for (const f of ["tokensIn", "tokensOut", "toolCalls", "turns"] as const) {
    const v = run[f];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new DomainInvariantError(
        `${ctx}.${f}: must be a non-negative integer (got ${String(v)})`,
      );
    }
  }
  if (run.error !== null && typeof run.error !== "string") {
    throw new DomainInvariantError(
      `${ctx}.error: must be null or a verbatim string (E-05)`,
    );
  }
}

/**
 * Assert `data` satisfies the fugue.v1 invariants:
 *  - schema literal "fugue.v1"
 *  - unique positive-integer job ids and run ids
 *  - nextId = max(jobs, runs ids) + 1 (the high-water-mark law)
 *  - every run.taskId resolves to a job
 *  - the invariants named in PLAN §2 per job and per run
 *
 * @throws {DomainInvariantError} on the first breach.
 */
export function assertData(data: FugueData): void {
  if (data.schema !== "fugue.v1") {
    throw new DomainInvariantError(
      `data.schema: must be "fugue.v1" (got ${String(data.schema)})`,
    );
  }
  if (!Array.isArray(data.jobs)) {
    throw new DomainInvariantError(
      "data.jobs: must be an array",
    );
  }
  if (!Array.isArray(data.runs)) {
    throw new DomainInvariantError(
      "data.runs: must be an array",
    );
  }
  const jobIds = new Set<number>();
  data.jobs.forEach((job, i) => {
    const ctx = `jobs[${i}]`;
    assertJob(job, ctx);
    if (jobIds.has(job.id)) {
      throw new DomainInvariantError(
        `${ctx}.id: duplicate job id ${job.id}`,
      );
    }
    jobIds.add(job.id);
  });
  const runIds = new Set<number>();
  data.runs.forEach((run, i) => {
    const ctx = `runs[${i}]`;
    assertRun(run, ctx);
    if (runIds.has(run.id)) {
      throw new DomainInvariantError(
        `${ctx}.id: duplicate run id ${run.id}`,
      );
    }
    runIds.add(run.id);
    if (!jobIds.has(run.taskId)) {
      throw new DomainInvariantError(
        `${ctx}.taskId: unknown task ${run.taskId} (runs resolve against jobs)`,
      );
    }
  });
/**
 * The high-water-mark law (ids.ts): `FugueData.nextId` is the next
 * FREE id — the stored mark IS the next allocation. For a non-empty
 * document the mark is maxTaken + 1 (never equal to a taken id); a
 * FRESH document keeps mark 0 (its first allocation is id 1). A
 * deletion leaves the mark monotonic — it never slides down below
 * maxTaken + 1 (a deleted id must never be re-used). The check is
 * `nextId >= maxTaken + 1` (removals preserve the mark; only the
 * first allocation from a fresh mark of 0 bumps to max+1).
 */
let max = 0;
for (const j of data.jobs) if (j.id > max) max = j.id;
for (const r of data.runs) if (r.id > max) max = r.id;
const isEmpty = data.jobs.length === 0 && data.runs.length === 0;
const minimum = isEmpty ? 0 : max + 1;
  if (
    typeof data.nextId !== "number" ||
    !Number.isInteger(data.nextId) ||
    data.nextId < minimum
  ) {
    throw new DomainInvariantError(
      `data.nextId: must be at least the high-water mark ${minimum} (max of all taken ids + 1; an empty document stays 0); got ${String(data.nextId)}`,
    );
  }
}
