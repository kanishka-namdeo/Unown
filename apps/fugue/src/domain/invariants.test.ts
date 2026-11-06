/**
 * invariants test — dotted-path message pins + every invariant the
 * PLAN grammar names (schema literal, unique ids, taskId resolution,
 * closed kind/mode sets, non-empty title/prompt, the nextId high-water
 * law).
 */
import { test, expect } from "bun:test";
import { DomainInvariantError } from "./types.js";
import { nextFreeId } from "./ids.js";
import { assertData } from "./invariants.js";
import { emptyData, addJob, addRun } from "./model.js";
import type { FugueData, Job } from "./types.js";

const NOW = 1762454400000; // 2026-11-07T00:00:00Z in epoch ms

function validJob(partial: Partial<Job> = {}): Omit<Job, "id" | "createdAt" | "updatedAt"> {
  return {
    title: "nightly",
    prompt: "summarize",
    schedule: { kind: "every", spec: "2d" },
    mode: "read-only",
    model: "agnes-3.0-flash",
    timezone: "",
    misfire: "skip",
    spendCap: "off",
    ...partial,
  };
}

function oneJob(): FugueData {
  return addJob(emptyData(), validJob(), NOW).data;
}

/** Plant a run into `d` after the reducer has already asserted; the
 * invariants throw on the NEXT boundary check, not inside addRun. */
function plantRun(
  d: FugueData,
  rec: Omit<import("./types.js").RunRecordView, "id">,
): FugueData {
  const id = nextFreeId(d.nextId); // the next free id (max+1)
  const out: FugueData = {
    ...d,
    runs: [...d.runs, { ...rec, id }],
    nextId: id + 1,
  };
  // do NOT assert here — this is a PLANTED breach
  return out;
}

test("a valid document passes assertData", () => {
  expect(() => assertData(oneJob())).not.toThrow();
});

test("schema literal must be fugue.v1 (dotted path)", () => {
  const d = oneJob();
  (d as { schema: string }).schema = "fugue.v2";
  expect(() => assertData(d)).toThrow(
    /data\.schema: must be "fugue\.v1"/,
  );
});

test("non-empty title/prompt are enforced with dotted paths", () => {
  // Plant the breach AFTER the reducer (the reducer asserts first, so a
  // healthy document is the only thing it can return).
  const d = oneJob();
  d.jobs[0] = { ...d.jobs[0], title: "" };
  expect(() => assertData(d)).toThrow(/jobs\[0\]\.title: must be a non-empty string/);
  const d2 = oneJob();
  d2.jobs[0] = { ...d2.jobs[0], prompt: "" };
  expect(() => assertData(d2)).toThrow(/jobs\[0\]\.prompt: must be a non-empty string/);
});

test("mode is the closed set (dotted path)", () => {
  const d = oneJob();
  d.jobs[0] = { ...d.jobs[0], mode: "full" } as unknown as Job;
  expect(() => assertData(d)).toThrow(/jobs\[0\]\.mode: must be "read-only" or "standard"/);
});

test("schedule kind is the closed five-kind set", () => {
  const d = oneJob();
  d.jobs[0] = { ...d.jobs[0], schedule: { kind: "fortnightly" } as Job["schedule"] };
  expect(() => assertData(d)).toThrow(
    /jobs\[0\]\.schedule\.kind: must be one of \[cron\|every\|after\|once\|event\]/,
  );
});

test("once delayMinutes is bounded 1..525600", () => {
  const d = oneJob();
  d.jobs[0] = { ...d.jobs[0], schedule: { kind: "once", delayMinutes: 0 } };
  expect(() => assertData(d)).toThrow(/jobs\[0\]\.schedule\.delayMinutes: must be an integer 1\.\.525600/);
});

test("spendCap must be a non-negative number or 'off'", () => {
  const d = oneJob();
  d.jobs[0] = { ...d.jobs[0], spendCap: -1 };
  expect(() => assertData(d)).toThrow(/jobs\[0\]\.spendCap: must be a non-negative number or "off"/);
});

test("updatedAt must not precede createdAt", () => {
  const d = oneJob();
  const j = d.jobs[0];
  d.jobs[0] = { ...j, updatedAt: NOW - 1000 };
  expect(() => assertData(d)).toThrow(/jobs\[0\]\.updatedAt: must not precede jobs\[0\]\.createdAt/);
});

test("duplicate job ids are rejected", () => {
  const d = oneJob();
  const first = addJob(d, validJob(), NOW).data;
  first.jobs[1] = { ...first.jobs[1], id: first.jobs[0].id };
  expect(() => assertData(first)).toThrow(/jobs\[1\]\.id: duplicate job id/);
});

test("run.taskId must resolve to a live job", () => {
  const d = oneJob();
  const withRun = plantRun(d, {
    taskId: 999,
    kind: "schedule",
    status: "ok",
    startedAt: NOW,
    endedAt: null,
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 0,
    turns: 0,
    error: null,
  });
  expect(() => assertData(withRun)).toThrow(/runs\[0\]\.taskId: unknown task 999/);
});

test("run.status is the closed seven-status set", () => {
  const d = oneJob();
  const withRun = plantRun(d, {
    taskId: 1,
    kind: "schedule",
    status: "exploded" as never,
    startedAt: NOW,
    endedAt: null,
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 0,
    turns: 0,
    error: null,
  });
  expect(() => assertData(withRun)).toThrow(
    /runs\[0\]\.status: must be one of \[ok\|failed\|capped\|schema-invalid\|loop-guard\|budget-throttled\|draining\]/,
  );
});

test("the nextId high-water law holds", () => {
  const d = oneJob();
  d.nextId = 1; // drift BELOW the mark (max+1 = 2)
  expect(() => assertData(d)).toThrow(/data\.nextId: must be at least the high-water mark 2/);
});

test("an empty document's mark is 0 (nothing taken yet)", () => {
  expect(() => assertData(emptyData())).not.toThrow();
});

test("DomainInvariantError is the thrown type", () => {
  const d = oneJob();
  const broken = { ...d } as FugueData;
  broken.jobs[0] = { ...broken.jobs[0], title: "" } as Job;
  expect(() => assertData(broken)).toThrow(DomainInvariantError);
});
