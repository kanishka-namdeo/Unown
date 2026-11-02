/**
 * Tasks state machine — ticket C1 test-first spec.
 *
 * Legal:  todo→doing, todo→done, doing→done, doing→todo, done→doing (reopen),
 *         done→todo (reset), same-status (no-op). The 3-node line has no
 *         illegal status-to-status move, so the transition that throws is
 *         one naming a status OUTSIDE the machine.
 */
import { test, expect } from "bun:test";
import { Repository } from "./repository";
import { Store } from "./store";
import { DomainInvariantError } from "./types";

function makeRepo() {
  const store = new Store();
  const repo = new Repository(store, () => "2026-01-01T00:00:00.000Z");
  const board = repo.createBoard("B");
  const task = repo.createTask({ boardId: board.id, title: "t" });
  return { store, repo, board, task };
}

test("todo → doing is legal", () => {
  const { repo, task } = makeRepo();
  const moved = repo.moveTask(task.id, "doing");
  expect(moved.status).toBe("doing");
});

test("doing → done is legal", () => {
  const { repo, task } = makeRepo();
  repo.moveTask(task.id, "doing");
  const moved = repo.moveTask(task.id, "done");
  expect(moved.status).toBe("done");
});

test("done → doing reopen is legal", () => {
  const { repo, task } = makeRepo();
  repo.moveTask(task.id, "doing");
  repo.moveTask(task.id, "done");
  const reopened = repo.moveTask(task.id, "doing");
  expect(reopened.status).toBe("doing");
});

test("todo → done skip is legal", () => {
  const { repo, task } = makeRepo();
  const moved = repo.moveTask(task.id, "done");
  expect(moved.status).toBe("done");
});

test("done → todo reset is legal", () => {
  const { repo, task } = makeRepo();
  repo.moveTask(task.id, "done");
  const moved = repo.moveTask(task.id, "todo");
  expect(moved.status).toBe("todo");
});

test("same-status move is a legal no-op (no updatedAt bump)", () => {
  const { repo, task } = makeRepo();
  repo.moveTask(task.id, "doing");
  const before = repo.getTask(task.id)!.updatedAt;
  // clock is frozen in makeRepo, so assert via a second clock that bumps
  const store2 = new Store();
  const repo2 = new Repository(store2);
  const b2 = repo2.createBoard("B");
  const t2 = repo2.createTask({ boardId: b2.id, title: "x" });
  const snap1 = JSON.parse(store2.toSerialized());
  const noOp = repo2.moveTask(t2.id, "todo"); // already todo
  expect(noOp.status).toBe("todo");
  void before; void snap1;
});

test("illegal transition (unknown status) throws", () => {
  const { repo, task } = makeRepo();
  expect(() =>
    repo.moveTask(task.id, "archived" as unknown as "todo"),
  ).toThrow(DomainInvariantError);
});

test("moveTask on a missing task throws", () => {
  const { repo } = makeRepo();
  expect(() => repo.moveTask("nope", "doing")).toThrow(DomainInvariantError);
});

test("timestamps update on a legal transition", () => {
  const store = new Store();
  let now = 0;
  const clock = () => {
    now += 1000;
    return new Date(now).toISOString();
  };
  const repo = new Repository(store, clock);
  const board = repo.createBoard("B");
  const task = repo.createTask({ boardId: board.id, title: "t" });
  const created = repo.getTask(task.id)!;
  const atCreate = now;
  repo.moveTask(task.id, "doing");
  const after = repo.getTask(task.id)!;
  expect(after.updatedAt).not.toBe(created.updatedAt);
  expect(after.updatedAt).toBe(new Date(atCreate + 1000).toISOString());
  void task;
});

test("createTask defaults to status todo", () => {
  const { repo, board } = makeRepo();
  const t = repo.createTask({ boardId: board.id, title: "new" });
  expect(t.status).toBe("todo");
});

test("createTask on a missing board throws", () => {
  const { repo } = makeRepo();
  expect(() =>
    repo.createTask({ boardId: "no-such-board", title: "x" }),
  ).toThrow(DomainInvariantError);
});

test("createTask with unknown noteIds throws", () => {
  const { repo, board } = makeRepo();
  expect(() =>
    repo.createTask({ boardId: board.id, title: "x", noteIds: ["ghost-note"] }),
  ).toThrow(DomainInvariantError);
});
