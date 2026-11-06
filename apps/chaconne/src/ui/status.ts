/**
 * Chaconne — live runner status (C-3; P0 #4's honest loading states).
 *
 * In C-3 the "Run" action does NOT invoke the runner (C-4+ owns the
 * scheduling integration) — so this module renders the two honest
 * states the shell actually shows:
 *
 *   - `renderStatusIdle()`: the "not scheduled yet" placeholder that
 *     the Run palette row flips into — honest copy, never a fake
 *     spinner (the loading-state honesty law: a status that can't
 *     happen is not rendered).
 *   - `renderStatusLive()`: the live progress row (step N of M,
 *     elapsed) — rendered whenever a run record is the active one.
 *     Elapsed is computed from the record's startedAt/finishedAt
 *     (domain data, ISO-8601 strings) at the UI edge; a finished run
 *     shows the total, a missing finishedAt shows the running marker.
 *
 * The DOM wiring lives in app.ts; this file owns the render + the
 * elapsed math so both stay testable.
 */
import { el } from "./el.js";

/**
 * The "Run recipe" placeholder panel — the honest not-scheduled state
 * (NON-OVERLAP: C-4 wires the real trigger; C-3 records the state).
 */
export function renderStatusIdle(recipeName: string): HTMLElement {
  const d = el("div", { class: "chaconne-status-idle", role: "status", id: "chaconne-status-idle" });
  d.append(
    el("p", {
      text: `"${recipeName}" has not been scheduled yet. The runner integration lands with C-4; the recipe itself is ready.`,
      class: "chaconne-state-copy",
    }),
  );
  return d;
}

/** Format an elapsed ms span as the honest "Xm Ys" copy (0m when < 1s). */
export function formatElapsed(ms: number): string {
  if (ms <= 0) return "0m";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/**
 * The live progress row: "Step N of M · <elapsed>". A running run
 * (no finishedAt) marks the elapsed with a live dot — the state is
 * computed from the record, not from a timer (honest: no spinner
 * theater for data the store says is settled).
 */
export function renderStatusLive(opts: {
  stepIndex: number;
  totalSteps: number;
  startedAt: string;
  finishedAt?: string;
  /** the UI edge's clock read — the wall read stays OUT of the domain. */
  nowIso?: string;
}): HTMLElement {
  const started = Date.parse(opts.startedAt);
  const finished = opts.finishedAt ? Date.parse(opts.finishedAt) : opts.nowIso ? Date.parse(opts.nowIso) : Date.now();
  const running = opts.finishedAt === undefined;
  const row = el("div", { class: "chaconne-status-live", role: "status", id: "chaconne-status-live" });
  row.append(
    el(
      "p",
      {
        text: `Step ${opts.stepIndex + 1} of ${opts.totalSteps} · ${formatElapsed(Math.max(0, finished - started))}${running ? " (running)" : ""}`,
        class: "chaconne-state-copy",
        id: "chaconne-status-line",
      },
    ),
  );
  return row;
}
