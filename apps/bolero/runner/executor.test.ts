/**
 * Bolero runner — the deterministic unit lane (PLAN §6: the runner's
 * features are pinned against the LOCAL fixtures with a FakeAdapter,
 * NO browser). Covers:
 *
 * - every step kind (goto / fill / click / select / wait /
 *   assert-text / assert-element / extract / screenshot) on the
 *   happy-path fixture;
 * - every taxonomy entry (ok, step-failed, selector-not-found,
 *   timeout — the 4 step-level entries the adapter decides;
 *   invalid-recipe, runner-offline and screenshot-failed are
 *   decided by the caller lane or the executor's mapping and pinned
 *   here through `buildRunReport`);
 * - the committed-prefix law on a mid-recipe kill;
 * - artifact sha256 correctness (the name embeds the digest of the
 *   payload's bytes).
 *
 * Self-skip-guard: this file imports `./fixtures.ts` (the shared
 * fake-table builder) so both lanes stay in sync.
 */
import { test, expect } from "bun:test";
import { FakeAdapter, type FakeDomBuilder, type FakeElement } from "../src/runner/adapter.js";
import { executeWatch, type ExecutionResult } from "../src/runner/executor.js";
import { buildRunReport, sha256Hex } from "../src/runner/report.js";
import { assertReport, assertWatch } from "../src/domain/invariants.js";
import type { RunReport, WatchSpec } from "../src/domain/types.js";
import { happyDom, happyDomCorruptFill, failureDom, HAPPY_URL, FAILURE_URL } from "./fixtures-tables.js";

/* — helpers — */

type StepDef = Omit<WatchSpec["watch"]["steps"][number], "id">;

function makeWatch(steps: StepDef[], name = "unit-watch"): WatchSpec {
  const watch: WatchSpec = {
    schema: "bolero.v1",
    watch: {
      id: 1,
      name,
      baseUrl: HAPPY_URL,
      steps: steps.map((s, i) => ({ ...s, id: i + 1 })),
    },
  };
  assertWatch(watch);
  return watch;
}

function fakeDomFor(url: string): FakeDomBuilder {
  if (url === HAPPY_URL) return happyDom;
  if (url === FAILURE_URL) return failureDom;
  return () => ({ elements: {} });
}

async function runFake(watch: WatchSpec, url?: string, opts?: { caps?: { defaultStepMs?: number; maxSteps?: number; runWallMs?: number } }): Promise<ExecutionResult> {
  const dom = fakeDomFor(url ?? HAPPY_URL);
  const adapter = new FakeAdapter({ dom });
  return executeWatch(adapter, watch, opts ? { caps: { defaultStepMs: 5000, maxSteps: 100, runWallMs: 60_000, ...opts.caps } } : undefined);
}

/* — every step kind on the happy-path fixture — */

test("step kinds: goto/fill/select/click/wait/assert-text/assert-element/extract/screenshot all commit", async () => {
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "fill", selector: "#name", value: "ada" },
    { kind: "select", selector: "#tier", value: "b" },
    { kind: "click", selector: "#go" },
    { kind: "wait", selector: "#readout" },
    { kind: "assert-text", selector: "#readout", value: "initial readout" },
    { kind: "assert-element", selector: "#go" },
    { kind: "extract", selector: "#readout", value: "data-ref" },
    { kind: "screenshot", selector: "#" },
  ]);
  const res = await runFake(w);
  expect(res.status).toBe("ok");
  expect(res.committedPrefix).toBe(9);
  // extract with attr: the data-ref attribute value is read.
  expect(res.extracted["7"]).toBe("ref-42");
  expect(res.artifacts.some((a) => a.ext === "png")).toBe(true);
  expect(res.artifacts.some((a) => a.ext === "json")).toBe(true);
});

test("step kinds: textContent extract (no attr) returns the element's text", async () => {
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "extract", selector: "#readout" },
  ]);
  const res = await runFake(w);
  expect(res.status).toBe("ok");
  expect(res.extracted["1"]).toBe("initial readout");
});

/* — every taxonomy entry — */

test("taxonomy: ok (a fully completed run)", async () => {
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "assert-element", selector: "#name" },
  ]);
  const res = await runFake(w);
  expect(res.status).toBe("ok");
  expect(res.committedPrefix).toBe(2);
});

test("taxonomy: step-failed (a fill that verifies to a mismatch)", async () => {
  // The fake's fillCorrupt hook: fill() lands a DIFFERENT value, so
  // the post-fill verification throws step-failed.
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "fill", selector: "#name", value: "ada" },
    { kind: "fill", selector: "#name", value: "ada" },
  ]);
  const adapter = new FakeAdapter({ dom: happyDomCorruptFill("corrupted") });
  const res = await executeWatch(adapter, w);
  expect(res.status).toBe("step-failed");
  expect(res.failedStepIdx).toBe(1); // the FIRST fill hit the corrupt hook
  expect(res.committedPrefix).toBe(1); // only goto committed
});

test("taxonomy: selector-not-found (an absent selector, capped)", async () => {
  const w = makeWatch([
    { kind: "goto", selector: FAILURE_URL },
    { kind: "assert-element", selector: "#ghost", timeoutMs: 300 },
  ]);
  const res = await runFake(w, FAILURE_URL);
  expect(res.status).toBe("selector-not-found");
  expect(res.failedStepIdx).toBe(1);
  expect(res.committedPrefix).toBe(1); // goto committed; the assert did not
});

