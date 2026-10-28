"use client";

import { useRef } from "react";
import { useBazaar } from "@/lib/bazaar/store";
import { cartTotals } from "@/lib/bazaar/cart";
import { money } from "./format";
import {
  Glyph,
  QtyStepper,
  useDialogDismiss,
} from "./primitives";

export function CartDrawer({ onClose }: { onClose: () => void }) {
  const { state, setQuantity, removeFromCart, clearCart, setCheckoutOpen } = useBazaar();
  const totals = cartTotals(state.cart, state.products);
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(onClose, panelRef);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Shopping cart">
      <button
        aria-label="Close cart"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
        tabIndex={-1}
      />
      {/* slide-over on desktop, bottom sheet on mobile (brief §10) */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-hidden rounded-t-2xl border-t border-line bg-surface sm:inset-x-auto sm:bottom-0 sm:right-0 sm:top-0 sm:max-h-none sm:h-full sm:w-[420px] sm:max-w-[90vw] sm:rounded-none sm:border-l sm:border-t-0 sm:animate-pop"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-lg font-bold">Your cart</h2>
          <button
            onClick={onClose}
            aria-label="Close cart (Esc)"
            className="rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-2"
          >
            ✕
          </button>
        </header>

        {totals.itemCount === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
            <div aria-hidden="true" className="text-4xl">⌖</div>
            <p className="text-muted">Your cart is empty. The bazaar awaits.</p>
            <button
              onClick={onClose}
              className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
            >
              Browse the store
            </button>
          </div>
        ) : (
          <>
            <ul className="space-y-3 overflow-y-auto px-4 py-4" aria-label="Cart items">
              {state.cart.map((line: { productId: string; quantity: number }) => {
                const p = state.products.find((x) => x.id === line.productId);
                if (!p) return null;
                return (
                  <li key={line.productId} className="flex gap-3 rounded-lg border border-line bg-background/40 p-3">
                    <Glyph product={p} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{money(p.price)} each</div>
                      <div className="mt-2 flex items-center gap-2">
                        <QtyStepper
                          value={line.quantity}
                          min={1}
                          max={Math.min(9, p.stock)}
                          onChange={(q) => setQuantity(p.id, q)}
                          label={"Quantity of " + p.name}
                        />
                        <span className="ml-auto text-sm font-semibold">{money(p.price * line.quantity)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromCart(line.productId)}
                      aria-label={"Remove " + p.name + " from cart"}
                      className="self-start rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-danger"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-line px-4 py-4 text-sm">
              <dl className="space-y-1.5">
                <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Tax (8%)</dt><dd>{money(totals.tax)}</dd></div>
                <div className="flex justify-between">
                  <dt className="text-muted">{totals.freeShipping ? "Shipping — free" : "Shipping"}</dt>
                  <dd>{totals.shipping === 0 ? "Free" : money(totals.shipping)}</dd>
                </div>
                {totals.freeShipping && (
                  <p className="text-xs text-ok">Your order qualifies for free shipping.</p>
                )}
                <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{money(totals.total)}</dd>
                </div>
              </dl>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => { setCheckoutOpen(true); onClose(); }}
                  className="flex-1 rounded-lg bg-accent-strong px-4 py-2.5 font-semibold text-white hover:bg-accent"
                >
                  Checkout
                </button>
                <button
                  onClick={clearCart}
                  aria-label="Clear cart (destructive: removes all items)"
                  className="rounded-lg border border-danger/40 px-3 py-2.5 text-sm text-danger hover:bg-danger/10"
                >
                  Clear
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
