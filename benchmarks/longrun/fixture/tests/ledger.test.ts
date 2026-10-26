import { describe, expect, test } from "bun:test";
import { Ledger } from "../src/ledger";
import { nextId } from "../src/ids";

describe("Ledger core", () => {
  test("add assigns sequential ids", () => {
    const l = new Ledger();
    const a = l.add({ date: "2026-01-01", amountCents: 100, category: "food" });
    const b = l.add({ date: "2026-01-02", amountCents: 200, category: "rent" });
    expect(a.id).toBe("e-001");
    expect(b.id).toBe("e-002");
  });

  test("balance sums cents", () => {
    const l = new Ledger();
    l.add({ date: "2026-01-01", amountCents: 100, category: "food" });
    l.add({ date: "2026-01-02", amountCents: 250, category: "rent" });
    expect(l.balance()).toBe(350);
  });

  test("remove returns the removed entry and null when absent", () => {
    const l = new Ledger();
    const a = l.add({ date: "2026-01-01", amountCents: 100, category: "food" });
    expect(l.remove("e-999")).toBeNull();
    expect(l.remove(a.id)?.id).toBe("e-001");
    expect(l.entries()).toHaveLength(0);
  });

  test("rejects bad input (amount, date, category)", () => {
    const l = new Ledger();
    expect(() => l.add({ date: "2026-01-01", amountCents: -5, category: "food" })).toThrow();
    expect(() => l.add({ date: "01/02/2026", amountCents: 5, category: "food" })).toThrow();
    expect(() => l.add({ date: "2026-01-01", amountCents: 5, category: "Food!" })).toThrow();
  });

  test("optional payee/note survive the round-trip", () => {
    const l = new Ledger();
    const e = l.add({ date: "2026-01-01", amountCents: 500, category: "food", payee: "grocer", note: "weekly" });
    expect(e.payee).toBe("grocer");
    expect(e.note).toBe("weekly");
  });
});

describe("ids", () => {
  test("nextId continues the sequence", () => {
    expect(nextId([])).toBe("e-001");
    expect(nextId(["e-001", "e-002"])).toBe("e-003");
    expect(nextId(["e-010", "e-002"])).toBe("e-011");
  });
});
