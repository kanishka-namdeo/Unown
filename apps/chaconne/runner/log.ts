/**
 * Chaconne runner — the run-log artifact (PLAN §1: "honest
 * step-by-step log + error-taxonomy entries").
 *
 * The log is the artifact the run record points at. Honesty rules:
 * - one line per step, in order, numbered from 1 (human index) with
 *   the step's kind and selector — a reader can map lines to recipe
 *   steps without re-deriving.
 * - the prefix LAW: lines for steps that did not fully complete are
 *   NEVER written as done. A cap or a kill stops the log at the last
 *   completed step and appends ONE honest interruption line.
 * - error-taxonomy entries: a failed step gets a `status:` line naming
 *   the taxonomy entry (step-failed / selector-not-found / timeout /
 *   invalid-recipe) and the adapter's detail.
 *
 * The log bytes are content-addressed like every artifact (store.ts),
 * so identical runs dedupe and a name collision cannot clobber.
 */
import type { RunRecord, Step } from "../src/domain/types.js";

export type LogLine = {
  stepIdx?: number; // 0-based recipe index, when a step was reached
  kind?: string;
  selector?: string;
  ok?: boolean;
  status?: string; // taxonomy entry on the failure line
  detail?: string;
};

export type RunLog = {
  lines: LogLine[];
  /** true when the run stopped by cap/kill instead of ok/error. */
  interrupted: boolean;
};

export function renderRunLog(log: RunLog, recipeName: string, totalSteps: number): string {
  const out: string[] = [`# chaconne run log — "${recipeName}"`];
  for (const line of log.lines) {
    if (line.status !== undefined) {
      // The taxonomy / interruption line (last line of a failed run).
      out.push(`  status: ${line.status}${line.detail ? ` — ${line.detail}` : ""}`);
    } else if (line.ok === undefined) {
      // Reached but never completed (the interrupted prefix tail).
      const idx = line.stepIdx ?? 0;
      out.push(`step ${idx !== undefined ? idx + 1 : "?"}/${totalSteps} (${line.kind ?? "?"}) ${line.selector ?? ""} — started, not completed`);
    } else if (line.ok) {
      const idx = line.stepIdx ?? 0;
      out.push(`step ${idx + 1}/${totalSteps} (${line.kind}) ${line.selector ?? ""} — ok${line.detail ? ` (${line.detail})` : ""}`);
    } else {
      const idx = line.stepIdx ?? 0;
      out.push(`step ${idx + 1}/${totalSteps} (${line.kind}) ${line.selector ?? ""} — FAILED`);
    }
  }
  out.push(
    log.interrupted
      ? `run interrupted: committed prefix kept; steps after were not executed`
      : `run complete: ${totalSteps} step(s)`,
  );
  return out.join("\n") + "\n";
}

export type LogBuilder = {
  stepStarted(stepIdx: number, step: Step): void;
  stepDone(stepIdx: number, detail?: string): void;
  stepFailed(stepIdx: number, status: string, detail?: string): void;
  interrupted(detail?: string): void;
  finishOk(totalSteps: number): void;
  build(): RunLog;
};

/** The append-only builder the runner core drives. */
export function createLogBuilder(): LogBuilder {
  let lines: LogLine[] = [];
  let interrupted = false;
  /** The pending step entry (stepIdx/kind/selector), carried into the done/failed line. */
  let pending: LogLine | undefined;

  function flushPending(): void {
    if (pending !== undefined) {
      // Reached but never finished → the honest "started, not completed".
      lines.push({ ...pending });
      pending = undefined;
    }
  }

  return {
    stepStarted(stepIdx: number, step: Step) {
      flushPending();
      pending = { stepIdx, kind: step.kind, selector: step.selector };
    },
    stepDone(stepIdx: number, detail?: string) {
      if (pending === undefined || pending.stepIdx !== stepIdx) {
        throw new Error(`log: done(${stepIdx}) before start`);
      }
      lines.push({ ...pending, ok: true, detail });
      pending = undefined;
    },
    stepFailed(stepIdx: number, status: string, detail?: string) {
      if (pending === undefined || pending.stepIdx !== stepIdx) {
        throw new Error(`log: failed(${stepIdx}) before start`);
      }
      lines.push({ ...pending, ok: false, detail });
      lines.push({ status, detail });
      pending = undefined;
    },
    interrupted(detail?: string) {
      flushPending();
      interrupted = true;
      lines.push({ status: "timeout", detail: detail ? `interrupted: ${detail}` : "interrupted" });
    },
    finishOk(totalSteps: number) {
      if (interrupted) throw new Error("log: finishOk after interrupted");
      const doneLines = lines.filter((l) => l.ok === true).length;
      if (doneLines !== totalSteps) {
        throw new Error(`log: ${doneLines} done-line(s) for ${totalSteps} step(s)`);
      }
    },
    build() {
      flushPending();
      return { lines: [...lines], interrupted };
    },
  };
}

/** Serialize the log into its artifact payload (the store content-addresses it). */
export function logArtifactBytes(log: RunLog, recipeName: string, totalSteps: number): string {
  return renderRunLog(log, recipeName, totalSteps);
}

/**
 * The run's status when a CAP (not a step error) stops execution —
 * the taxonomy entry for every cap/interruption path is `timeout`
 * (a cap IS a timed stop; the step-count cap reports as such too, and
 * the run record's detail line carries the reason).
 */
export function capStatus(): RunRecord["status"] {
  return "timeout";
}
