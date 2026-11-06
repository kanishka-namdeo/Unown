/**
 * model.ts — the pure reducers (PLAN §1: "addJob, updateJob, addRun,
 * recordEngine"; the brief also names removeJob + nextId allocation).
 * No I/O: every helper returns a NEW FugueData and re-runs assertData,
 * so no mutation path can leave the store in a breach state.
 *
 * Ids come from the deterministic high-water-mark helpers in ids.ts
 * (never random — export byte-stability law). Timestamps are the
 * `now` ISO-8601 string INJECTED by the caller (domain never reads a
 * wall clock).
 */
import type { FugueData, Job, RunRecordView, EngineStatusView } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";
import { bumpNextFree, highWaterOf, nextFreeId, nextIdFromBoth } from "./ids.js";

/** The starting document for a fresh store. */
export function emptyData(): FugueData {
  return { schema: "fugue.v1", jobs: [], runs: [], nextId: 0 };
}

type JobInput = Omit<Job, "id" | "createdAt" | "updatedAt">;

type Timestamp = number | string; // epoch ms or ISO-8601 (both plain JSON)

/**
 * Add a job. Its id is the next free id (max+1); the high-water mark is
 * bumped to reflect it. `now` stamps createdAt/updatedAt.
 */
export function addJob(
  data: FugueData,
  input: JobInput,
  now: number,
): { data: FugueData; job: Job } {
  const id = nextFreeId(data.nextId);
  const job: Job = {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
  };
  const next: FugueData = {
    ...data,
    jobs: [...data.jobs, job],
    nextId: bumpNextFree(data.nextId, id),
  };
  assertData(next);
  return { data: next, job };
}

type JobPatch = Partial<Omit<Job, "id" | "createdAt">>;

/** Replace a job's fields; bumps updatedAt. Preserves id/createdAt.
 * The high-water mark is recomputed over the new set of jobs, so a
 * patch that does not change ids never drifts the mark. */
export function updateJob(
  data: FugueData,
  jobId: number,
  patch: JobPatch,
  now: number,
): FugueData {
  const target = data.jobs.find((j) => j.id === jobId);
  if (!target) throw new DomainInvariantError(`updateJob: unknown job ${jobId}`);
  const merged: Job = { ...target, ...patch, id: target.id, updatedAt: now };
  const next: FugueData = {
    ...data,
    jobs: data.jobs.map((j) => (j.id === jobId ? merged : j)),
    nextId: highWaterOf(data.jobs, data.runs) + 1,
  };
  assertData(next);
  return next;
}
/**
 * Remove a job. Its runs stay (history is append-only); the invariant
 * requires runs to resolve against live jobs, so a job with runs must
 * have those runs deleted first.
 */
export function removeJob(data: FugueData, jobId: number): FugueData {
  if (data.runs.some((r) => r.taskId === jobId)) {
    const n = data.runs.filter((r) => r.taskId === jobId).length;
    throw new DomainInvariantError(
      `removeJob: job ${jobId} has ${n} run(s) in history; delete the runs first`,
    );
  }
  const next: FugueData = {
    ...data,
    jobs: data.jobs.filter((j) => j.id !== jobId),
  };
  assertData(next);
  return next;
}

type RunInput = Omit<RunRecordView, "id"> & { startedAt?: Timestamp; endedAt?: Timestamp | null };

/** Record a run. Its id is the next free id; the mark is bumped.
 * Omitting timestamps stamps the injected `now` (a run in progress
 * ends null — `endedAt` null, not now — so a run never invents a
 * finish it has not had). */
export function addRun(
  data: FugueData,
  record: RunInput,
  now: number,
): { data: FugueData; run: RunRecordView } {
  const id = nextFreeId(data.nextId);
  const startedAt = record.startedAt !== undefined ? record.startedAt : now;
  const endedAt = record.endedAt !== undefined ? record.endedAt : null;
  const run: RunRecordView = {
    ...record,
    id,
    startedAt: startedAt as RunRecordView["startedAt"],
    endedAt: endedAt as RunRecordView["endedAt"],
  };
  const next: FugueData = {
    ...data,
    runs: [...data.runs, run],
    nextId: bumpNextFree(data.nextId, id),
  };
  assertData(next);
  return { data: next, run };
}

/** Remove one run record from history. */
export function removeRun(data: FugueData, runId: number): FugueData {
  const next: FugueData = {
    ...data,
    runs: data.runs.filter((r) => r.id !== runId),
    // The high-water mark is monotonic: removals never slide it down
    // (a deleted id must never be re-used), so the mark is preserved.
    nextId: data.nextId,
  };
  assertData(next);
  return next;
}

/** Record the latest engine status snapshot (the observation lane). */
export function recordEngine(
  data: FugueData,
  status: EngineStatusView,
): FugueData {
  // FugueData v1 keeps the engine status OUT of the persisted document
  // (the adapter owns live status); this reducer exists so the seam has
  // a pure home. It re-asserts the (unchanged) store.
  void status;
  assertData(data);
  return data;
}

/**
 * Rebuild the high-water mark from the taken ids — the repair path a
 * loader uses when a document's nextId drifted from its max+1 law.
 */
export function recomputeNextId(data: FugueData): FugueData {
  const expected = nextIdFromBoth(data.jobs, data.runs);
  if (data.nextId === expected) return data;
  const next: FugueData = { ...data, nextId: expected };
  if (next.jobs.length === 0 && next.runs.length === 0) {
    // an emptied document keeps the empty-document mark (0)
    return next;
  }
  assertData(next);
  return next;
}
