"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isSeededOrderId } from "./seed";
import { productsFrom, seededCatalog } from "./persistence";
import {
  type CartLine,
  type Order,
  type OrderStatus,
  type Product,
} from "./types";
import { loadState, saveState, wipeBazaarStorage } from "./persistence";

// ── Embedding patch (landing copy #3) ────────────────────────────────────
// The standalone app serves its API at /api/* (it owns the root); embedded
// in the unown landing the routes live under /bazaar/api/* and the client
// sync targets them there.
const ORDERS_SYNC_URL = "/bazaar/api/orders";

export type View = "store" | "orders" | "dashboard";
export type Theme = "dark" | "light";

export interface BazaarState {
  products: Product[];
  cart: CartLine[];
  orders: Order[];
  statusOverrides: Record<string, OrderStatus>;
  theme: Theme;
  view: View;
  cartOpen: boolean;
  checkoutOpen: boolean;
  detailProduct: Product | null;
  helpOpen: boolean;
  /** fire-and-forget sync result, informational only */
  lastSyncAt: string | null;
}

interface BazaarApi {
  state: BazaarState;
  setView(v: View): void;
  setCartOpen(open: boolean): void;
  setCheckoutOpen(open: boolean): void;
  setHelpOpen(open: boolean): void;
  openDetail(product: Product | null): void;
  addToCart(productId: string, quantity?: number): void;
  setQuantity(productId: string, quantity: number): void;
  removeFromCart(productId: string): void;
  clearCart(): void;
  placeOrder(order: Order, decrementStock: boolean): void;
  advanceOrderStatus(id: string): void;
  restock(productId: string, amount: number): void;
  toggleTheme(): void;
  setTheme(theme: Theme): void;
}

const BazaarContext = createContext<BazaarApi | null>(null);

/**
 * A hand-rolled zustand-lite: one provider, one state object, one commit
 * path (mutate draft → commit) so every state change goes through a single
 * persistence effect.
 */
function makeInitialState(): BazaarState {
  const persisted = loadState();
  const base = Object.keys(persisted.stockOverrides).length > 0
    ? productsFrom(seededCatalog(), persisted.stockOverrides)
    : seededCatalog();
  return {
    products: base,
    cart: persisted.cart,
    orders: persisted.orders,
    statusOverrides: {},
    theme: persisted.theme,
    view: "store",
    cartOpen: false,
    checkoutOpen: false,
    detailProduct: null,
    helpOpen: false,
    lastSyncAt: null,
  };
}

