import { CATEGORIES, type Category, type Product } from "./types";

/**
 * The catalog: 16 products across 4 categories.
 * Pure data — no React, no randomness — so client seed and server seed agree.
 */
export const PRODUCTS: Product[] = [
  // ── Runes (4) ────────────────────────────────────────────────
  {
    id: "rune-01",
    name: "Rune of Kindling",
    description:
      "A black-stone rune that hums warmer the longer a candle burns beside it. Carvers say it answers touch with a slow pulse.",
    category: "Runes",
    price: 3400,
    rating: 4.5,
    reviewCount: 132,
    stock: 14,
    addedAt: "2026-01-02",
    glyph: "ᚢᚱ",
    hue: 18,
    specs: [
      "Obsidian chip, 4 × 4 × 1 cm",
      "Charged in lamplight",
      "Pair with any brazier sigil",
    ],
  },
  {
    id: "rune-02",
    name: "Rune of Still Water",
    description:
      "Cool to the touch even in a sunlit shop. Mappers keep one at the compass rose of their drafting table for level lines.",
    category: "Runes",
    price: 4200,
    rating: 4.0,
    reviewCount: 88,
    stock: 3,
    addedAt: "2026-01-06",
    glyph: "ᛟᚹ",
    hue: 205,
    specs: [
      "River glass, 5 × 3 cm",
      "Holds chill for 40 minutes",
      "Sealed in a waxed leather sleeve",
    ],
  },
  {
    id: "rune-03",
    name: "Rune of the Long Road",
    description:
      "Worn smooth by generations of pilgrims who traded it at each rest-stop shrine. An unbroken path, one legend holds.",
    category: "Runes",
    price: 5600,
    rating: 4.5,
    reviewCount: 214,
    stock: 0,
    addedAt: "2025-11-18",
    glyph: "ᛏᚱ",
    hue: 42,
    specs: [
      "Bronze plate, 6 × 2 cm",
      "Hand-etched route lines",
      "Numbered edition of 100",
    ],
  },
  {
    id: "rune-04",
    name: "Rune of First Snow",
    description:
      "Translucent rune that fogs when the air turns cold. Winter market stalls sell them by the handful at the solstice.",
    category: "Runes",
    price: 2800,
    rating: 3.5,
    reviewCount: 57,
    stock: 22,
    addedAt: "2025-12-04",
    glyph: "ᛊᚾ",
    hue: 180,
    specs: [
      "Ice-white resin, 3 × 3 cm",
      "Thermochromic surface",
      "Fades and refreezes in daylight",
    ],
  },
  // ── Sigils (4) ───────────────────────────────────────────────
  {
    id: "sigil-01",
    name: "Sigil of the Lantern Keeper",
    description:
      "A brass seal stamped into tallow and thread. Keepers of the old watch-lights carry one so the flame bows toward them.",
    category: "Sigils",
    price: 4800,
    rating: 5.0,
    reviewCount: 176,
    stock: 9,
    addedAt: "2026-01-12",
    glyph: "ᛗᛞ",
    hue: 45,
    specs: [
      "Brass, hand-embossed",
      "Wax stamp + thread spool",
      "Includes keeper's rubbing card",
    ],
  },
  {
    id: "sigil-02",
    name: "Sigil of Tidal Hours",
    description:
      "Copperwork that turns of itself with the harbor moon. Sailors wind it before departure and read the hour by its stillness.",
    category: "Sigils",
    price: 6900,
    rating: 4.5,
    reviewCount: 143,
    stock: 2,
    addedAt: "2025-12-19",
    glyph: "ᛉᛊ",
    hue: 174,
    specs: [
      "Copper disc, 9 cm",
      "Moon-latched escapement",
      "Winds true within 6 hours",
    ],
  },
  {
    id: "sigil-03",
    name: "Sigil of the Quiet Door",
    description:
      "Stamped in lead and hung where a house wants its noise to end. Bakers' guilds order three or four at a time.",
    category: "Sigils",
    price: 3600,
    rating: 4.0,
    reviewCount: 95,
    stock: 17,
    addedAt: "2025-11-27",
    glyph: "ᛞᚲ",
    hue: 320,
    specs: [
      "Lead plate, 7 × 5 cm",
      "Silent-door stamp",
      "Hanger ring included",
    ],
  },
  {
    id: "sigil-04",
    name: "Sigil of the Cartographer",
    description:
      "Iron sigil sold with a vial of iron-gall ink. Rub a sheet and the map remembers one true north of its choosing.",
    category: "Sigils",
    price: 5200,
    rating: 4.5,
    reviewCount: 121,
    stock: 11,
    addedAt: "2026-01-08",
    glyph: "ᚷᚲ",
    hue: 262,
    specs: [
      "Iron, patina finish",
      "Iron-gall ink vial, 10 ml",
      "Works on any true-sheet paper",
    ],
  },
  // ── Relics (4) ───────────────────────────────────────────────
  {
    id: "relic-01",
    name: "Relic of the Bell That Did Not Ring",
    description:
      "A cracked altar bell that has never sounded — and yet every procession pauses at its step. Scholars disagree, loudly.",
    category: "Relics",
    price: 12400,
    rating: 5.0,
    reviewCount: 208,
    stock: 1,
    addedAt: "2025-10-30",
    glyph: "ᛒᚷ",
    hue: 28,
    specs: [
      "Tin alloy, 11 cm",
      "Documented provenance",
      "Displayed on a turned pedestal",
    ],
  },
  {
    id: "relic-02",
    name: "Relic of the Compass Rose",
    description:
      "A navigator's rose that points to the last port the holder visited, no matter where the ship is now.",
    category: "Relics",
    price: 8800,
    rating: 4.5,
    reviewCount: 164,
    stock: 6,
    addedAt: "2025-11-21",
    glyph: "ᚱᛏ",
    hue: 210,
    specs: [
      "Silvered bronze, 8 cm",
      "Holds 3 memories",
      "Comes with a waxed log card",
    ],
  },
  {
    id: "relic-03",
    name: "Relic of the Unlit Stove",
    description:
      "A palm-sized stove carved from hearthstone, found cold in every house it enters. Fire crews request it be treated kindly.",
    category: "Relics",
    price: 7300,
    rating: 4.0,
    reviewCount: 73,
    stock: 4,
    addedAt: "2025-12-08",
    glyph: "ᛋᛏ",
    hue: 14,
    specs: [
      "Hearthstone, 6 cm",
      "Includes iron trivet",
      "Certified non-fissured",
    ],
  },
  {
    id: "relic-04",
    name: "Relic of the Glass Moon",
    description:
      "Museum-grade moon glass, blown and polished, that throws one extra shadow under a full moon. Collectors keep it dark.",
    category: "Relics",
    price: 15800,
    rating: 5.0,
    reviewCount: 342,
    stock: 0,
    addedAt: "2025-10-12",
    glyph: "ᛗᛟ",
    hue: 288,
    specs: [
      "Blown moon glass, 4 cm",
      "Museum case included",
      "Shadow chart for 12 lunar phases",
    ],
  },
  // ── Tomes (4) ────────────────────────────────────────────────
  {
    id: "tome-01",
    name: "Tome of Small Bargains",
    description:
      "A pocket ledger of every fair price ever recorded at the bazaar — binding stiff with a century of haggling.",
    category: "Tomes",
    price: 6200,
    rating: 4.5,
    reviewCount: 151,
    stock: 13,
    addedAt: "2025-11-05",
    glyph: "ᛏᛗ",
    hue: 90,
    specs: [
      "Vellum, 180 pages",
      "Brass clasps",
      "Index of 400 prices",
    ],
  },
  {
    id: "tome-02",
    name: "Tome of Unwritten Songs",
    description:
      "Pages that stay blank until the reader hums. Archivists keep it in a sealed case for exactly that reason.",
    category: "Tomes",
    price: 9400,
    rating: 4.0,
    reviewCount: 198,
    stock: 5,
    addedAt: "2025-12-14",
    glyph: "ᛚᚱ",
    hue: 330,
    specs: [
      "Blank-vellum edition",
      "Fits a 22 cm song",
      "Seal case included",
    ],
  },
  {
    id: "tome-03",
    name: "Tome of the Slow Tide",
    description:
      "A tide-table of a sea that moves once a decade. The plates are hand-silvered; the margins are full of small predictions.",
    category: "Tomes",
    price: 5100,
    rating: 3.5,
    reviewCount: 64,
    stock: 19,
    addedAt: "2026-01-04",
    glyph: "ᛏᛞ",
    hue: 190,
    specs: [
      "Quarto, 96 pages",
      "Silvered tide plates",
      "Margin commentary in ink",
    ],
  },
  {
    id: "tome-04",
    name: "Tome of Last Letters",
    description:
      "A compendium of letters that never arrived, kept by the bazaar's post-house. A quiet, famous volume.",
    category: "Tomes",
    price: 7800,
    rating: 4.5,
    reviewCount: 267,
    stock: 8,
    addedAt: "2025-10-19",
    glyph: "ᛓᛗ",
    hue: 355,
    specs: [
      "Owl-gray cloth binding",
      "214 facsimile letters",
      "Laminated reading copy",
    ],
  },
];

