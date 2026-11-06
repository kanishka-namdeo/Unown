/**
 * model test — the pure reducers (PLAN §1: addJob, updateJob, addRun,
 * recordEngine + removeJob/removeRun + nextId allocation). Every
 * helper returns a NEW document and re-runs assertData — no mutation
 * path can leave the store in a breach state. Ids come from the
 * deterministic high-water mark (max+1, never random); timestamps are
 * the INJECTED `now` number (epoch ms) — the domain never reads a wall
 * clock.
 */
import { test, expect } from "bun:test";
import {
  emptyData,
  addJob,
  updateJob,
  removeJob,
  addRun,
  removeRun,
  recordEngine,
  recomputeNextId,
} from "./model.js";
import type { FugueData, Job, RunRecordView } from "./types.js";
import { DomainInvariantError } from "./types.js";

const NOW = 1762454400000; // 2026-11-07T00:00:00Z in epoch ms
const LATER = NOW + 86_400_000;

function jobInput(partial: Partial<Job> = {}) {
  return {
    title: "nightly",
    prompt: "summarize",
    schedule: { kind: "every", spec: "2d" } as Job["schedule"],
    mode: "read-only" as const,
    model: "agnes-3.0-flash",
    timezone: "",
    misfire: "skip" as const,
    spendCap: "off" as const,
    ...partial,
  };
}

function runInput(taskId: number) {
  return {
    taskId,
    kind: "schedule",
    status: "ok" as const,
    tokensIn: 100,
    tokensOut: 10,
    toolCalls: 2,
    turns: 1,
    error: null,
  };
}

test("emptyData: the fresh document (ids start at 1)", () => {
  const d = emptyData();
  expect(d).toEqual({ schema: "fugue.v1", jobs: [], runs: [], nextId: 0 });
});

test("addJob: deterministic max+1 id, stamps the injected now, bumps the mark", () => {
  const d1 = addJob(emptyData(), jobInput(), NOW);
  expect(d1.job.id).toBe(1);
  expect(d1.job.createdAt).toBe(NOW);
  expect(d1.job.updatedAt).toBe(NOW);
  expect(d1.data.nextId).toBe(2);
  const d2 = addJob(d1.data, jobInput({ title: "second" }), NOW);
  expect(d2.job.id).toBe(2);
  expect(d2.data.nextId).toBe(3);
  // purity: the input document is untouched
  expect(d1.data.jobs.length).toBe(1);
  expect(d2.data.jobs.length).toBe(2);
});

test("addJob: an already-breached document is surfaced, never repaired", () => {
  const d = addJob(emptyData(), jobInput(), NOW);
  // a healthy document re-asserts on every mutation path
  const d2 = addJob(d.data, jobInput({ title: "ok" }), NOW);
  expect(d2.data.jobs.length).toBe(2);
  // a document ALREADY in breach (planted from outside) is surfaced
  // honestly by the next re-assertion — never silently repaired
  const broken = { ...d.data } as FugueData;
  broken.jobs[0] = { ...broken.jobs[0], title: "" };
  expect(() => addJob(broken, jobInput({ title: "ok" }), NOW)).toThrow(
    /jobs\[0\]\.title: must be a non-empty string/,
  );
});

test("updateJob: replaces fields, bumps updatedAt, preserves id/createdAt", () => {
  const d1 = addJob(emptyData(), jobInput(), NOW);
  const d2 = updateJob(d1.data, 1, { title: "renamed", mode: "standard" }, LATER);
  const j = d2.jobs[0];
  expect(j.title).toBe("renamed");
  expect(j.mode).toBe("standard");
  expect(j.id).toBe(1);
  expect(j.createdAt).toBe(NOW);
  expect(j.updatedAt).toBe(LATER);
  // the mark survives a patch (max+1 over the unchanged ids)
  expect(d2.nextId).toBe(2);
  expect(() => updateJob(d2, 42, { title: "ghost" }, LATER)).toThrow(
    /updateJob: unknown job 42/,
  );
});

test("addRun: ids share the ONE high-water collection space", () => {
  let d = addJob(emptyData(), jobInput(), NOW).data; // job id 1, mark 2
  const a = addRun(d, runInput(1), NOW + 60_000);
  expect(a.run.id).toBe(2);
  expect(a.data.nextId).toBe(3);
  // an in-progress run: startedAt stamped now, endedAt stays null
  expect(a.run.startedAt).toBe(NOW + 60_000);
  expect(a.run.endedAt).toBeNull();
  const b = addRun(a.data, runInput(1), NOW + 120_000);
  expect(b.run.id).toBe(3);
  expect(b.data.nextId).toBe(4);
  d = b.data;
  const c = addJob(d, jobInput({ title: "third" }), LATER);
  expect(c.job.id).toBe(4); // the mark is shared across jobs + runs
  expect(c.data.nextId).toBe(5);
});

test("removeRun: drops one record, the mark is never re-used (monotonic)", () => {
  let d = addJob(emptyData(), jobInput(), NOW).data;
  const a = addRun(d, runInput(1), NOW + 60_000);
  const b = addRun(a.data, runInput(1), NOW + 120_000);
  expect(b.data.runs.length).toBe(2);
  const c = removeRun(b.data, a.run.id);
  expect(c.runs.length).toBe(1);
  expect(c.runs[0].id).toBe(b.run.id);
  // the high-water mark is monotonic — it does not slide down
  expect(c.nextId).toBe(b.data.nextId);
  const dNext = addRun(c, runInput(1), LATER);
  expect(dNext.run.id).toBe(c.nextId); // next id is max+1, never re-used
});

test("removeJob: refused while its runs are still in history", () => {
  let d = addJob(emptyData(), jobInput(), NOW).data;
  d = addRun(d, runInput(1), NOW + 60_000).data;
  expect(() => removeJob(d, 1)).toThrow(/has 1 run\(s\) in history; delete the runs first/);
  // after deleting the run, the job can be removed
  const withoutRun = removeRun(d, d.runs[0].id);
  const withoutJob = removeJob(withoutRun, 1);
  expect(withoutJob.jobs.length).toBe(0);
});

test("recordEngine: a pure observation lane — the store is unchanged", () => {
  const d = addJob(emptyData(), jobInput(), NOW).data;
  const out = recordEngine(d, { phase: "ready", pid: 4242 });
  expect(out).toBe(d); // same document (asserted, unchanged)
});

test("recomputeNextId: repairs a drifted mark back to max+1", () => {
  let d = addJob(emptyData(), jobInput(), NOW).data;
  d = addJob(d, jobInput({ title: "b" }), NOW).data;
  d = addRun(d, runInput(1), LATER).data; // max id 3, mark 4
  const drifted = { ...d, nextId: 99 } as FugueData;
  const fixed = recomputeNextId(drifted);
  expect(fixed.nextId).toBe(4);
  // a correct mark passes through untouched (same reference)
  expect(recomputeNextId(d)).toBe(d);
});

test("every reducer re-runs the invariants (a breach throws)", () => {
  const d = addJob(emptyData(), jobInput(), NOW).data;
  const broken = { ...d, jobs: [{ ...d.jobs[0], title: "" }] } as FugueData;
  expect(() => addJob(broken, jobInput(), NOW)).toThrow(DomainInvariantError);
});
