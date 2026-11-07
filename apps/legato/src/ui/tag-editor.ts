/**
 * tag-editor.ts — the clip tag editor (ticket L-7 deliverable 3:
 * "from the detail view, 't' opens the tag editor — the palette's
 * dialog contract: role=dialog, aria-modal, focus trap, Esc
 * return — add/remove tags on the clip, the canonical-order law
 * enforced, persisted through the StoragePort on every
 * transition").
 *
 * THE DIALOG CONTRACT (binding, same as palette.ts / Ostinato):
 *   - the overlay is `role="dialog"` + `aria-modal="true"` +
 *     `aria-labelledby` pointing at the editor's visible title
 *   - **attach-before-focus**: the overlay is appended to the
 *     document body BEFORE the input receives focus
 *   - **focus trap**: Tab/Shift+Tab wrap within the dialog
 *   - **Esc focus-return**: Esc closes the editor and returns
 *     focus to the invoking element (the app remembers it in
 *     `invokingEl`) — the Ostinato P0 #9 lane
 *   - **tabindex routing**: every focusable element in the
 *     dialog is created via `el()` with `tabindex` props that
 *     route through setAttribute (the B-12 cure in el.ts)
 *
 * THE CANONICAL-ORDER LAW: the editor's input is freeform — the
 * user types a tag, presses Enter, and the domain's
 * `canonicalTagList` re-derives the clip's tag list (normalize,
 * drop empties, dedupe, ASCII-sort). Removing a tag re-derives
 * the same way. The editor never hand-writes the order — the
 * domain owns it.
 *
 * PERSIST ON EVERY TRANSITION: the editor's `onCommit(tags)`
 * callback fires on every add / remove; the APP owns the
 * persistence lane (it mutates the clip's `tags` + `updatedAt`,
 * calls `storage.save(data)` — the Ostinato every-transition
 * rule — and re-renders). The editor itself is a pure renderer +
 * event emitter over the app's state (the list.ts / filterbar.ts
 * pattern).
 *
 * DOM-GUARD: every DOM global named here is resolved through the
 * globalThis-seam INSIDE function bodies — the module load is
 * side-effect-free, so Lane A's DOM-free runtime imports it
 * clean.
 */
import { el } from "./el.js";
import { canonicalTagList } from "../domain/tags.js";
import type { Clip } from "../domain/types.js";

/** The editor's state (the app owns the value; the editor renders
 *  it + emits events). */
export interface TagEditorState {
  open: boolean;
  /** the clip being edited (null when closed) */
  clipId: number | null;
  /** the clip's current tag list (canonical — the domain's law) */
  tags: string[];
  /** the freeform input's draft ("" when nothing typed) */
  draft: string;
  /** the invoking element (Esc focus-return target) */
  invokingEl: HTMLElement | null;
  /** fired on every add/remove commit — the app persists
   *  (StoragePort) + re-renders. The `tags` argument is the
   *  clip's NEW canonical list (the domain re-derived it — the
   *  editor never writes the order by hand). */
  onCommit: (clipId: number, tags: string[]) => void;
}

/** Open the editor for `clip`: attach the overlay to the document
 *  body BEFORE focusing the input (the attach-before-focus
 *  contract). The invoking element is remembered in `invokingEl`
 *  for the Esc focus-return lane. */
export function openTagEditor(state: TagEditorState, clip: Clip): void {
  state.open = true;
  state.clipId = clip.id;
  state.tags = [...clip.tags];
  state.draft = "";
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const active = w?.document?.activeElement;
  state.invokingEl = active instanceof HTMLElement ? active : null;
}

/** Close the editor: remove the overlay, return focus to the
 *  invoking element (the Ostinato P0 #9 focus-return lane). */
export function closeTagEditor(state: TagEditorState): void {
  state.open = false;
  state.clipId = null;
  state.draft = "";
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const doc = w?.document;
  doc?.getElementById("legato-tag-editor")?.remove();
  const target = state.invokingEl ?? (doc?.body as HTMLElement | undefined);
  if (target) target.focus();
  state.invokingEl = null;
}

/**
 * The editor's ADD lane: normalize + re-derive the canonical
 * list (the domain's law — the editor never writes the order by
 * hand). Returns the new canonical list; the caller (the app, via
 * `onCommit`) persists it. Returns null when the draft normalizes
 * to empty (an all-whitespace draft adds nothing).
 */
export function addTagToEditor(state: TagEditorState): string[] | null {
  const normalized = state.draft.trim().toLowerCase();
  if (normalized === "") return null;
  const next = canonicalTagList([...state.tags, normalized]);
  if (
    next.length === state.tags.length &&
    next.every((t, i) => t === state.tags[i])
  ) {
    // The tag was already there — nothing to commit (idempotent).
    state.draft = "";
    return state.tags;
  }
  state.tags = next;
  state.draft = "";
  return next;
}

/** The editor's REMOVE lane: drop `tag` + re-derive the
 *  canonical list (dedupe is by construction; the removal is the
 *  only change). */
