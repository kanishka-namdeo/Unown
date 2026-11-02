/**
 * Coda UI — notes list.
 *
 * Reads notes from the repository's readonly accessor; clicking a row
 * selects it into the editor. A delete affordance confirms before calling
 * the repository (which scrubs the id from every task).
 *
 * Each note row is a <div> containing two sibling <button>s (title = open,
 * "×" = delete). No interactive element nests inside another
 * (nested-interactive, WCAG 4.1.2).
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
    // Flat row: two sibling buttons (open-note, delete-note). No nesting.
    const row = document.createElement("div");
    row.className = "coda-note-row" + (n.id === activeId ? " is-active" : "");
    row.setAttribute("data-note-id", n.id);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "coda-note-open";
    open.textContent = n.title || "(untitled)";
    open.setAttribute("aria-label", n.title || "(untitled)");
    open.onclick = () => onSelect(n.id);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "coda-note-del";
    del.textContent = "\u00d7";
    del.setAttribute("aria-label", `Delete ${n.title || "untitled"}`);
    del.onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Delete note \u201c${n.title || "(untitled)"}\u201d? This cannot be undone.`)) {
        onDelete(n.id);
      }
    };
    row.append(open, del);
    list.append(row);
  }
  box.append(list);
}
