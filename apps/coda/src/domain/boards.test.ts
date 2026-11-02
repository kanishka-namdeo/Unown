/**
 * Boards + taskOrder integrity — ticket C1.
 *
 * Invariant under test: for every board, the SET of task ids on that
 * board EXACTLY equals `board.taskOrder`. Every mutation that touches
 * a task or a board rewrites `taskOrder` in the same step.
 */
import { test, expect } from "bun:test";
import { Repository } from "./repository";
import { Store, deserialize, serialize } from "./store";
import { DomainInvariantError } from "./types";

function makeRepo() {
  const store = new Store();
  const repo = new Repository(store, () => "2026-01-01T00:00:00.000Z");
  return { store, repo };
}

function taskIdsOn(repo: Repository, boardId: string): string[] {
  return repo
    .listTasks(boardId)
    .map((t) => t.id);
}

test("createBoard yields an empty board", () => {
  const { repo } = makeRepo();
  const b = repo.createBoard("Inbox");
  expect(b.name).toBe("Inbox");
  expect(b.taskOrder).toEqual([]);
});

test("createTask appends its id to board.taskOrder", () => {
  const { repo } = makeRepo();
  const b = repo.createBoard("B");
  const t1 = repo.createTask({ boardId: b.id, title: "one" });
  const t2 = repo.createTask({ boardId: b.id, title: "two" });
  expect(repo.getBoard(b.id)!.taskOrder).toEqual([t1.id, t2.id]);
});

test("listTasks returns tasks in board order", () => {
  const { repo } = makeRepo();
  const b = repo.createBoard("B");
  const t1 = repo.createTask({ boardId: b.id, title: "one" });
  const t2 = repo.createTask({ boardId: b.id, title: "two" });
  repo.reorderTasks(b.id, [t2.id, t1.id]);
  const ids = taskIdsOn(repo, b.id);
  expect(ids).toEqual([t2.id, t1.id]);
});

test("deleteTask removes the id from board.taskOrder", () => {
  const { repo } = makeRepo();
  const b = repo.createBoard("B");
  const t1 = repo.createTask({ boardId: b.id, title: "one" });
  const t2 = repo.createTask({ boardId: b.id, title: "two" });
  repo.deleteTask(t1.id);
  expect(repo.getBoard(b.id)!.taskOrder).toEqual([t2.id]);
});

test("reorderTasks validates the supplied ids are exactly the board's set", () => {
  const { repo } = makeRepo();
  const b = repo.createBoard("B");
  const t1 = repo.createTask({ boardId: b.id, title: "one" });
  const t2 = repo.createTask({ boardId: b.id, title: "two" });
  // unknown id rejected
  expect(() =>
    repo.reorderTasks(b.id, [t1.id, "ghost"]),
  ).toThrow(DomainInvariantError);
  // duplicate / short list rejected
  expect(() =>
    repo.reorderTasks(b.id, [t1.id]),
  ).toThrow(DomainInvariantError);
  // legal reorder works
  repo.reorderTasks(b.id, [t2.id, t1.id]);
  expect(repo.getBoard(b.id)!.taskOrder).toEqual([t2.id, t1.id]);
});

test("deleteBoard cascades its tasks and preserves the invariant elsewhere", () => {
  const { repo } = makeRepo();
  const b1 = repo.createBoard("one");
  const b2 = repo.createBoard("two");
  const t1 = repo.createTask({ boardId: b1.id, title: "a" });
  repo.createTask({ boardId: b2.id, title: "b" });
  repo.deleteBoard(b1.id);
  expect(repo.getBoard(b1.id)).toBeUndefined();
  expect(repo.getTask(t1.id)).toBeUndefined();
  // b2 untouched
  expect(repo.getBoard(b2.id)!.taskOrder.length).toBe(1);
});

test("serialize → deserialize preserves taskOrder exactly", () => {
  const { store, repo } = makeRepo();
  const b = repo.createBoard("B");
  const t1 = repo.createTask({ boardId: b.id, title: "one" });
  const t2 = repo.createTask({ boardId: b.id, title: "two" });
  repo.reorderTasks(b.id, [t2.id, t1.id]);
  const json = serialize(deserialize(store.toSerialized()));
  const revived = deserialize(json);
  expect(revived.boards[0].taskOrder).toEqual([t2.id, t1.id]);
});

test("createBoard with an existing name is allowed (ids are unique, names are not)", () => {
  const { repo } = makeRepo();
  repo.createBoard("same");
  const b = repo.createBoard("same");
  expect(repo.listBoards().length).toBe(2);
  void b;
});
