import { describe, expect, test } from "bun:test";
import { validateRows } from "../src/validate.ts";

test("flags short rows", () => {
  const r = validateRows([["date", "memo", "amount"], ["2026-01-03", "coffee"]]);
  expect(r.ok).toBe(false);
});