export function productById(products: Product[], id: string): Product | undefined {
  return products.find((p) => p.id === id);
}

export type SortKey = "price-asc" | "price-desc" | "rating" | "newest";

export const SORT_KEYS: { value: SortKey; label: string }[] = [
  { value: "price-asc", label: "Price: low → high" },
  { value: "price-desc", label: "Price: high → low" },
  { value: "rating", label: "Rating" },
  { value: "newest", label: "Newest" },
];

export interface CatalogQuery {
  search: string;
  category: Category | "All";
  sort: SortKey;
}

/**
 * Compose search (name + description, case-insensitive) with the category
 * filter, then sort. Pure function for unit testing.
 */
export function filterSortProducts(
  products: Product[],
  query: CatalogQuery,
): Product[] {
  const q = query.search.trim().toLowerCase();
  let out = products.filter((p) => {
    if (query.category !== "All" && p.category !== query.category) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  });

  const byNewest = (a: Product, b: Product) =>
    b.addedAt.localeCompare(a.addedAt);
  switch (query.sort) {
    case "price-asc":
      out = [...out].sort((a, b) => a.price - b.price || byNewest(a, b));
      break;
    case "price-desc":
      out = [...out].sort((a, b) => b.price - a.price || byNewest(a, b));
      break;
    case "rating":
      out = [...out].sort((a, b) => b.rating - a.rating || byNewest(a, b));
      break;
    case "newest":
      out = [...out].sort(byNewest);
      break;
  }
  return out;
}

export function stockBadge(stock: number): "In stock" | "Low stock" | "Sold out" {
  if (stock <= 0) return "Sold out";
  if (stock <= 3) return "Low stock";
  return "In stock";
}

export function assertCategory(c: string): Category {
  if (!(CATEGORIES as string[]).includes(c)) {
    throw new Error(`unknown category: ${c}`);
  }
  return c as Category;
}
