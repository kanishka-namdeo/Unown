"use client";

import { useMemo, useState } from "react";
import { useBazaar } from "@/lib/bazaar/store";
import {
  filterSortProducts,
  SORT_KEYS,
  type CatalogQuery,
  type SortKey,
} from "@/lib/bazaar/catalog";
import { CATEGORIES, type Category } from "@/lib/bazaar/types";
import { ProductCard } from "./primitives";

type Cat = Category | "All";
const CHIPS: Cat[] = ["All", ...CATEGORIES];

export function CatalogGrid({ embed }: { embed: boolean }) {
  const { state } = useBazaar();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Cat>("All");
  const [sort, setSort] = useState<SortKey>("newest");

  const query: CatalogQuery = useMemo(
    () => ({ search, category, sort }),
    [search, category, sort],
  );
  const results = useMemo(
    () => filterSortProducts(state.products, query),
    [state.products, query],
  );

  return (
    <div className={embed ? "space-y-4" : "mx-auto max-w-6xl space-y-6"}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="relative block">
          <span className="sr-only">Search products by name or description</span>
          <input
            id="search-input"
            type="search"
            placeholder="Search the bazaar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 pr-10 text-sm placeholder:text-muted focus:border-accent"
          />
          {/* Desktop-only shortcut hint; hidden on coarse pointers (VLM 01.2 / 12.3) */}
          <kbd
            aria-hidden="true"
            className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:block"
          >
            /
          </kbd>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort products"
            className="rounded-lg border border-line bg-surface px-3 py-2 focus:border-accent"
          >
            {SORT_KEYS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={
              "rounded-full border px-4 py-1.5 text-sm transition-colors " +
              (category === c
                ? "border-accent bg-accent/20 font-semibold"
                : "border-line text-muted hover:text-foreground")
            }
          >
            {c}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-10 text-center text-muted">
          No artifacts match that search. Try another glyph.
        </p>
      ) : (
        <ul
          className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label={"Products"}
        >
          {results.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
