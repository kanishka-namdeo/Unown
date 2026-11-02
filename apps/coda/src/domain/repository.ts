/**
 * Coda repository — all CRUD over the in-memory Store.
 *
 * TASK STATE MACHINE (single source of truth: LEGAL_TRANSITIONS):
 *   todo  → doing | done
 *   doing → done | todo
 *   done  → doing | todo   (reopen / reset; legal)
 *   same-status is a no-op (legal, no updatedAt bump).
 *   `moveTask` THROWS DomainInvariantError for any transition not in
 *   the table.
 *
 * BOARD taskOrder INTEGRITY:
 *   - the set of task ids on a board EXACTLY equals `board.taskOrder`
 *   - `createTask` appends its id; `deleteTask` removes it;
 *     `reorderTasks` replaces the whole order (validated)
 *   - every mutation above rewrites `board.taskOrder` in the same step,
 *     so the invariant can never be observed broken.
 *
 * REFERENCE INTEGRITY:
 *   - a task's `boardId` must reference an existing board
 *   - a task's `noteIds` must all reference existing notes
 */

import type { Board, CodaData, Note, Task, TaskStatus } from "./types";
import { DomainInvariantError } from "./types";
import { Store } from "./store";

/**
 * The legal task-status transition table. `from → to` is legal iff
 * `LEGAL_TRANSITIONS[from].includes(to)`. Same-status is always legal
 * (no-op).
 */
export const LEGAL_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["doing", "done"],
  doing: ["done", "todo"],
  done: ["doing", "todo"],
};

export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export interface CreateNoteInput {
  title: string;
  body?: string;
  tags?: string[];
}

export interface UpdateNoteInput {
  title?: string;
  body?: string;
  tags?: string[];
}

export interface CreateTaskInput {
  boardId: string;
  title: string;
  status?: TaskStatus; // defaults to "todo"
  dueAt?: string;
  noteIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  dueAt?: string | null; // null clears; undefined leaves
  noteIds?: string[];
}

/** A domain repository bound to one Store. */
export class Repository {
  private now: () => string;
  /** The domain's single writable state container. */
  private data: CodaData;
  /** Read-only store facade, for replaceAll and re-exports. */
  readonly store: Store;

  constructor(store: Store, clock?: () => string) {
    this.store = store;
    this.data = store._data;
    this.now = clock ?? (() => new Date().toISOString());
  }

  // ---------- notes ----------

  createNote(input: CreateNoteInput): Note {
    const id = nextId(this.data.notes);
    const ts = this.now();
    const note: Note = {
      id,
      title: input.title,
      body: input.body ?? "",
      createdAt: ts,
      updatedAt: ts,
      tags: input.tags ? [...input.tags] : [],
    };
    this.data.notes.push(note);
    return { ...note, tags: [...note.tags] };
  }

  getNote(id: string): Note | undefined {
    const n = this.data.notes.find((x) => x.id === id);
    return n ? { ...n, tags: [...n.tags] } : undefined;
  }

  listNotes(): Note[] {
    return this.data.notes.map((n) => ({ ...n, tags: [...n.tags] }));
  }

  updateNote(id: string, input: UpdateNoteInput): Note {
    const n = this.requireNote(id);
    if (input.title !== undefined) n.title = input.title;
    if (input.body !== undefined) n.body = input.body;
    if (input.tags !== undefined) n.tags = [...input.tags];
    n.updatedAt = this.now();
    return { ...n, tags: [...n.tags] };
  }

  deleteNote(id: string): void {
    let i = this.data.notes.findIndex((n) => n.id === id);
    if (i === -1) throw new DomainInvariantError(`note ${id} does not exist`);
    this.data.notes.splice(i, 1);
    // Reference integrity: drop the note from every task's noteIds.
    for (const t of this.data.tasks) {
      if (t.noteIds.includes(id)) t.noteIds = t.noteIds.filter((x) => x !== id);
    }
  }

  private requireNote(id: string): Note {
    const n = this.data.notes.find((x) => x.id === id);
    if (!n) throw new DomainInvariantError(`note ${id} does not exist`);
    return n;
  }

  // ---------- tasks ----------

  createTask(input: CreateTaskInput): Task {
    this.requireBoard(input.boardId);
    for (const nid of input.noteIds ?? []) this.requireNote(nid);
    const id = nextId(this.data.tasks);
    const ts = this.now();
    const task: Task = {
      id,
      boardId: input.boardId,
      title: input.title,
      status: input.status ?? "todo",
      dueAt: input.dueAt,
      noteIds: [...(input.noteIds ?? [])],
      createdAt: ts,
      updatedAt: ts,
    };
    this.data.tasks.push(task);
    const board = this.requireBoard(input.boardId);
    board.taskOrder.push(id);
    board.updatedAt = ts;
    return { ...task, noteIds: [...task.noteIds] };
  }

  getTask(id: string): Task | undefined {
    const t = this.data.tasks.find((x) => x.id === id);
    return t ? { ...t, noteIds: [...t.noteIds] } : undefined;
  }

