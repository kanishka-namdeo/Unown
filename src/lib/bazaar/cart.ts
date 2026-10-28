import {
  FREE_SHIPPING_THRESHOLD,
  MAX_QUANTITY,
  SHIPPING_FLAT,
  TAX_RATE,
  type CartLine,
  type Order,
  type Product,
} from "./types";

export interface CartTotals {
  subtotal: number; // cents
  tax: number;
  shipping: number; // 0 when free
  total: number;
  itemCount: number;
  freeShipping: boolean;
}

function roundCents(cents: number): number {
  return Math.round(cents);
}

/** Subtotal of a cart against the catalog (sold-out lines clamp to 0). */
export function cartSubtotal(lines: CartLine[], products: Product[]): number {
  return lines.reduce((sum, line) => {
    const p = products.find((x) => x.id === line.productId);
    if (!p) return sum;
    const qty = Math.min(line.quantity, Math.max(p.stock, 0));
    return sum + p.price * qty;
  }, 0);
}

/**
 * Full cart math: subtotal, 8% tax on the subtotal, flat $5.99 shipping
 * unless the subtotal meets the free-shipping threshold.
 */
export function cartTotals(lines: CartLine[], products: Product[]): CartTotals {
  const subtotal = roundCents(cartSubtotal(lines, products));
  const tax = roundCents(subtotal * TAX_RATE);
  const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
  const shipping = freeShipping ? 0 : lines.length > 0 ? SHIPPING_FLAT : 0;
  const itemCount = lines.reduce((n, l) => n + Math.max(0, l.quantity), 0);
  return { subtotal, tax, shipping, total: subtotal + tax + shipping, itemCount, freeShipping };
}

/**
 * Immutably add a product to the cart, capping quantity at 9 and at the
 * product's stock. Adding a sold-out product is a no-op.
 */
export function addLine(
  lines: CartLine[],
  productId: string,
  quantity: number,
  products: Product[],
): CartLine[] {
  const p = products.find((x) => x.id === productId);
  if (!p || p.stock <= 0) return lines;
  const qty = Math.max(1, Math.min(quantity, MAX_QUANTITY, p.stock));
  const idx = lines.findIndex((l) => l.productId === productId);
  if (idx === -1) return [...lines, { productId, quantity: qty }];
  const existing = lines[idx];
  const nextQty = Math.min(existing.quantity + qty, MAX_QUANTITY, p.stock);
  const next = lines.slice();
  next[idx] = { ...existing, quantity: nextQty };
  return next;
}

export function setLineQuantity(lines: CartLine[], productId: string, quantity: number, products: Product[]): CartLine[] {
  const p = products.find((x) => x.id === productId);
  const cap = p ? Math.min(MAX_QUANTITY, p.stock) : MAX_QUANTITY;
  const qty = Math.max(1, Math.min(quantity, cap));
  return lines.map((l) => (l.productId === productId ? { ...l, quantity: qty } : l));
}

export function removeLine(lines: CartLine[], productId: string): CartLine[] {
  return lines.filter((l) => l.productId !== productId);
}

/** Convert a cart (with catalog) into the line items of an order. */
export function toOrderItems(lines: CartLine[], products: Product[]): Order["items"] {
  return lines
    .filter((l) => l.quantity > 0)
    .map((l) => {
      const p = products.find((x) => x.id === l.productId)!;
      const qty = Math.min(l.quantity, Math.max(p.stock, 0));
      return { productId: p.id, name: p.name, price: p.price, quantity: qty };
    })
    .filter((i) => i.quantity > 0);
}
