/**
 * job-list.ts — the grouped job list with status + arrow-key
 * navigation (DOM-free render + pure navigation helpers; the DOM
 * wiring and key handler live in app.ts).
 *
 * Groups: the live engine lane (AutomationRecord rows, the
 * engine-authoritative source of truth) above the offline shadow
 * (FugueData.jobs, the local lane). Status is the job's `state`
 * (active / paused); the cursor is `selectedJobId`.
 */
import type { Job } from "../domain/types.js";
import type { AutomationRecord } from "../adapter/engine-adapter.js";

export interface JobListOptions {
  automations: AutomationRecord[];
  shadow: Job[];
  selected: number | null;
}

export interface JobListViewModel {
  groups: { title: string; lane: "engine" | "shadow"; rows: string[] }[];
  totalRows: number;
  selectedIndex: number;
}

/** Build the view model for the grouped list. Pure; no DOM. */
export function jobListViewModel(opts: JobListOptions): JobListViewModel {
  const groups: JobListViewModel["groups"] = [];
  let flat: string[] = [];
  const allRows: { row: string; id: number }[] = [];
  let selectedIndex = -1;

  if (opts.automations.length > 0) {
    const rows = opts.automations.map((a) => {
      const spec = scheduleLabel(a.schedule);
      const status = a.state === "paused" ? "paused" : "active";
      return `<li class="fugue-job-row" data-job="${a.id}" data-lane="engine" data-state="${status}"><span class="fugue-job-title">${escapeHtml(a.title)}</span><span class="fugue-job-sched">${escapeHtml(spec)}</span><span class="fugue-job-status">${status}</span></li>`;
    });
    groups.push({ title: "Engine jobs", lane: "engine", rows });
    flat = flat.concat(rows);
    opts.automations.forEach((a) => allRows.push({ row: "", id: a.id }));
  }

  if (opts.shadow.length > 0) {
    const rows = opts.shadow.map((j) => {
      const spec = scheduleLabel(j.schedule);
      return `<li class="fugue-job-row" data-job="${j.id}" data-lane="shadow" data-state="local"><span class="fugue-job-title">${escapeHtml(j.title)}</span><span class="fugue-job-sched">${escapeHtml(spec)}</span><span class="fugue-job-status">local</span></li>`;
    });
    groups.push({ title: "Offline shadow", lane: "shadow", rows });
    flat = flat.concat(rows);
    opts.shadow.forEach((j) => allRows.push({ row: "", id: j.id }));
  }

  allRows.forEach((r, i) => {
    if (opts.selected !== null && r.id === opts.selected) selectedIndex = i;
  });

  return { groups, totalRows: flat.length, selectedIndex };
}

/** Render the full grouped list HTML. Empty input returns the
 *  no-jobs panel markup (the O-1 never-blank law, the caller picks
 *  which via jobListViewModel.totalRows === 0). */
export function renderJobList(_state: unknown, opts: JobListOptions): string {
  const vm = jobListViewModel(opts);
  if (vm.totalRows === 0) {
    return `<section class="fugue-panel" data-panel="no-jobs"><h2>No jobs yet</h2></section>`;
  }
  const groupsHtml = vm.groups
    .map(
      (g) =>
        `<div class="fugue-job-group" data-lane="${g.lane}" aria-label="${escapeHtml(g.title)}"><h3>${escapeHtml(g.title)}</h3><ul class="fugue-jobs">${g.rows.join("")}</ul></div>`,
    )
    .join("\n");
  return `<section class="fugue-route" data-route="jobs" aria-label="Jobs">${groupsHtml}\n<div class="fugue-route-actions"><a class="fugue-spend-link" data-spend-link="" role="button" tabindex="0" href="#spend" aria-label="Open the spend meter">Spend</a></div></section>`;
}

/** Move the cursor one step (the arrow-key navigation, DOM-free). */
export function moveSelection(
  current: number,
  total: number,
  dir: 1 | -1,
): number {
  const next = current + dir;
  if (next < 0) return 0;
  if (next >= total) return total - 1;
  return next;
}

function scheduleLabel(s: { kind: string; [k: string]: unknown }): string {
  switch (s.kind) {
    case "cron":
      return `cron: ${String(s.expr ?? "")}`;
    case "every":
      return `every ${String(s.spec ?? "")}`;
    case "after":
      return `after ${String(s.spec ?? "")}`;
    case "once":
      return `once (+${s.delayMinutes}m)`;
    case "event":
      return `on ${String(s.name ?? s.event ?? "")}`;
    default:
      return s.kind;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
