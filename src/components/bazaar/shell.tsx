"use client";

import { useEffect, type ReactNode } from "react";
import { useBazaar } from "@/lib/bazaar/store";
import { CatalogGrid } from "./catalog";
import { CartDrawer } from "./cart-drawer";
import { ProductDetailDialog } from "./product-detail";
import { CheckoutWizard } from "./checkout-wizard";
import { OrdersView } from "./orders";
import { Dashboard } from "./dashboard";
import { ShortcutsHelp } from "./shortcuts-help";

export function BazaarShell({ embed }: { embed: boolean }) {
  const { state, setCartOpen, setCheckoutOpen, setHelpOpen, setView, openDetail, toggleTheme } =
    useBazaar();

  // Keyboard shortcuts (brief §10)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "/":
          e.preventDefault();
          setView("store");
          requestAnimationFrame(() =>
            (document.getElementById("search-input") as HTMLInputElement | null)?.focus(),
          );
          break;
        case "c":
          setCartOpen(!state.cartOpen);
          break;
        case "t":
          toggleTheme();
          break;
        case "d":
          setView("dashboard");
          break;
        case "?":
          setHelpOpen(!state.helpOpen);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.cartOpen, state.helpOpen, setView, setCartOpen, toggleTheme, setHelpOpen]);

  // Sync theme class so CSS vars flip everywhere. Embedding patch (landing
  // copy #5): the standalone app flips <html> (it owns the root); embedded
  // under the landing's root layout, <html> is SHARED — flipping it would
  // restyle the host page. The scope wrapper (.bazaar-scope, rendered by
  // the /bazaar layout) carries the class instead; falls back to <html>
  // when the wrapper is absent (the standalone app keeps its behavior).
  useEffect(() => {
    const target =
      document.querySelector(".bazaar-scope") ?? document.documentElement;
    target.classList.toggle("light", state.theme === "light");
    target.classList.toggle("dark", state.theme === "dark");
  }, [state.theme]);

  return (
    <div className={embed ? "min-h-full" : "mx-auto flex min-h-full max-w-7xl flex-col"}>
      <header className="sticky top-0 z-30 border-b border-line bg-background/85 backdrop-blur">
        <div
          className={
            "flex items-center justify-between gap-3 px-4 " +
            (embed ? "py-2.5" : "py-4")
          }
        >
          <button
            onClick={() => setView("store")}
            className="text-lg font-bold tracking-wide"
            aria-label="Sigil Bazaar home"
          >
            <span aria-hidden="true">✧ </span>Sigil Bazaar
          </button>
          <div className="flex items-center gap-2">
            <nav className="hidden sm:flex items-center gap-1 text-sm" aria-label="Primary">
              <NavBtn active={state.view === "store"} onClick={() => setView("store")}>Store</NavBtn>
              <NavBtn active={state.view === "orders"} onClick={() => setView("orders")}>Orders</NavBtn>
              <NavBtn active={state.view === "dashboard"} onClick={() => setView("dashboard")}>Dashboard</NavBtn>
            </nav>
            <button
              onClick={() => setHelpOpen(true)}
              aria-label="Keyboard shortcuts (?)"
              className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2"
            >
              ?
            </button>
            <button
              onClick={toggleTheme}
              aria-label="Toggle theme (t)"
              className="rounded-md border border-line px-2.5 py-1.5 text-sm hover:bg-surface-2"
            >
              {state.theme === "dark" ? "☾" : "☀"}
            </button>
            <CartButton />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:py-8">
        {/* mobile view switcher: customer views only (VLM 12.1).
            Dashboard is an owner view — reachable on mobile via the `d` key
            or the desktop nav, but deliberately NOT a one-tap customer nav item. */}
        <div className="mb-4 flex gap-1 sm:hidden" role="tablist" aria-label="Views">
          {(["store", "orders"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={state.view === v}
              onClick={() => setView(v)}
              className={
                "flex-1 rounded-lg px-3 py-1.5 text-sm capitalize " +
                (state.view === v ? "bg-accent/20 font-semibold" : "text-muted")
              }
            >
              {v}
            </button>
          ))}
        </div>
        {state.view === "store" && <CatalogGrid embed={embed} />}
        {state.view === "orders" && <OrdersView />}
        {state.view === "dashboard" && <Dashboard />}
      </main>

      {!embed && (
        <footer className="border-t border-line px-4 py-6 text-center text-sm text-muted">
          Sigil Bazaar — a fullstack demo. Runes, sigils, relics &amp; tomes.
          Press <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-xs">?</kbd> for shortcuts.
        </footer>
      )}

      {state.cartOpen && <CartDrawer onClose={() => setCartOpen(false)} />}
      {state.detailProduct && <ProductDetailDialog onClose={() => openDetail(null)} />}
      {state.checkoutOpen && <CheckoutWizard onClose={() => setCheckoutOpen(false)} />}
      {state.helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function CartButton() {
  const { state, setCartOpen } = useBazaar();
  const count = state.cart.reduce((n, l) => n + l.quantity, 0);
  const label = count === 1 ? "1 item" : count + " items";
  return (
    <button
      onClick={() => setCartOpen(true)}
      aria-label={"Open cart (c) — " + label}
      className="relative rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2"
    >
      <span aria-hidden="true">⚱</span>
      <span className="hidden sm:inline"> Cart</span>
      {count > 0 && (
        <span
          className="absolute -right-2 -top-2 rounded-full bg-accent-strong px-1.5 py-0.5 text-xs font-bold text-white"
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  );
}

function NavBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={
        "rounded-md px-3 py-1.5 " +
        (active ? "bg-surface-2 font-semibold" : "hover:bg-surface-2/60")
      }
    >
      {children}
    </button>
  );
}
