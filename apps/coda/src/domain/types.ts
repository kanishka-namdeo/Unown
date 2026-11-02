/**
 * Coda domain types — pure, serializable, DOM-free.
 *
 * These are the single source of truth for the app's data model. Every
 * entity is plain JSON (no class instances, no symbols, no Date objects)
 * so a store serializing to JSON is a lossless, non-rewrite path to
 * export/sync later.
 */

export type Note = {
  id: string;
  title: string;
  body: string;
  /** ISO-8601 timestamp */
  createdAt: string;
  /** ISO-8601 timestamp */
  updatedAt: string;
  /** user-facing tags, lowercased by the caller if desired; the domain does not enforce casing */
  tags: string[];
};

export type TaskStatus = "todo" | "doing" | "done";

export type Task = {
  id: string;
  /** board the task belongs to; must match a Board.id present in the store */
  boardId: string;
  title: string;
  status: TaskStatus;
  /** optional ISO-8601 due date */
  dueAt?: string;
  /** note ids linked to this task; must reference existing notes */
  noteIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type Board = {
  id: string;
  name: string;
  /**
   * Order of task ids on this board. Integrity rule: the set of task ids
   * for the board must EXACTLY equal `taskOrder` — no orphan tasks, no
   * missing entries. All repository mutations preserve this invariant.
   */
  taskOrder: string[];
  createdAt: string;
  updatedAt: string;
};

export type CodaData = {
  notes: Note[];
  tasks: Task[];
  boards: Board[];
};

export type { CodaData as CodaStoreShape };

/** Result of a domain operation that failed a guard. */
export class DomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainInvariantError";
  }
}
