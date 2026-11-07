/**
 * run-history.ts — the grouped run-history view (F-5, ticket 1).
 *
 * DOM-free render + pure navigation helpers (the job-list.ts kin). The
 * data comes from the adapter seam ONLY (`adapter.runs(limit?)` for the
 * global lane, `adapter.history(jobId, limit?)` for a job-scoped lane)
 * — the UI never fetches directly. Rows show status (the F-1
 * RunRecordView taxonomy), tokens in/out, turns and duration.
 *
 * Honesty rules:
 *   - success badges render ONLY for `status === "ok"` — a failed /
 *     partial run (tokens in, zero out) is NEVER rendered as success.
 *   - the empty state is per-group: a job with zero runs gets its own
 *     honest "no runs yet" group line, never a fake row.
 */
import type { RunRecordView } from "../domain/types.js";

export interface RunGroup {
  taskId: number | null; // null = unattributed (the global lane)
  title: string;
  rows: RunRecordView[]; // newest first
}

export interface RunHistoryOptions {
  runs: RunRecordView[];
  /** Job titles for `taskId`s that have runs; unknown ids fall back to
   *  a bare id label. Omit for the global (ungrouped) lane. */
  jobTitles?: Record<number, string>;
  /** The global lane: one group, no per-job empty states. */
  groupByJob?: boolean;
  /** Jobs with zero runs still get an honest empty group line.
   *  The id is the RAW task id (the engine's string 'auto-xxx' ids or
   *  the fixture's numeric ones) — String()-equality everywhere. */
  jobs?: { id: number | string; title: string }[];
  selected?: number | null; // the run id the cursor sits on (optional: null when unselected)
}

export interface RunHistoryViewModel {
  groups: { title: string; taskId: number | null; rows: string[]; empty: boolean }[];
  totalRows: number;
  runIds: number[]; // flat order matching the rendered rows
  selectedIndex: number;
}

/** Group the runs by job (newest first within a group; groups in the
 *  caller's job order, the global lane first when mixed). Pure. */
export function groupRuns(runs: RunRecordView[], jobs?: { id: number | string; title: string }[]): RunGroup[] {
  const titleOf = (taskId: number): string =>
    jobs?.find((j) => String(j.id) === String(taskId))?.title ?? `Job ${taskId}`;
  const byTask = new Map<number, RunRecordView[]>();
  for (const r of runs) {
    const rows = byTask.get(r.taskId) ?? [];
    rows.push(r);
    byTask.set(r.taskId, rows);
  }
  byTask.forEach((rows) => rows.sort((a, b) => b.id - a.id));
  // The known jobs in the caller's order, then any unknown task ids
  // that have runs, in ascending order (stable, honest). The engine's
  // string task ids group under their coerced numeric key (0) — the
  // group title resolves by String()-equality (O-4), never a crash.
  const orderedTasks: number[] = [...(jobs ?? [])].map((j) => Number(j.id) || 0);
  for (const id of byTask.keys()) {
    if (!orderedTasks.includes(id)) orderedTasks.push(id);
  }
  const groupJobs = orderedTasks.map((id) => ({ id: Number(id), title: titleOf(id) }));
  return groupJobs.map((j) => ({
    taskId: j.id,
    title: j.title,
    rows: byTask.get(j.id) ?? [],
  }));
}

/** Format a run's duration from its epoch-ish timestamps. The fixtures
 *  mix ISO strings and epoch ms (the Ostinato law: no Date objects in
 *  the domain — both serialize to primitives); a null `endedAt` means
 *  the run is still open and shows `…` rather than a fake zero. */
