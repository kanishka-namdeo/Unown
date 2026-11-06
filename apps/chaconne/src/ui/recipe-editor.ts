/**
 * Chaconne — the recipe create/edit modal (C-3; P0 #4's "create/edit").
 *
 * The Ostinato dialog contract, verbatim:
 *   - role=dialog + aria-modal + aria-labelledby (the a11y pins)
 *   - attach-before-focus: the overlay enters document.body BEFORE
 *     the first field receives focus (the D11 law)
 *   - Esc focus-return: closing returns focus to the invoking control
 *     (captured on open — the P0 #9 lane)
 *   - double-Esc discard guard: with unsaved input, the first Esc
 *     arms the guard ("press Esc again to discard"); the second
 *     discards. Empty form closes on one Esc.
 *
 * Step-list editing covers the CLOSED 9-kind set (STEP_KINDS).
 * The form builds `Omit<Step, "id">[]` — ids are the domain's
 * deterministic business (model.ts assigns them), never the form's.
 */
import type { Recipe, Step, StepKind } from "../domain/types.js";
import { STEP_KINDS } from "../domain/types.js";
import { el } from "./el.js";

/** One step row's form state (the edit buffer; ids are NOT here). */
export type StepDraft = {
  kind: StepKind;
  selector: string;
  value?: string;
  timeoutMs?: number;
  intoFrame?: string;
};

/** The editor's open state (the Ostinato createForm kin). */
export type EditorState = {
  /** null = create; otherwise the recipe being edited. */
  recipeId: number | null;
  discardArmed: boolean;
};

/** The draft payload the submit lane validates before calling the model. */
export type RecipeDraft = {
  name: string;
  steps: StepDraft[];
};

const STEP_KIND_LABEL: Record<StepKind, string> = {
  goto: "goto — navigate to URL",
  click: "click — press a selector",
  fill: "fill — set an input's value",
  select: "select — choose an option",
  wait: "wait — cap until the selector exists",
  "assert-text": "assert-text — textContent match",
  "assert-element": "assert-element — presence wait",
  extract: "extract — read textContent",
  screenshot: "screenshot — capture the page",
};

/** Does this kind carry a `value` field? (fill/select/assert-text/extract.) */
function kindHasValue(kind: StepKind): boolean {
  return kind === "fill" || kind === "select" || kind === "assert-text" || kind === "extract";
}

/** The modal's renderer. `onSubmit` gets the validated draft; the
 *  caller closes the form + rerenders on success, keeps it open on
 *  error (the Ostinato submit lane). */
