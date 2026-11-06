/**
 * C-3 — the recipe-editor dialog-contract pins (the Ostinato
 * settings-modal.test.ts precedent, verbatim lane semantics).
 *
 *   Lane A — `cd apps/chaconne && bun test`: no DOM globals → one
 *            skipped stub (the module's boot-time side effects are
 *            avoided by the lazy import inside the else branch).
 *   Lane B — `bun test apps/chaconne` from the root: the root
 *            bunfig.toml's happy-dom preload provides `document` →
 *            the real pins RUN.
 *
 * The pins (all through the app's own renderer + Esc handler):
 *   1. Render: role=dialog + aria-modal + aria-labelledby + the h2
 *      title + the name input + the step fieldset + the submit row
 *      (the Ostinato dialog contract).
 *   2. Attach-before-focus (D11): the overlay is in the document
 *      before the first field receives focus.
 *   3. handleEditorEscape: unsaved input + no armed guard → arm +
 *      paint; armed → close.
 *   4. closeRecipeEditor: Esc focus-return to the invoking control.
 */
import { test, expect, afterEach } from "bun:test";

const hasDom = typeof document !== "undefined";

if (!hasDom) {
  test.skip("chaconne recipe-editor pin — requires a DOM (Lane B's happy-dom provides it)", () => {});
} else {
  function cleanBody(): void {
    document.body.innerHTML = "";
  }

  function makeRecipe() {
    return {
      id: 1,
      name: "Test recipe",
      version: 1,
      steps: [{ id: 10, kind: "goto", selector: "https://example.com" }],
    };
  }

  async function importEditor() {
    const mod = await import("./recipe-editor.js");
    return mod as typeof import("./recipe-editor.js");
  }

  afterEach(() => {
    cleanBody();
  });

  test("render: the dialog contract (role=dialog, aria-modal, labelled title)", async () => {
    const { renderRecipeEditor } = await importEditor();
    cleanBody();

    let closed = 0;
    renderRecipeEditor({
      overlayId: "chaconne-editor",
      recipe: null,
      onSubmit: () => null,
      onClose: () => {
        closed++;
      },
      isDirty: () => false,
    });

    const form = document.getElementById("chaconne-editor-form") as HTMLElement;
    expect(form).not.toBeNull();
    expect(form.getAttribute("role")).toBe("dialog");
    expect(form.getAttribute("aria-modal")).toBe("true");
    expect(form.getAttribute("aria-labelledby")).toBe("chaconne-editor-title");

    const title = form.querySelector("h2#chaconne-editor-title");
    expect(title?.textContent).toBe("New recipe");

    const nameInput = form.querySelector("#chaconne-editor-name") as HTMLInputElement;
    expect(nameInput).not.toBeNull();

    // The step fieldset + one starter row (create mode).
    const stepGroup = form.querySelector(".chaconne-step-group");
    expect(stepGroup).not.toBeNull();
    const rows = form.querySelectorAll(".chaconne-step-row");
    expect(rows.length).toBe(1);

    // The 9-kind select (the CLOSED step-kind set).
    const kindSel = form.querySelector<HTMLSelectElement>("#chaconne-editor-kind-0");
    expect(kindSel).not.toBeNull();
    expect(kindSel?.options.length).toBe(9);
  });

  test("attach-before-focus (D11): the overlay is in the DOM before the name input is focused", async () => {
    const { renderRecipeEditor } = await importEditor();
    cleanBody();

    let overlayWasAttachedBeforeFocus = false;
    const origFocus = HTMLInputElement.prototype.focus;
    (HTMLInputElement.prototype as unknown as { focus: () => void }).focus = function () {
      overlayWasAttachedBeforeFocus = document.getElementById("chaconne-editor") !== null;
      return origFocus.call(this);
    };

    try {
      renderRecipeEditor({
        overlayId: "chaconne-editor",
        recipe: null,
        onSubmit: () => null,
        onClose: () => {},
        isDirty: () => false,
      });
    } finally {
      HTMLInputElement.prototype.focus = origFocus;
    }

    expect(overlayWasAttachedBeforeFocus).toBe(true);
  });

  test("handleEditorEscape: unsaved input + no guard → arms the guard; second Esc closes", async () => {
    const { renderRecipeEditor, handleEditorEscape } = await importEditor();
    cleanBody();

    const state = { recipeId: null, discardArmed: false };
    let closed = 0;
    renderRecipeEditor({
      overlayId: "chaconne-editor",
      recipe: null,
      onSubmit: () => null,
      onClose: () => {
        closed++;
      },
      isDirty: () => true,
    });

    const form = document.getElementById("chaconne-editor-form") as HTMLElement;
    const nameInput = form.querySelector("#chaconne-editor-name") as HTMLInputElement;
    nameInput.value = "Unsaved draft"; // unsaved input present

    // (a) First Esc: guard not armed → arm + paint the message.
    handleEditorEscape({
      overlayId: "chaconne-editor",
      state,
      isDirty: () => true,
      onClose: () => {
        closed++;
      },
    });
    expect(state.discardArmed).toBe(true);
    expect(closed).toBe(0); // still open
    const guard = form.querySelector(".chaconne-modal-guard") as HTMLParagraphElement;
    expect(guard.textContent).toBe("You have unsaved input — press Esc again to discard.");

    // (b) Second Esc: guard armed → close.
    handleEditorEscape({
      overlayId: "chaconne-editor",
      state,
      isDirty: () => true,
      onClose: () => {
        closed++;
      },
    });
    expect(closed).toBe(1); // the overlay removed
  });

  test("closeRecipeEditor: focus returns to the invoking control (Esc focus-return)", async () => {
    const { closeRecipeEditor } = await importEditor();
    cleanBody();

    const overlay = document.createElement("div");
    overlay.id = "chaconne-editor";
    document.body.append(overlay);

    const invoking = document.createElement("button");
    invoking.id = "invoking-btn";
    document.body.append(invoking);

    closeRecipeEditor("chaconne-editor", invoking);

    expect(document.getElementById("chaconne-editor")).toBeNull();
    expect(document.activeElement).toBe(invoking);
  });

  test("closeRecipeEditor: no invoking control → focus falls back to document.body", async () => {
    const { closeRecipeEditor } = await importEditor();
    cleanBody();

    const overlay = document.createElement("div");
    overlay.id = "chaconne-editor";
    document.body.append(overlay);

    closeRecipeEditor("chaconne-editor", null);

    expect(document.getElementById("chaconne-editor")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  test("edit mode: the recipe's name + steps are preloaded", async () => {
    const { renderRecipeEditor } = await importEditor();
    cleanBody();

    renderRecipeEditor({
      overlayId: "chaconne-editor",
      recipe: makeRecipe() as never,
      onSubmit: () => null,
      onClose: () => {},
      isDirty: () => false,
    });

    const form = document.getElementById("chaconne-editor-form") as HTMLElement;
    const title = form.querySelector("h2#chaconne-editor-title");
    expect(title?.textContent).toBe("Edit — Test recipe");
    const nameInput = form.querySelector("#chaconne-editor-name") as HTMLInputElement;
    expect(nameInput.value).toBe("Test recipe");
    const rows = form.querySelectorAll(".chaconne-step-row");
    expect(rows.length).toBe(1);
    const kindSel = form.querySelector<HTMLSelectElement>("#chaconne-editor-kind-0");
    expect(kindSel?.value).toBe("goto");
  });
}
