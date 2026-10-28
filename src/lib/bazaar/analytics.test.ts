import { describe, expect, test } from "bun:test";
import {
  categoryMix,
  computeAnalytics,
  computeKpis,
  revenueByDay,
  topProducts,
} from "./analytics";
import { PRODUCTS } from "./catalog";
import { seedOrders } from "./seed";
import type { Order } from "./types";

const NOW = new Date(2026, 6, 15); // fixed "today" for deterministic tests

function order(daysAgo: number, total: number, items: Order["items"] = []): Order {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  return {
    id: "SB-" + daysAgo + "x42a",
    createdAt: d.toISOString(),
    items,
    subtotal: 0,
    tax: 0,
    shipping: 0,
    total,
    status: "Delivered",
  };
}

const seeded = seedOrders(PRODUCTS, NOW);

describe("revenueByDay", () => {
  test("returns 14 zero-filled days ending at `end`", () => {
    const days = revenueByDay([], 14, NOW);
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe("2026-07-02");
    expect(days[13].day).toBe("2026-07-15");
    expect(days.every((d) => d.revenue === 0)).toBe(true);
  });

  test("attributes order totals to their day", () => {
    const orders = [order(0, 1000), order(1, 2000), order(1, 500), order(20, 99999)];
    const days = revenueByDay(orders, 14, NOW);
    expect(days[13].revenue).toBe(1000); // today (day 0)
    expect(days[12].revenue).toBe(2500); // day 1 aggregates
    expect(days[0].revenue).toBe(0); // the 20-day-old order is outside the window
  });
});

describe("topProducts", () => {
  test("ranks by revenue and caps at N", () => {
    const orders = [
      order(0, 0, [
        { productId: "a", name: "A", price: 100, quantity: 5 },
        { productId: "b", name: "B", price: 900, quantity: 1 },
        { productId: "c", name: "C", price: 500, quantity: 2 },
      ]),
      order(1, 0, [{ productId: "b", name: "B", price: 900, quantity: 1 }]),
    ];
    const top = topProducts(orders, 3);
    expect(top.map((t) => t.productId)).toEqual(["b", "c", "a"]);
    expect(top[0].revenue).toBe(1800);
    expect(top[0].units).toBe(2);
  });

  test("empty orders → empty result", () => {
    expect(topProducts([])).toEqual([]);
  });

  test("seeded history yields 5 products ranked sensibly", () => {
    const top = topProducts(seeded, 5);
    expect(top).toHaveLength(5);
    for (let i = 1; i < top.length; i++) expect(top[i - 1].revenue).toBeGreaterThanOrEqual(top[i].revenue);
  });
});

describe("categoryMix", () => {
  test("shares sum to ~100 and rank by revenue", () => {
    const orders = [
      order(0, 0, [
        { productId: "rune-01", name: "Rune of Kindling", price: 3400, quantity: 2 },
        { productId: "tome-01", name: "Tome of Small Bargains", price: 6200, quantity: 1 },
        { productId: "relic-01", name: "Relic of the Bell That Did Not Ring", price: 12400, quantity: 1 },
      ]),
    ];
    const mix = categoryMix(orders, PRODUCTS);
    const total = 3400 * 2 + 6200 + 12400;
    expect(mix.reduce((n, c) => n + c.percent, 0)).toBeCloseTo(100, 0);
    expect(mix[0].category).toBe("Relics");
    expect(mix.find((c) => c.category === "Relics")!.percent).toBeCloseTo(
      (12400 / total) * 100,
      1,
    );
  });

  test("unknown product ids bucket into Other without crashing", () => {
    const orders = [order(0, 0, [{ productId: "ghost", name: "Ghost", price: 1000, quantity: 1 }])];
    const mix = categoryMix(orders, PRODUCTS);
    expect(mix.some((c) => c.category === "Other")).toBe(true);
  });
});

describe("computeKpis", () => {
  test("totals, average, and low-stock count", () => {
    const kpis = computeKpis(seeded, PRODUCTS);
    expect(kpis.orderCount).toBe(seeded.length);
    expect(kpis.totalRevenue).toBe(seeded.reduce((n, o) => n + o.total, 0));
    expect(kpis.averageOrderValue).toBe(Math.round(kpis.totalRevenue / kpis.orderCount));
    expect(kpis.lowStockCount).toBe(PRODUCTS.filter((p) => p.stock <= 3).length);
    expect(kpis.lowStockCount).toBeGreaterThan(0); // seed intentionally has low stock
  });

  test("empty orders → zero KPIs, average 0 (no NaN)", () => {
    const kpis = computeKpis([], PRODUCTS);
    expect(kpis.totalRevenue).toBe(0);
    expect(kpis.orderCount).toBe(0);
    expect(kpis.averageOrderValue).toBe(0);
  });
});

describe("computeAnalytics", () => {
  test("combines all four sections", () => {
    const a = computeAnalytics(seeded, PRODUCTS, 14, NOW);
    expect(a.days).toHaveLength(14);
    expect(a.topProducts.length).toBeLessThanOrEqual(5);
    expect(a.kpis.orderCount).toBe(seeded.length);
    expect(a.categoryMix.length).toBeGreaterThan(0);
    // every order in the seed is inside the 14-day window, so revenue matches
    const sum = a.days.reduce((n, d) => n + d.revenue, 0);
    expect(sum).toBe(seeded.reduce((n, o) => n + o.total, 0));
  });
});
