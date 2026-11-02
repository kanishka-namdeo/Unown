/**
 * Coda UI — notes list.
 *
 * Reads notes from the repository's readonly accessor; clicking a row
 * selects it into the editor. A delete affordance confirms before calling
 * the repository (which scrubs the id from every task).
 */

import type { Note } from "../domain/types";
import type { UI } from "./shell";

export function renderNotes(
  ui: UI,
  notes: Note[],
  activeId: string | null,
  onSelect: (id: string | null) => void,
  onDelete: (id: string) => void,
  onNew: () => void,
): void {
  const box = ui.notes;
  box.textContent = "";

  const head = document.createElement("div");
  head.className = "coda-col-head";
  const h = document.createElement("h2");
  h.className = "coda-col-title";
  h.textContent = "Notes";
  const newBtn = document.createElement("button");
  newBtn.className = "coda-btn coda-btn--small";
  newBtn.textContent = "New";
  newBtn.onclick = onNew;
  head.append(h, newBtn);
  box.append(head);

  const sorted = [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  if (sorted.length === 0) {
    const p = document.createElement("p");
    p.className = "coda-empty";
    p.textContent = "No notes yet. Create one to get started.";
    box.append(p);
    return;
  }
  const list = document.createElement("div");
  list.className = "coda-list";
  for (const n of sorted) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "coda-note-row" + (n.id === activeId ? " is-active" : "");
    const label = document.createElement("span");
    label.className = "coda-note-title";
    label.textContent = n.title || "(untitled)";
    const del = document.createElement("span");
    del.className = "coda-note-del";
    del.textContent = "×";
    del.setAttribute("role", "button");
    del.setAttribute("aria-label", `Delete ${n.title || "untitled"}`);
    del.tabIndex = 0;
    del.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.stopPropagation();
        del.click();
      }
    };
    del.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete note “${n.title || "(untitled)"}”? This cannot be undone.`)) {
        onDelete(n.id);
      }
    };
    row.append(label, del);
    row.onclick = () => onSelect(n.id);
    list.append(row);
  }
  box.append(list);
}