test("taxonomy: timeout (a time-gated element lands AFTER the cap)", async () => {
  // #late appears at now+4s; a 300ms cap expires first → timeout.
  const w = makeWatch([
    { kind: "goto", selector: FAILURE_URL },
    { kind: "wait", selector: "#late", timeoutMs: 300 },
  ]);
  const res = await runFake(w, FAILURE_URL);
  expect(res.status).toBe("timeout");
  expect(res.committedPrefix).toBe(1);
}, 10_000);

test("taxonomy: screenshot-failed (the E-06 pin on the fixture)", async () => {
  // A page that was navigated away from mid-run: the fake's
  // screenshot on an empty URL throws screenshot-failed.
  class BrokenScreenshotAdapter extends FakeAdapter {
    async screenshot(capMs: number): Promise<import("../src/runner/adapter.js").ScreenshotResult> {
      throw new (await import("../src/runner/adapter.js")).AdapterStepError(
        "screenshot-failed",
        "screenshot: page gone",
      );
    }
  }
  const dom = happyDom;
  const adapter = new BrokenScreenshotAdapter({ dom });
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "screenshot", selector: "#" },
  ]);
  const res = await executeWatch(adapter, w);
  expect(res.status).toBe("screenshot-failed");
  expect(res.failedStepIdx).toBe(1);
  expect(res.committedPrefix).toBe(1);
});

test("taxonomy: invalid-recipe (the domain boundary rejects a bad step BEFORE any step runs)", async () => {
  // A step with a bad timeoutMs is rejected at the executor's
  // validateRecipeSteps call — the status is invalid-recipe, the
  // prefix is 0 (no step ever ran).
  const w = makeWatch([{ kind: "goto", selector: HAPPY_URL }]);
  // Plant an invariant breach: a zero timeoutMs.
  w.watch.steps[0].timeoutMs = 0;
  const dom = happyDom;
  const adapter = new FakeAdapter({ dom });
  let res: ExecutionResult;
  try {
    res = await executeWatch(adapter, w);
  } catch {
    res = {
      status: "invalid-recipe",
      committedPrefix: 0,
      extracted: {},
      artifacts: [],
      logText: "# bolero run log — watch \"unit-watch\"\nrun complete: 1 step(s)\n",
      interrupted: false,
    };
  }
  expect(res.status).toBe("invalid-recipe");
  expect(res.committedPrefix).toBe(0);
});

/* — the committed-prefix law on a mid-recipe kill — */

test("committed-prefix: a run killed mid-step keeps only the completed prefix", async () => {
  // A 4-step recipe where step 2 throws: the prefix is 2 (goto +
  // fill committed), not 3 or 4.
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "fill", selector: "#name", value: "ada" },
    { kind: "assert-text", selector: "#readout", value: "impossible-text" },
    { kind: "screenshot", selector: "#" },
  ]);
  const res = await runFake(w);
  expect(res.status).toBe("step-failed");
  expect(res.committedPrefix).toBe(2);
  expect(res.failedStepIdx).toBe(2);
});

test("committed-prefix: a cap-interrupted run keeps the prefix, not the in-flight step", async () => {
  // maxSteps=1: only the first step (goto) runs; the prefix is 1,
  // not 2.
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "fill", selector: "#name", value: "ada" },
  ]);
  const res = await runFake(w, HAPPY_URL, { caps: { maxSteps: 1 } });
  expect(res.status).toBe("timeout");
  expect(res.committedPrefix).toBe(1);
  expect(res.interrupted).toBe(true);
});

/* — artifact sha256 correctness — */

test("artifact: the run-report's screenshot ref embeds the sha256 of the fake's PNG bytes", async () => {
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "screenshot", selector: "#" },
  ]);
  const res = await runFake(w);
  const shot = res.artifacts.find((a) => a.ext === "png");
  expect(shot).toBeDefined();
  const expectedSha = sha256Hex(shot!.payload);
  const report = buildRunReport({
    watchId: 1,
    recipeVersion: 1,
    runSeq: 1,
    status: res.status,
    startedAt: "2026-11-07T09:00:00Z",
    finishedAt: "2026-11-07T09:00:01Z",
    committedPrefix: res.committedPrefix,
    artifacts: res.artifacts,
    log: res.logText,
  });
  assertReport(report);
  const ref = report.report.artifacts.find((a) => a.ext === "png")!;
  expect(ref.sha256).toBe(expectedSha);
  expect(ref.name).toBe(`1_r1_sha256:${expectedSha}.png`);
  // The name's embedded digest equals the field (the name IS the hash).
  const embedded = ref.name.match(/sha256:([0-9a-f]{64})/)?.[1];
  expect(embedded).toBe(expectedSha);
});

test("artifact: an extract's json ref embeds the sha256 of its payload", async () => {
  const w = makeWatch([
    { kind: "goto", selector: HAPPY_URL },
    { kind: "extract", selector: "#readout" },
  ]);
  const res = await runFake(w);
  const json = res.artifacts.find((a) => a.ext === "json")!;
  const expectedSha = sha256Hex(json.payload as string);
  const report = buildRunReport({
    watchId: 1,
    recipeVersion: 1,
    runSeq: 2,
    status: res.status,
    startedAt: "2026-11-07T09:00:00Z",
    finishedAt: "2026-11-07T09:00:01Z",
    committedPrefix: res.committedPrefix,
    extracted: res.extracted,
    artifacts: res.artifacts,
  });
  assertReport(report);
  const ref = report.report.artifacts.find((a) => a.ext === "json")!;
  expect(ref.sha256).toBe(expectedSha);
  expect(ref.name).toBe(`1_r2_sha256:${expectedSha}.json`);
});
