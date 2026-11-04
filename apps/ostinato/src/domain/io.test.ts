/**
 * IO tests — P0 #7 (JSON round-trip lossless, byte-stable).
 *
 * Pinned at O-2 (Lane A). The matrix lane I-1: same data, two
 * sequential boots → identical export bytes.
 *
 * Coverage:
 *   1. Byte-stability: serialize → parse → serialize → byte-identical
 *   2. Corrupt-import rejection: DomainInvariantError on
 *      - truncated JSON
 *      - foreign payload (valid JSON, wrong shape)
 *      - invariant-violating data (sm2 easiness out of bounds)
 *   3. emptyData() round-trips to itself
 *
 * All tests are DOM-free and run green in both Lane A and Lane B.
 */
import { test, expect } from "bun:test";
import type { OstinatoData, Card } from "./types.js";
import { DomainInvariantError } from "./types.js";
import { toCanonicalJson, importExport } from "./io.js";
import { emptyData } from "./model.js";

/**
 * Build a small OstinatoData with one deck and two cards carrying
 * distinct SM-2 states.
 */
function makeSmallData(): OstinatoData {
  const c1: Card = {
    id: "c1",
    deckId: "d1",
    front: "What is 2+2?",
    back: "4",
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T00:00:00Z",
  };
  const c2: Card = {
    id: "c2",
    deckId: "d1",
    front: "Capital of France?",
    back: "Paris",
    createdAt: "2026-11-04T00:00:00Z",
    updatedAt: "2026-11-04T12:00:00Z",
    sm2: {
      repetitions: 2,
      easiness: 1.86,
      interval: 6,
      lastReviewedAt: "2026-11-04T10:00:00Z",
    },
  };
  return {
    decks: [
      {
        id: "d1",
        name: "Test Deck",
        cardOrder: ["c1", "c2"],
        createdAt: "2026-11-04T00:00:00Z",
        updatedAt: "2026-11-04T00:00:00Z",
      },
    ],
    cards: [c1, c2],
  };
}

test("io: byte-stable round-trip — two serializations of the same data are identical", () => {
  const data = makeSmallData();
  const s1 = toCanonicalJson(data);
  // Parse back, re-serialize
  const parsed = JSON.parse(s1) as OstinatoData;
  const s2 = toCanonicalJson(parsed);
  expect(s2).toBe(s1);
});

test("io: importExport.exportData equals toCanonicalJson", () => {
  const data = makeSmallData();
  expect(importExport.exportData(data)).toBe(toCanonicalJson(data));
});

test("io: importExport.importData round-trips exportData", () => {
  const data = makeSmallData();
  const json = importExport.exportData(data);
  const back = importExport.importData(json);
  expect(back.decks).toEqual(data.decks);
  expect(back.cards).toEqual(data.cards);
});

test("io: truncated JSON throws DomainInvariantError", () => {
  const data = makeSmallData();
  const full = importExport.exportData(data);
  // Truncate mid-document (not valid JSON)
  const truncated = full.slice(0, full.length - 5);
  expect(() => importExport.importData(truncated)).toThrow(DomainInvariantError);
});

test("io: foreign payload (valid JSON, wrong shape) throws DomainInvariantError", () => {
  // Valid JSON but missing the expected top-level keys
  expect(() => importExport.importData('{"foo":1}')).toThrow(DomainInvariantError);
  // Root is an array, not an object
  expect(() => importExport.importData("[1,2,3]")).toThrow(DomainInvariantError);
  // Root is a string
  expect(() => importExport.importData('"hello"')).toThrow(DomainInvariantError);
});

test("io: invariant-violating data (sm2 easiness < 1.3) throws DomainInvariantError", () => {
  const json = JSON.stringify({
    decks: [
      {
        id: "d1",
        name: "Deck",
        cardOrder: ["c1"],
        createdAt: "2026-11-04T00:00:00Z",
        updatedAt: "2026-11-04T00:00:00Z",
      },
    ],
    cards: [
      {
        id: "c1",
        deckId: "d1",
        front: "q",
        back: "a",
        createdAt: "2026-11-04T00:00:00Z",
        updatedAt: "2026-11-04T00:00:00Z",
        sm2: {
          repetitions: 1,
          easiness: 1.1, // out of bounds — SM-2 floor is 1.3
          interval: 1,
        },
      },
    ],
  });
  expect(() => importExport.importData(json)).toThrow(DomainInvariantError);
});

test("io: emptyData() round-trips to itself", () => {
  const data = emptyData();
  const json = importExport.exportData(data);
  const back = importExport.importData(json);
  expect(back).toEqual(data);
  // Re-serialize: byte-identical
  expect(importExport.exportData(back)).toBe(json);
});

test("io: unknown top-level key rejected", () => {
  const data = makeSmallData();
  const json = importExport.exportData(data);
  // Inject an unknown top-level key
  const injected = JSON.stringify({ ...JSON.parse(json), version: 2 });
  expect(() => importExport.importData(injected)).toThrow(DomainInvariantError);
});
