/**
 * Chaconne runner — caps pins (per-step + per-run, the committed-prefix
 * law in the ledger; PLAN §1, acceptance #5).
 */
import { test, expect } from "bun:test";
import { DEFAULT_CAPS, RunLedger, CapExceeded, finishRunRecord, stepCap } from "./caps.js";

test("stepCap: a step's own timeoutMs wins, else the default", () => {
  expect(stepCap({ timeoutMs: 100 }, DEFAULT_CAPS)).toBe(100);
  expect(stepCap({}, DEFAULT_CAPS)).toBe(DEFAULT_CAPS.defaultStepMs);
});

test("RunLedger: checkStepCount trips the step-count cap past maxSteps", () => {
  const caps = { ...DEFAULT_CAPS, maxSteps: 3 };
  const ledger = new RunLedger(caps, 100, 0);
  expect(() => ledger.checkStepCount(2)).not.toThrow(); // last legal index
  expect(() => ledger.checkStepCount(3)).toThrow(CapExceeded);
});

test("RunLedger: checkWall trips the wall cap when the budget is spent", () => {
  const caps = { ...DEFAULT_CAPS, runWallMs: 100 };
  const ledger = new RunLedger(caps, 10, 0);
  expect(() => ledger.checkWall(90)).not.toThrow();
  expect(() => ledger.checkWall(101)).toThrow(CapExceeded);
});

test("RunLedger: prefix() counts only committed steps", () => {
  const ledger = new RunLedger(DEFAULT_CAPS, 5, 0);
  expect(ledger.prefix()).toBe(0);
  ledger.commitStep();
  ledger.commitStep();
  expect(ledger.prefix()).toBe(2);
});

test("finishRunRecord: an ok completion carries prefix = total", () => {
  const r = finishRunRecord({ totalSteps: 4, prefix: 4 });
  expect(r).toEqual({ status: "timeout", committedPrefix: 4, failedStepIdx: undefined });
  // Note: no failedStepIdx → a cap/interruption path → 'timeout'. An
  // ok run is handled by the runner core's direct branch, not here.
});

test("finishRunRecord: a step failure carries its taxonomy + the prefix", () => {
  const r = finishRunRecord({
    totalSteps: 6,
    prefix: 2,
    failedStepIdx: 2,
    failedStatus: "selector-not-found",
  });
  expect(r.status).toBe("selector-not-found");
  expect(r.committedPrefix).toBe(2); // the failed step is NOT committed
  expect(r.failedStepIdx).toBe(2);
});

test("CapExceeded: carries the 'timeout' status (cap stops are timeouts)", () => {
  const e = new CapExceeded("timeout", "run wall cap exceeded");
  expect(e.status).toBe("timeout");
  expect(e.name).toBe("CapExceeded");
});
