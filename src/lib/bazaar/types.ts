export type Category = "Runes" | "Sigils" | "Relics" | "Tomes";

export const CATEGORIES: Category[] = ["Runes", "Sigils", "Relics", "Tomes"];

export interface Product {
  id: string;
  name: string;
  description: string;
  category: Category;
  /** cents */
  price: number;
  /** 0–5, halves allowed */
  rating: number;
  reviewCount: number;
  stock: number;
  /** ISO date — used by "newest" sort */
  addedAt: string;
  /** two-character glyph drawn with pure CSS */
  glyph: string;
  /** deterministic hue used by the CSS monogram */
  hue: number;
  specs: string[];
}

export interface CartLine {
  productId: string;
  quantity: number;
}

export type OrderStatus = "Processing" | "Shipped" | "Delivered";

export const ORDER_STATUSES: OrderStatus[] = [
  "Processing",
  "Shipped",
  "Delivered",
];

export interface OrderItem {
  productId: string;
  name: string;
  /** cents, snapshot at order time */
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  createdAt: string; // ISO date
  items: OrderItem[];
  /** cents, pre-tax */
  subtotal: number;
  /** cents */
  tax: number;
  /** cents */
  shipping: number;
  /** cents */
  total: number;
  status: OrderStatus;
}

/** Shipping constants (brief §4) */
export const TAX_RATE = 0.08;
export const SHIPPING_FLAT = 599; // $5.99 in cents
export const FREE_SHIPPING_THRESHOLD = 5000; // $50.00 in cents
export const MAX_QUANTITY = 9;
