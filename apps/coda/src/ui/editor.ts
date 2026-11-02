/**
 * Coda UI — markdown editor with a preview toggle.
 *
 * Writing mode: title / body / tags inputs bound to the active note.
 * Preview mode: `marked` renders the body, and its HTML output passes
 * through the sanitization allowlist (script/style/iframe/on*-attrs and
 * event handlers stripped) BEFORE insertion. marked only ever runs in
 * this preview path.
 */

import { marked } from "marked";
import { sanitizeHtml } from "./sanitize";
import type { Note } from "../domain/types";
import type { UI } from "./shell";

export interface EditorValue {
  title: string;
  body: string;
  tags: string[];
}

export function renderEditor(
  ui: UI,
  activeNote: Note | null,
  previewOn: boolean,
  onSave: (v: EditorValue) => void,
): void {
  const box = ui.editor;
  box.textContent = "";

  const note = activeNote;
  if (!note) {
    const p = document.createElement("p");
    p.className = "coda-empty";
    p.textContent = "Select a note to edit, or create one.";
    box.append(p);
    return;
  }

  const title = document.createElement("input");
  title.className = "coda-input coda-editor-title";
  title.type = "text";
  title.placeholder = "Title";
  title.value = note.title;
  title.setAttribute("aria-label", "Note title");

  const tagsInput = document.createElement("input");
  tagsInput.className = "coda-input coda-editor-tags";
  tagsInput.type = "text";
  tagsInput.placeholder = "tags (comma-separated)";
  tagsInput.value = note.tags.join(", ");
  tagsInput.setAttribute("aria-label", "Note tags, comma-separated");

  const body = document.createElement("textarea");
  body.className = "coda-input coda-editor-body";
  body.rows = 12;
  body.value = note.body;
  body.setAttribute("aria-label", "Note body (markdown)");

  if (previewOn) {
    // --- PREVIEW: body shown rendered (marked → sanitized); title + tags stay editable.
    const pre = document.createElement("div");
    pre.className = "coda-preview";
    pre.innerHTML = sanitizeHtml(marked.parse(note.body, { async: false }) as string);
    const val: EditorValue = { title: note.title, body: note.body, tags: note.tags };
    title.oninput = () => {
      val.title = title.value;
    };
    tagsInput.oninput = () => {
      val.tags = parseTags(tagsInput.value);
    };
    box.append(title, tagsInput, pre, makeSaveRow(onSave, () => ({ ...val })));
  } else {
    // --- WRITE: title / tags / body are all live inputs; body edits captured here.
    const val: EditorValue = { title: note.title, body: note.body, tags: note.tags };
    title.oninput = () => {
      val.title = title.value;
    };
    tagsInput.oninput = () => {
      val.tags = parseTags(tagsInput.value);
    };
    body.oninput = () => {
      val.body = body.value;
    };
    box.append(title, tagsInput, body, makeSaveRow(onSave, () => ({ ...val })));
  }
}

function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function makeSaveRow(onSave: (v: EditorValue) => void, get: () => EditorValue): HTMLElement {
  const row = document.createElement("div");
  row.className = "coda-editor-actions";
  const save = document.createElement("button");
  save.className = "coda-btn";
  save.textContent = "Save";
  save.onclick = () => onSave(get());
  row.append(save);
  return row;
}
