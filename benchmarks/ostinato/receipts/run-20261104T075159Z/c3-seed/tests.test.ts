import { describe, expect, test } from "bun:test";
import { romanToInt } from "../src/roman";
describe("romanToInt", () => {
  test("III is 3", () => expect(romanToInt("III")).toBe(3));
  test("IV is 4", () => expect(romanToInt("IV")).toBe(4));
  test("IX is 9", () => expect(romanToInt("IX")).toBe(9));
  test("MCMXCIV is 1994", () => expect(romanToInt("MCMXCIV")).toBe(1994));
  test("lowercase tolerated", () => expect(romanToInt("mmxxvi")).toBe(2026));
  test("throws on bad glyph", () => expect(() => romanToInt("ABC")).toThrow(SyntaxError));
});
