/**
 * types test — pin the closed sets and the fugue.v1 root grammar.
 */
import { test, expect } from "bun:test";
import {
  SCHEDULE_KINDS,
  RUN_STATUSES,
  MODES,
  DomainInvariantError,
} from "./types.js";

test("the five ScheduleSpec kinds are the closed set", () => {
  expect(SCHEDULE_KINDS).toEqual(["cron", "every", "after", "once", "event"]);
});

test("the seven run-statuses are the closed set", () => {
  expect(RUN_STATUSES).toEqual([
    "ok",
    "failed",
    "capped",
    "schema-invalid",
    "loop-guard",
    "budget-throttled",
    "draining",
  ]);
});

test("the two modes are the closed set", () => {
  expect(MODES).toEqual(["read-only", "standard"]);
});

test("DomainInvariantError names itself", () => {
  const e = new DomainInvariantError("x");
  expect(e.name).toBe("DomainInvariantError");
  expect(e.message).toBe("x");
});
