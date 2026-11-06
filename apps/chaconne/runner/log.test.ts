/**
 * Chaconne runner — run-log artifact pins (PLAN §1: honest step-by-step
 * log + error-taxonomy entries; the prefix law surfaces in the log).
 */
import { test, expect } from "bun:test";
import { createLogBuilder, renderRunLog, logArtifactBytes, capStatus } from "./log.js";
import type { Step } from "../src/domain/types.js";

function step(idx: number, kind: Step["kind"] = "goto", selector = "http://x"): Step {
  return { id: idx + 1, kind, selector };
}

test("log: an ok run lists every step done", () => {
  const log = createLogBuilder();
  log.stepStarted(0, step(0, "goto"));
  log.stepDone(0);
  log.stepStarted(1, step(1, "fill"));
  log.stepDone(1, "value=ada");
  log.finishOk(2);
  const out = log.build();
  expect(out.interrupted).toBe(false);
  const text = renderRunLog(out, "demo", 2);
  expect(text).toContain("step 1/2 (goto) http://x — ok");
  expect(text).toContain("step 2/2 (fill) http://x — ok (value=ada)");
  expect(text).toContain("run complete: 2 step(s)");
});

test("log: a failed step carries the taxonomy entry + detail", () => {
  const log = createLogBuilder();
  log.stepStarted(0, step(0, "goto"));
  log.stepDone(0);
  log.stepStarted(1, step(1, "assert-text"));
  log.stepFailed(1, "selector-not-found", "selector not found within 5000ms: #ghost");
  const out = log.build();
  const text = renderRunLog(out, "demo", 2);
  expect(text).toContain("step 2/2 (assert-text) http://x — FAILED");
  expect(text).toContain("status: selector-not-found");
  expect(text).toContain("selector not found within 5000ms: #ghost");
});

test("log: an interrupted run marks the prefix tail 'started, not completed'", () => {
  const log = createLogBuilder();
  log.stepStarted(0, step(0, "goto"));
  log.stepDone(0);
  log.stepStarted(1, step(1, "wait"));
  // The cap/kill lands mid-step 1: the tail line is honest, not done.
  log.interrupted("run wall cap 60000ms exceeded");
  const out = log.build();
  expect(out.interrupted).toBe(true);
  const text = renderRunLog(out, "demo", 2);
  expect(text).toContain("step 2/2 (wait) http://x — started, not completed");
  expect(text).toContain("status: timeout");
  expect(text).toContain("run interrupted: committed prefix kept");
});

test("log: finishOk rejects a step-count mismatch", () => {
  const log = createLogBuilder();
  log.stepStarted(0, step(0, "goto"));
  log.stepDone(0);
  expect(() => log.finishOk(2)).toThrow(); // only 1 done-line for 2 steps
});

test("capStatus(): a cap stop is the taxonomy 'timeout'", () => {
  expect(capStatus()).toBe("timeout");
});

test("logArtifactBytes: the log text is its own artifact payload", () => {
  const log = createLogBuilder();
  log.stepStarted(0, step(0, "goto"));
  log.stepDone(0);
  log.finishOk(1);
  const text = logArtifactBytes(log.build(), "demo", 1);
  expect(text).toContain("# chaconne run log — \"demo\"");
  expect(text.endsWith("\n")).toBe(true);
});