export function BazaarProvider({
  children,
  embed = false,
}: {
  children: ReactNode;
  /** embed mode arms the landing frame's reset channel (landing patch #2). */
  embed?: boolean;
}) {
  const [state, setState] = useState<BazaarState>(makeInitialState);

  // Ids of orders created *in this browser session*. Only these are synced
  // to the API — seeded or previously-loaded orders are never re-posted
  // (REVIEW-FINDINGS A2: fresh loads must not duplicate seeded orders).
  const sessionOrdersRef = useRef<Set<string>>(new Set());
  // Ids already successfully synced this session (idempotency guard).
  const syncedIdsRef = useRef<Set<string>>(new Set());
  // Guard so the first mount (which only loads persisted state) never
  // triggers a sync POST.
  const mountedRef = useRef(false);

  // Persist on every state change (cart, orders, theme, stock) — silent.
  useEffect(() => {
    const stockOverrides: Record<string, number> = {};
    for (const p of state.products) stockOverrides[p.id] = p.stock;
    saveState({
      cart: state.cart,
      orders: state.orders,
      stockOverrides,
      theme: state.theme,
    });
  }, [state]);

  // Fire-and-forget order sync (brief §9): never blocks, never surfaces.
  // Runs only when a session-created order appears, and skips ids the
  // server already owns (seeded or previously-posted by this session).
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const created = state.orders.filter((o) => sessionOrdersRef.current.has(o.id));
    if (created.length === 0) return;
    // Sync the newest un-synced session order (idempotent by order id).
    const target = created[created.length - 1];
    if (syncedIdsRef.current.has(target.id)) return;
    fetch(ORDERS_SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: target.id,
        createdAt: target.createdAt,
        items: target.items,
        subtotal: target.subtotal,
        tax: target.tax,
        shipping: target.shipping,
        total: target.total,
        status: target.status,
      }),
    })
      .then((r) => {
        if (r.ok) {
          syncedIdsRef.current.add(target.id);
          setState((s2) => ({ ...s2, lastSyncAt: new Date().toISOString() }));
        }
      })
      .catch(() => {
        // silent per brief §9; leave unsynced so a later retry can happen
      });
     
  }, [state.orders]);

  // ── Embed reset channel (landing patch #2) ──────────────────────────
  // The landing page's "Reset demo" button posts
  // {source: "unown-landing", type: "bazaar-reset"}; mounted only in embed
  // mode. Origin-checked + shape-checked: a postMessage from any other
  // window in the hierarchy (or a foreign origin) is ignored — MDN's rule,
  // never trust a message without verifying where it came from.
  useEffect(() => {
    if (!embed || typeof window === "undefined") return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.origin) return;
      const data = e.data as { source?: string; type?: string } | null;
      if (!data || data.source !== "unown-landing" || data.type !== "bazaar-reset") return;
      wipeBazaarStorage();
      sessionOrdersRef.current.clear();
      syncedIdsRef.current.clear();
      mountedRef.current = true; // the reset is not a sync trigger
      setState(makeInitialState());
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [embed]);

  const commit = useCallback(
    (patch: Partial<BazaarState> | ((s: BazaarState) => Partial<BazaarState>)) =>
      setState((s) => ({ ...s, ...(typeof patch === "function" ? patch(s) : patch) })),
    [],
  );

  const products = state.products;
  // Embedding patch #9 (the landing's lint gate caught it): the standalone
  // app assigned the latest-ref DURING render ("Cannot access refs during
  // render") — the sanctioned pattern syncs it in an effect; for event
  // handlers (the only readers) the post-render timing is equivalent.
  const productsRef = useRef(products);
  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const addToCart = useCallback(
    (productId: string, quantity = 1) => {
      commit((s) => {
        const p = productsRef.current.find((x) => x.id === productId);
        if (!p || p.stock <= 0) return s;
        const cap = Math.min(quantity, p.stock, 9);
        const idx = s.cart.findIndex((l) => l.productId === productId);
        const cart =
          idx === -1
            ? [...s.cart, { productId, quantity: cap }]
            : s.cart.map((l, i) =>
                i === idx
                  ? { ...l, quantity: Math.min(l.quantity + cap, 9, p.stock) }
                  : l,
              );
        return { ...s, cart };
      });
    },
    [commit],
  );

  const api = useMemo<BazaarApi>(
    () => ({
      state,
      setView: (view) => commit({ view }),
      setCartOpen: (cartOpen) => commit({ cartOpen }),
      setCheckoutOpen: (checkoutOpen) => commit({ checkoutOpen }),
      setHelpOpen: (helpOpen) => commit({ helpOpen }),
      openDetail: (detailProduct) => commit({ detailProduct }),
      addToCart,
      setQuantity: (productId, quantity) =>
        commit((s) => ({
          ...s,
          cart: s.cart.map((l) =>
            l.productId === productId
              ? { ...l, quantity: Math.max(1, Math.min(quantity, 9)) }
              : l,
          ),
        })),
      removeFromCart: (productId) =>
        commit((s) => ({
          ...s,
          cart: s.cart.filter((l) => l.productId !== productId),
        })),
      clearCart: () => commit({ cart: [] }),
      placeOrder: (order, decrementStock) =>
        commit((s) => {
          // Mark this order as session-created so the sync effect will POST it.
          if (!isSeededOrderId(order.id)) sessionOrdersRef.current.add(order.id);
          const products2 = decrementStock
            ? s.products.map((p) => {
                const line = order.items.find((i) => i.productId === p.id);
                return line
                  ? { ...p, stock: Math.max(0, p.stock - line.quantity) }
                  : p;
              })
            : s.products;
          return {
            ...s,
            products: products2,
            orders: [order, ...s.orders],
            cart: [],
            // Keep the wizard open so the confirmation step (step 3) renders;
            // the wizard's "View order history" CTA closes it. (QA regression
            // 2026-10-28: placeOrder used to set checkoutOpen: false here,
            // which unmounted the wizard before step 3 could paint — the
            // confirmation screen was silently skipped.)
            cartOpen: false,
          };
        }),
      advanceOrderStatus: (id) =>
        commit((s) => {
          const o = s.orders.find((x) => x.id === id);
          if (!o) return s;
          const next: Record<OrderStatus, OrderStatus | null> = {
            Processing: "Shipped",
            Shipped: "Delivered",
            Delivered: null,
          };
          const advanced = next[o.status];
          if (!advanced) return s;
          return {
            ...s,
            statusOverrides: { ...s.statusOverrides, [id]: advanced },
          };
        }),
      restock: (productId, amount) =>
        commit((s) => ({
          ...s,
          products: s.products.map((p) =>
            p.id === productId ? { ...p, stock: p.stock + amount } : p,
          ),
        })),
      toggleTheme: () =>
        commit((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" })),
      setTheme: (theme) => commit({ theme }),
    }),
    [state, commit, addToCart],
  );

  return (
    <BazaarContext.Provider value={api}>
      {children}
    </BazaarContext.Provider>
  );
}

export function useBazaar(): BazaarApi {
  const ctx = useContext(BazaarContext);
  if (!ctx) throw new Error("useBazaar must be used inside <BazaarProvider>");
  return ctx;
}

/** Read-only status helper honoring per-order overrides. */
export function orderStatus(
  state: BazaarState,
  order: Order,
): OrderStatus {
  return state.statusOverrides[order.id] ?? order.status;
}
