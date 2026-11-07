/**
 * dreams.ts — the dreams journal view (F-7 chunk 2, the learning band).
 *
 * DOM-free render + pure navigation helpers (the run-history.ts kin).
 * Data comes from the adapter seam ONLY (`adapter.dreams(limit?)` via
 * the dreams route's load helper) — the UI never fetches directly.
 *
 * Honesty rules (E-06 / V-41):
 *   - the status badge renders the RAW DreamStatus word — a GATED dream
 *     is GATED (never a success badge), a running dream shows RUNNING
 *     with a null endedAt (the open-run "…" duration), an error dream
 *     shows error. Each of the five statuses gets a visually distinct
 *     badge class; only `done` is green.
 *   - zero dreams → the honest no-dreams panel (never fake data).
 *   - the output previews the first ~200 chars inside an expandable
 *     details/summary (keyboard accessible); a null/empty output shows
 *     the honest "no output" line, never a seeded placeholder.
 */
import type { DreamRecord, DreamStatus } from "../adapter/engine-adapter.js";

export interface DreamsOptions {
  dreams: DreamRecord[];
  /** The dream id the cursor sits on (the journal's selection;
   *  the raw string id flows through — no Number() collapse). */
  selected?: string | null;
}

/** The closed DreamStatus badge-class map (E-06: gated is NEVER the
 *  success class — it gets its own warn lane, visually distinct from
 *  done/running/no-notes/error). */
export function dreamStatusClass(status: DreamStatus): string {
  switch (status) {
    case "done":
      return "is-success";
    case "gated":
      return "is-gated";
    case "running":
      return "is-running";
    case "no-notes":
      return "is-no-notes";
    case "error":
      return "is-error";
  }
}

/** Human-readable duration for one dream (the run-history kin):
 *  epoch-ms start/end; a null endedAt is the open run ("…"). */
export function dreamDuration(d: DreamRecord): string {
  if (d.endedAt === null) return "…";
  const sec = Math.max(0, Math.round((d.endedAt - d.startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** The consolidation ledger line: +merged / -pruned / +added. */
export function dreamLedger(d: DreamRecord): string {
  return `+${d.entriesMerged}/-${d.entriesPruned}/+${d.entriesAdded}`;
}

/** The output preview: the first ~200 chars (whitespace-collapsed),
 *  or the honest empty line. The FULL text stays in the <details>
 *  body — the preview never truncates the full view. */
export function dreamOutputPreview(d: DreamRecord, limit = 200): string {
  const text = d.output.trim();
  if (text === "") return "(no output yet)";
  const flat = text.replace(/\s+/g, " ");
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit - 1)}…`;
}

/** One dream row's HTML (the journal is newest-first — the adapter's
 *  mapDreams ordering). data-dream carries the RAW string id. */
export function renderDreamRow(d: DreamRecord): string {
  const badge = `<span class="fugue-dream-badge ${dreamStatusClass(d.status)}" data-status="${escapeHtml(d.status)}">${escapeHtml(d.status)}</span>`;
  const hasOutput = d.output.trim() !== "";
  const details = hasOutput
    ? `<details class="fugue-dream-output" data-dream-output="${escapeHtml(d.id)}"><summary class="fugue-dream-preview">${escapeHtml(dreamOutputPreview(d))}</summary><pre class="fugue-dream-output-full">${escapeHtml(d.output)}</pre></details>`
    : `<p class="fugue-dream-preview fugue-dream-output-empty">no output yet</p>`;
  return `<li class="fugue-dream-row" data-dream="${escapeHtml(d.id)}" data-status="${escapeHtml(d.status)}">
    ${badge}
    <span class="fugue-dream-duration">${escapeHtml(dreamDuration(d))}</span>
    <span class="fugue-dream-ledger" title="notes in / +merged / -pruned / +added">${d.notesIn} in · ${escapeHtml(dreamLedger(d))}</span>
    ${details}
  </li>`;
}

/** Render the full journal HTML. Zero dreams → the honest no-dreams
 *  panel (the V-41 law: no fake data, no seeded rows). */
export function renderDreams(opts: DreamsOptions): string {
  const { dreams, selected = null } = opts;
  if (dreams.length === 0) {
    return `<section class="fugue-route" data-route="dreams" aria-label="Dreams journal"><div class="fugue-panel" data-panel="no-dreams"><h2>No dreams yet</h2><p class="fugue-panel-body">When AutoDream consolidates session notes, the journal (done / gated / running / no-notes / error) renders here. Nothing has consolidated yet in this lane.</p></div></section>`;
  }
  const sel = selected !== null ? ` data-selected="${escapeHtml(selected)}"` : "";
  return `<section class="fugue-route" data-route="dreams" aria-label="Dreams journal"${sel}><h2>Dreams</h2><ul class="fugue-dreams">${dreams
    .map(renderDreamRow)
    .join("\n")}</ul></section>`;
}

/** Build the view model (the run-history kin: flat ids + selection). */
export function dreamsViewModel(opts: DreamsOptions) {
  const { dreams, selected = null } = opts;
  const dreamIds = dreams.map((d) => d.id);
  let selectedIndex = -1;
  dreamIds.forEach((id, i) => {
    if (selected !== null && id === selected) selectedIndex = i;
  });
  return {
    totalRows: dreams.length,
    dreamIds,
    selectedIndex,
  };
}

/** Move the cursor one step (the arrow-key navigation, DOM-free). */
export function moveDreamSelection(current: number, total: number, dir: 1 | -1): number {
  const next = current + dir;
  if (next < 0) return 0;
  if (next >= total) return total - 1;
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
