import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/bazaar/catalog";
import { productsFrom, seedOverrides } from "@/lib/bazaar/persistence";

// Served catalog: base stock minus quantities already sold in the seeded
// order history — the same seed the client hydrates (brief §8).
const products = productsFrom(PRODUCTS, seedOverrides());

export async function GET() {
  return NextResponse.json(products);
}
