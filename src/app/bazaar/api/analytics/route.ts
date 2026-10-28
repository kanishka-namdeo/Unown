import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/bazaar/catalog";
import { seedOrders } from "@/lib/bazaar/seed";
import { productsFrom, seedOverrides } from "@/lib/bazaar/persistence";
import { computeAnalytics } from "@/lib/bazaar/analytics";
import type { Order } from "@/lib/bazaar/types";

// In-memory store seeded identically to the client seed (brief §8).
// Stock reflects post-sale levels, matching what the client sees on first load.
const orders: Order[] = seedOrders(PRODUCTS);
const products = productsFrom(PRODUCTS, seedOverrides());

export async function GET() {
  const analytics = computeAnalytics(orders, products);
  return NextResponse.json(analytics);
}
