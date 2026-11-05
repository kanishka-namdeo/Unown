import { test, expect } from "bun:test";
import { sum } from "./sum";
test("sum adds two numbers", () => {
  expect(sum(2, 3)).toBe(5);
});
test("sum with negatives", () => {
  expect(sum(-1, 1)).toBe(0);
});
