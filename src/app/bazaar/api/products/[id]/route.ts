import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/bazaar/catalog";
import { productsFrom, seedOverrides } from "@/lib/bazaar/persistence";

// Served catalog: base stock minus quantities already sold in the seeded
// order history — the same seed the client hydrates (brief §8).
const products = productsFrom(PRODUCTS, seedOverrides());

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const p = products.find((x) => x.id === id);
  if (!p) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  return NextResponse.json(p);
}
