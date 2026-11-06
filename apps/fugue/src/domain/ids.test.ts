/**
 * ids test — the deterministic max+1 / high-water-mark law (PLAN §1:
 * integer ids, never random; export byte-stability depends on it).
 */
import { test, expect } from "bun:test";
import {
  bumpHighWater,
  highWaterOf,
  jobIds,
  nextFreeId,
  nextIdFrom,
  nextIdFromBoth,
  runIds,
} from "./ids.js";

test("nextFreeId: the high-water mark IS the next allocation (mark 0 → id 1)", () => {
  expect(nextFreeId(0)).toBe(1);
  expect(nextFreeId(2)).toBe(2);
  expect(nextFreeId(7)).toBe(7);
});

test("nextIdFrom: empty starts at 1; max+1, order-independent", () => {
  expect(nextIdFrom([])).toBe(1);
  expect(nextIdFrom([3, 1, 7, 5])).toBe(8);
  expect(nextIdFrom([7, 3, 5, 1])).toBe(8);
  expect(nextIdFrom([42, 42, 42])).toBe(43);
});

test("bumpHighWater: max of input mark and allocated ids", () => {
  expect(bumpHighWater(5, 3)).toBe(5); // below the mark stays
  expect(bumpHighWater(5, 9)).toBe(9);
  expect(bumpHighWater(1, 4, 2, 7)).toBe(7);
  expect(bumpHighWater(0)).toBe(0); // empty allocation unchanged
});

test("jobIds / runIds extract the id set", () => {
  expect(jobIds([{ id: 2 }, { id: 5 }])).toEqual([2, 5]);
  expect(runIds([{ id: 9 }])).toEqual([9]);
});

test("highWaterOf: the store-wide max over jobs + runs", () => {
  expect(highWaterOf([], [])).toBe(0);
  expect(highWaterOf([{ id: 3 }], [])).toBe(3);
  expect(highWaterOf([], [{ id: 8 }])).toBe(8);
  expect(highWaterOf([{ id: 3 }], [{ id: 8 }])).toBe(8);
});

test("nextIdFromBoth: max+1, empty document stays 0", () => {
  expect(nextIdFromBoth([], [])).toBe(0);
  expect(nextIdFromBoth([{ id: 3 }], [{ id: 8 }])).toBe(9);
  expect(nextIdFromBoth([], [{ id: 8 }])).toBe(9);
  expect(nextIdFromBoth([{ id: 3 }], [])).toBe(4);
});
