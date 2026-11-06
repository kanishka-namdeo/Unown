/**
 * io test — the canonical-JSON + schema-gate pins (house pattern from
 * Chaconne's io test, Ostinato byte-stability law):
 *  - serialize twice → byte-identical (round-trip byte-stability)
 *  - round-trip import(export(d)) deep-equal
 *  - planted drift (invariant breach on a fugue.v1 doc) → structured
 *    dry-run refusal, never a mid-parse throw, store unchanged
 *  - foreign/future schema → "foreign-schema" refusal with the report
 */
import { test, expect } from "bun:test";
import {
  exportFugue,
  parseFugue,
  toCanonicalJson,
  SCHEMA_VERSION,
} from "./io.js";
import { emptyData, addJob, addRun } from "./model.js";
import type { FugueData, Job } from "./types.js";

const NOW = 1762454400000; // 2026-11-07T00:00:00Z in epoch ms

function fixtureData(): FugueData {
  const input = {
    title: "nightly café ① ②",
    prompt: "summarize",
    schedule: { kind: "cron", expr: "0 9 * * 1-5" } as Job["schedule"],
    mode: "read-only" as const,
    model: "agnes-3.0-flash",
    timezone: "",
    misfire: "skip" as const,
    spendCap: "off" as const,
  };
  let d = addJob(emptyData(), input, NOW).data;
  d = addRun(d, {
    taskId: d.jobs[0].id,
    kind: "schedule",
    status: "ok",
    startedAt: NOW,
    endedAt: NOW + 120_000,
    tokensIn: 1200,
    tokensOut: 340,
    toolCalls: 4,
    turns: 2,
    error: null,
  }, NOW + 180_000).data;
  return d;
}

test("canonical JSON: serialize twice → byte-identical", () => {
  const a = toCanonicalJson(fixtureData());
  const b = toCanonicalJson(fixtureData());
  expect(a).toBe(b);
});

test("canonical JSON: keys are sorted deep, arrays keep index order", () => {
  const s = toCanonicalJson(fixtureData());
  // top-level sorted keys: jobs < nextId < runs < schema
  const iJobs = s.indexOf('"jobs"');
  const iNext = s.indexOf('"nextId"');
  const iRuns = s.indexOf('"runs"');
  const iSchema = s.indexOf('"schema"');
  expect(iJobs).toBeLessThan(iNext);
  expect(iNext).toBeLessThan(iRuns);
  expect(iRuns).toBeLessThan(iSchema);
  // run record keys sorted: endedAt < error < id < kind < startedAt
  const runStart = s.indexOf('"runs"');
  const rec = s.slice(runStart);
  expect(rec.indexOf('"endedAt"')).toBeLessThan(rec.indexOf('"error"'));
  expect(rec.indexOf('"error"')).toBeLessThan(rec.indexOf('"id"'));
  expect(rec.indexOf('"id"')).toBeLessThan(rec.indexOf('"kind"'));
});

test("round-trip: parse(export(d)) is deep-equal AND byte-stable", () => {
  const d = fixtureData();
  const bytes = exportFugue(d);
  const out = parseFugue(bytes);
  expect(out.ok).toBe(true);
  if (out.ok) {
    // the imported document is semantically identical; re-exporting it
    // through the canonical serializer yields the SAME bytes
    // (byte-stability law). The input document d may carry insertion-
    // order keys — only the CANONICAL bytes are stable.
    expect(exportFugue(out.data)).toBe(bytes);
  }
});

test("planted drift: invariant breach on a fugue.v1 doc → dry-run refusal", () => {
  const d = fixtureData();
  const doc = JSON.parse(exportFugue(d)) as FugueData;
  doc.jobs[0].title = ""; // plant a drift: non-empty title law
  const out = parseFugue(JSON.stringify(doc));
  expect(out.ok).toBe(false);
  if (!out.ok) {
    expect(out.reason).toBe("invariant");
    expect(out.details).toContain("jobs[0].title");
  }
  // the store is unchanged — the healthy document still round-trips
  const healthy = parseFugue(exportFugue(d));
  expect(healthy.ok).toBe(true);
});

test("foreign schema (fugue.v2 / a different app) → foreign-schema refusal", () => {
  const doc = JSON.parse(exportFugue(fixtureData())) as Record<string, unknown>;
  doc.schema = "fugue.v2"; // a FUTURE schema
  const out = parseFugue(JSON.stringify(doc));
  expect(out.ok).toBe(false);
  if (!out.ok) {
    expect(out.reason).toBe("foreign-schema");
    expect(out.schema).toBe("fugue.v2");
    expect(out.details).toContain("no partial import");
  }
  // an absent schema literal is refused the same way
  delete doc.schema;
  const out2 = parseFugue(JSON.stringify(doc));
  expect(out2.ok).toBe(false);
  if (!out2.ok) expect(out2.reason).toBe("foreign-schema");
  // a DIFFERENT app's schema is refused, never imported
  doc.schema = "chaconne.v1";
  const out3 = parseFugue(JSON.stringify(doc));
  expect(out3.ok).toBe(false);
  if (!out3.ok) expect(out3.schema).toBe("chaconne.v1");
});

test("not-JSON and non-object roots are refused with the structured report", () => {
  const bad = parseFugue("{not json");
  expect(bad.ok).toBe(false);
  if (!bad.ok) expect(bad.reason).toBe("not-json");
  const arr = parseFugue("[1,2]");
  expect(arr.ok).toBe(false);
  if (!arr.ok) expect(arr.reason).toBe("not-json");
});

test("the accepted schema literal is fugue.v1", () => {
  expect(SCHEMA_VERSION).toBe("fugue.v1");
  const out = parseFugue(exportFugue(fixtureData()));
  expect(out.ok).toBe(true);
});
