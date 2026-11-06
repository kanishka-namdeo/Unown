/**
 * Chaconne — the run-history surface (C-3; P0 #4's "run history").
 *
 * The grouped list (runs by recipe) + the keyboard navigation + the
 * honest 5-entry status badges. Pure render functions over domain data;
 * app.ts owns the route + key wiring.
 *
 * Navigation law (the Ostinato j/k/g/G kin): the cursor moves over the
 * visible rows; ArrowUp/ArrowDown step (wrapping), Home/End are the
 * bounds. The SELECTED row is pinned in the app state (`runId`) so
 * the palette's view-run / view-artifact / delete-run target it —
 * selection survives re-renders of the route (the "selection pins"
 * row of the ticket).
 */
import type { Recipe, RunRecord, RunStatus } from "../domain/types.js";
import { RUN_STATUSES } from "../domain/types.js";
import { el } from "./el.js";

/** Group the run history by recipe (recipe id → runs, newest last). */
export function groupRunsByRecipe(data: { recipes: Recipe[]; runs: RunRecord[] }): Map<number, RunRecord[]> {
  const map = new Map<number, RunRecord[]>();
  for (const r of data.recipes) map.set(r.id, []);
  for (const run of data.runs) {
    if (!map.has(run.recipeId)) map.set(run.recipeId, []);
    map.get(run.recipeId)!.push(run);
  }
  return map;
}

/** The 5-entry status badge (the honest taxonomy — every status renders a
 *  distinct, non-color-only badge: the text is the cue, the class the tint). */
export function renderStatusBadge(status: RunStatus): HTMLElement {
  return el("span", {
    text: status,
    class: `chaconne-badge chaconne-badge-${status}`,
    "data-status": status,
  });
}

/**
 * Render the run-history route: one section per recipe with runs, plus
 * the global empty panel when there are no runs at all (app.ts picks
 * between this and empty.ts's no-runs panel).
 *
 * Each row carries: the badge, the version snapshot, the timestamps,
 * the committed prefix (honest crash-lane copy), and the artifact
 * count. The selected row gets the focus ring (aria-current).
 */
export function renderRunHistory(
  recipes: Recipe[],
  runs: RunRecord[],
  selectedRunId: number | null,
): HTMLElement {
  const wrap = el("div", { class: "chaconne-runs", id: "chaconne-runs" });
  wrap.append(el("h2", { text: "Run history", class: "chaconne-section-title" }));

  const grouped = groupRunsByRecipe({ recipes, runs });
  let any = false;

  for (const [recipeId, rs] of grouped) {
    if (rs.length === 0) continue;
    any = true;
    const recipe = recipes.find((r) => r.id === recipeId);
    const section = el("section", { class: "chaconne-run-group", "data-recipe": String(recipeId) });
    section.append(el("h3", { text: recipe ? recipe.name : `Recipe #${recipeId}`, class: "chaconne-run-group-title" }));
    const list = el("ol", { class: "chaconne-run-list", role: "list", "aria-label": `Runs for ${recipe ? recipe.name : recipeId}` });
    for (const run of rs) {
      const row = el("li", {
        class: "chaconne-run-row",
        "data-run": String(run.id),
        role: "option",
        "aria-selected": String(run.id === selectedRunId),
        tabindex: run.id === selectedRunId ? "0" : "-1",
      });
      if (run.id === selectedRunId) row.setAttribute("aria-current", "true");
      const steps = recipe?.steps.length ?? 0;
      row.append(
        renderStatusBadge(run.status),
        el("span", {
          text: `v${run.recipeVersion} · ${run.startedAt.replace("T", " ").replace("Z", "")}${run.finishedAt ? ` → ${run.finishedAt.replace("T", " ").replace("Z", "")}` : ""}`,
          class: "chaconne-run-meta",
        }),
        el("span", {
          text: `prefix ${run.committedPrefix}/${steps}${run.artifacts.length > 0 ? ` · ${run.artifacts.length} artifact${run.artifacts.length === 1 ? "" : "s"}` : ""}`,
          class: "chaconne-run-meta",
        }),
      );
      list.append(row);
    }
    section.append(list);
    wrap.append(section);
  }

  if (!any) {
    wrap.append(el("p", { text: "No runs yet. Run a recipe to build the history.", class: "chaconne-state-copy", id: "chaconne-empty-runs" }));
  }
  return wrap;
}

/**
 * The keyboard math (DOM-free, test-pinned): move the selection index
 * by `dir` over `count` rows with wrap; Home/End absolute. Mirrors
 * the Ostinato queue-nav law (j/k WRAP, g/G absolute bounds).
 */
export function moveRunSelection(index: number, dir: 1 | -1, count: number): number {
  if (count === 0) return 0;
  return ((index + dir) % count + count) % count;
}

/** All run ids in display order (groups in recipe order, runs in store order). */
export function orderedRunIds(data: { recipes: Recipe[]; runs: RunRecord[] }): number[] {
  const grouped = groupRunsByRecipe(data);
  const out: number[] = [];
  for (const [recipeId, rs] of grouped) for (const r of rs) out.push(r.id);
  return out;
}

/** The status legend row (the 5-entry taxonomy — honest copy, always visible). */
export function renderStatusLegend(): HTMLElement {
  const dl = el("dl", { class: "chaconne-status-legend", "aria-label": "Run status legend" });
  for (const s of RUN_STATUSES) {
    const row = el("div", { class: "chaconne-legend-row" });
    row.append(renderStatusBadge(s), el("dd", { text: LEGEND_COPY[s], class: "chaconne-legend-copy" }));
    dl.append(row);
  }
  return dl;
}

/** The legend copy (the 5 statuses → one honest line each). */
const LEGEND_COPY: Record<RunStatus, string> = {
  ok: "completed every step",
  "step-failed": "a step action threw",
  "selector-not-found": "the selector matched nothing (capped wait, no hang)",
  timeout: "a capped wait expired",
  "invalid-recipe": "the recipe failed validation at start",
};
