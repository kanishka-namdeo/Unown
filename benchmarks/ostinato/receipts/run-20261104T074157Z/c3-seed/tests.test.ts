import { describe, expect, test } from "bun:test";
import { daysInclusive, overlaps } from "../src/daterange";
describe("daysInclusive", () => {
  test("same day is 1", () => expect(daysInclusive("2026-01-01", "2026-01-01")).toBe(1));
  test("two days", () => expect(daysInclusive("2026-01-01", "2026-01-02")).toBe(2));
  test("across a month", () => expect(daysInclusive("2026-01-30", "2026-02-02")).toBe(4));
  test("throws on end before start", () => expect(() => daysInclusive("2026-02-02", "2026-01-30")).toThrow(RangeError));
});
describe("overlaps", () => {
  test("adjacent days overlap", () => expect(overlaps("2026-01-01", "2026-01-02", "2026-01-02", "2026-01-03")).toBe(true));
  test("disjoint ranges do not", () => expect(overlaps("2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04")).toBe(false));
  test("contained range overlaps", () => expect(overlaps("2026-01-01", "2026-01-10", "2026-01-03", "2026-01-05")).toBe(true));
});
