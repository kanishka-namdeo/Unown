/**
 * O-3 queue-nav tests (Lane A — DOM-free, runs under `cd
 * apps/ostinato && bun test`). Covers the P0 #4 hardening row:
 *
 *   - j/k wrap (the selection ring survives an over-scroll)
 *   - g/G absolute bounds
 *   - filtered-view math (selection survives filtering)
 *   - the `/` search predicate (empty query = the unfiltered view)
 */
import { test, expect } from "bun:test";
import type { Card } from "../domain/ports.js";
import {
  selectQueuePosition,
  selectQueuePositionWithFilter,
  matchCardInFilter,
  filterCards,
  type NavigateCmdId,
} from "./queue-nav.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────

function mkCard(id: string, front = `front ${id}`, back = `back ${id}`): Card {
  return {
    id,
    deckId: "d1",
    front,
    back,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
  };
}

const IDS = ["c1", "c2", "c3", "c4"];
const CARDS: Card[] = [
  mkCard("c1", "apple pie", "a dessert"),
  mkCard("c2", "banana smoothie", "a drink"),
  mkCard("c3", "cherry tart", "a dessert"),
  mkCard("c4", "date cake", "a dessert"),
];

// ─── selectQueuePosition: the plain (unfiltered) queue math ────────────

test("selectQueuePosition: j/k WRAP at both ends (the hardening row)", () => {
  expect(selectQueuePosition(IDS, 0, "next-card")).toBe(1);
  expect(selectQueuePosition(IDS, 0, "prev-card")).toBe(3); // head wraps to tail
  expect(selectQueuePosition(IDS, 3, "next-card")).toBe(0); // tail wraps to head
  expect(selectQueuePosition(IDS, 3, "prev-card")).toBe(2);
});

test("selectQueuePosition: g/G are absolute bounds (no wrap)", () => {
  expect(selectQueuePosition(IDS, 2, "first-card")).toBe(0);
  expect(selectQueuePosition(IDS, 1, "last-card")).toBe(3);
});

test("selectQueuePosition: a single-element queue is a no-op for j/k", () => {
  expect(selectQueuePosition(["x"], 0, "next-card")).toBe(0);
  expect(selectQueuePosition(["x"], 0, "prev-card")).toBe(0);
});

test("selectQueuePosition: an empty queue is a total function → 0", () => {
  expect(selectQueuePosition([], 5, "next-card")).toBe(0);
});

test("selectQueuePosition: a drifted out-of-range index re-clamps before moving", () => {
  // index 99 on a 4-item queue clamps to 3; j wraps to 0, k lands on 2.
  expect(selectQueuePosition(IDS, 99, "next-card")).toBe(0);
  expect(selectQueuePosition(IDS, 99, "prev-card")).toBe(2);
  // index −1 clamps to 0; k from the clamped head WRAPS to the tail.
  expect(selectQueuePosition(IDS, -1, "next-card")).toBe(1);
  expect(selectQueuePosition(IDS, -1, "prev-card")).toBe(3);
});

test("selectQueuePosition: every command id is a NavigateCmdId (total dispatch)", () => {
  const cmds: NavigateCmdId[] = ["next-card", "prev-card", "first-card", "last-card"];
  for (const c of cmds) {
    expect(selectQueuePosition(IDS, 1, c)).toBeGreaterThanOrEqual(0);
    expect(selectQueuePosition(IDS, 1, c)).toBeLessThan(IDS.length);
  }
});

// ─── selectQueuePositionWithFilter: selection survives filtering ──────

test("filtered view: j/k walk only the FILTERED cards (skips non-matches)", () => {
  // c1/c3/c4 match "dessert" (case-insensitive); c2 is filtered out.
  const filter = (id: string) => {
    const card = CARDS.find((c) => c.id === id);
    return card !== undefined && matchCardInFilter("dessert", card);
  };
  const filtered = IDS.map((id) => id).filter((id) => filter(id));
  expect(filtered).toEqual(["c1", "c3", "c4"]);

  // From c1 (absolute pos 0), j → c3 (absolute pos 2, skipping c2).
  expect(selectQueuePositionWithFilter(IDS, 0, "next-card", filter)).toBe(2);
  // From c3, j → c4.
  expect(selectQueuePositionWithFilter(IDS, 2, "next-card", filter)).toBe(3);
  // From c4, j WRAPS to c1 (the filtered wrap, not the absolute tail).
  expect(selectQueuePositionWithFilter(IDS, 3, "next-card", filter)).toBe(0);
  // From c1, k WRAPS to c4 (the filtered head wraps to the filtered tail).
  expect(selectQueuePositionWithFilter(IDS, 0, "prev-card", filter)).toBe(3);
});

