"use client";

import { useEffect, type RefObject } from "react";
import { stockBadge } from "@/lib/bazaar/catalog";
import type { Product, OrderStatus } from "@/lib/bazaar/types";
import { useBazaar } from "@/lib/bazaar/store";
import { money } from "./format";

/**
 * CSS-drawn two-character glyph monogram (brief §1: no binary image assets).
 * The .glyph CSS class layers radial gradients from the product hue; the
 * ::after pseudo-element paints the two-character glyph.
 */
export function Glyph({ product, size = 56 }: { product: Product; size?: number }) {
  return (
    <div
      data-glyph={product.glyph}
      style={{ width: size, height: size, ["--glyph-hue" as string]: String(product.hue) }}
      className="glyph shrink-0"
      aria-hidden="true"
    />
  );
}

export function StarRating({ rating, count }: { rating: number; count?: number }) {
  const pct = Math.max(0, Math.min(1, rating / 5)) * 100;
  return (
    <div
      className="relative inline-block leading-none text-sm"
      role="img"
      aria-label={"Rated " + rating.toFixed(1) + " out of 5" + (count != null ? " from " + count + " reviews" : "")}
    >
      <span aria-hidden="true" className="text-line select-none">★★★★★</span>
      <span
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden text-warn select-none"
        style={{ width: pct + "%" }}
      >
        ★★★★★
      </span>
    </div>
  );
}

export function StatusChip({ status }: { status: OrderStatus }) {
  const cls =
    status === "Processing" ? "bg-accent/15 text-accent" :
    status === "Shipped" ? "bg-warn/15 text-warn" :
    "bg-ok/15 text-ok";
  return (
    <span className={"inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " + cls}>
      {status}
    </span>
  );
}

export function QtyStepper({
  value,
  min = 1,
  max = 9,
  onChange,
  label = "Quantity",
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (q: number) => void;
  label?: string;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-line px-1 py-0.5" role="group" aria-label={label}>
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label="Decrease quantity"
        className="rounded px-1.5 text-muted hover:text-foreground disabled:opacity-30"
      >
        −
      </button>
      <span className="w-5 text-center text-sm font-semibold" aria-live="polite">{value}</span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase quantity"
        className="rounded px-1.5 text-muted hover:text-foreground disabled:opacity-30"
      >
        +
      </button>
    </div>
  );
}

export function ProductCard({ product }: { product: Product }) {
  const { addToCart, openDetail } = useBazaar();
  const badge = stockBadge(product.stock);
  const soldOut = badge === "Sold out";
  const badgeClass =
    badge === "Sold out" ? "bg-danger/15 text-danger" :
    badge === "Low stock" ? "bg-warn/15 text-warn" :
    "bg-ok/15 text-ok";

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface p-4 animate-pop">
      <button
        onClick={() => openDetail(product)}
        className="flex items-start gap-3 text-left"
        aria-label={"View " + product.name}
      >
        <Glyph product={product} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{product.category}</div>
          <h3 className="mt-0.5 truncate font-semibold leading-snug">{product.name}</h3>
          <div className="mt-1 flex items-center gap-1.5">
            <StarRating rating={product.rating} />
            <span className="text-xs text-muted">({product.reviewCount})</span>
          </div>
        </div>
      </button>
      <p className="mt-3 line-clamp-2 text-xs text-muted">{product.description}</p>
      <div className="mt-auto flex items-end justify-between pt-4">
        <div>
          <span className={"mr-2 inline-block rounded-full px-2 py-0.5 text-xs " + badgeClass}>{badge}</span>
          <div className="text-lg font-bold tracking-tight">{money(product.price)}</div>
        </div>
        <button
          onClick={() => addToCart(product.id)}
          disabled={soldOut}
          aria-disabled={soldOut || undefined}
          aria-label={soldOut ? product.name + " is sold out" : "Add " + product.name + " to cart"}
          className={
            "rounded-lg px-3 py-2 text-sm font-semibold transition " +
            (soldOut
              ? "cursor-not-allowed bg-surface-2 text-muted"
              : "bg-accent-strong text-white hover:bg-accent")
          }
        >
          {soldOut ? "Sold out" : "Add"}
        </button>
      </div>
    </div>
  );
}

/**
 * A11y dialog primitive with focus trap, Esc to close, and focus restoration
 * to the opener (brief §3, §10).
 */
export function useDialogDismiss(onClose: () => void, ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const nodes = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const list = [...nodes].filter((n) => !n.hasAttribute("disabled"));
        if (list.length === 0) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose, ref]);
}
