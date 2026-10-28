"use client";

import { useEffect, useRef, useState } from "react";
import { useBazaar } from "@/lib/bazaar/store";
import { stockBadge } from "@/lib/bazaar/catalog";
import { money } from "./format";
import { Glyph, QtyStepper, StarRating, useDialogDismiss } from "./primitives";

export function ProductDetailDialog({ onClose }: { onClose: () => void }) {
  const { state, addToCart } = useBazaar();
  const product = state.detailProduct;
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(onClose, panelRef);

  // Embedding patch #8 (the landing's lint gate caught it): hooks BEFORE the
  // early return — the standalone app shipped useState below `if (!product)
  // return null`, a rules-of-hooks violation (the hook list changes across
  // renders of the same instance). The qty state now resets through the
  // effect below whenever the dialog re-opens on a product.
  const [qty, setQty] = useState(1);
  useEffect(() => {
    setQty(1);
  }, [product?.id]);
  if (!product) return null;
  const badge = stockBadge(product.stock);
  const soldOut = badge === "Sold out";
  const maxQty = Math.max(1, Math.min(9, product.stock));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={product.name}>
      <button
        aria-label="Close product details"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-pop"
      >
        <div className="flex gap-4">
          <Glyph product={product} size={84} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">{product.category}</div>
            <h2 className="text-xl font-bold leading-tight">{product.name}</h2>
            <div className="mt-1 flex items-center gap-2">
              <StarRating rating={product.rating} count={product.reviewCount} />
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight">{money(product.price)}</div>
          </div>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-foreground/90">{product.description}</p>
        {/* Spec list with visual separators for scanability (VLM 02.4) */}
        <div className="mt-4 rounded-lg border border-line bg-background/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Specifications</div>
          <ul className="mt-2 space-y-1.5">
            {product.specs.map((s) => (
              <li key={s} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
        <div
          className={"mt-4 rounded-lg px-3 py-2 text-sm " +
            (soldOut ? "bg-danger/15 text-danger" : badge === "Low stock" ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok")}
        >
          {badge}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <QtyStepper value={qty} min={1} max={maxQty} onChange={setQty} label="Quantity" />
          <button
            onClick={() => { addToCart(product.id, qty); onClose(); }}
            disabled={soldOut}
            className="flex-1 rounded-lg bg-accent-strong px-4 py-2.5 font-semibold text-white hover:bg-accent disabled:opacity-40"
          >
            {soldOut ? "Sold out" : "Add to cart"}
          </button>
        </div>
      </div>
    </div>
  );
}