export function removeTagFromEditor(state: TagEditorState, tag: string): string[] {
  const next = canonicalTagList(state.tags.filter((t) => t !== tag));
  state.tags = next;
  return next;
}

/**
 * Render (or re-render) the tag editor overlay into the document
 * body. Idempotent: the first call attaches, subsequent calls
 * repaint.
 *
 * FOCUS TRAP (the Ostinato dialog contract): Tab/Shift+Tab wrap
 * within the dialog (the input + the tag chips + the Add button +
 * the Cancel button are the focus stops; the overlay's own
 * onkeydown wraps them in a ring).
 *
 * ESC FOCUS-RETURN: Esc closes the editor + returns focus to the
 * invoking element (the `closeTagEditor` lane — the overlay's own
 * onkeydown handles the case where focus is inside the dialog;
 * the app's document-level handler covers the rest).
 *
 * ATTACH-BEFORE-FOCUS: the overlay is appended to the document
 * body BEFORE the input receives focus (the contract's ordering
 * pin — the a11y tree sees the dialog before the focus moves in).
 */
export function renderTagEditor(state: TagEditorState): void {
  const w = (globalThis as Record<string, unknown>)["window"] as Window | undefined;
  const doc = w?.document;
  if (!doc) return;

  let overlay = doc.getElementById("legato-tag-editor");
  if (!overlay) {
    overlay = el("div", {
      id: "legato-tag-editor",
      class: "legato-tag-editor",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "legato-tag-editor-title",
    }) as unknown as HTMLElement;
    doc.body.append(overlay);
  }
  overlay.replaceChildren();

  // The title (the aria-labelledby target — a real, visible
  // element; the label is never a dangling id).
  const title = el("h2", {
    id: "legato-tag-editor-title",
    class: "legato-tag-editor-title",
    text: "Edit tags",
  }) as unknown as HTMLElement;
  overlay.append(title);

  // The current tag list (the remove chips).
  const tagsList = el("div", {
    class: "legato-tag-editor-tags",
    "aria-label": "Current tags",
  }) as unknown as HTMLElement;
  if (state.tags.length === 0) {
    tagsList.append(
      el("p", {
        class: "legato-tag-editor-no-tags",
        text: "No tags yet.",
      }) as unknown as HTMLElement,
    );
  } else {
    for (const tag of state.tags) {
      const chip = el("button", {
        class: "legato-tag-editor-tag-chip",
        "data-tag": tag,
        "aria-label": "Remove tag " + tag,
      }) as HTMLButtonElement;
      chip.textContent = tag;
      chip.addEventListener("click", () => {
        const next = removeTagFromEditor(state, tag);
        if (state.clipId !== null) state.onCommit(state.clipId, next);
        renderTagEditor(state);
      });
      tagsList.append(chip);
    }
  }
  overlay.append(tagsList);

  // The add lane: input + Add button (Enter in the input also
  // adds — the keyboard-first law).
  const addRow = el("div", { class: "legato-tag-editor-add" }) as unknown as HTMLElement;
  const input = el("input", {
    class: "legato-tag-editor-input",
    "aria-label": "New tag (press Enter to add)",
    type: "text",
    autocomplete: "off",
    value: state.draft,
  }) as HTMLInputElement;
  const addBtn = el("button", {
    class: "legato-tag-editor-add-btn",
    text: "Add",
  }) as HTMLButtonElement;
  const addTag = (): void => {
    const next = addTagToEditor({ ...state, draft: input.value });
    if (next !== null && state.clipId !== null && next !== state.tags) {
      state.tags = next;
      state.draft = "";
      state.onCommit(state.clipId, next);
      renderTagEditor(state);
    }
  };
  addBtn.addEventListener("click", addTag);
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  });
  addRow.append(input, addBtn);
  overlay.append(addRow);

  // The Cancel button (the Esc lane's visible twin).
  const cancel = el("button", {
    class: "legato-tag-editor-cancel",
    text: "Cancel (Esc)",
  }) as HTMLButtonElement;
  cancel.addEventListener("click", () => closeTagEditor(state));
  overlay.append(cancel);

  // THE FOCUS TRAP (the Ostinato dialog contract): Tab/Shift+Tab
  // wrap within the dialog.
  const focusable = (): HTMLElement[] =>
    Array.from(overlay.querySelectorAll<HTMLElement>("input, button")).filter(
      (e) => !e.hasAttribute("disabled"),
    );

  overlay.onkeydown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeTagEditor(state);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const stops = focusable();
      if (stops.length === 0) return;
      const idx = stops.indexOf(doc.activeElement as HTMLElement);
      const next = e.shiftKey
        ? (idx - 1 + stops.length) % stops.length
        : (idx + 1) % stops.length;
      stops[next].focus();
      return;
    }
  };

  // ATTACH-BEFORE-FOCUS: the overlay is in the DOM before focus
  // lands on the input (the contract's ordering pin).
  input.focus();
}
