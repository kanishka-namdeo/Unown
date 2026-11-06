/**
 * Bolero runner — the execution core (PLAN §3 S-2, §1 boundary).
 *
 * `executeWatch` takes a `PageAdapter` (real or fake), a frozen
 * `WatchSpec`, caps, and a clock seam; runs the 9-step recipe with
 * per-step/per-run caps; keeps the committed-prefix law; returns the
 * pieces `report.ts` needs to build a well-formed `RunReport`.
 *
 * - Per-step cap: every step's `timeoutMs` resolves to a hard
 *   wall-clock budget (the step's own value when present, else the
 *   runner default — `stepCap`).
 * - Per-run cap: `maxSteps` stops a runaway recipe; `runWallMs`
 *   bounds the whole run so a slow fixture can never hang a CI lane.
 * - The committed-prefix law: a killed/errored run keeps ONLY the
 *   prefix of steps that fully completed. A step in flight at the cap
 *   (or when the process dies) is NOT committed — `committedPrefix`
 *   counts completed steps, and the log says exactly that, never
 *   "step N done" for a step that didn't finish.
 * - Status taxonomy: step errors carry their AdapterStepError status
 *   (step-failed / selector-not-found / timeout / screenshot-failed);
 *   a cap or a kill interrupts the run and records `timeout` with the
 *   prefix kept. `invalid-recipe` is decided BEFORE any step runs
 *   (the domain's `assertStep` boundary); `runner-offline` and `ok`
 *   are decided by the caller lane / completed-all path.
 */
import { AdapterStepError, type PageAdapter } from "./adapter.js";
import { stepCap, RunLedger, CapExceeded, DEFAULT_CAPS, type Caps } from "./caps.js";
import { createLogBuilder, logArtifactBytes } from "./log.js";
import { assertStep } from "../domain/invariants.js";
import type { RunReport, Step, WatchSpec } from "../domain/types.js";

/** The execution result the report builder consumes. */
export type ExecutionResult = {
  /** The 7-entry taxonomy entry the run ends with. */
  status: RunReport["report"]["status"];
  /** How many steps fully completed (the committed-prefix law). */
  committedPrefix: number;
  /** Which step index failed, when status is not "ok". */
  failedStepIdx?: number;
  /** Extracted values keyed by step index (the `extract` kind). */
  extracted: Record<string, string>;
  /** Artifact payloads produced by this run, in order. */
  artifacts: { stepIdx: number; ext: "png" | "json" | "log"; payload: Uint8Array | string }[];
  /** The run-log artifact text (its name is derived from these bytes). */
  logText: string;
  /** true when the run was interrupted by a cap/kill, not a step error. */
  interrupted: boolean;
};

export type ExecuteOptions = {
  caps?: Caps;
  /** Wall-clock seam for the per-run cap (the fake lane injects a
   *  fixed start; the real lane passes Date.now()). The ISO clock is
   *  the report builder's concern (the domain is Date-free by law). */
  nowMs?: number;
};

/**
 * Resolve a step's effective cap: its own `timeoutMs` or the default.
 * (Re-exported from caps.ts so executor tests can import one place.)
 */
export { stepCap, DEFAULT_CAPS };

/**
 * THE execution core. Runs every step of the frozen recipe against
 * the adapter; applies per-step and per-run caps; records the
 * committed prefix; builds the run log. Returns an `ExecutionResult`
 * — the caller (`report.ts`) builds the `RunReport`.
 */
