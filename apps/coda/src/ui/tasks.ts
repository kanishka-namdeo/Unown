/**
 * Coda UI — task board for the single active board.
 *
 * Status toggle walks the domain's LEGAL_TRANSITIONS (todo→doing→done→todo).
 * Any DomainInvariantError from moveTask/updateTask/deleteTask is surfaced
 * to the status line, never swallowed. Due date + note-links flow through
 * the repository.
 */

import { type Note, type TaskStatus } from "../domain/types";
import type { UI } from "./shell";

export interface TaskRowData {
  id: string;
  title: string;
  status: TaskStatus;
  dueAt?: string;
  noteIds: string[];
}

export function renderTasks(
  ui: UI,
  board: { id: string; name: string },
  tasks: TaskRowData[],
  onToggle: (t: TaskRowData) => void,
  onCreate: () => void,
  onDelete: (id: string) => void,
  onDue: (id: string, value: string) => void,
  onLink: (id: string, noteId: string) => void,
  notes: Note[],
  activeTaskId: string | null,
): void {
  const box = ui.tasks;
  box.textContent = "";

  const head = document.createElement("div");
  head.className = "coda-col-head";
  const h = document.createElement("h2");
  h.className = "coda-col-title";
  h.textContent = `Tasks · ${board.name}`;
  const addBtn = document.createElement("button");
  addBtn.className = "coda-btn coda-btn--small";
  addBtn.textContent = "Add task";
  addBtn.onclick = onCreate;
  head.append(h, addBtn);
  box.append(head);

  if (tasks.length === 0) {
    const p = document.createElement("p");
    p.className = "coda-empty";
    p.textContent = "No tasks on this board.";
    box.append(p);
    return;
  }

  const list = document.createElement("div");
  list.className = "coda-task-list";

  for (const t of tasks) {
    const row = document.createElement("div");
    row.className =
      "coda-task" + (t.status === "done" ? " is-done" : "") + (t.id === activeTaskId ? " is-active" : "");
    row.setAttribute("data-task-id", t.id);

    const cycle = document.createElement("button");
    cycle.type = "button";
    cycle.className = "coda-task-cycle";
    // aria-label must INCLUDE the visible text (label-content-name-mismatch, WCAG 2.5.3):
    // the visible status word ("todo") is part of the accessible name.
    cycle.setAttribute("aria-label", `${t.status}: Move ${t.title} to ${nextStatus(t.status)}`);
    cycle.title = `${t.status} → ${nextStatus(t.status)}`;
    cycle.textContent = t.status;
    cycle.onclick = () => onToggle(t);

    const title = document.createElement("span");
    title.className = "coda-task-title";
    title.textContent = t.title;

    const due = document.createElement("input");
    due.type = "date";
    due.className = "coda-input coda-task-due";
    due.setAttribute("aria-label", `Due date for ${t.title}`);
    due.value = t.dueAt ? t.dueAt.slice(0, 10) : "";
    due.onchange = () => onDue(t.id, due.value === "" ? "" : due.value);

    const linkSel = document.createElement("select");
    linkSel.className = "coda-task-link";
    linkSel.setAttribute("aria-label", `Link a note to ${t.title}`);
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Link note…";
    linkSel.append(opt);
    for (const n of notes) {
      const o = document.createElement("option");
      o.value = n.id;
      o.textContent = n.title || "(untitled)";
      if (t.noteIds.includes(n.id)) o.selected = true;
      linkSel.append(o);
    }
    linkSel.onchange = () => {
      if (linkSel.value !== "") onLink(t.id, linkSel.value);
    };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "coda-task-del";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete ${t.title}`);
    del.onclick = () => {
      if (confirm(`Delete task “${t.title}”?`)) onDelete(t.id);
    };

    row.append(cycle, title, due, linkSel, del);
    list.append(row);
  }
  box.append(list);
}

function nextStatus(s: TaskStatus): TaskStatus {
  // Presentation cycle only: todo→doing→done→todo. The repository is
  // the transition enforcer (it throws on illegal targets; the app
  // surfaces that via the status line), so the UI hardcodes no table.
  if (s === "todo") return "doing";
  if (s === "doing") return "done";
  return "todo";
}
