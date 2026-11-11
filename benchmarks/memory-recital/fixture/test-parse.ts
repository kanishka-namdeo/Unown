import { describe, expect, test } from "bun:test";
import { parseLedger } from "../src/parse.ts";

test("parses header + rows", () => {
  const rows = parseLedger("date,memo,amount\n2026-01-03,coffee,-4.50");
  expect(rows.length).toBe(2);
  expect(rows[1][2]).toBe("-4.50");
});

test("quoted commas survive", () => {
  const rows = parseLedger('date,memo,amount\n2026-01-03," Beans, 1kg ",12.00');
  expect(rows[1].length).toBe(4); // BUG: naive split breaks quoted commas — this is the planted defect
});