export function renderRecipeEditor(opts: {
  overlayId: string;
  recipe?: Recipe | null; // absent/null = create mode
  onSubmit: (draft: RecipeDraft, recipeId: number | null) => string | null;
  onClose: () => void;
  isDirty: () => boolean;
}): HTMLElement {
  const overlay = el("div", { id: opts.overlayId, class: "chaconne-modal-overlay" });
  document.body.append(overlay);

  const mode: "create" | "edit" = opts.recipe ? "edit" : "create";
  const form = el(
    "form",
    {
      id: `${opts.overlayId}-form`,
      class: "chaconne-recipe-form",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": `${opts.overlayId}-title`,
    },
  );
  form.append(el("h2", { id: `${opts.overlayId}-title`, text: mode === "create" ? "New recipe" : `Edit — ${(opts.recipe as Recipe).name}`, class: "chaconne-state-title" }));

  // ── the name field ──
  const nameLabel = el("label", { text: "Recipe name", class: "chaconne-field-label" });
  nameLabel.setAttribute("for", `${opts.overlayId}-name`);
  const nameInput = el("input", {
    id: `${opts.overlayId}-name`,
    class: "chaconne-field",
    autocomplete: "off",
  }) as HTMLInputElement;
  if (opts.recipe) nameInput.value = opts.recipe.name;
  form.append(nameLabel, nameInput);

  // ── the step rows (one field group per step) ──
  const stepGroup = el("fieldset", { class: "chaconne-step-group", "aria-label": "Steps" });
  const stepLegend = el("legend", { text: "Steps (the 9 kinds)" });
  stepGroup.append(stepLegend);
  const rowContainer = el("div", { class: "chaconne-step-rows", id: `${opts.overlayId}-steps` });
  stepGroup.append(rowContainer);
  form.append(stepGroup);

  function stepDraftAt(i: number): StepDraft {
    const recipe = opts.recipe;
    if (recipe !== null && recipe !== undefined && i < recipe.steps.length) {
      const s = recipe.steps[i];
      const d: StepDraft = { kind: s.kind, selector: s.selector };
      if (s.value !== undefined) d.value = s.value;
      if (s.timeoutMs !== undefined) d.timeoutMs = s.timeoutMs;
      if (s.intoFrame !== undefined) d.intoFrame = s.intoFrame;
      return d;
    }
    return { kind: "goto", selector: "" };
  }

  function addStepRow(i?: number): void {
    const idx = i ?? rowContainer.childElementCount;
    const d = i === undefined ? { kind: "goto" as StepKind, selector: "" } : stepDraftAt(idx);
    const row = el("div", { class: "chaconne-step-row", "data-step": String(idx) });
    const kindLabel = el("label", { text: `Step ${idx + 1} kind`, class: "chaconne-field-label" });
    const kindSel = el("select", { class: "chaconne-field" }) as HTMLSelectElement;
    kindSel.id = `${opts.overlayId}-kind-${idx}`;
    for (const k of STEP_KINDS) {
      kindSel.append(el("option", { text: STEP_KIND_LABEL[k], value: k }) as HTMLOptionElement);
    }
    kindSel.value = d.kind;
    kindLabel.setAttribute("for", kindSel.id);
    row.append(kindLabel, kindSel);

    const selLabel = el("label", { text: "Selector (URL for goto)", class: "chaconne-field-label" });
    const selInput = el("input", { class: "chaconne-field", autocomplete: "off", id: `${opts.overlayId}-sel-${idx}` }) as HTMLInputElement;
    selInput.value = d.selector ?? "";
    selLabel.setAttribute("for", selInput.id);
    row.append(selLabel, selInput);

    const valInput = el("input", { class: "chaconne-field", autocomplete: "off", id: `${opts.overlayId}-val-${idx}` }) as HTMLInputElement;
    if (d.value !== undefined) valInput.value = d.value;
    valInput.placeholder = "value (fill / select / assert-text / extract)";
    const valLabel = el("label", { text: "Value", class: "chaconne-field-label" });
    valLabel.setAttribute("for", valInput.id);
    row.append(valLabel, valInput);

    const toInput = el("input", { class: "chaconne-field", type: "number", autocomplete: "off", id: `${opts.overlayId}-to-${idx}` }) as HTMLInputElement;
    if (d.timeoutMs !== undefined) toInput.value = String(d.timeoutMs);
    toInput.placeholder = "timeout ms (optional)";
    const toLabel = el("label", { text: "Timeout (ms)", class: "chaconne-field-label" });
    toLabel.setAttribute("for", toInput.id);
    row.append(toLabel, toInput);

    kindSel.addEventListener("change", () => {
      valInput.disabled = !kindHasValue(kindSel.value as StepKind);
    });
    if (!kindHasValue(d.kind)) valInput.disabled = true;
    rowContainer.append(row); // THE fix: the row lands in the container
  }

  // One starter row on open (create mode) — or the recipe's own rows.
  if (opts.recipe) {
    for (let i = 0; i < opts.recipe.steps.length; i++) addStepRow(i);
  } else {
    addStepRow();
  }

  const addBtn = el("button", { type: "button", text: "+ Add step", class: "chaconne-action" });
  addBtn.onclick = () => addStepRow();
  form.append(addBtn);

  const guard = el("p", { class: "chaconne-modal-guard", role: "status" });
  const error = el("p", { class: "chaconne-modal-error", role: "alert" });
  const submitRow = el("div", { class: "chaconne-modal-row" });
  submitRow.append(
    el("button", { type: "submit", text: mode === "create" ? "Create recipe" : "Save recipe", class: "chaconne-action" }),
    el("span", { text: "Esc cancels", class: "chaconne-modal-hint" }),
  );
  form.append(guard, error, submitRow);
  overlay.replaceChildren(form);

  // The submit lane: read the rows, validate (name non-empty, ≥1 step,
  // every selector non-empty), hand the draft up. Failures keep the
  // form open (the Ostinato lane) + focus the first offender.
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let err: string | null = null;
    let firstOffender: HTMLElement | null = null;
    const name = nameInput.value.trim();
    if (name === "") {
      err = "Recipe name is required.";
      firstOffender = nameInput;
    }
    const steps: StepDraft[] = [];
    if (!err) {
      const rows = rowContainer.querySelectorAll(".chaconne-step-row");
      if (rows.length === 0) {
        err = "At least one step is required.";
      } else {
        rows.forEach((rowEl, i) => {
          const kind = (rowEl.querySelector<HTMLSelectElement>(".chaconne-field") ?? ({} as HTMLSelectElement)).value as StepKind;
          const sel = rowEl.querySelectorAll("input")[0] as HTMLInputElement;
          const val = rowEl.querySelectorAll("input")[1] as HTMLInputElement;
          const to = rowEl.querySelectorAll("input")[2] as HTMLInputElement;
          const d: StepDraft = { kind, selector: (sel?.value ?? "").trim() };
          if (val && val.value.trim() !== "") d.value = val.value.trim();
          if (to && to.value.trim() !== "") {
            const t = Number.parseInt(to.value, 10);
            if (Number.isFinite(t) && t > 0) d.timeoutMs = t;
          }
          if (d.selector === "") {
            err = `Step ${i + 1}: the selector is required.`;
            firstOffender = sel ?? null;
          }
          steps.push(d);
        });
      }
    }
    if (err !== null) {
      error.textContent = err;
      if (firstOffender) firstOffender.focus();
      return;
    }
    const err2 = opts.onSubmit({ name, steps }, mode === "edit" ? (opts.recipe as Recipe).id : null);
    if (err2 !== null) {
      error.textContent = err2;
      return; // the form stays open
    }
    opts.onClose();
  });

  // D11: attach-before-focus — the overlay is in the DOM, the first
  // field gets focus only now.
  nameInput.focus();
  void stepGroup;
  return form;
}

/**
 * The double-Esc discard guard (the Ostinato handleCreateFormEscape
 * kin, exported for the shell's key handler + the unit pins):
 * unsaved input + no armed guard → arm + paint; armed or clean →
 * close.
 */
export function handleEditorEscape(opts: {
  overlayId: string;
  state: EditorState;
  isDirty: () => boolean;
  onClose: () => void;
}): void {
  const form = document.getElementById(`${opts.overlayId}-form`);
  if (form && !opts.state.discardArmed) {
    const hasInput =
      Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, textarea")).some(
        (i) => i.value.trim() !== "",
      );
    if (hasInput) {
      opts.state.discardArmed = true;
      const guard = form.querySelector<HTMLParagraphElement>(".chaconne-modal-guard");
      if (guard) guard.textContent = "You have unsaved input — press Esc again to discard.";
      return;
    }
  }
  opts.onClose();
}

/** The Esc focus-return close (the D8 close lane). */
export function closeRecipeEditor(overlayId: string, invokingEl: HTMLElement | null): void {
  document.getElementById(overlayId)?.remove();
  (invokingEl ?? document.body).focus();
}
