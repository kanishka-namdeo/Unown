/**
 * Coda UI — shell layout.
 *
 * `renderShell` builds the static three-column layout and returns typed
 * handles to the live containers the other renderers fill.
 */

import type { Note, Task, Board } from "../domain/types";

export interface UI {
  content: HTMLElement;
  notes: HTMLElement;
  editor: HTMLElement;
  tasks: HTMLElement;
  search: HTMLInputElement;
  searchResults: HTMLElement;
  toolbar: HTMLElement;
  status: { el: HTMLElement };
  previewToggle: HTMLButtonElement;
}

export function renderShell(root: HTMLElement): UI {
  root.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "coda-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "coda-toolbar";

  const h = document.createElement("h1");
  h.className = "coda-title";
  h.textContent = "Coda";

  const search = document.createElement("input");
  search.className = "coda-search";
  search.type = "text";
  search.placeholder = "Search notes & tasks…";
  search.setAttribute("aria-label", "Global search");

  const exportBtn = document.createElement("button");
  exportBtn.className = "coda-btn coda-btn--ghost";
  exportBtn.textContent = "Export";

  const importBtn = document.createElement("button");
  importBtn.className = "coda-btn coda-btn--ghost";
  importBtn.textContent = "Import";
  const importFile = document.createElement("input");
  importFile.type = "file";
  importFile.accept = "application/json,.json";
  importFile.hidden = true;
  importFile.className = "coda-import-file";

  const previewToggle = document.createElement("button");
  previewToggle.className = "coda-btn coda-btn--ghost";
  previewToggle.textContent = "Preview";
  previewToggle.setAttribute("aria-pressed", "false");

  toolbar.append(h, search, exportBtn, importBtn, previewToggle);

  const grid = document.createElement("div");
  grid.className = "coda-grid";

  const notes = document.createElement("section");
  notes.className = "coda-col coda-col--notes";
  notes.setAttribute("aria-label", "Notes");

  const editor = document.createElement("section");
  editor.className = "coda-col coda-col--editor";
  editor.setAttribute("aria-label", "Note editor");

  const tasks = document.createElement("section");
  tasks.className = "coda-col coda-col--tasks";
  tasks.setAttribute("aria-label", "Tasks");

  grid.append(notes, editor, tasks);
  wrap.append(toolbar, grid);

  const status = document.createElement("div");
  status.className = "coda-status";
  status.id = "coda-status";
  status.setAttribute("role", "status");
  wrap.append(status);

  const searchResults = document.createElement("div");
  searchResults.className = "coda-search-results";
  wrap.insertBefore(searchResults, grid);

  root.append(wrap);

  // Wire toolbar actions to the app via a small event bus on the root.
  const ui: UI = {
    content: wrap,
    notes,
    editor,
    tasks,
    search,
    searchResults,
    toolbar,
    status: { el: status },
    previewToggle,
  };

  exportBtn.onclick = () => root.dispatchEvent(new CustomEvent("coda:export"));
  importBtn.onclick = () => importFile.click();
  importFile.onchange = () => {
    const file = importFile.files?.[0];
    if (file) root.dispatchEvent(new CustomEvent("coda:import", { detail: { file } }));
    importFile.value = "";
  };
  previewToggle.onclick = () => {
    const on = previewToggle.getAttribute("aria-pressed") === "true";
    previewToggle.setAttribute("aria-pressed", String(!on));
    previewToggle.textContent = on ? "Preview" : "Writing";
    root.dispatchEvent(new CustomEvent("coda:preview", { detail: { on: !on } }));
  };
  (ui as UI & { _root: HTMLElement })._root = root;

  return ui;
}
