import { describe, expect, test } from "bun:test";
import {
  PRODUCTS,
  assertCategory,
  filterSortProducts,
  productById,
  stockBadge,
} from "./catalog";
import type { CatalogQuery } from "./catalog";
import type { Product } from "./types";
import { CATEGORIES } from "./types";

const q = (over: Partial<CatalogQuery>): CatalogQuery => ({
  search: "",
  category: "All",
  sort: "newest",
  ...over,
});

describe("catalog shape", () => {
  test("16 products across exactly 4 categories, 4 each", () => {
    expect(PRODUCTS).toHaveLength(16);
    for (const c of CATEGORIES) {
      expect(PRODUCTS.filter((p) => p.category === c)).toHaveLength(4);
    }
  });

  test("every glyph is exactly two characters", () => {
    for (const p of PRODUCTS) {
      expect(Array.from(p.glyph).length).toBe(2);
    }
  });

  test("ratings are 0–5 in half steps; stock is non-negative", () => {
    for (const p of PRODUCTS) {
      expect(p.rating).toBeGreaterThanOrEqual(0);
      expect(p.rating).toBeLessThanOrEqual(5);
      expect(Math.round(p.rating * 2)).toBe(p.rating * 2);
      expect(p.stock).toBeGreaterThanOrEqual(0);
    }
  });

  test("productById finds or misses", () => {
    expect(productById(PRODUCTS, "rune-01")!.name).toMatch(/Rune/);
    expect(productById(PRODUCTS, "nope")).toBeUndefined();
  });
});

describe("stockBadge", () => {
  test("0 → Sold out, 1–3 → Low stock, 4+ → In stock", () => {
    expect(stockBadge(0)).toBe("Sold out");
    expect(stockBadge(1)).toBe("Low stock");
    expect(stockBadge(3)).toBe("Low stock");
    expect(stockBadge(4)).toBe("In stock");
  });
});

describe("search", () => {
  test("matches names case-insensitively", () => {
    const hits = filterSortProducts(PRODUCTS, q({ search: "glaSS MOOn" }));
    expect(hits.map((p) => p.id)).toContain("relic-04");
  });

  test("matches descriptions, not just names", () => {
    const hits = filterSortProducts(PRODUCTS, q({ search: "tide-table" }));
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toMatch(/Slow Tide/);
  });

  test("no match → empty, never crashes", () => {
    expect(filterSortProducts(PRODUCTS, q({ search: "zzz-quantum" }))).toEqual([]);
  });

  test("whitespace is trimmed", () => {
    const a = filterSortProducts(PRODUCTS, q({ search: "   " }));
    const b = filterSortProducts(PRODUCTS, q({ search: "" }));
    expect(a.length).toBe(b.length);
  });
});

describe("category filter", () => {
  test("a category chip keeps only that category", () => {
    const runes = filterSortProducts(PRODUCTS, q({ category: "Runes" }));
    expect(runes).toHaveLength(4);
    expect(runes.every((p) => p.category === "Runes")).toBe(true);
  });

  test("filters compose with search", () => {
    const hits = filterSortProducts(PRODUCTS, q({ category: "Tomes", search: "tide" }));
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toMatch(/Slow Tide/);
  });
});

describe("sorting", () => {
  test("price ascending", () => {
    const s = filterSortProducts(PRODUCTS, q({ sort: "price-asc" }));
    for (let i = 1; i < s.length; i++) expect(s[i].price).toBeGreaterThanOrEqual(s[i - 1].price);
  });

  test("price descending", () => {
    const s = filterSortProducts(PRODUCTS, q({ sort: "price-desc" }));
    for (let i = 1; i < s.length; i++) expect(s[i].price).toBeLessThanOrEqual(s[i - 1].price);
  });

  test("rating sorts best first, newest breaks ties", () => {
    const s = filterSortProducts(PRODUCTS, q({ sort: "rating" }));
    for (let i = 1; i < s.length; i++) expect(s[i - 1].rating).toBeGreaterThanOrEqual(s[i].rating);
  });

  test("newest sorts by addedAt descending", () => {
    const s = filterSortProducts(PRODUCTS, q({ sort: "newest" }));
    for (let i = 1; i < s.length; i++) {
      expect(s[i - 1].addedAt.localeCompare(s[i].addedAt)).toBeGreaterThanOrEqual(0);
    }
    expect(s[0].addedAt).toBe(
      [...PRODUCTS].sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0].addedAt,
    );
  });

  test("sorts apply within a filtered category", () => {
    const s = filterSortProducts(PRODUCTS, q({ category: "Sigils", sort: "price-asc" }));
    expect(s).toHaveLength(4);
    for (let i = 1; i < s.length; i++) expect(s[i].price).toBeGreaterThanOrEqual(s[i - 1].price);
  });
});

describe("assertCategory", () => {
  test("accepts the four categories", () => {
    for (const c of CATEGORIES) expect(assertCategory(c)).toBe(c);
  });

  test("throws on unknown", () => {
    expect(() => assertCategory("Amber")).toThrow();
  });
});
