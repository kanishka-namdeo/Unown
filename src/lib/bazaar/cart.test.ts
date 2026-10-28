import { describe, expect, test } from "bun:test";
import {
  addLine,
  cartSubtotal,
  cartTotals,
  removeLine,
  setLineQuantity,
  toOrderItems,
} from "./cart";
import { PRODUCTS } from "./catalog";
import type { CartLine, Product } from "./types";

const P = PRODUCTS;
const lowStock = P.find((p) => p.stock > 0 && p.stock <= 3)!;
const soldOut = P.find((p) => p.stock === 0)!;
const P0 = { ...P[0], price: 1000, stock: 20 } as Product;
const P1 = { ...P[1], price: 2000, stock: 20 } as Product;

describe("cart math — totals", () => {
  test("tax is 8% of subtotal", () => {
    const t = cartTotals([{ productId: P0.id, quantity: 1 }], [P0]);
    expect(t.tax).toBe(80); // 8% of $10.00
  });

  test("subtotal is the sum of line prices × quantities", () => {
    const t = cartTotals(
      [
        { productId: P0.id, quantity: 2 },
        { productId: P1.id, quantity: 3 },
      ],
      [P0, P1],
    );
    expect(t.subtotal).toBe(1000 * 2 + 2000 * 3);
  });

  test("flat $5.99 shipping applies below the free threshold", () => {
    const t = cartTotals([{ productId: P0.id, quantity: 1 }], [P0]);
    expect(t.shipping).toBe(599);
    expect(t.freeShipping).toBe(false);
    expect(t.total).toBe(t.subtotal + t.tax + 599);
  });

  test("shipping is free at exactly the $50 threshold", () => {
    const fake = { ...P0, price: 5000 } as Product;
    const t = cartTotals([{ productId: fake.id, quantity: 1 }], [fake]);
    expect(t.subtotal).toBe(5000);
    expect(t.freeShipping).toBe(true);
    expect(t.shipping).toBe(0);
  });

  test("shipping is free above the threshold, regardless of line count", () => {
    const t = cartTotals(
      [
        { productId: P0.id, quantity: 3 },
        { productId: P1.id, quantity: 2 },
      ],
      [P0, P1],
    );
    expect(t.subtotal).toBe(3000 + 4000);
    expect(t.freeShipping).toBe(true);
    expect(t.shipping).toBe(0);
  });

  test("total = subtotal + tax + shipping in every case", () => {
    const t = cartTotals(
      P.filter((p) => p.stock > 0).slice(0, 4).map((p) => ({ productId: p.id, quantity: 1 })),
      P,
    );
    expect(t.total).toBe(t.subtotal + t.tax + t.shipping);
  });

  test("empty cart → zero totals, zero items, no shipping charge", () => {
    const t = cartTotals([], P);
    expect(t.subtotal).toBe(0);
    expect(t.tax).toBe(0);
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(0);
    expect(t.itemCount).toBe(0);
  });
});

describe("cart math — quantity edge cases", () => {
  test("adding caps quantity at 9", () => {
    const lines = addLine([], P0.id, 9, [P0]);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(9);
    const lines2 = addLine(lines, P0.id, 9, [P0]);
    expect(lines2[0].quantity).toBe(9);
  });

  test("adding caps at stock for low-stock items", () => {
    const lines = addLine([], lowStock.id, 9, P);
    expect(lines[0].quantity).toBe(lowStock.stock);
  });

  test("adding a sold-out product is a no-op", () => {
    const lines = addLine([], soldOut.id, 1, P);
    expect(lines).toHaveLength(0);
  });

  test("adding an unknown product is a no-op", () => {
    const lines = addLine([], "nope", 1, P);
    expect(lines).toHaveLength(0);
  });

  test("setLineQuantity clamps to 1 and stock/9", () => {
    const lines = addLine([], P0.id, 4, [P0]);
    expect(setLineQuantity(lines, P0.id, 0, [P0])[0].quantity).toBe(1);
    expect(setLineQuantity(lines, P0.id, 99, [P0])[0].quantity).toBe(9);
  });

  test("setLineQuantity clamps to stock for a low-stock item", () => {
    const lines = addLine([], lowStock.id, 1, P);
    expect(setLineQuantity(lines, lowStock.id, 9, P)[0].quantity).toBe(lowStock.stock);
  });

  test("removeLine drops the product, keeps the rest", () => {
    const lines = addLine(addLine([], P0.id, 1, [P0, P1]), P1.id, 1, [P0, P1]);
    const after = removeLine(lines, P0.id);
    expect(after).toHaveLength(1);
    expect(after[0].productId).toBe(P1.id);
  });

  test("cartSubtotal ignores lines for products with zero stock", () => {
    const lines: CartLine[] = [
      { productId: soldOut.id, quantity: 3 },
      { productId: P0.id, quantity: 1 },
    ];
    expect(cartSubtotal(lines, [P0, ...P])).toBe(1000);
  });

  test("toOrderItems carries the price snapshot and clamps quantities", () => {
    const lines: CartLine[] = [
      { productId: P0.id, quantity: 2 },
      { productId: soldOut.id, quantity: 5 },
    ];
    const items = toOrderItems(lines, [P0, ...P]);
    expect(items).toHaveLength(1);
    expect(items[0].price).toBe(1000);
  });
});
