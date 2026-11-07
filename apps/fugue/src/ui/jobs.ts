/**
 * jobs.ts — the selected job's adapter commands + job-aware view
 * model (F-5, ticket 4). DOM-free, pure: data comes through the
 * adapter seam ONLY (never a direct fetch).
 *
 * Honest refresh (optimistic-free): every mutation call re-reads the
 * engine's authoritative lane AFTER the call resolves — the UI shows
 * what the engine says, never what the UI guessed. Typed errors
 * (EngineLocked / EngineDown / EngineDrift) are SURFACED to the
 * caller (never swallowed into a silent failure, never crashed): the
 * caller paints them through the existing honest panels.
 */
import type { EngineAdapter, AutomationRecord, SpendReport } from "../adapter/engine-adapter.js";
import { EngineLocked, EngineDown, EngineDrift, EngineError } from "../adapter/engine-adapter.js";
import type { RunRecordView } from "../domain/types.js";

/** The one-call result: either the re-read lane state (success) or
 *  the typed error (surfaces through the honest panels). */
export type JobAction =
  | { ok: true; jobs: AutomationRecord[]; runs: RunRecordView[]; spend: SpendReport | null }
  | { ok: false; error: EngineError; jobs: AutomationRecord[] };

/** The adapter methods a job-scoped command needs. */
export interface JobCommands {
  runNow(id: number | string): Promise<void>;
  pause(id: number | string): Promise<void>;
  resume(id: number | string): Promise<void>;
  skip(id: number | string): Promise<void>;
  snooze(id: number | string, minutes: number): Promise<void>;
}

/** Build the command surface over an EngineAdapter (the app's seam). */
export function makeJobCommands(adapter: EngineAdapter): JobCommands {
  return {
    runNow: (id) => adapter.runNow(id),
    pause: (id) => adapter.pauseAutomation(id),
    resume: (id) => adapter.resumeAutomation(id),
    skip: (id) => adapter.skip(id),
    snooze: (id, minutes) => adapter.snooze(id, minutes),
  };
}

/** Execute one job-scoped command against the selected job, then
 *  re-read the engine lane. The re-read tolerates a failed refresh
 *  (EngineDown while the mutation landed): the mutation's own typed
 *  error is the source of truth. */
export async function runJobCommand(
  cmd: keyof JobCommands,
  id: number | string,
  extra: { minutes?: number },
  commands: JobCommands,
  adapter: Pick<EngineAdapter, "listAutomations" | "runs" | "spend">,
): Promise<JobAction> {
  let error: EngineError | null = null;
  try {
    switch (cmd) {
      case "runNow":
        await commands.runNow(id);
        break;
      case "pause":
        await commands.pause(id);
        break;
      case "resume":
        await commands.resume(id);
        break;
      case "skip":
        await commands.skip(id);
        break;
      case "snooze":
        await commands.snooze(id, extra.minutes ?? 1);
        break;
    }
  } catch (e) {
    if (
      e instanceof EngineLocked ||
      e instanceof EngineDown ||
      e instanceof EngineDrift
    ) {
      error = e;
    } else {
      error = new EngineDown(`unknown error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // The optimistic-free honest refresh: re-read AFTER the call.
  const [jobs, runs, spend] = await Promise.all([
    safeJobs(adapter),
    safeRuns(adapter),
    safeSpend(adapter),
  ]);
  if (error !== null) {
    return { ok: false, error, jobs };
  }
  return { ok: true, jobs, runs, spend };
}

async function safeJobs(a: Pick<EngineAdapter, "listAutomations">): Promise<AutomationRecord[]> {
  try {
    return await a.listAutomations();
  } catch {
    return [];
  }
}

async function safeRuns(a: Pick<EngineAdapter, "runs">): Promise<RunRecordView[]> {
  try {
    return await a.runs();
  } catch {
    return [];
  }
}

async function safeSpend(a: Pick<EngineAdapter, "spend">): Promise<SpendReport | null> {
  try {
    return await a.spend();
  } catch {
    return null;
  }
}

/** The selected job's current lifecycle state, for the palette's
 *  enable gate (pause enabled only when active; resume only when
 *  paused). */
export function jobLifecycle(
  jobs: AutomationRecord[],
  id: number | string | null,
): "active" | "paused" | null {
  if (id === null) return null;
  const j = jobs.find((x) => String(x.id) === String(id));
  return j?.state ?? null;
}
