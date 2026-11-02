/**
 * Notes CRUD — ticket C1.
 */
import { test, expect } from "bun:test";
import { Repository } from "./repository";
import { Store } from "./store";
import { DomainInvariantError } from "./types";

function makeRepo() {
  const store = new Store();
  const repo = new Repository(store, () => "2026-01-01T00:00:00.000Z");
  return { store, repo };
}

test("createNote returns a note with the given title and empty defaults", () => {
  const { repo } = makeRepo();
  const n = repo.createNote({ title: "hello" });
  expect(n.title).toBe("hello");
  expect(n.body).toBe("");
  expect(n.tags).toEqual([]);
  expect(n.createdAt).toBe("2026-01-01T00:00:00.000Z");
  expect(n.updatedAt).toBe(n.createdAt);
});

test("createNote stores tags verbatim", () => {
  const { repo } = makeRepo();
  const n = repo.createNote({ title: "t", tags: ["a", "b"] });
  expect(n.tags).toEqual(["a", "b"]);
});

test("getNote returns a copy (mutating the copy does not affect the store)", () => {
  const { repo } = makeRepo();
  const n = repo.createNote({ title: "t", body: "b" });
  const fetched = repo.getNote(n.id)!;
  fetched.title = "MUTATED";
  expect(repo.getNote(n.id)!.title).toBe("t");
});

test("listNotes returns every note", () => {
  const { repo } = makeRepo();
  repo.createNote({ title: "a" });
  repo.createNote({ title: "b" });
  expect(repo.listNotes().length).toBe(2);
});

test("updateNote bumps only the requested fields + updatedAt", () => {
  const store = new Store();
  let now = 0;
  const clock = () => {
    now += 1000;
    return new Date(now).toISOString();
  };
  const repo = new Repository(store, clock);
  const n = repo.createNote({ title: "orig", body: "orig" });
  expect(now).toBe(1000);
  const updated = repo.updateNote(n.id, { body: "new body" });
  expect(updated.title).toBe("orig");
  expect(updated.body).toBe("new body");
  expect(updated.updatedAt).toBe(new Date(2000).toISOString());
  expect(updated.createdAt).toBe(n.createdAt);
});

test("updateNote replaces tags wholesale", () => {
  const { repo } = makeRepo();
  const n = repo.createNote({ title: "t", tags: ["old"] });
  const updated = repo.updateNote(n.id, { tags: ["new1", "new2"] });
  expect(updated.tags).toEqual(["new1", "new2"]);
});

test("updateNote on a missing id throws", () => {
  const { repo } = makeRepo();
  expect(() => repo.updateNote("ghost", { body: "x" })).toThrow(DomainInvariantError);
});

test("deleteNote removes the note and drops it from task noteIds", () => {
  const { repo } = makeRepo();
  const board = repo.createBoard("B");
  const n = repo.createNote({ title: "linked" });
  const t = repo.createTask({ boardId: board.id, title: "x", noteIds: [n.id] });
  repo.deleteNote(n.id);
  expect(repo.getNote(n.id)).toBeUndefined();
  expect(repo.getTask(t.id)!.noteIds).toEqual([]);
});

test("deleteNote on a missing id throws", () => {
  const { repo } = makeRepo();
  expect(() => repo.deleteNote("nope")).toThrow(DomainInvariantError);
});