test("filtered view: g/G land on the first/last FILTERED card", () => {
  const filter = (id: string) => {
    const card = CARDS.find((c) => c.id === id);
    return card !== undefined && matchCardInFilter("dessert", card);
  };
  expect(selectQueuePositionWithFilter(IDS, 3, "first-card", filter)).toBe(0); // c1
  expect(selectQueuePositionWithFilter(IDS, 0, "last-card", filter)).toBe(3); // c4
});

test("filtered view: the current index points at a non-matching card → snaps to the next filtered card", () => {
  const filter = (id: string) => {
    const card = CARDS.find((c) => c.id === id);
    return card !== undefined && matchCardInFilter("dessert", card);
  };
  // Absolute index 1 is c2 (filtered out); j snaps to c3 (pos 2) then advances to c4 (pos 3).
  expect(selectQueuePositionWithFilter(IDS, 1, "next-card", filter)).toBe(3);
  // k from c2 snaps forward to c3 (the first filtered card ≥ the clamp) then back to c1.
  expect(selectQueuePositionWithFilter(IDS, 1, "prev-card", filter)).toBe(0);
});

test("filtered view: a filter with zero matches is a total function", () => {
  const noMatch = (_id: string) => false;
  // Falls back to a clamped plain index (the unfiltered re-clamp rule).
  expect(selectQueuePositionWithFilter(IDS, 1, "next-card", noMatch)).toBe(1);
  expect(selectQueuePositionWithFilter(IDS, 99, "last-card", noMatch)).toBe(3);
});

test("filtered view: an identity filter is identical to the plain selector", () => {
  const identity = (_id: string) => true;
  for (let i = 0; i < IDS.length; i++) {
    for (const cmd of ["next-card", "prev-card", "first-card", "last-card"] as NavigateCmdId[]) {
      expect(selectQueuePositionWithFilter(IDS, i, cmd, identity)).toBe(
        selectQueuePosition(IDS, i, cmd),
      );
    }
  }
});

// ─── matchCardInFilter: the / predicate ─────────────────────────────────

test("matchCardInFilter: an empty/whitespace query matches every card", () => {
  for (const c of CARDS) {
    expect(matchCardInFilter("", c)).toBe(true);
    expect(matchCardInFilter("   ", c)).toBe(true);
  }
});

test("matchCardInFilter: case-insensitive substring over front/back/id", () => {
  expect(matchCardInFilter("dessert", CARDS[0])).toBe(true); // back
  expect(matchCardInFilter("DESSERT", CARDS[0])).toBe(true); // case-insensitive
  expect(matchCardInFilter("apple", CARDS[0])).toBe(true); // front
  expect(matchCardInFilter("c2", CARDS[1])).toBe(true); // id
  expect(matchCardInFilter("drink", CARDS[1])).toBe(true); // back
});

test("matchCardInFilter: a non-matching query is false", () => {
  expect(matchCardInFilter("zebra", CARDS[0])).toBe(false);
  expect(matchCardInFilter("  ", CARDS[0])).toBe(true); // whitespace = unfiltered
});

// ─── filterCards: the list-view result ──────────────────────────────────

test("filterCards: empty query → the unfiltered view (identity, same array)", () => {
  expect(filterCards(CARDS, "")).toBe(CARDS);
  expect(filterCards(CARDS, "   ")).toBe(CARDS);
});

test("filterCards: narrows to matches, preserves input order", () => {
  const q = filterCards(CARDS, "dessert");
  expect(q.map((c) => c.id)).toEqual(["c1", "c3", "c4"]); // c2 (a drink) drops out
});
