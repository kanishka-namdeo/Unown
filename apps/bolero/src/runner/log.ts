/**
 * Bolero runner — the run-log artifact (the Chaconne `log.ts`
 * precedent re-adopted: honest step-by-step log, the prefix law,
 * error-taxonomy entries).
 *
 * Honesty rules:
 * - one line per step, in order, numbered from 1 (human index) with
 *   the step's kind and selector — a reader can map lines to recipe
 *   steps without re-deriving.
 * - the prefix LAW: lines for steps that did not fully complete are
 *   NEVER written as done. A cap or a kill stops the log at the last
 *   completed step and appends ONE honest interruption line.
 * - error-taxonomy entries: a failed step gets a `status:` line
 *   naming the taxonomy entry + the adapter's detail.
 */
import type { Step } from "../domain/types.js";

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

export function renderRunLog(log: RunLog, watchName: string, totalSteps: number): string {
  const out: string[] = [`# bolero run log — watch "${watchName}"`];
  for (const line of log.lines) {
    if (line.status !== undefined) {
      out.push(`  status: ${line.status}${line.detail ? ` — ${line.detail}` : ""}`);
    } else if (line.ok === undefined) {
      const idx = line.stepIdx ?? 0;
      out.push(`step ${idx + 1}/${totalSteps} (${line.kind ?? "?"}) ${line.selector ?? ""} — started, not completed`);
    } else if (line.ok) {
      const idx = line.stepIdx ?? 0;
      out.push(`step ${idx + 1}/${totalSteps} (${line.kind}) ${line.selector ?? ""} — ok`);
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
  stepDone(stepIdx: number): void;
  stepFailed(stepIdx: number, status: string, detail?: string): void;
  interrupted(detail?: string): void;
  build(): RunLog;
};

/** The append-only builder the runner core drives. */
export function createLogBuilder(): LogBuilder {
  let lines: LogLine[] = [];
  let interrupted = false;
  /** The pending step entry, carried into the done/failed line. */
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
    stepDone(stepIdx: number) {
      if (pending === undefined || pending.stepIdx !== stepIdx) {
        throw new Error(`log: done(${stepIdx}) before start`);
      }
      lines.push({ ...pending, ok: true });
      pending = undefined;
    },
    stepFailed(stepIdx: number, status: string, detail?: string) {
      if (pending === undefined || pending.stepIdx !== stepIdx) {
        throw new Error(`log: failed(${stepIdx}) before start`);
      }
      lines.push({ ...pending, ok: false });
      lines.push({ status, detail });
      pending = undefined;
    },
    interrupted(detail?: string) {
      flushPending();
      interrupted = true;
      lines.push({ status: "timeout", detail: detail ? `interrupted: ${detail}` : "interrupted" });
    },
    build() {
      flushPending();
      return { lines: [...lines], interrupted };
    },
  };
}

/** Serialize the log into its artifact payload (content-addressed). */
export function logArtifactBytes(log: RunLog, watchName: string, totalSteps: number): string {
  return renderRunLog(log, watchName, totalSteps);
}
