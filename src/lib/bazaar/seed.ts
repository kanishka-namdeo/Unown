import { PRODUCTS } from "./catalog";
import { advanceOrderStatus } from "./orders";
import type { Order, OrderItem, OrderStatus, Product } from "./types";

/**
 * Deterministic order-history seed. The server (API routes) and the client
 * (localStorage hydration) import the same function so both sides agree —
 * the in-memory store is seeded identically per brief §8.
 *
 * 8 orders spread over the last 8–12 days (ISO dates relative to `now`),
 * each with 1–3 line items from the catalog.
 */

interface SeedSpec {
  daysAgo: number; // 0..11
  time: string; // "HH:MM" local
  statusIdx: number; // 0 Processing, 1 Shipped, 2 Delivered
  items: Array<[productId: string, quantity: number]>;
}

// Deterministic ids shared by the client seed and the server seed, so both
// sides can recognise "this order came from the seed" and never re-sync it.
export const SEED_ORDER_SUFFIXES = ["k9f3a1", "b2m8q4", "z7w2c6", "h5j9d3", "r4t6y8", "f1g7s2", "m6n8v4", "q2x5z9"];

/** True when an order id belongs to the deterministic seed (never re-synced). */
export function isSeededOrderId(id: string): boolean {
  return SEED_ORDER_SUFFIXES.some((s) => id === "SB-" + s);
}

const SPECS: SeedSpec[] = [
  { daysAgo: 0, time: "09:20", statusIdx: 0, items: [["relic-04", 1]] },
  { daysAgo: 1, time: "14:05", statusIdx: 0, items: [["rune-01", 2], ["tome-01", 1]] },
  { daysAgo: 3, time: "11:42", statusIdx: 1, items: [["sigil-02", 1]] },
  { daysAgo: 4, time: "16:33", statusIdx: 1, items: [["tome-04", 1], ["rune-02", 3]] },
  { daysAgo: 6, time: "10:12", statusIdx: 2, items: [["relic-02", 1]] },
  { daysAgo: 8, time: "19:48", statusIdx: 2, items: [["sigil-01", 2], ["sigil-03", 1]] },
  { daysAgo: 9, time: "08:03", statusIdx: 2, items: [["tome-02", 1]] },
  { daysAgo: 11, time: "13:27", statusIdx: 2, items: [["rune-04", 4]] },
];

function isoAt(daysAgo: number, time: string, now: Date): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  // Landing patch #7 (found by the integration test pass at 00:04 UTC): a
  // seed order must never carry a FUTURE date. The specs use fixed
  // times-of-day; a same-day order whose time hasn't happened yet (a run in
  // the small hours, after midnight) dated the seed into the future —
  // future orders render in the Orders view ahead of "now" and the
  // analytics charts count revenue that has not happened. A same-day
  // timestamp still ahead of `now` is dated YESTERDAY at the same time:
  // deterministic for the whole run, never future, still inside the
  // 8–12-day seed window.
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 1);
  return d.toISOString();
}

export function seedOrders(products: Product[], now: Date = new Date()): Order[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return SPECS.map((spec, i) => {
    const items: OrderItem[] = spec.items.map(([pid, qty]) => {
      const p = byId.get(pid)!;
      return { productId: p.id, name: p.name, price: p.price, quantity: qty };
    });
    const subtotal = items.reduce((n, it) => n + it.price * it.quantity, 0);
    const tax = Math.round(subtotal * 0.08);
    const shipping = subtotal >= 5000 ? 0 : 599;
    let status: OrderStatus = "Processing";
    for (let s = 0; s < spec.statusIdx; s++) {
      const next = advanceOrderStatus(status);
      if (!next) break;
      status = next;
    }
    return {
      id: "SB-" + SEED_ORDER_SUFFIXES[i],
      createdAt: isoAt(spec.daysAgo, spec.time, now),
      items,
      subtotal,
      tax,
      shipping,
      total: subtotal + tax + shipping,
      status,
    } satisfies Order;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Seed the in-memory catalog. Products start from the shared constant and
 * are then reduced by the quantities already bought in the seeded order
 * history — so stock levels on the dashboard reflect real "past sales".
 */
export function seedProducts(now: Date = new Date()): Product[] {
  const sold = new Map<string, number>();
  for (const o of seedOrders(PRODUCTS, now)) {
    for (const it of o.items) sold.set(it.productId, (sold.get(it.productId) ?? 0) + it.quantity);
  }
  return PRODUCTS.map((p) => ({ ...p, stock: Math.max(0, p.stock - (sold.get(p.id) ?? 0)) }));
}