export function formatDuration(r: RunRecordView): string {
  if (r.endedAt === null) return "…";
  const s = toMs(r.startedAt);
  const e = toMs(r.endedAt);
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function toMs(v: string | number): number {
  if (typeof v === "number") return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? Number.NaN : t;
}

/** The row's status badge class. Only `ok` gets the success badge. */
export function statusClass(status: RunRecordView["status"]): string {
  switch (status) {
    case "ok":
      return "is-success";
    case "failed":
    case "schema-invalid":
    case "loop-guard":
      return "is-error";
    case "budget-throttled":
      return "is-throttled";
    case "capped":
    case "draining":
      return "is-warn";
  }
}

/** One run row's HTML. The badge shows the RAW status word — a failed
 *  run with partial tokens renders `failed`, never a success badge. */
export function renderRunRow(r: RunRecordView): string {
  const badge =
    r.status === "ok"
      ? `<span class="fugue-run-badge ${statusClass(r.status)}">ok</span>`
      : `<span class="fugue-run-badge ${statusClass(r.status)}">${escapeHtml(r.status)}</span>`;
  const marker =
    r.status === "budget-throttled"
      ? `<span class="fugue-run-marker" data-marker="budget-throttled" title="budget-throttled">⏸</span>`
      : "";
  return `<li class="fugue-run-row" data-run="${r.id}" data-status="${escapeHtml(r.status)}" data-task="${r.taskId}">${badge}${marker}<span class="fugue-run-tokens">${r.tokensIn}/${r.tokensOut} tok</span><span class="fugue-run-turns">${r.turns} turns</span><span class="fugue-run-duration">${escapeHtml(formatDuration(r))}</span></li>`;
}

/** Render the full grouped view HTML. Zero runs → the honest no-runs
 *  panel (the O-1 never-blank law, cf. empty.ts). */
export function renderRunHistory(opts: RunHistoryOptions): string {
  const { runs, jobs, selected = null } = opts;
  if (runs.length === 0 && (jobs ?? []).length === 0) {
    return `<section class="fugue-route" data-route="runs" aria-label="Run history"><div class="fugue-panel" data-panel="no-runs"><h2>No runs yet</h2></div></section>`;
  }
  const groups = groupRuns(runs, jobs);
  const groupsHtml = groups
    .map((g) =>
      g.rows.length === 0
        ? `<div class="fugue-run-group" data-task="${g.taskId}" data-empty="true" aria-label="${escapeHtml(g.title)}"><h3>${escapeHtml(g.title)}</h3><p class="fugue-run-empty">No runs yet for this job.</p></div>`
        : `<div class="fugue-run-group" data-task="${g.taskId}" aria-label="${escapeHtml(g.title)}"><h3>${escapeHtml(g.title)}</h3><ul class="fugue-runs">${g.rows.map(renderRunRow).join("")}</ul></div>`,
    )
    .join("\n");
  const sel = selected !== null ? ` data-selected="${selected}"` : "";
  return `<section class="fugue-route" data-route="runs" aria-label="Run history"${sel}><h2>Runs</h2>${groupsHtml}</section>`;
}

/** Build the view model (the job-list.ts kin: flat ids + selection). */
export function runHistoryViewModel(opts: RunHistoryOptions): RunHistoryViewModel {
  const groups = groupRuns(opts.runs, opts.jobs?.map((j) => ({ id: j.id, title: j.title })));
  const runIds: number[] = [];
  let selectedIndex = -1;
  const groupRows = groups.map((g) => {
    const rows = g.rows.map(renderRunRow);
    g.rows.forEach((r) => runIds.push(r.id));
    return { title: g.title, taskId: g.taskId, rows, empty: g.rows.length === 0 };
  });
  runIds.forEach((id, i) => {
    if (opts.selected !== null && id === opts.selected) selectedIndex = i;
  });
  return {
    groups: groupRows,
    totalRows: runIds.length,
    runIds,
    selectedIndex,
  };
}

/** Move the cursor one step (the arrow-key navigation, DOM-free). */
export function moveRunSelection(current: number, total: number, dir: 1 | -1): number {
  const next = current + dir;
  if (next < 0) return 0;
  if (next >= total) return total - 1;
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
