import { describe, expect, test } from "bun:test";
import { luhnValid } from "../src/luhn";
describe("luhnValid", () => {
  test("classic valid number", () => expect(luhnValid("4532015112830366")).toBe(true));
  test("another valid", () => expect(luhnValid("79927398713")).toBe(true));
  test("invalid checksum", () => expect(luhnValid("4532015112830367")).toBe(false));
  test("dashes and spaces tolerated", () => expect(luhnValid("4532 0151 1283 0366")).toBe(true));
  test("rejects non-digits", () => expect(luhnValid("45x2")).toBe(false));
  test("rejects single digit", () => expect(luhnValid("0")).toBe(false));
});
