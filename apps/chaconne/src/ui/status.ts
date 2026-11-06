/**
 * Chaconne — live runner status (C-3; P0 #4's honest loading states).
 *
 * C-4 landed the real schedule state: `renderStatusIdle` now shows
 * the real schedule state for a recipe (next due, last fired, paused
 * / retired) instead of the C-3 "not scheduled yet" placeholder. The
 * live row (`renderStatusLive`) is unchanged — it still renders the
 * active run record's progress.
 *
 * The DOM wiring lives in app.ts; this file owns the render + the
 * elapsed math so both stay testable.
 */
import { el } from "./el.js";
import type { Recipe, Schedule } from "../domain/types.js";

/**
 * The "Run recipe" idle panel — backward-compatible with C-3's call
 * signature (`renderStatusIdle("name")`), extended in C-4 to show the
 * REAL schedule state when a schedule (or the recipe itself) is
 * passed. Honest not-scheduled copy is kept for a recipe with no
 * schedule (never a fake spinner — the loading-state honesty law).
 */
export function renderStatusIdle(
  recipeOrName: Pick<Recipe, "name"> | string,
  schedule?: Schedule,
  nowIso?: string,
): HTMLElement {
  const name =
    typeof recipeOrName === "string" ? recipeOrName : recipeOrName.name;
  const d = el("div", { class: "chaconne-status-idle", role: "status", id: "chaconne-status-idle" });
  const sched = schedule;
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  if (!sched) {
    d.append(el("p", { text: `"${name}" has no schedule. Run it now or add a schedule in the recipe editor.`, class: "chaconne-state-copy" }));
    return d;
  }
  const lines: string[] = [];
  if (sched.kind === "one-shot" && sched.lastFiredIso !== undefined && sched.nextDueIso === undefined) {
    lines.push(`"${name}" · one-shot · retired (fired)`);
  } else {
    lines.push(`"${name}" · ${sched.kind}`);
    if (sched.everyMs !== undefined) lines.push(`every ${Math.round(sched.everyMs / 1000)}s`);
    if (sched.nextDueIso !== undefined) {
      const t = new Date(Date.parse(sched.nextDueIso)).toISOString().replace("T", " ").replace("Z", "");
      lines.push(Date.parse(sched.nextDueIso) <= now ? `due now (${t})` : `next due ${t}`);
    }
    if (sched.lastFiredIso !== undefined) {
      lines.push(`last fired ${new Date(Date.parse(sched.lastFiredIso)).toISOString().replace("T", " ").replace("Z", "")}`);
    }
  }
  d.append(el("p", { text: lines.join(" · "), class: "chaconne-state-copy" }));
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
