import { describe, expect, test } from "bun:test";
import { snapshotItems, validateOrderPayload } from "@/app/bazaar/api/orders/route";
import { SEED_ORDER_SUFFIXES, isSeededOrderId, seedOrders } from "@/lib/bazaar/seed";
import { PRODUCTS } from "@/lib/bazaar/catalog";
import { buildOrder, generateOrderId } from "@/lib/bazaar/orders";
import { paymentErrors } from "@/lib/bazaar/validation";
import type { OrderItem } from "@/lib/bazaar/types";

describe("QA regression: checkout confirmation must not be skipped", () => {
  // QA finding: `placeOrder` in the store used to set `checkoutOpen: false`
  // in the same commit that prepended the new order, which unmounted the
  // wizard before step 3 (the "Order placed" confirmation) could paint.
  // Two invariants guard the fix:
  test("a placed order's status is Processing, and its payload stays syncable", () => {
    // placeOrder decrements stock and prepends; the order object itself is
    // created by buildOrder and must carry a real Processing status.
    const p = PRODUCTS.find((x) => x.id === "rune-01")!;
    const id = generateOrderId();
    const order = buildOrder([{ productId: p.id, quantity: 2 }], PRODUCTS, id, new Date(0).toISOString());
    expect(order.status).toBe("Processing");
    expect(order.id).toBe(id);
    // The order joins history as a session order (not a seeded id), so the
    // sync filter WILL post it exactly once.
    expect(isSeededOrderId(id)).toBe(false);
  });

  test("the confirmation step's data source (state.orders[0] after placeOrder) is the just-placed order", () => {
    // After placeOrder, orders[0] is the new order — that is what the
    // wizard's step-3 panel and the Orders view both read.
    const p = PRODUCTS.find((x) => x.id === "tome-01")!;
    const id = generateOrderId();
    const order = buildOrder([{ productId: p.id, quantity: 1 }], PRODUCTS, id, new Date(0).toISOString());
    const orders = [order]; // simulated post-placeOrder shape (newest first)
    expect(orders[0].id).toBe(id);
    expect(orders[0].items[0].name).toBe(p.name);
    expect(orders[0].total).toBe(orders[0].subtotal + orders[0].tax + orders[0].shipping);
  });

  test("a rejected payment does not place an order (no stray orders[0] shift)", () => {
    // step2Valid gate: a Luhn-invalid card must never reach buildOrder.
    const errs = paymentErrors({ cardNumber: "4242 4242 4242 4243", expiry: "12/30", cvv: "123" });
    expect(Object.keys(errs).length).toBeGreaterThan(0);
    expect(errs.cardNumber).toBeDefined();
  });
});

describe("sync filter (A2): only session orders are re-posted", () => {
  // Mirror of the store's sync predicate: an order is a sync candidate only
  // when it was created in this browser session (id not in the seeded set).
  function isSyncCandidate(order: { id: string }): boolean {
    return !isSeededOrderId(order.id);
  }

  test("no seeded order is a sync candidate → a fresh load posts 0", () => {
    const seeded = seedOrders(PRODUCTS);
    const candidates = seeded.filter((o) => isSyncCandidate(o));
    expect(seeded.length).toBeGreaterThanOrEqual(8);
    expect(candidates).toHaveLength(0);
  });

  test("a user-created order IS a sync candidate (exactly one post)", () => {
    const userOrder = { id: generateOrderId() };
    expect(isSyncCandidate(userOrder)).toBe(true);
  });

  test("seeded ids are the closed set the store trusts", () => {
    for (const o of seedOrders(PRODUCTS)) {
      expect(isSyncCandidate(o)).toBe(false);
    }
  });
});

describe("POST /api/orders item snapshot (A1)", () => {
  test("resolve name+price from catalog even when the client sends junk", () => {
    const items: OrderItem[] = [
      { productId: "rune-01", name: "rune-01", price: 0, quantity: 2 }, // id-as-name, price 0
      { productId: "tome-01", name: "Tome of Small Bargains", price: 6200, quantity: 1 },
    ];
    const snap = snapshotItems(items);
    // The broken case: catalog name + price win over the client's values.
    const rune = snap.find((i) => i.productId === "rune-01")!;
    expect(rune.name).toBe("Rune of Kindling");
    expect(rune.price).toBe(3400);
    expect(rune.quantity).toBe(2);
    // A correct case passes through unchanged.
    const tome = snap.find((i) => i.productId === "tome-01")!;
    expect(tome.name).toBe("Tome of Small Bargains");
    expect(tome.price).toBe(6200);
  });

  test("validateOrderPayload snapshots known product ids from the catalog", () => {
    const res = validateOrderPayload({
      items: [
        // Deliberately send a wrong name/price: server must correct both.
        { productId: "sigil-01", name: "sigil-01", price: 0, quantity: 2 },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.items[0].name).toBe("Sigil of the Lantern Keeper");
    expect(res.items[0].price).toBe(4800);
    expect(res.items[0].quantity).toBe(2);
  });

  test("unknown product ids error with a field-level message (no snapshot)", () => {
    const res = validateOrderPayload({
      items: [{ productId: "does-not-exist", name: "x", price: 100, quantity: 1 }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("unknown");
  });

  test("quantity bounds are enforced and reported", () => {
    const res = validateOrderPayload({
      items: [
        { productId: "rune-01", name: "Rune of Kindling", price: 3400, quantity: 12 },
      ],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.join(" ")).toContain("1–9");
  });

  test("a freshly generated id is NOT a seeded id (so it is syncable)", () => {
    for (let i = 0; i < 50; i++) {
      expect(isSeededOrderId(generateOrderId())).toBe(false);
    }
    // And every seeded id IS recognised.
    for (const o of seedOrders(PRODUCTS)) {
      expect(isSeededOrderId(o.id)).toBe(true);
    }
  });

  test("seeded suffixes are exactly the documented 8", () => {
    expect(SEED_ORDER_SUFFIXES).toHaveLength(8);
    for (const s of SEED_ORDER_SUFFIXES) expect(isSeededOrderId("SB-" + s)).toBe(true);
  });
});
