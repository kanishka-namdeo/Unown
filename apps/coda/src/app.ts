/**
 * Coda app shell — wiring, state, and mutation handlers.
 *
 * Boot: IDB load → deserialize (corrupt → offer choice, never silently
 * wipe) → seed board on first run. Every domain mutation flows
 * repository → store.toSerialized() → IDB write-through → re-render
 * from the domain's readonly accessors.
 */

import { Repository } from "./domain/repository";
import { Store, DataFormatError, deserialize } from "./domain/store";
import { DomainInvariantError, type Note, type Task, type TaskStatus } from "./domain/types";
import { loadState, saveState, clearState } from "./db/idb";
import { renderShell, type UI } from "./ui/shell";
import { renderNotes } from "./ui/notes";
import { renderEditor, type EditorValue } from "./ui/editor";
import { renderTasks, type TaskRowData } from "./ui/tasks";
import { renderSearch } from "./ui/search";
import { showTransient } from "./ui/status";

export class App {
  private store: Store;
  private repo: Repository;
  private ui: UI;
  private searchQuery = "";
  private activeNoteId: string | null = null;
  private activeTaskId: string | null = null;
  private previewMode = false;
  private persistAsked = false;

  constructor() {
    this.store = new Store();
    this.repo = new Repository(this.store);
    this.ui = renderShell(document.getElementById("coda-root")!);
  }

  async boot(): Promise<void> {
    const root = document.getElementById("coda-root")!;
    this.wireEvents(root);

    try {
      const raw = await loadState();
      if (raw !== null) {
        try {
          const parsed = deserialize(raw);
          this.store.replaceAll(parsed);
          this.repo = new Repository(this.store);
          await this.persist();
          this.renderAll();
          this.ui.status.el.textContent = "Ready.";
        } catch (e) {
          if (e instanceof DataFormatError) {
            await this.corruptState(raw);
            return;
          }
          throw e;
        }
      } else {
        // First run — seed a default board.
        this.repo.createBoard("Inbox");
        await this.persist();
        this.renderAll();
        this.ui.status.el.textContent = "Ready.";
      }
    } catch (err) {
      this.ui.status.el.textContent = "Boot failed: " + (err as Error).message;
    }
  }

  private wireEvents(root: HTMLElement): void {
    this.ui.search.oninput = () => {
      this.searchQuery = this.ui.search.value;
      this.renderSearch();
    };
    root.addEventListener("coda:export", () => void this.exportJson());
    root.addEventListener("coda:import", (ev: Event) => {
      void this.importJson((ev as CustomEvent<{ file: File }>).detail.file);
    });
    root.addEventListener("coda:preview", (ev: Event) => {
      this.previewMode = (ev as CustomEvent<{ on: boolean }>).detail.on;
      this.renderEditor();
    });
  }

  private async persist(): Promise<void> {
    await saveState(this.store.toSerialized());
    // Local-first means fighting eviction: after the first successful IDB
    // write, ask the browser to persist this origin's storage. Feature
    // detected, fire-and-forget, result logged — the app works regardless.
    if (!this.persistAsked && "storage" in navigator && "persist" in navigator.storage) {
      this.persistAsked = true;
      void navigator.storage
        .persist()
        .then((granted) => {
          // eslint-disable-next-line no-console
          console.info(`[coda] storage.persist() ${granted ? "granted" : "not granted"}`);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[coda] storage.persist() failed:", err);
        });
    }
  }

  // ---------- corrupt state ----------

  private async corruptState(raw: string): Promise<void> {
    const body = this.ui.content;
    body.textContent = "";
    const panel = document.createElement("div");
    panel.className = "coda-panel coda-panel--danger";

    const h = document.createElement("h2");
    h.textContent = "Stored data could not be read";
    const p = document.createElement("p");
    p.textContent = "The on-disk state failed structural validation. Choose what to do:";

    const resetBtn = document.createElement("button");
    resetBtn.className = "coda-btn coda-btn--danger";
    resetBtn.textContent = "Reset to empty";
    resetBtn.onclick = () => void this.startFresh("Reset.");

    const exportBtn = document.createElement("button");
    exportBtn.className = "coda-btn";
    exportBtn.textContent = "Export raw (for inspection)";
    exportBtn.onclick = () => this.downloadRaw(raw);

    const discardBtn = document.createElement("button");
    discardBtn.className = "coda-btn coda-btn--ghost";
    discardBtn.textContent = "Start empty (discard)";
    discardBtn.onclick = () => void this.startFresh("Started empty.");

    panel.append(h, p, resetBtn, exportBtn, discardBtn);
    body.append(panel);
    this.ui.status.el.textContent = "Corrupt state.";
  }

  private async startFresh(msg: string): Promise<void> {
    await clearState();
    this.store = new Store();
    this.repo = new Repository(this.store);
    this.activeNoteId = null;
    this.activeTaskId = null;
    this.repo.createBoard("Inbox");
    await this.persist();
    this.renderAll();
    this.ui.status.el.textContent = msg;
  }

