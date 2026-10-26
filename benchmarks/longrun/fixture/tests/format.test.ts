import { describe, expect, test } from "bun:test";
import { formatEntry, formatCents } from "../src/format";

describe("format", () => {
  test("formatEntry renders id/date/category/amount", () => {
    const line = formatEntry({ id: "e-001", date: "2026-01-15", amountCents: 2500, category: "food" });
    expect(line).toContain("e-001");
    expect(line).toContain("2026-01-15");
    expect(line).toContain("food");
    expect(line).toContain("2500");
  });

  test("formatEntry appends payee/note when present", () => {
    const line = formatEntry({ id: "e-002", date: "2026-01-16", amountCents: 800, category: "food", payee: "grocer", note: "milk" });
    expect(line).toContain("grocer");
    expect(line).toContain("milk");
  });

  test("formatCents renders plain decimal, two digits", () => {
    expect(formatCents(0)).toBe("0.00");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(2500)).toBe("25.00");
    expect(formatCents(-125)).toBe("-1.25");
  });
});
