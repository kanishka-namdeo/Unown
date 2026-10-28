import { cartTotals, toOrderItems } from "./cart";
import {
  ORDER_STATUSES,
  type CartLine,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Product,
} from "./types";

/** Deterministic base-36 alphabet, 6 chars → format `SB-XXXXXX`. */
export function generateOrderId(rand: () => number = Math.random): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 6; i++) suffix += alphabet[Math.floor(rand() * 36)];
  return "SB-" + suffix;
}

export function isValidOrderId(id: string): boolean {
  return /^SB-[0-9a-z]{6}$/.test(id);
}

/**
 * Build a complete order from a validated cart. Pure: `id`, `createdAt` and
 * the order-status flow are all inputs, so the same cart always yields the
 * same order given the same seed.
 */
export function buildOrder(
  lines: CartLine[],
  products: Product[],
  id: string,
  createdAt: string,
): Order {
  const items = toOrderItems(lines, products);
  const totals = cartTotals(lines, products);
  return {
    id,
    createdAt,
    items,
    subtotal: totals.subtotal,
    tax: totals.tax,
    shipping: totals.shipping,
    total: totals.total,
    status: "Processing",
  };
}

/**
 * Orders are kept newest-first. New orders join the front; statuses flow
 * Processing → Shipped → Delivered.
 */
export function addOrder(orders: Order[], order: Order): Order[] {
  return [order, ...orders];
}

export function advanceOrderStatus(status: OrderStatus): OrderStatus | null {
  const idx = ORDER_STATUSES.indexOf(status);
  return idx === -1 || idx === ORDER_STATUSES.length - 1
    ? null
    : ORDER_STATUSES[idx + 1];
}

export function canAdvance(status: OrderStatus): boolean {
  return advanceOrderStatus(status) !== null;
}

/** Most orders first; a stable, pure sort. */
export function sortByNewest(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A fresh order's shape, used by the API's 400 validation as well. */
export interface NewOrderPayload {
  items: OrderItem[];
}
