"use client";

import { useMemo, useState } from "react";
import { useBazaar } from "@/lib/bazaar/store";
import {
  computeAnalytics,
  type Analytics,
  type DayRevenue,
} from "@/lib/bazaar/analytics";
import { money, fmt } from "./format";

export function Dashboard() {
  const { state, restock } = useBazaar();
  const analytics = useMemo<Analytics>(
    () => computeAnalytics(state.orders, state.products),
    [state.orders, state.products],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <h1 className="text-2xl font-bold">Owner dashboard</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Total revenue" value={money(analytics.kpis.totalRevenue)} />
        <Kpi label="Orders" value={String(analytics.kpis.orderCount)} />
        <Kpi label="Average order value" value={money(analytics.kpis.averageOrderValue)} />
        <Kpi
          label="Low-stock items"
          value={String(analytics.kpis.lowStockCount)}
          highlight={analytics.kpis.lowStockCount > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Chart14Day data={analytics.days} />
        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-bold">Top 5 products by revenue</h2>
          <ol className="mt-3 space-y-2">
            {analytics.topProducts.map((t, i) => (
              <li key={t.productId} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 text-muted">{i + 1}.</span>
                <span className="truncate">{t.name}</span>
                <span className="mx-1 flex-1 border-b border-dotted border-line" aria-hidden="true" />
                <span className="shrink-0 font-semibold">{money(t.revenue)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-bold">Category mix</h2>
        <ul className="mt-3 space-y-3">
          {analytics.categoryMix.map((c) => (
            <li key={c.category}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{c.category}</span>
                <span className="text-muted">{c.percent}% · {money(c.revenue)}</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-surface-2" role="presentation">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: c.percent + "%" }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <InventoryTable products={state.products} onRestock={(id, amt) => restock(id, amt)} />
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (highlight ? "border-warn bg-surface" : "border-line bg-surface")
      }
    >
      <div className="text-xs text-muted">{label}</div>
      {/* Value is the hero: 1.5rem bold in the theme foreground; the label
          stays muted 12px so the eye knows what to read first (VLM 08.1).
          In light theme --warn is a dark brown, so the value stays readable. */}
      <div
        className={
          "mt-1 text-2xl font-bold " +
          (highlight ? "text-warn" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

function Chart14Day({ data }: { data: DayRevenue[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  // Nice round "step" for the y-axis ticks: pick the smallest of 10/25/50/100
  // (× powers of 1000 for cents) that keeps the top tick ≥ max.
  function niceStep(v: number): number {
    const pow = Math.pow(10, Math.max(0, Math.floor(Math.log10(v))));
    const n = v / pow;
    let s = 10;
    if (n > 5) s = 10;
    else if (n > 2) s = 5;
    else if (n > 1) s = 2;
    else s = 1;
    return s * pow;
  }
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const ticks = [0, Math.round(top / 2), top];

  const [hover, setHover] = useState<number | null>(null);
  const W = 460;
  const H = 190;
  const padL = 46;
  const padB = 22;
  const plotW = W - padL - 8;
  const plotH = H - padB - 8;
  const bw = plotW / data.length;
  const yFor = (v: number) => 8 + plotH - (v / top) * plotH;

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Revenue — last 14 days</h2>
        {hover != null && (
          <span className="rounded-md bg-surface-2 px-2 py-1 font-mono text-xs" role="status">
            {data[hover].day} · {money(data[hover].revenue)}
          </span>
        )}
      </div>
      <svg
        viewBox={"0 0 " + W + " " + H}
        role="img"
        aria-label={"Bar chart of revenue over the last 14 days, peak " + money(max)}
        className="mt-3 w-full"
      >
        {/* gridlines + Y-axis ticks (VLM 08.2) */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={yFor(t)}
              x2={W - 8}
              y2={yFor(t)}
              stroke="var(--border)"
              strokeWidth={1}
              strokeDasharray={t === 0 ? undefined : "2 3"}
            />
            <text
              x={padL - 6}
              y={yFor(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="var(--muted)"
            >
              {money(t)}
            </text>
          </g>
        ))}
        {/* bars */}
        {data.map((d, i) => {
          const h = Math.max(0, (d.revenue / top) * plotH);
          const x = padL + i * bw + 3;
          return (
            <rect
              key={d.day}
              x={x}
              y={8 + plotH - h}
              width={bw - 6}
              height={h}
              rx={3}
              fill={d.revenue > 0 ? "var(--accent-strong)" : "var(--surface-2)"}
              opacity={hover === null || hover === i ? 1 : 0.35}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{d.day} — {money(d.revenue)}</title>
            </rect>
          );
        })}
        {/* x-axis labels every 3rd bar (VLM 08.2) */}
        {data.map((d, i) =>
          i % 3 === 0 || i === data.length - 1 ? (
            <text
              key={d.day + "-x"}
              x={padL + i * bw + bw / 2}
              y={H - 4}
              textAnchor="middle"
              fontSize={9}
              fill="var(--muted)"
            >
              {fmt(new Date(d.day + "T00:00:00"))}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

function InventoryTable({
  products,
  onRestock,
}: {
  products: import("@/lib/bazaar/types").Product[];
  onRestock: (id: string, amount: number) => void;
}) {
  const sorted = [...products].sort((a, b) => a.stock - b.stock);
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold">Inventory</h2>
        <span className="text-xs text-muted">{sorted.length} products · scrolls ↕</span>
      </div>
      <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-line/60">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pl-3 pr-4 font-medium">Product</th>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium">Price</th>
              <th className="py-2 pr-4 font-medium">Stock</th>
              <th className="py-2 pr-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.id}
                className={
                  "border-b border-line/60 " +
                  (p.stock === 0
                    ? "bg-danger/10"
                    : p.stock <= 3
                    ? "bg-warn/10"
                    : "")
                }
              >
                <td className="py-2 pl-3 pr-4">{p.name}</td>
                <td className="py-2 pr-4 text-muted">{p.category}</td>
                <td className="py-2 pr-4">{money(p.price)}</td>
                <td className="py-2 pr-4">
                  <span className="font-semibold">{p.stock}</span>
                  {p.stock === 0 && (
                    <span className="ml-2 rounded bg-danger/20 px-1.5 text-xs font-bold text-danger">
                      Sold out
                    </span>
                  )}
                  {p.stock > 0 && p.stock <= 3 && (
                    <span className="ml-2 rounded bg-warn/20 px-1.5 text-xs font-bold text-warn">
                      Low
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <button
                    onClick={() => onRestock(p.id, 10)}
                    className="rounded-md bg-accent-strong px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent"
                    aria-label={"Restock " + p.name + " by 10"}
                  >
                    Restock +10
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