  private downloadRaw(raw: string): void {
    const blob = new Blob([raw], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "coda-corrupt-state.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- rendering ----------

  private renderAll(): void {
    this.renderNotes();
    this.renderEditor();
    this.renderTasks();
    this.renderSearch();
  }

  private renderNotes(): void {
    renderNotes(
      this.ui,
      this.repo.listNotes(),
      this.activeNoteId,
      (id) => {
        this.activeNoteId = id;
        this.previewMode = false;
        this.renderAll();
      },
      (id) => void this.deleteNote(id),
      () => void this.newNote(),
    );
  }

  private renderEditor(): void {
    const active: Note | null = this.activeNoteId ? this.repo.getNote(this.activeNoteId) ?? null : null;
    renderEditor(this.ui, active, this.previewMode, (v) => void this.saveNote(v));
  }

  private renderTasks(): void {
    const board = this.repo.listBoards()[0];
    if (!board) {
      this.ui.tasks.textContent = "";
      return;
    }
    const tasks: TaskRowData[] = this.repo.listTasks(board.id).map((t: Task) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt,
      noteIds: [...t.noteIds],
    }));
    renderTasks(
      this.ui,
      { id: board.id, name: board.name },
      tasks,
      (t) => void this.toggleTask(t),
      () => void this.newTask(),
      (id) => void this.deleteTask(id),
      (id, val) => void this.setDue(id, val),
      (id, noteId) => void this.linkNote(id, noteId),
      this.repo.listNotes(),
      this.activeTaskId,
    );
  }

  private renderSearch(): void {
    renderSearch(
      this.ui,
      this.searchQuery,
      this.repo.listNotes(),
      this.repo.listTasks(),
      (id) => {
        this.clearSearch();
        this.activeNoteId = id;
        this.previewMode = false;
        this.renderAll();
      },
      (id) => {
        this.clearSearch();
        this.activeTaskId = id;
        this.renderTasks();
      },
    );
  }

  private clearSearch(): void {
    this.searchQuery = "";
    this.ui.search.value = "";
    // Re-render results so they clear (renderAll re-invokes renderSearch).
  }

  // ---------- note mutations ----------

  private async newNote(): Promise<void> {
    try {
      const note = this.repo.createNote({ title: "", body: "", tags: [] });
      this.activeNoteId = note.id;
      this.previewMode = false;
      await this.persist();
      this.renderAll();
      showTransient(this.ui.status.el, "New note created.");
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Create failed: " + e.message, true);
      }
    }
  }

  private async deleteNote(id: string): Promise<void> {
    try {
      this.repo.deleteNote(id);
      if (this.activeNoteId === id) this.activeNoteId = null;
      await this.persist();
      this.renderAll();
      showTransient(this.ui.status.el, "Note deleted.");
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Delete failed: " + e.message, true);
      }
    }
  }

  private async saveNote(v: EditorValue): Promise<void> {
    try {
      if (this.activeNoteId) {
        this.repo.updateNote(this.activeNoteId, v);
      } else {
        const created = this.repo.createNote(v);
        this.activeNoteId = created.id;
      }
      await this.persist();
      this.renderAll();
      showTransient(this.ui.status.el, "Saved.");
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Save failed: " + e.message, true);
      } else {
        throw e;
      }
    }
  }

  // ---------- task mutations ----------

  private async newTask(): Promise<void> {
    const board = this.repo.listBoards()[0];
    if (!board) return;
    const title = prompt("Task title:");
    if (title === null) return;
    try {
      this.repo.createTask({ boardId: board.id, title: title.trim() === "" ? "(untitled)" : title });
      await this.persist();
      this.renderTasks();
      showTransient(this.ui.status.el, "Task created.");
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Create failed: " + e.message, true);
      }
    }
  }

  private async toggleTask(t: TaskRowData): Promise<void> {
    const next: TaskStatus = t.status === "todo" ? "doing" : t.status === "doing" ? "done" : "todo";
    try {
      this.repo.moveTask(t.id, next);
      await this.persist();
      this.renderTasks();
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Status change failed: " + e.message, true);
      }
    }
  }

  private async deleteTask(id: string): Promise<void> {
    try {
      this.repo.deleteTask(id);
      if (this.activeTaskId === id) this.activeTaskId = null;
      await this.persist();
      this.renderTasks();
      showTransient(this.ui.status.el, "Task deleted.");
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Delete failed: " + e.message, true);
      }
    }
  }

  private async setDue(id: string, value: string): Promise<void> {
    try {
      const dueAt: string | null = value === "" ? null : value;
      this.repo.updateTask(id, { dueAt });
      await this.persist();
      this.renderTasks();
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Update failed: " + e.message, true);
      }
    }
  }

  private async linkNote(taskId: string, noteId: string): Promise<void> {
    const task = this.repo.getTask(taskId);
    if (!task) return;
    const links = [...task.noteIds];
    const i = links.indexOf(noteId);
    if (i >= 0) links.splice(i, 1);
    else links.push(noteId);
    try {
      this.repo.updateTask(taskId, { noteIds: links });
      await this.persist();
      this.renderTasks();
    } catch (e) {
      if (e instanceof DomainInvariantError) {
        showTransient(this.ui.status.el, "Link failed: " + e.message, true);
      }
    }
  }

  // ---------- export / import (the local-first proof) ----------

  async exportJson(): Promise<void> {
    const data = this.store.toSerialized();
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "coda-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showTransient(this.ui.status.el, "Exported.");
  }

  async importJson(file: File): Promise<void> {
    const text = await file.text();
    try {
      const data = deserialize(text);
      this.store.replaceAll(data);
      this.repo = new Repository(this.store);
      this.activeNoteId = null;
      this.activeTaskId = null;
      await this.persist();
      this.renderAll();
      showTransient(this.ui.status.el, "Imported.");
    } catch (e) {
      if (e instanceof DataFormatError) {
        showTransient(this.ui.status.el, "Import failed: invalid document.", true);
      } else {
        throw e;
      }
    }
  }
}
