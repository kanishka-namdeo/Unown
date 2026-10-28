import type { Order, Product } from "./types";

export interface DayRevenue {
  /** `YYYY-MM-DD` */
  day: string;
  revenue: number; // cents
}

export interface TopProduct {
  productId: string;
  name: string;
  revenue: number; // cents
  units: number;
}

export interface CategoryShare {
  category: string;
  revenue: number; // cents
  /** 0–100, one decimal */
  percent: number;
}

export interface Kpis {
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  lowStockCount: number;
}

export interface Analytics {
  days: DayRevenue[];
  topProducts: TopProduct[];
  categoryMix: CategoryShare[];
  kpis: Kpis;
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Revenue by day for the trailing `numDays` days ending at `end` (default
 * today). Days with no orders still appear with revenue 0 so the bar chart
 * has a stable axis.
 */
export function revenueByDay(orders: Order[], numDays = 14, end: Date = new Date()): DayRevenue[] {
  const days: DayRevenue[] = [];
  const bucket = new Map<string, number>();
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    days.push({ day: key, revenue: 0 });
    bucket.set(key, 0);
  }
  for (const o of orders) {
    const key = o.createdAt.slice(0, 10);
    if (bucket.has(key)) bucket.set(key, (bucket.get(key) ?? 0) + o.total);
  }
  for (const d of days) {
    d.revenue = bucket.get(d.day) ?? 0;
  }
  return days;
}

/** Top-N products by revenue across all orders (default 5). */
export function topProducts(orders: Order[], n = 5): TopProduct[] {
  const agg = new Map<string, TopProduct>();
  for (const o of orders) {
    for (const it of o.items) {
      const cur = agg.get(it.productId) ?? {
        productId: it.productId,
        name: it.name,
        revenue: 0,
        units: 0,
      };
      cur.revenue += it.price * it.quantity;
      cur.units += it.quantity;
      agg.set(it.productId, cur);
    }
  }
  return [...agg.values()]
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
    .slice(0, n);
}

/** Share of total revenue per category, 0–100 with one decimal. */
export function categoryMix(orders: Order[], products: Product[]): CategoryShare[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const revByCat = new Map<string, number>();
  let total = 0;
  for (const o of orders) {
    for (const it of o.items) {
      const cat = byId.get(it.productId)?.category ?? "Other";
      const rev = it.price * it.quantity;
      revByCat.set(cat, (revByCat.get(cat) ?? 0) + rev);
      total += rev;
    }
  }
  const cats: string[] = [...new Set(products.map((p) => p.category))];
  const shares = cats
    .map((c) => {
      const rev = revByCat.get(c) ?? 0;
      return {
        category: c,
        revenue: rev,
        percent: total > 0 ? Math.round((rev / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
  // include "Other" only if any order line had no catalog match
  const other = revByCat.get("Other");
  if (other && !shares.some((s) => s.category === "Other")) {
    shares.push({
      category: "Other",
      revenue: other,
      percent: total > 0 ? Math.round((other / total) * 1000) / 10 : 0,
    });
  }
  return shares;
}

/** KPIs: totals, average order value, and low-stock products (stock ≤ 3). */
export function computeKpis(orders: Order[], products: Product[], lowStockThreshold = 3): Kpis {
  const totalRevenue = orders.reduce((n, o) => n + o.total, 0);
  const orderCount = orders.length;
  const averageOrderValue = orderCount > 0 ? Math.round(totalRevenue / orderCount) : 0;
  const lowStockCount = products.filter((p) => p.stock <= lowStockThreshold).length;
  return { totalRevenue, orderCount, averageOrderValue, lowStockCount };
}

/** All of the above, as one dashboard-shaped object. */
export function computeAnalytics(
  orders: Order[],
  products: Product[],
  numDays = 14,
  end: Date = new Date(),
): Analytics {
  return {
    days: revenueByDay(orders, numDays, end),
    topProducts: topProducts(orders),
    categoryMix: categoryMix(orders, products),
    kpis: computeKpis(orders, products),
  };
}
