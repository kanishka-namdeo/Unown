/**
 * Id generation — pure, deterministic, integer (the Ostinato/Chaconne
 * law: max+1, NEVER random — export byte-stability across boots).
 *
 * `FugueData.nextId` is the NEXT FREE id: the id the next allocation
 * will take. A fresh document carries `nextId: 0` (no ids taken yet,
 * first allocation is id 1). After every allocation the stored mark is
 * max(taken ids, previous mark) + 1, so the mark NEVER equals a
 * taken id. The high-water check in assertData compares nextId
 * against maxTaken + 1 (an EMPTY document keeps its mark at 0 — its
 * "maxTaken + 1" is vacuously 0, since nothing has been taken).
 */

/** The next free id: the id the next allocation takes. A fresh
 * document carries mark 0, so the first allocation is id 1; after
 * each allocation the stored mark equals maxTaken + 1, which IS the
 * next free id itself. */
export function nextFreeId(highWater: number): number {
  return highWater === 0 ? 1 : highWater;
}

/** The high-water mark to store after allocating ids `lo..hi`:
 * max(input mark, allocated) — pure math; an empty allocation
 * returns the input mark unchanged. (Callers that store a
 * next-free value add 1 via bumpNextFree.) */
export function bumpHighWater(highWater: number, ...allocated: number[]): number {
  let max = highWater;
  for (const id of allocated) if (id > max) max = id;
  return max;
}

/**
 * The next-free value to store after allocating an id:
 * max(input mark, id) + 1 — the mark never equals a taken id.
 * A fresh document (mark 0) allocating id 1 stores 2.
 */
export function bumpNextFree(highWater: number, id: number): number {
  return Math.max(highWater, id) + 1;
}

/**
 * Deterministic max+1 over the taken ids (1 when empty) — the helper a
 * fresh document or an id-collision repair derives the mark from.
 */
export function nextIdFrom(taken: readonly number[]): number {
  let max = 0;
  for (const id of taken) if (id > max) max = id;
  return max + 1;
}

/**
 * Rebuild the next-id mark from the taken id sets (jobs + runs):
 * maxTaken + 1 — but an EMPTY document keeps its mark at 0 (nothing
 * taken yet; the first allocation will be id 1). Matches
 * assertData's empty-case exception (invariants.ts).
 */
export function nextIdFromBoth(
  jobs: readonly { id: number }[],
  runs: readonly { id: number }[],
): number {
  if (jobs.length === 0 && runs.length === 0) return 0;
  return highWaterOf(jobs, runs) + 1;
}

/** Collect the taken ids of a job collection. */
export function jobIds(jobs: readonly { id: number }[]): number[] {
  return jobs.map((j) => j.id);
}

/** Collect the taken ids of a run collection. */
export function runIds(runs: readonly { id: number }[]): number[] {
  return runs.map((r) => r.id);
}

/**
 * The store-wide high-water mark: the max of every taken id in the
 * document (jobs + runs), the value `FugueData.nextId` must equal
 * (except for the empty document, which stays at 0).
 */
export function highWaterOf(
  jobs: readonly { id: number }[],
  runs: readonly { id: number }[],
): number {
  let max = 0;
  for (const j of jobs) if (j.id > max) max = j.id;
  for (const r of runs) if (r.id > max) max = r.id;
  return max;
}
