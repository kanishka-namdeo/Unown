/**
 * empty.ts — the four honest panels (O-1 law: never a blank screen).
 *
 * One function renders any of the four panel kinds. Each panel carries
 * a heading, an honest one-line reason, and (for the engine-down /
 * engine-locked lanes) a retry affordance hint. The renderer is
 * DOM-free: it returns an HTML string; the shell (app.ts) owns the
 * DOM. No seeded fake data — the panels are honest by construction.
 */

/** The closed panel-kind set (the O-1 four). */
export type EmptyPanelKind = "no-jobs" | "no-runs" | "engine-down" | "engine-locked" | "no-dreams";

interface PanelDef {
  heading: string;
  body: string;
  action?: string;
}

const PANELS: Record<EmptyPanelKind, PanelDef> = {
  "no-jobs": {
    heading: "No jobs yet",
    body: "Author a scheduled agent job and it will appear here. The engine owns execution; this console owns authorship, observation and curation.",
    action: "Ctrl+K → \"new job\"",
  },
  "no-runs": {
    heading: "No runs yet",
    body: "When a job runs, its run record (status, tokens, turns, duration) lands here. Engine accounting only — the console never invents numbers.",
  },
  "engine-down": {
    heading: "Engine unavailable",
    body: "The engine REST lane is unreachable. Queued actions stay in the outbox; nothing was silently succeeded. Retry when the engine is back.",
    action: "Ctrl+K → \"refresh\"",
  },
  "engine-locked": {
    heading: "Engine locked",
    body: "The engine's bearer token is missing or rotated (401). Update $UNOWN_HOME/engine.token or the install's token, then retry.",
    action: "Ctrl+K → \"refresh\"",
  },
  "no-dreams": {
    heading: "No dreams yet",
    body: "When AutoDream consolidates session notes, the journal (applied / gated / rolled-back) renders here. Nothing has consolidated yet in this lane.",
  },
};

/** Render one honest panel as an HTML string. `reason` (engine lanes)
 *  carries the typed error's message so the operator sees WHY the lane
 *  is down — honesty, not a blank. */
export function renderEmptyPanel(
  kind: EmptyPanelKind,
  reason?: string,
): string {
  const p = PANELS[kind];
  const reasonLine = reason
    ? `<p class="fugue-panel-reason">${escapeHtml(reason)}</p>`
    : "";
  const actionLine = p.action ? `<p class="fugue-panel-action"><kbd>${escapeHtml(p.action)}</kbd></p>` : "";
  return [
    `<section class="fugue-panel" data-panel="${kind}" role="region" aria-label="${escapeHtml(p.heading)}">`,
    `  <h2 class="fugue-panel-heading">${escapeHtml(p.heading)}</h2>`,
    `  <p class="fugue-panel-body">${escapeHtml(p.body)}</p>`,
    reasonLine,
    actionLine,
    `</section>`,
  ].filter(Boolean).join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
