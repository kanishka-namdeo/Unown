import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { loadState, productsFrom, saveState, seedState, productsWithOverrides, type PersistedState } from "./persistence";
import { PRODUCTS } from "./catalog";
import type { Product } from "./types";

// Minimal localStorage shim so tests run in bun without DOM. Under the
// landing repo's test setup (bunfig preload registers happy-dom) a REAL
// localStorage global already exists (readonly accessor) — the shim is
// only installed when the global is absent, and every helper works with
// either implementation (both need .clear()).
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const KEY = "sigil-bazaar:v1";
let installedShim = false;

beforeAll(() => {
  if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    installedShim = true;
  }
});

afterAll(() => {
  if (installedShim) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

function fresh() {
  localStorage.clear();
}

describe("persistence round-trip", () => {
  test("save then load returns the same state", () => {
    fresh();
    const state: PersistedState = {
      cart: [{ productId: "rune-01", quantity: 3 }],
      orders: [
        {
          id: "SB-zzz999",
          createdAt: "2026-07-15T10:00:00.000Z",
          items: [{ productId: "rune-01", name: "Rune of Kindling", price: 3400, quantity: 3 }],
          subtotal: 10200,
          tax: 816,
          shipping: 0,
          total: 11016,
          status: "Processing",
        },
      ],
      stockOverrides: { "relic-01": 11 },
      theme: "light",
    };
    saveState(state);
    const loaded = loadState();
    expect(loaded).toEqual(state);
  });

  test("empty storage falls back to the deterministic seed", () => {
    fresh();
    const loaded = loadState();
    const seed = seedState();
    expect(loaded.orders.length).toBe(seed.orders.length);
    expect(loaded.orders.length).toBeGreaterThanOrEqual(6);
    expect(loaded.orders.length).toBeLessThanOrEqual(10);
    // seeded order dates live within the past 12 days
    const daysAgo = (o: { createdAt: string }) =>
      (Date.now() - new Date(o.createdAt).getTime()) / 86_400_000;
    expect(Math.max(...loaded.orders.map(daysAgo))).toBeLessThanOrEqual(12);
    expect(Math.min(...loaded.orders.map(daysAgo))).toBeGreaterThanOrEqual(0);
  });
});

describe("corruption normalization", () => {
  test("invalid JSON falls back to the seed without throwing", () => {
    fresh();
    (localStorage as unknown as MemStorage).setItem(KEY, "{not json!!");
    const loaded = loadState();
    expect(loaded.orders.length).toBeGreaterThanOrEqual(6);
    expect(loaded.cart).toEqual([]);
  });

  test("unknown top-level shape normalizes to an empty-but-valid state", () => {
    fresh();
    (localStorage as unknown as MemStorage).setItem(KEY, JSON.stringify({ foo: "bar" }));
    const loaded = loadState();
    expect(Array.isArray(loaded.cart)).toBe(true);
    expect(Array.isArray(loaded.orders)).toBe(true);
  });

  test("garbage order entries are dropped or repaired, never fatal", () => {
    fresh();
    const state = {
      cart: [
        { productId: "sigil-01", quantity: 2 },
        "junk-line",
        null,
        { quantity: 99 }, // missing productId → dropped
      ],
      orders: [
        {
          id: "SB-good1",
          createdAt: "2026-07-10T00:00:00.000Z",
          items: [{ productId: "tome-01", name: "Tome of Small Bargains", price: 6200, quantity: 1 }],
          subtotal: 6200,
          tax: 496,
          shipping: 0,
          total: 6696,
          status: "Delivered",
        },
        { id: null, createdAt: 42, items: ["bad"], subtotal: "oops", tax: null }, // garbage
      ],
      stockOverrides: { "relic-01": 99, bad: "nope", "tome-01": -3 },
      theme: "weird",
    };
    (localStorage as unknown as MemStorage).setItem(KEY, JSON.stringify(state));
    const loaded = loadState();
    expect(loaded.cart).toEqual([{ productId: "sigil-01", quantity: 2 }]);
    expect(loaded.orders).toHaveLength(1);
    expect(loaded.orders[0].id).toBe("SB-good1");
    expect(loaded.stockOverrides).toEqual({ "relic-01": 99, "tome-01": 0 });
    expect(loaded.theme).toBe("dark"); // unknown theme → default
  });

  test("cart quantities are clamped to 1–9 on read", () => {
    fresh();
    (localStorage as unknown as MemStorage).setItem(
      KEY,
      JSON.stringify({ cart: [{ productId: "rune-02", quantity: 0 }, { productId: "rune-03", quantity: 25 }] }),
    );
    const loaded = loadState();
    expect(loaded.cart[0].quantity).toBe(1);
    expect(loaded.cart[1].quantity).toBe(9);
  });
});

describe("productsFrom (stock overrides)", () => {
  test("overrides replace the catalog stock, floored at 0", () => {
    const ps = productsFrom(PRODUCTS, { "rune-01": 40, "tome-01": 0 }) as Product[];
    expect(ps.find((p) => p.id === "rune-01")!.stock).toBe(40);
    expect(ps.find((p) => p.id === "tome-01")!.stock).toBe(0);
    expect(ps.find((p) => p.id === "rune-02")!.stock).toBe(PRODUCTS.find((p) => p.id === "rune-02")!.stock);
  });

  test("productsWithOverrides reads from state", () => {
    const state: PersistedState = { cart: [], orders: [], stockOverrides: { "rune-04": 50 }, theme: "dark" };
    const ps = productsWithOverrides(state);
    expect(ps.find((p) => p.id === "rune-04")!.stock).toBe(50);
  });
});
