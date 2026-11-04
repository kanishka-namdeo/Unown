/**
 * Domain boot + invariant check — the O-1 executable core (P0 #1).
 *
 * Two tests, green in BOTH lanes:
 *  - Lane A (`cd apps/ostinato && bun test`) — DOM-free enforcement
 *  - Lane B (`bun test apps/ostinato` from the repo root) — masked
 *    by the root happy-dom preload, still enforces the import graph
 *
 * The boot test exercises `assertData` against a valid OstinatoData
 * and three invariant breaches (orphan card, cardOrder set-mismatch,
 * duplicate id) — all expected to throw `DomainInvariantError`. No
 * SM-2 logic, no UI, no persistence: the scheduler + repository are
 * O-2/O-3 seams, and this file deliberately stops at the shape
 * invariants (non-overlap: O-1 skeleton only).
 */
import { test, expect } from "bun:test";
import type { OstinatoData, Card, Deck } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { assertData } from "./invariants.js";

function mkCard(id: string, deckId = "d1"): Card {
  return {
    id,
    deckId,
    front: "**q**",
    back: "a",
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
  };
}

function mkDeck(id: string, names: string[], cardOrder: string[]): Deck {
  return {
    id,
    name: `deck-${id}`,
    cardOrder,
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
  };
}

function validData(): OstinatoData {
  const d1 = mkDeck("d1", "alpha", ["c1", "c2"]);
  return { decks: [d1], cards: [mkCard("c1"), mkCard("c2")] };
}

test("assertData: valid OstinatoData passes", () => {
  assertData(validData());
});

test("assertData: orphan card (unknown deckId) throws", () => {
  const data = validData();
  data.cards.push(mkCard("c3", "ghost"));
  expect(() => assertData(data)).toThrow(DomainInvariantError);
});

test("assertData: cardOrder set-mismatch throws", () => {
  const data = validData();
  data.decks[0].cardOrder = ["c1"]; // c2 missing
  expect(() => assertData(data)).toThrow(DomainInvariantError);
});

test("assertData: duplicate deck id throws", () => {
  const data = validData();
  data.decks.push(mkDeck("d1", "alpha", [])); // duplicate id
  expect(() => assertData(data)).toThrow(DomainInvariantError);
});
