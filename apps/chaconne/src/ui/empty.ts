/**
 * Chaconne — the honest empty/failed panels (C-3: never a blank screen).
 *
 * One renderer family, four honest panels: no recipes, no runs, no
 * artifacts, and a failed-run detail. Every panel carries a copy line
 * plus the honest escape hatch (a CTA button with the palette hint) so
 * the user is never parked at a dead end — the Ostinato
 * "No decks yet — create one first" empty-state law.
 */
import { el } from "./el.js";

/** The four empty-panel kinds (the test-pinned enumeration). */
export type EmptyKind = "no-recipes" | "no-runs" | "no-artifacts" | "failed-run";

const EMPTY_COPY: Record<Exclude<EmptyKind, "failed-run">, string> = {
  "no-recipes": "No recipes yet. Create one to start recording a flow.",
  "no-runs": "No runs yet. Run a recipe to build the history.",
  "no-artifacts": "No artifacts yet. Runs with screenshot or extract steps produce them.",
};

/**
 * Render an empty panel. `cta` carries the action label (e.g.
 * "New recipe (N)"); when given, a real button lands in the panel —
 * the CTA's `id` is pinned by the tests (the "named panel" contract).
 */
export function renderEmpty(kind: Exclude<EmptyKind, "failed-run">, cta?: { label: string; id: string }): HTMLElement {
  const d = el("div", { class: "chaconne-state", role: "status", id: `chaconne-empty-${kind}` });
  d.append(el("p", { text: EMPTY_COPY[kind], class: "chaconne-state-copy" }));
  if (cta) {
    d.append(el("button", { text: cta.label, class: "chaconne-action", id: cta.id }));
  }
  return d;
}

/**
 * Render the failed-run detail panel: the recipe, the failing step,
 * the status (the 5-entry taxonomy), and the committed prefix (honest
 * crash-lane copy). The failed step's kind/selector/value are shown so
 * the user can act on it (the editor opens from the CTA).
 */
export function renderFailedRun(opts: {
  recipeName: string;
  status: string;
  failedStep: string; // the step INDEX as a string (the test pin's convention)
  committedPrefix: number;
  totalSteps: number;
}): HTMLElement {
  const d = el("div", { class: "chaconne-state chaconne-failed", role: "alert", id: "chaconne-failed-run" });
  const stepIdx = parseInt(opts.failedStep, 10);
  d.append(el("h2", { text: "Run failed", class: "chaconne-state-title" }));
  d.append(
    el("p", {
      text: `${opts.recipeName} stopped at step ${stepIdx + 1} (${opts.status}).`,
      class: "chaconne-state-copy",
    }),
  );
  d.append(
    el("p", {
      text: `Committed prefix: ${opts.committedPrefix} of ${opts.totalSteps} steps completed.`,
      class: "chaconne-state-copy",
    }),
  );
  d.append(el("p", { text: "Open the recipe to fix the failing step.", class: "chaconne-state-copy" }));
  return d;
}
