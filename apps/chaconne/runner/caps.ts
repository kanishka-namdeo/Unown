/**
 * Chaconne runner — per-step + per-run caps and the committed-prefix
 * law (PLAN §1/§5 edge cases 1 & 5).
 *
 * - Per-step cap: every step's `timeoutMs` resolves to a hard wall-clock
 *   budget (the step's own value when present, else the runner default).
 * - Per-run cap: `maxSteps` stops a runaway recipe; `runWallMs` bounds
 *   the whole run so a slow fixture can never hang a CI lane.
 * - The committed-prefix law: a killed/errored run keeps ONLY the
 *   prefix of steps that fully completed. A step in flight at the cap
 *   (or when the process dies) is NOT committed — the run record's
 *   `committedPrefix` counts completed steps, and the log says exactly
 *   that, never "step N done" for a step that didn't finish.
 */
import type { RunStatus, Step } from "../src/domain/types.js";

/** The runner's cap configuration (the CLI fills it in from flags/env). */
export type Caps = {
  /** default per-step cap in ms, when a step declares no `timeoutMs`. */
  defaultStepMs: number;
  /** hard per-run cap on the number of steps executed. */
  maxSteps: number;
  /** hard per-run wall-clock budget in ms. */
  runWallMs: number;
};

/** Sensible defaults (the fixture pages are designed around them). */
export const DEFAULT_CAPS: Caps = {
  defaultStepMs: 5000,
  maxSteps: 100,
  runWallMs: 60_000,
};

/** Resolve a step's effective cap: its own `timeoutMs` or the default. */
export function stepCap(step: Pick<Step, "timeoutMs">, caps: Caps): number {
  return step.timeoutMs !== undefined ? step.timeoutMs : caps.defaultStepMs;
}

export type StepOutcome = {
  stepIdx: number;
  /** true only when EVERY effect of the step completed (value landed, etc). */
  committed: boolean;
  /** the step's status line for the run log (log.ts). */
  status: RunStatus | "running";
  detail?: string;
};

/**
 * A single run's execution ledger — the committed-prefix law in one
 * place. `record` is called at each boundary; `prefix()` is always
 * "how many steps FULLY completed", which is the value that lands in
 * the run record, whether the run finished ok, errored, or was killed.
 */
export class RunLedger {
  private committed = 0;
  readonly startedAtMs: number;

  constructor(private readonly caps: Caps, private readonly totalSteps: number, private readonly wallStartMs: number) {
    this.startedAtMs = wallStartMs;
  }

  /** Per-run wall check: throw `timeout` when the budget is spent. */
  checkWall(elapsedMs: number): void {
    if (elapsedMs > this.caps.runWallMs) {
      throw new CapExceeded("timeout", `run wall cap ${this.caps.runWallMs}ms exceeded`);
    }
  }

  /** Per-run step-count check: a step PAST maxSteps is never started. */
  checkStepCount(stepIdx: number): void {
    if (stepIdx >= this.caps.maxSteps) {
      throw new CapExceeded("timeout", `max steps ${this.caps.maxSteps} exceeded (step ${stepIdx + 1} not started)`);
    }
    if (stepIdx >= this.totalSteps) {
      throw new CapExceeded("timeout", `step ${stepIdx + 1} is past the recipe's ${this.totalSteps} steps`);
    }
  }

  /** A step fully completed → the prefix advances exactly one. */
  commitStep(): void {
    this.committed += 1;
  }

  /** The committed-prefix law: steps FULLY completed, nothing more. */
  prefix(): number {
    return this.committed;
  }

  /**
   * Elapsed wall budget consumed so far (injected clock keeps tests
   * deterministic; the runner core passes `nowMs - wallStartMs`).
   */
  wallConsumed(nowMs: number): number {
    return nowMs - this.wallStartMs;
  }
}

/** A cap boundary crossed — the run stops and records its prefix. */
export class CapExceeded extends Error {
  constructor(
    public readonly status: "timeout",
    message: string,
  ) {
    super(message);
    this.name = "CapExceeded";
  }
}

/**
 * The final-run-record helper: given where a run stopped, the status +
 * committed prefix that land in the store. The law in one function:
 * - completed all steps → "ok", prefix = total
 * - a step threw an AdapterStepError → its taxonomy status, prefix =
 *   completed steps BEFORE that one (the failed step is not committed)
 * - a cap (or a kill) interrupted → "timeout", prefix as-kept
 */
export function finishRunRecord(args: {
  totalSteps: number;
  prefix: number;
  /** set when a step itself failed (not a cap). */
  failedStepIdx?: number;
  failedStatus?: RunStatus;
}): Pick<RunRecordShape, "status" | "committedPrefix" | "failedStepIdx"> {
  const { totalSteps, prefix, failedStepIdx, failedStatus } = args;
  if (failedStepIdx === undefined) {
    // A cap (or nothing): every failure path that is not a step error
    // is a `timeout` per the taxonomy (the cap kinds are the timeouts).
    return { status: "timeout", committedPrefix: prefix, failedStepIdx: undefined };
  }
  const status: RunStatus = failedStatus ?? "step-failed";
  return { status, committedPrefix: prefix, failedStepIdx };
}

export type RunRecordShape = {
  status: RunStatus;
  committedPrefix: number;
  failedStepIdx?: number;
};
