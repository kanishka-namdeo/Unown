import { describe, expect, test } from "bun:test";
import { addOrder, advanceOrderStatus, buildOrder, generateOrderId, isValidOrderId } from "./orders";
import { PRODUCTS } from "./catalog";

describe("order id generation", () => {
  test("format is SB- followed by 6 lowercase base-36 chars", () => {
    for (let i = 0; i < 200; i++) {
      const id = generateOrderId();
      expect(id).toMatch(/^SB-[0-9a-z]{6}$/);
    }
  });

  test("isValidOrderId rejects anything else", () => {
    expect(isValidOrderId("SB-abc123")).toBe(true);
    expect(isValidOrderId("SB-ABC123")).toBe(false);
    expect(isValidOrderId("sb-abc12")).toBe(false);
    expect(isValidOrderId("SB-abc123X")).toBe(false);
    expect(isValidOrderId("not-an-id")).toBe(false);
  });

  test("ids are unique across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateOrderId());
    expect(seen.size).toBe(5000);
  });

  test("a seeded rng is deterministic", () => {
    const makeRng = (start: number) => {
      let t = start;
      return () => {
        t = (t * 31 + 7) % 97;
        return t / 97;
      };
    };
    expect(generateOrderId(makeRng(7))).toBe(generateOrderId(makeRng(7)));
  });
});

describe("buildOrder", () => {
  test("computes the same totals as cart math and stamps Processing", () => {
    const p = PRODUCTS[0];
    const order = buildOrder([{ productId: p.id, quantity: 2 }], PRODUCTS, "SB-abc123", new Date().toISOString());
    expect(order.status).toBe("Processing");
    expect(order.id).toBe("SB-abc123");
    expect(order.subtotal).toBe(p.price * 2);
    expect(order.total).toBe(order.subtotal + order.tax + order.shipping);
  });

  test("addOrder prepends and preserves newest-first order", () => {
    const a = buildOrder([], PRODUCTS, "SB-aaaaaa", "2026-07-01T00:00:00.000Z");
    const b = buildOrder([], PRODUCTS, "SB-bbbbbb", "2026-07-02T00:00:00.000Z");
    const list = addOrder([a], b);
    expect(list.map((o) => o.id)).toEqual(["SB-bbbbbb", "SB-aaaaaa"]);
  });

  test("status flow is Processing → Shipped → Delivered and stops there", () => {
    expect(advanceOrderStatus("Processing")).toBe("Shipped");
    expect(advanceOrderStatus("Shipped")).toBe("Delivered");
    expect(advanceOrderStatus("Delivered")).toBeNull();
  });
});
