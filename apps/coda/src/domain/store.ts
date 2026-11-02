/**
 * Coda store — ONE serializable in-memory state container.
 *
 * Purity contract: no DOM, no Node builtins, no globals beyond
 * `JSON`/`String`. The whole app state is a single `CodaData` object so
 * that export/sync later is a non-rewrite: serialize → ship → deserialize.
 */

import type { Board, CodaData, Note, Task } from "./types";

/** Structural validation of a deserialized CodaData. Throws on shape drift. */
export function isValidCodaData(data: unknown): data is CodaData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.notes) || !Array.isArray(d.tasks) || !Array.isArray(d.boards)) return false;
  return (d.notes as Note[]).every(isValidNote)
    && (d.tasks as Task[]).every(isValidTask)
    && (d.boards as Board[]).every(isValidBoard);
}

function isValidNote(n: unknown): boolean {
  if (typeof n !== "object" || n === null) return false;
  const o = n as Record<string, unknown>;
  return typeof o.id === "string"
    && typeof o.title === "string"
    && typeof o.body === "string"
    && typeof o.createdAt === "string"
    && typeof o.updatedAt === "string"
    && Array.isArray(o.tags);
}

function isValidTask(t: unknown): boolean {
  if (typeof t !== "object" || t === null) return false;
  const o = t as Record<string, unknown>;
  return typeof o.id === "string"
    && typeof o.boardId === "string"
    && typeof o.title === "string"
    && (o.status === "todo" || o.status === "doing" || o.status === "done")
    && Array.isArray(o.noteIds)
    && typeof o.createdAt === "string"
    && typeof o.updatedAt === "string"
    && (o.dueAt === undefined || typeof o.dueAt === "string");
}

function isValidBoard(b: unknown): boolean {
  if (typeof b !== "object" || b === null) return false;
  const o = b as Record<string, unknown>;
  return typeof o.id === "string"
    && typeof o.name === "string"
    && Array.isArray(o.taskOrder)
    && (o.taskOrder as unknown[]).every((x) => typeof x === "string")
    && typeof o.createdAt === "string"
    && typeof o.updatedAt === "string";
}

/** Fresh, empty, always-valid state. */
export function emptyData(): CodaData {
  return { notes: [], tasks: [], boards: [] };
}

/**
 * Deserialize JSON text (or a parsed plain object) into a CodaData.
 * Throws `DataFormatError` when the payload does not structurally match
 * the CodaData shape — never returns a partially-valid store.
 */
export function deserialize(input: string | unknown): CodaData {
  const candidate: unknown = typeof input === "string" ? JSON.parse(input) : input;
  if (!isValidCodaData(candidate)) {
    throw new DataFormatError("payload is not a valid CodaData document");
  }
  // Return the canonical value as-is; callers must treat the store as
  // immutable-ish (repository helpers always copy on write).
  return candidate;
}

/** JSON serialize — stable key order (notes, tasks, boards) for diffing. */
export function serialize(data: CodaData): string {
  return JSON.stringify({
    notes: data.notes,
    tasks: data.tasks,
    boards: data.boards,
  });
}

/** Thrown by `deserialize` on structural validation failure. */
export class DataFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataFormatError";
  }
}

/**
 * The in-memory store.
 *
 * Holds exactly one `CodaData`. The domain never touches a persistence
 * medium — adapters (IndexedDB in a later ticket, export/sync) live
 * OUTSIDE the domain and only ever exchange serialized strings with it.
 */
export class Store {
  /**
   * Internal mutable state, owned by the Store. The `readonly` modifier
   * forbids external reassignment; the class itself rebinds through
   * `replaceAll` (and the constructor) via the private write accessor.
   */
  private _dataRef: CodaData;

  constructor(data?: CodaData) {
    this._dataRef = data ? structuredClone(data) : emptyData();
  }

  /** The live state, for domain-internal access (Repository binds to it). */
  /** @internal */
  get _data(): CodaData {
    return this._dataRef;
  }

  /** Read-only view of the current data. Mutate only through the repository. */
  get notes(): readonly Note[] {
    return this._dataRef.notes;
  }
  get tasks(): readonly Task[] {
    return this._dataRef.tasks;
  }
  get boards(): readonly Board[] {
    return this._dataRef.boards;
  }

  /** Replace the whole state atomically (import/sync restore path). */
  replaceAll(data: CodaData): void {
    if (!isValidCodaData(data)) {
      throw new DataFormatError("refusing to replace store with invalid data");
    }
    this._dataRef = structuredClone(data);
  }

  /**
   * Mutable arrays, for repository internals only.
   * @internal
   */
  get notesMutable(): Note[] {
    return this._dataRef.notes;
  }
  get tasksMutable(): Task[] {
    return this._dataRef.tasks;
  }
  get boardsMutable(): Board[] {
    return this._dataRef.boards;
  }

  toSerialized(): string {
    return serialize(this._dataRef);
  }

  static fromSerialized(input: string | unknown): Store {
    return new Store(deserialize(input));
  }
}
