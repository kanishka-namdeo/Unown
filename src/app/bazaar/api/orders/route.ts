import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/bazaar/catalog";
import { seedOrders } from "@/lib/bazaar/seed";
import { generateOrderId, isValidOrderId } from "@/lib/bazaar/orders";
import { productsFrom, seedOverrides, isSeededOrderId } from "@/lib/bazaar/persistence";
import type { Order, OrderItem } from "@/lib/bazaar/types";

// In-memory orders store, seeded identically to the client (brief §8).
const orders: Order[] = seedOrders(PRODUCTS);
const catalog = productsFrom(PRODUCTS, seedOverrides());
const byId = new Map(catalog.map((p) => [p.id, p]));

/**
 * Resolve each submitted line against the catalog and write back the
 * authoritative denormalized snapshot (name + price). The client may send
 * partial or stale item data (e.g. id-as-name, price 0); the server is the
 * source of truth for what an order actually contains.
 */
export function snapshotItems(items: OrderItem[]): OrderItem[] {
  return items.map((it) => {
    const p = byId.get(it.productId);
    return {
      ...it,
      name: p ? p.name : it.name,
      price: p ? p.price : it.price,
    };
  });
}

/** Validate a raw order payload → field errors, or the snapshot-ready items. */
export function validateOrderPayload(raw: unknown, products: Map<string, { id: string; name: string; price: number }> = byId):
  | { errors: string[]; ok: false }
  | { items: OrderItem[]; ok: true } {
  const errors: string[] = [];
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    return { errors: ["body must be a JSON object"], ok: false };
  }
  if (!Array.isArray(obj.items)) {
    return { errors: ["items must be an array"], ok: false };
  }
  const items = (obj.items as unknown[]).map((it, i): OrderItem => {
    const o = (it ?? {}) as Record<string, unknown>;
    const pid = String(o?.productId ?? "");
    if (!products.has(pid)) errors.push(`items[${i}].productId is unknown: "${pid}"`);
    const qty = Number(o?.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 9) {
      errors.push(`items[${i}].quantity must be an integer 1–9`);
    }
    // Snapshot name/price from the catalog (fallback to submitted values for
    // unknown ids, which will already have errored above).
    const p = products.get(pid);
    return {
      productId: pid,
      name: p ? p.name : String(o?.name ?? pid),
      price: p ? p.price : Number(o?.price) > 0 ? Math.round(Number(o?.price)) : 0,
      quantity: Number.isInteger(qty) ? qty : 1,
    };
  });
  if (items.length === 0) errors.push("items must not be empty");
  if (errors.length > 0) return { errors, ok: false };
  return { items, ok: true };
}

// ── Rate limit (landing patch #6) ────────────────────────────────────────
// This POST is a public write endpoint on an anonymous marketing demo — the
// hardening round's research (docs/live-preview-competitor-research.md)
// flagged unbounded public writes as an invocation-quota and memory-growth
// abuse vector. A simple fixed-window counter per client IP: RATE_MAX
// writes per RATE_WINDOW_MS. Per-lambda-instance semantics (each Vercel
// instance carries its own module state) — an honest bound, not a global
// one; GETs are untouched (read-only, cacheable).
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { start: number; count: number }>();

function rateLimited(req: Request): boolean {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local";
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 500) {
      // crude sweep: never let the map itself grow unbounded
      for (const [k, v] of rateBuckets) {
        if (now - v.start >= RATE_WINDOW_MS) rateBuckets.delete(k);
      }
    }
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

export async function POST(req: Request) {
  if (rateLimited(req)) {
    return NextResponse.json(
      {
        error: "rate limited",
        errors: [`too many order posts — max ${RATE_MAX} per ${RATE_WINDOW_MS / 1000}s`],
      },
      { status: 429 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body", errors: ["body must be valid JSON"] },
      { status: 400 },
    );
  }

  const result = validateOrderPayload(body);
  if (!result.ok) {
    return NextResponse.json(
      { error: "validation failed", errors: result.errors },
      { status: 400 },
    );
  }

  const obj = body as Record<string, unknown>;
  const id =
    typeof obj.id === "string" && isValidOrderId(obj.id)
      ? obj.id
      : generateOrderId();
  const createdAt =
    typeof obj.createdAt === "string" && !Number.isNaN(Date.parse(obj.createdAt))
      ? obj.createdAt
      : new Date().toISOString();

  // Items already carry the denormalized catalog snapshot.
  const items = snapshotItems(result.items);
  const subtotal = items.reduce((n, it) => n + it.price * it.quantity, 0);
  const tax = Math.round(subtotal * 0.08);
  const shipping = subtotal >= 5000 ? 0 : 599;

  const order: Order = {
    id,
    createdAt,
    items,
    subtotal,
    tax,
    shipping,
    total: subtotal + tax + shipping,
    status: "Processing",
  };
  orders.unshift(order);
  return NextResponse.json(order, { status: 201 });
}

export async function GET() {
  return NextResponse.json(orders);
}
