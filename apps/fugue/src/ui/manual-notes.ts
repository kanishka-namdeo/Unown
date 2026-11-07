/**
 * manual-notes.ts — the Manual-notes editor view (F-7 chunk 3, the
 * ONE hand-edit lane, marked unverified in the render).
 *
 * The section body lives in .unown/memory/project.md between the
 * `## Manual notes` heading and the next heading / EOF; the engine's
 * dream renderer preserves it VERBATIM (capped at 4096 chars — beyond
 * the cap the tail is dropped with a visible marker, never a silent
 * truncate). In-app edits are the HUMAN's edits (the PRD's ruling),
 * written through the app server edge (serve.mjs's PUT /manual-notes
 * splice + atomic write) — NEVER through an agent session, NEVER
 * touching any other section, NEVER writing the provenance sidecar
 * (the engine's dream owns that).
 *
 * The render is DOM-free: it returns HTML the shell owns; the pure
 * section/splice/cap-meter semantics live in manual-notes-core.ts
 * (shared with the server edge, tested against temp fixtures).
 */
import {
  MANUAL_NOTES_CAP,
  OVER_CAP_MARKER,
  capMeter,
  type CapMeter,
} from "./manual-notes-core.js";

export { MANUAL_NOTES_CAP, OVER_CAP_MARKER, capMeter, type CapMeter };

/** The GET /manual-notes wire row (the app server's read route). */
export interface ManualNotesWire {
  section: string; // the current body (bullets, WITHOUT the heading)
  chars: number;
  cap: number; // 4096
  path: string; // ".unown/memory/project.md"
}

export interface ManualNotesOptions {
  wire: ManualNotesWire | null; // null = the read failed (E-02 panel)
  /** The editor draft (the textarea content while the user types). */
  draft?: string;
  /** The last save's honest result (surfaced, never silent). */
  saveError?: string;
  savedAt?: number; // epoch ms of the last successful save (0 = never)
}

/** The lane's label: 'hand-edited, unverified' — NEVER "written by
 *  AutoDream" (that sidecar stamp is the engine's dream's). */
export const LANE_LABEL = "Manual notes — hand-edited, unverified";

/** Render the editor HTML: the textarea prefilled with the section
 *  body, the live budget meter (chars / 4096), and — when the draft
 *  is OVER the cap — the visible over-cap marker + the EXACT tail
 *  the engine's renderer will drop (never a silent truncate). */
export function renderManualNotes(opts: ManualNotesOptions): string {
  const wire = opts.wire;
  if (wire === null) {
    return `<section class="fugue-route" data-route="manual-notes" aria-label="Manual notes"><div class="fugue-panel fugue-panel-error" data-panel="manual-notes-load-failed"><h2>Manual notes load failed</h2><p class="fugue-panel-reason">${escapeHtml(opts.saveError ?? "the /manual-notes lane rejected or failed")}</p><p class="fugue-panel-action"><kbd>Esc</kbd> back to jobs · Ctrl+K → "refresh"</p></div></section>`;
  }
  const draft = opts.draft !== undefined ? opts.draft : wire.section;
  const meter = capMeter(draft);
  const meterLine =
    `<p class="fugue-mn-meter" data-mn-chars="${meter.chars}" data-mn-cap="${meter.cap}" data-mn-over="${meter.overCap ? "1" : "0"}">` +
    `${meter.chars} / ${meter.cap} chars${meter.overCap ? ` — over cap: the renderer will drop the tail` : ""}</p>`;
  // Edge 11: when over the cap, show the marker line the renderer
  // writes AND the exact dropped tail, styled distinctly — the
  // human sees exactly which tail will not survive the re-render.
  const overBlock = meter.overCap
    ? `<div class="fugue-mn-overcap" data-mn-overcap data-marker="${escapeHtml(OVER_CAP_MARKER)}"><p class="fugue-mn-marker"><code>${escapeHtml(OVER_CAP_MARKER)}</code> (appended by the renderer when the section is over cap)</p><pre class="fugue-mn-dropped-tail">${escapeHtml(meter.droppedTail)}</pre></div>`
    : "";
  const saveErr = opts.saveError !== undefined
    ? `<p class="fugue-panel-reason" data-mn-save-error>${escapeHtml(opts.saveError)}</p>`
    : "";
  const saved = opts.savedAt && opts.savedAt > 0
    ? `<p class="fugue-mn-saved">saved ${escapeHtml(new Date(opts.savedAt).toISOString())}</p>`
    : "";
  return `<section class="fugue-route" data-route="manual-notes" aria-label="Manual notes">
    <h2>Manual notes</h2>
    <p class="fugue-mn-lane" data-mn-lane>${escapeHtml(LANE_LABEL)}</p>
    <p class="fugue-mn-path">the section between <code>## Manual notes</code> and the next heading in ${escapeHtml(wire.path)} — preserved verbatim by the dream renderer; in-app edits are the human's edits, never an agent write.</p>
    <textarea class="fugue-mn-textarea" data-mn-input rows="14" aria-label="Manual notes section body">${escapeHtml(draft)}</textarea>
    ${meterLine}
    ${overBlock}
    <div class="fugue-mn-actions"><button type="button" class="fugue-mn-save" data-mn-save aria-label="save">Save</button></div>
    ${saveErr}
    ${saved}
  </section>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
