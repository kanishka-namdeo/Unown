/**
 * Bolero runner — per-step + per-run caps and the committed-prefix law
 * (PLAN §1/§5 edge cases 1 & 5; the Chaconne `RunLedger` re-adopted).
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
import type { Step } from "../domain/types.js";

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
      throw new CapExceeded(`run wall cap ${this.caps.runWallMs}ms exceeded`);
    }
  }

  /** Per-run step-count check: a step PAST maxSteps is never started. */
  checkStepCount(stepIdx: number): void {
    if (stepIdx >= this.caps.maxSteps) {
      throw new CapExceeded(`max steps ${this.caps.maxSteps} exceeded (step ${stepIdx + 1} not started)`);
    }
    if (stepIdx >= this.totalSteps) {
      throw new CapExceeded(`step ${stepIdx + 1} is past the recipe's ${this.totalSteps} steps`);
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

  /** Elapsed wall budget consumed so far. */
  wallConsumed(nowMs: number): number {
    return nowMs - this.startedAtMs;
  }
}

/** A cap boundary crossed — the run stops and records its prefix. */
export class CapExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapExceeded";
  }
}
