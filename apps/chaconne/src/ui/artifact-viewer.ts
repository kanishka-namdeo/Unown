/**
 * Chaconne — the artifact viewer (C-3; P0 #4's "artifact viewer").
 *
 * Two views over a run record's artifacts (the 5-status taxonomy's
 * output lane):
 *
 *   - screenshot view: the artifact `name` + `sha256` (the
 *     content-addressed law — the name IS the hash). In C-3 the
 *     viewer shows the honest metadata panel: the screenshot bytes
 *     live on the runner's disk store (C-2), outside the browser's
 *     localStorage closure, so the browser pane shows the reference,
 *     not a fake embedded image.
 *   - extracted-values view: the run's `extracted` map (step index →
 *     value) rendered as a table.
 *
 * Pure render functions — app.ts owns the route wiring.
 */
import type { ArtifactRef, RunRecord } from "../domain/types.js";
import { el } from "./el.js";

/** The screenshot artifact's metadata panel (honest: ref, not bytes). */
export function renderScreenshotArtifact(artifact: ArtifactRef, recipeName: string): HTMLElement {
  const d = el("div", { class: "chaconne-artifact", role: "region", "aria-label": "Screenshot artifact", id: "chaconne-artifact-screenshot" });
  d.append(el("h2", { text: `Screenshot — ${recipeName}`, class: "chaconne-state-title" }));
  const dl = el("dl", { class: "chaconne-artifact-dl" });
  dl.append(
    el("dt", { text: "artifact", class: "chaconne-artifact-key" }),
    el("dd", { text: artifact.name, class: "chaconne-artifact-value" }),
    el("dt", { text: "sha256", class: "chaconne-artifact-key" }),
    el("dd", { text: artifact.sha256, class: "chaconne-artifact-value" }),
  );
  d.append(dl);
  d.append(
    el("p", {
      text: "Screenshot bytes live in the runner's disk store; this pane shows the content-addressed reference.",
      class: "chaconne-state-copy",
    }),
  );
  return d;
}

/**
 * The extracted-values table. `run.extracted` is the step-index →
 * value map; empty (or absent) → the honest no-values panel, never a
 * blank.
 */
export function renderExtractedValues(run: RunRecord, recipeName: string): HTMLElement {
  const d = el("div", { class: "chaconne-artifact", role: "region", "aria-label": "Extracted values", id: "chaconne-artifact-extracted" });
  d.append(el("h2", { text: `Extracted values — ${recipeName}`, class: "chaconne-state-title" }));
  const extracted = run.extracted;
  if (!extracted || Object.keys(extracted).length === 0) {
    d.append(
      el("p", { text: "No extracted values in this run.", class: "chaconne-state-copy", id: "chaconne-artifact-empty" }),
    );
    return d;
  }
  const table = el("table", { class: "chaconne-extracted-table", "aria-label": "Extracted values" });
  const head = el("thead", {});
  const hr = el("tr", {});
  hr.append(el("th", { text: "Step", class: "chaconne-artifact-key" }));
  hr.append(el("th", { text: "Value", class: "chaconne-artifact-key" }));
  head.append(hr);
  const tbody = el("tbody", {});
  for (const [stepIdx, value] of Object.entries(extracted)) {
    const tr = el("tr", { "data-step": stepIdx });
    tr.append(
      el("td", { text: stepIdx, class: "chaconne-artifact-key" }),
      el("td", { text: value, class: "chaconne-artifact-value" }),
    );
    tbody.append(tr);
  }
  table.append(head, tbody);
  d.append(table);
  return d;
}
