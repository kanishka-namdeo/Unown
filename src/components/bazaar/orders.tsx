"use client";

import { useBazaar, orderStatus } from "@/lib/bazaar/store";
import { advanceOrderStatus } from "@/lib/bazaar/orders";
import { money, fmt } from "./format";
import { StatusChip } from "./primitives";

export function OrdersView() {
  const { state, advanceOrderStatus: advance } = useBazaar();
  const orders = [...state.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">Order history</h1>
      <p className="text-sm text-muted">
        {orders.length} orders · statuses flow Processing → Shipped → Delivered.
      </p>
      {orders.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-8 text-center text-muted">
          No orders yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {orders.map((o) => {
            const status = orderStatus(state, o);
            const next = advanceOrderStatus(status);
            return (
              <li key={o.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-accent">{o.id}</span>
                  <StatusChip status={status} />
                  <span className="text-xs text-muted">{fmt(o.createdAt)}</span>
                  <span className="ml-auto text-lg font-bold">{money(o.total)}</span>
                </div>
                <div className="mt-2 text-sm text-muted">
                  {o.items.length} {o.items.length === 1 ? "item" : "items"} ·{" "}
                  {o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                </div>
                {next && (
                  <button
                    onClick={() => advance(o.id)}
                    className="mt-3 rounded-md border border-line px-2.5 py-1 text-xs hover:bg-surface-2"
                  >
                    Advance to {next}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