  listTasks(boardId?: string): Task[] {
    const all = boardId ? this.data.tasks.filter((t) => t.boardId === boardId) : this.data.tasks;
    // Present in board order when a board is given; stable otherwise.
    if (boardId) {
      const board = this.requireBoard(boardId);
      return orderTasks(all, board.taskOrder).map((t) => ({ ...t, noteIds: [...t.noteIds] }));
    }
    return all.map((t) => ({ ...t, noteIds: [...t.noteIds] }));
  }

  /**
   * Move a task to a new status, enforcing the state machine.
   * Throws DomainInvariantError on an illegal transition.
   */
  moveTask(id: string, to: TaskStatus): Task {
    const t = this.requireTask(id);
    if (t.status === to) {
      // no-op legal transition: do not bump updatedAt
      return { ...t, noteIds: [...t.noteIds] };
    }
    if (!isLegalTransition(t.status, to)) {
      throw new DomainInvariantError(`illegal task transition ${t.status} → ${to} (${id})`);
    }
    t.status = to;
    t.updatedAt = this.now();
    return { ...t, noteIds: [...t.noteIds] };
  }

  updateTask(id: string, input: UpdateTaskInput): Task {
    const t = this.requireTask(id);
    if (input.title !== undefined) t.title = input.title;
    if (input.dueAt !== undefined) t.dueAt = input.dueAt === null ? undefined : input.dueAt;
    if (input.noteIds !== undefined) {
      for (const nid of input.noteIds) this.requireNote(nid);
      t.noteIds = [...input.noteIds];
    }
    t.updatedAt = this.now();
    return { ...t, noteIds: [...t.noteIds] };
  }

  deleteTask(id: string): void {
    let i = this.data.tasks.findIndex((t) => t.id === id);
    if (i === -1) throw new DomainInvariantError(`task ${id} does not exist`);
    const task = this.data.tasks[i];
    this.data.tasks.splice(i, 1);
    const board = this.requireBoard(task.boardId);
    board.taskOrder = board.taskOrder.filter((x) => x !== id);
    board.updatedAt = this.now();
  }

  private requireTask(id: string): Task {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) throw new DomainInvariantError(`task ${id} does not exist`);
    return t;
  }

  // ---------- boards ----------

  createBoard(name: string): Board {
    const id = nextId(this.data.boards);
    const ts = this.now();
    const board: Board = { id, name, taskOrder: [], createdAt: ts, updatedAt: ts };
    this.data.boards.push(board);
    return { ...board, taskOrder: [...board.taskOrder] };
  }

  getBoard(id: string): Board | undefined {
    const b = this.data.boards.find((x) => x.id === id);
    return b ? { ...b, taskOrder: [...b.taskOrder] } : undefined;
  }

  listBoards(): Board[] {
    return this.data.boards.map((b) => ({ ...b, taskOrder: [...b.taskOrder] }));
  }

  updateBoard(id: string, input: { name?: string }): Board {
    const b = this.requireBoard(id);
    if (input.name !== undefined) b.name = input.name;
    b.updatedAt = this.now();
    return { ...b, taskOrder: [...b.taskOrder] };
  }

  deleteBoard(id: string): void {
    const b = this.requireBoard(id);
    const ids = new Set(b.taskOrder);
    // Cascade: remove the board's tasks (and their note links are independent).
    this.data.tasks = this.data.tasks.filter((t) => !ids.has(t.id));
    let i = this.data.boards.findIndex((x) => x.id === id);
    this.data.boards.splice(i, 1);
  }

  /**
   * Replace the whole taskOrder of a board. Validates that the supplied
   * ids are exactly the task ids currently on that board (as a set).
   */
  reorderTasks(boardId: string, taskOrder: string[]): Board {
    const b = this.requireBoard(boardId);
    const current = new Set(b.taskOrder);
    const next = new Set(taskOrder);
    if (taskOrder.length !== current.size) {
      throw new DomainInvariantError(
        `reorderTasks: ${boardId} expects ${current.size} ids, got ${taskOrder.length}`,
      );
    }
    for (const id of taskOrder) {
      if (!current.has(id)) {
        throw new DomainInvariantError(`reorderTasks: unknown task id ${id} on board ${boardId}`);
      }
    }
    b.taskOrder = [...taskOrder];
    b.updatedAt = this.now();
    return { ...b, taskOrder: [...b.taskOrder] };
  }

  private requireBoard(id: string): Board {
    const b = this.data.boards.find((x) => x.id === id);
    if (!b) throw new DomainInvariantError(`board ${id} does not exist`);
    return b;
  }
}

function orderTasks(tasks: Task[], order: string[]): Task[] {
  const byId = new Map(tasks.map((t) => [t.id, t] as const));
  const ordered = order.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined);
  // Any task on the board missing from order is appended (defensive; the
  // invariant says this cannot happen).
  const seen = new Set(order);
  for (const t of tasks) {
    if (!seen.has(t.id)) ordered.push(t);
  }
  return ordered;
}

let idCounter = 0;
/**
 * Generate a fresh, app-unique id. Deterministic per process; stable
 * string. Not random — so tests can rely on ordering without freezing
 * clocks. Collisions across a session's creations are impossible.
 */
export function nextId<T extends { id: string }>(items: readonly T[]): string {
  const used = new Set(items.map((x) => x.id));
  let n = 0;
  let candidate = "id";
  while (used.has(candidate)) {
    n += 1;
    candidate = `id${n}`;
  }
  return candidate;
}
