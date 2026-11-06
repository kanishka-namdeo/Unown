/**
 * ids test — the deterministic max+1 law (PLAN §1/§2: integer ids,
 * never random; export byte-stability depends on it).
 */
import { test, expect } from "bun:test";
import { nextCollectionId, nextId, nextStepId, recipeIds, runIds } from "./ids.js";

test("nextId: empty set starts at 1", () => {
  expect(nextId([])).toBe(1);
});

test("nextId: max+1, idempotent, order-independent", () => {
  expect(nextId([3, 1, 7, 5])).toBe(8);
  expect(nextId([7, 3, 5, 1])).toBe(8);
  expect(nextId([42, 42, 42])).toBe(43);
});

test("nextCollectionId / nextStepId / id extractors agree", () => {
  expect(nextCollectionId([{ id: 1 }, { id: 9 }])).toBe(10);
  expect(nextStepId([{ id: 5 }])).toBe(6);
  expect(recipeIds([{ id: 2 }] as never)).toEqual([2]);
  expect(runIds([{ id: 7 }] as never)).toEqual([7]);
});
