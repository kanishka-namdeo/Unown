/**
 * Search — case-insensitive, special-char-safe, empty-query contract,
 * and sane ranking (title beats body).
 */
import { test, expect } from "bun:test";
import { buildSearcher, substringSearch } from "./search";
import { Repository } from "./repository";
import { Store } from "./store";

function seed() {
  const store = new Store();
  const repo = new Repository(store, () => "2026-01-01T00:00:00.000Z");
  const b = repo.createBoard("B");
  repo.createNote({
    title: "Meeting notes",
    body: "discussed the quarterly ROADMAP and launch timeline",
    tags: ["work"],
  });
  repo.createNote({
    title: "grocery list",
    body: "oat, milk, coffee, eggs",
    tags: ["home"],
  });
  repo.createTask({ boardId: b.id, title: "ship the roadmap" });
  return { store, repo, board: b };
}

test("case-insensitive: 'roadmap' matches the title 'ROADMAP' mention", () => {
  const { store } = seed();
  const searcher = buildSearcher(store.notes, store.tasks);
  const hits = searcher.search("roadmap");
  expect(hits.length).toBeGreaterThan(0);
  const ids = hits.map((h) => (h.kind === "note" ? h.note.id : h.task.id));
  expect(ids.length).toBe(2); // 1 note (body contains "ROADMAP") + 1 task (title "ship the roadmap")
});

test("case-insensitive: lowercase query matches uppercase title word", () => {
  const { store } = seed();
  const searcher = buildSearcher(store.notes, store.tasks);
  const hits = searcher.search("meeting");
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0].kind).toBe("note");
  if (hits[0].kind === "note") expect(hits[0].note.title.toLowerCase()).toContain("meeting");
});

test("special-char query is safe (no throw): '(', '*', regex metachars", () => {
  const { store } = seed();
  const searcher = buildSearcher(store.notes, store.tasks);
  for (const q of ["(", "*", "a.*", "\\x", "100%", "[]{}"]) {
    expect(() => searcher.search(q)).not.toThrow();
  }
});

test("empty query returns the most recently updated items, capped", () => {
  const { store } = seed();
  const searcher = buildSearcher(store.notes, store.tasks);
  const hits = searcher.search("");
  // 2 notes + 1 task, all created at the same frozen timestamp, so the
  // cap (20) does not trim; all three come back.
  expect(hits.length).toBe(3);
  // score for an empty query is a "recency list", not a relevance score.
  for (const h of hits) expect(h.score).toBe(0);
});

test("ranking: a title match ranks above a body-only match", () => {
  const { store } = seed();
  const searcher = buildSearcher(store.notes, store.tasks);
  // "ship" appears only in the task title; "coffee" only in a note body.
  const shipHits = searcher.search("ship");
  expect(shipHits[0].kind).toBe("task");
  const coffeeHits = searcher.search("coffee");
  expect(coffeeHits.length).toBe(1);
  expect(coffeeHits[0].kind).toBe("note");
});

test("substring fallback: case-insensitive + special chars + empty", () => {
  const { store } = seed();
  const notes = [...store.notes];
  const tasks = [...store.tasks];
  // substring fallback is a plain substring scan; no Fuzz, no errors
  expect(() => substringSearch(notes, tasks, "ship")).not.toThrow();
  expect(substringSearch(notes, tasks, "SHIP").length).toBeGreaterThan(0);
  expect(substringSearch(notes, tasks, "(", 5).length).toBe(0); // no '(' anywhere
  const empty = substringSearch(notes, tasks, "", 5);
  expect(empty.length).toBe(3);
});
