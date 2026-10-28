import { PRODUCTS } from "./catalog";
import { seedOrders, seedProducts, isSeededOrderId } from "./seed";
import type { CartLine, Order, OrderStatus, Product } from "./types";

export { isSeededOrderId };

export interface PersistedState {
  cart: CartLine[];
  orders: Order[];
  /** product id → stock override (after restocks) */
  stockOverrides: Record<string, number>;
  theme: "dark" | "light";
}

const STORAGE_KEY = "sigil-bazaar:v1";

/**
 * Embed seed version (landing patch #4). A returning visitor whose stored
 * state was seeded by an OLDER demo build gets the new seed: the loader
 * compares the persisted `seedVersion` tag and discards stored state on a
 * mismatch. Bump when the demo data changes and every visitor should see
 * the new board. (Standalone copies keep the unversioned first-load seed.)
 */
export const SEED_VERSION = 1;
const SEED_VERSION_KEY = "sigil-bazaar:seedVersion";

/**
 * Wipe every persisted key the app owns — the store, the seed-version tag.
 * The next loadState() then takes the first-load path (fresh seed). Powers
 * the embed reset channel (the landing page's "Reset demo" button) so every
 * visitor of the live demo is one click from the pristine seeded storefront.
 */
export function wipeBazaarStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SEED_VERSION_KEY);
  } catch {
    /* noop */
  }
}

/** Tag the current storage with the seed version in force. */
function markSeedVersion(): void {
  try {
    localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION));
  } catch {
    /* noop */
  }
}

/** True when the stored state was seeded by a DIFFERENT demo build. */
function hasStaleSeedVersion(): boolean {
  try {
    const v = localStorage.getItem(SEED_VERSION_KEY);
    return v !== null && v !== String(SEED_VERSION);
  } catch {
    return false;
  }
}

/** Deterministic starting state, shared by client hydration and the API. */
export function seedState(): PersistedState {
  return {
    cart: [],
    orders: seedOrders(PRODUCTS),
    stockOverrides: seedOverrides(),
    theme: "dark",
  };
}

export function productsWithOverrides(state: PersistedState): Product[] {
  return productsFrom(PRODUCTS, state.stockOverrides);
}

function fallback(): PersistedState {
  const s = seedState();
  saveState(s);
  return s;
}

/** Apply the persisted stock overrides on top of the catalog. */
export function productsFrom(
  catalog: Product[],
  overrides: Record<string, number>,
): Product[] {
  return catalog.map((p) =>
    p.id in overrides ? { ...p, stock: Math.max(0, overrides[p.id]!) } : p,
  );
}

/** Catalog with seeded post-sale stock levels applied (deterministic). */
export function seededCatalog(): Product[] {
  return productsFrom(PRODUCTS, seedOverrides());
}

function normalizeStatus(s: unknown): OrderStatus {
  return s === "Shipped" || s === "Delivered" ? s : "Processing";
}

/** Post-sale stock levels derived from the seeded order history. */
export function seedOverrides(): Record<string, number> {
  const o: Record<string, number> = {};
  for (const p of seedProducts()) o[p.id] = p.stock;
  return o;
}

/**
 * Read and normalize stored state. Corrupt or unknown data never throws —
 * it falls back to the deterministic seed (brief §9).
 */
export function loadState(): PersistedState {
  if (typeof localStorage === "undefined") return seedState();
  let raw: string;
  try {
    raw = localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return fallback();
  }
  if (!raw || hasStaleSeedVersion()) return fallback();
  markSeedVersion();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback();
  }
  const obj = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;

  const cart: CartLine[] = Array.isArray(obj.cart)
    ? obj.cart
        .filter(
          (l): l is { productId: string; quantity: number } =>
            !!l &&
            typeof l === "object" &&
            typeof (l as Record<string, unknown>).productId === "string" &&
            typeof (l as Record<string, unknown>).quantity === "number",
        )
        .map((l) => ({ productId: l.productId, quantity: Math.max(1, Math.min(9, Math.round(l.quantity))) }))
    : [];

  const orders: Order[] = Array.isArray(obj.orders)
    ? obj.orders
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
        .map((o) => {
          const items = Array.isArray(o.items)
            ? o.items
                .filter(
                  (it): it is Record<string, unknown> => !!it && typeof it === "object",
                )
                .map((it) => ({
                  productId: String(it.productId ?? ""),
                  name: String(it.name ?? "Unknown item"),
                  price: Number(it.price) > 0 ? Math.round(Number(it.price)) : 0,
                  quantity:
                    typeof it.quantity === "number"
                      ? Math.max(1, Math.min(9, Math.round(it.quantity)))
                      : 1,
                }))
                .filter((it) => it.productId)
            : [];
          const subtotal = Math.max(0, Math.round(Number(o.subtotal) || 0));
          const tax = Math.max(0, Math.round(Number(o.tax) || 0));
          const shipping = Math.max(0, Math.round(Number(o.shipping) || 0));
          return {
            id: typeof o.id === "string" && o.id ? o.id : "SB-unknown",
            createdAt:
              typeof o.createdAt === "string" && !Number.isNaN(Date.parse(o.createdAt))
                ? o.createdAt
                : new Date(0).toISOString(),
            items,
            subtotal,
            tax,
            shipping,
            total: Math.max(subtotal + tax + shipping, 0),
            status: normalizeStatus(o.status),
          } satisfies Order;
        })
        .filter((o) => o.items.length > 0 || o.total > 0)
    : [];

  const stockOverrides: Record<string, number> = {};
  if (obj.stockOverrides && typeof obj.stockOverrides === "object") {
    for (const [k, v] of Object.entries(obj.stockOverrides as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) stockOverrides[k] = Math.max(0, Math.round(v));
    }
  }

  const theme = obj.theme === "light" ? "light" : "dark";
  return { cart, orders, stockOverrides, theme };
}

/** Persist the full app state (never throws — silent on quota/security errors). */
export function saveState(state: PersistedState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        cart: state.cart,
        orders: state.orders,
        stockOverrides: state.stockOverrides,
        theme: state.theme,
      }),
    );
  } catch {
    // storage full or blocked — app stays usable in-memory
  }
}