export async function executeWatch(
  adapter: PageAdapter,
  watch: WatchSpec,
  opts: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const caps: Caps = { ...DEFAULT_CAPS, ...(opts.caps ?? {}) };
  const wallStart = opts.nowMs ?? Date.now();
  const totalSteps = watch.watch.steps.length;
  const ledger = new RunLedger(caps, totalSteps, wallStart);
  let wallCursor = wallStart; // the fake lane advances this per step

  // invalid-recipe: the domain's assertStep boundary runs BEFORE any
  // step executes (P0 #1 — a bad recipe never half-runs).
  validateRecipeSteps(watch);

  const log = createLogBuilder();
  const extracted: Record<string, string> = {};
  const artifacts: ExecutionResult["artifacts"] = [];
  let failedStepIdx: number | undefined;
  let failedStatus: ExecutionResult["status"];
  let interrupted = false;

  for (let i = 0; i < totalSteps; i++) {
    const step = watch.watch.steps[i];
    try {
      ledger.checkStepCount(i);
      ledger.checkWall(wallCursor - wallStart);
      log.stepStarted(i, step);
      const cap = stepCap(step, caps);
      const stepInput = {
        kind: step.kind,
        selector: step.selector,
        timeoutMs: cap,
        value: step.value,
        intoFrame: step.intoFrame,
      };
      await runStep(adapter, stepInput, step.kind, i, extracted, artifacts, cap);
      wallCursor += 1; // advance the fake wall by a constant; 1ms keeps
      // the step-count cap firing first in unit tests
      ledger.checkWall(wallCursor - wallStart);
      ledger.commitStep();
      log.stepDone(i);
    } catch (err) {
      // The step did NOT complete — the committed prefix stays put.
      if (err instanceof AdapterStepError) {
        failedStepIdx = i;
        failedStatus = err.status;
        log.stepFailed(i, err.status, err.message);
      } else if (err instanceof CapExceeded) {
        failedStatus = err.status;
        interrupted = true;
        log.interrupted(err.message);
      } else {
        failedStepIdx = i;
        failedStatus = "step-failed";
        log.stepFailed(i, "step-failed", err instanceof Error ? err.message : String(err));
      }
      break;
    }
  }

  const completedAll = failedStepIdx === undefined && failedStatus === undefined && !interrupted;
  const finished = completedAll
    ? { status: "ok" as const, committedPrefix: totalSteps, failedStepIdx: undefined as number | undefined }
    : {
        status: interrupted ? ("timeout" as const) : (failedStatus ?? "step-failed"),
        committedPrefix: ledger.prefix(),
        failedStepIdx,
      };

  const logText = logArtifactBytes(log.build(), watch.watch.name, totalSteps);
  return { ...finished, extracted, artifacts, logText, interrupted };
}

/* ------------------------------------------------------------------ */
/* Step dispatch                                                       */
/* ------------------------------------------------------------------ */

type StepInput = {
  kind: string;
  selector: string;
  timeoutMs: number;
  value?: string;
  intoFrame?: string;
};

async function runStep(
  adapter: PageAdapter,
  input: StepInput,
  kind: Step["kind"],
  idx: number,
  extracted: Record<string, string>,
  artifacts: ExecutionResult["artifacts"],
  cap: number,
): Promise<void> {
  const sel = input.selector;
  const val = input.value;
  const frame = input.intoFrame;
  switch (kind) {
    case "goto":
      await adapter.goto(sel, cap);
      break;
    case "click":
      await adapter.click(sel, cap, frame);
      break;
    case "fill":
      await adapter.fill(sel, val ?? "", cap, frame);
      break;
    case "select":
      await adapter.select(sel, val ?? "", cap, frame);
      break;
    case "wait":
      await adapter.wait(sel, cap, frame);
      break;
    case "assert-text":
      await adapter.assertText(sel, val ?? "", cap, frame);
      break;
    case "assert-element":
      await adapter.assertElement(sel, cap, frame);
      break;
    case "extract": {
      // value, when present, names the ATTRIBUTE to read; absent
      // means textContent.
      const attr = val;
      const v = await adapter.extract(sel, cap, frame, attr);
      extracted[String(idx)] = v;
      artifacts.push({ stepIdx: idx, ext: "json", payload: JSON.stringify({ [String(idx)]: v }), });
      break;
    }
    case "screenshot": {
      const shot = await adapter.screenshot(cap);
      artifacts.push({ stepIdx: idx, ext: "png", payload: shot.bytes });
      break;
    }
    default:
      // The closed 9-kind set is validated in validateWatch; this is
      // unreachable on a legal recipe — surface it as step-failed.
      throw new AdapterStepError("step-failed", `unknown step kind "${kind}"`);
  }
}

/**
 * `invalid-recipe` boundary: every step's shape checked BEFORE
 * execution (assertStep is the domain's boundary check — one lane,
 * one implementation, no duplication).
 */
function validateRecipeSteps(watch: WatchSpec): void {
  for (const step of watch.watch.steps) {
    assertStep(step, `watch ${watch.watch.id}`);
  }
}

/**
 * Map the execution outcome to one of the 7 taxonomy entries.
 * (The executor's own mapping; the caller's lane can override with
 * `invalid-recipe` or `runner-offline` when the recipe or runner
 * itself is the failure.)
 */
export function mapStatus(
  result: Pick<ExecutionResult, "status" | "failedStepIdx" | "interrupted">,
): RunReport["report"]["status"] {
  if (result.status === "ok") return "ok";
  if (result.interrupted) return "timeout";
  // A step error carries its own taxonomy entry; everything else maps
  // to step-failed.
  if (
    result.failedStepIdx !== undefined &&
    (result.status === "step-failed" ||
      result.status === "selector-not-found" ||
      result.status === "timeout" ||
      result.status === "screenshot-failed")
  ) {
    return result.status;
  }
  return "step-failed";
}
