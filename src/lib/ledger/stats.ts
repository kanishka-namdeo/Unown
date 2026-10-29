/**
 * Ledger — the derived figures (stats.ts, the encore stats pattern).
 *
 * Every KPI headline and chart extent is COMPUTED from the seed — the
 * drift gate asserts the rendered numbers against these pure functions,
 * so a seed edit that drifts a headline fails the suite. No I/O, no
 * clock reads, no RNG.
 */
import { ARR_BASE, CASH_POSITION, FLOW, MONTHLY_BURN, PRIOR_CASH, PRIOR_NET_30 } from "./seed";
import { money, months as fmtMonths } from "./format";
import type { FlowSeries, Kpi, Txn } from "./types";

/** The 90-day flow series with net + extents (the chart's input). */
export function flowSeries(): FlowSeries {
  const days = FLOW.map((d) => ({ ...d, net: d.inflow - d.outflow }));
  const maxAbs = Math.max(...days.flatMap((d) => [Math.abs(d.inflow), Math.abs(d.outflow)]));
  const net90 = days.reduce((n, d) => n + d.net, 0);
  return { days, maxAbs, net90, start: days[0]!.date, end: days[days.length - 1]!.date };
}

/** Net over the trailing N days (30 for the KPI). */
export function netTrailing(n: number): number {
  return FLOW.slice(-n).reduce((s, d) => s + (d.inflow - d.outflow), 0);
}

/** Runway in months from cash and burn — never negative, one decimal. */
export function runway(cash: number, monthlyBurn: number): number {
  if (monthlyBurn <= 0) return 0;
  return Math.max(0, cash / monthlyBurn);
}

/** The four KPI cards, figures pre-formatted (numbers-as-headlines). */
export function kpis(): Kpi[] {
  const net30 = netTrailing(30);
  const cashPct = ((CASH_POSITION - PRIOR_CASH) / PRIOR_CASH) * 100;
  const netPct = ((net30 - PRIOR_NET_30) / Math.abs(PRIOR_NET_30)) * 100;
  const run = runway(CASH_POSITION, MONTHLY_BURN);
  const arrPct = 14.2; // the fixture's fixed ARR growth (seeded, receipted)
  return [
    { id: "cash", label: "Cash position", figure: money(CASH_POSITION), deltaPct: +cashPct.toFixed(1), deltaLabel: "vs prior month", receipt: "4 accounts · seeded fixture Q4 FY26" },
    { id: "net30", label: "Net cash flow, 30d", figure: money(net30), deltaPct: +netPct.toFixed(1), deltaLabel: "vs prior 30d", receipt: "90-day series · seeded fixture" },
    { id: "runway", label: "Runway", figure: fmtMonths(run), deltaPct: null, deltaLabel: "at the current burn", receipt: `${money(MONTHLY_BURN)}/mo burn · seeded` },
    { id: "arr", label: "Annualized revenue", figure: money(ARR_BASE), deltaPct: arrPct, deltaLabel: "vs prior quarter", receipt: "trailing 12mo · seeded fixture" },
  ];
}

/** Sort a txn list by a column key — the table's whole interaction. */
export type SortKey = "date" | "merchant" | "amount" | "status";
export function sortTxns(rows: Txn[], key: SortKey, dir: "asc" | "desc"): Txn[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

/** The status chip's semantic class (data colors, never chrome — plan §4). */
export function statusTone(s: Txn["status"]): "pos" | "neutral" | "neg" {
  return s === "settled" ? "pos" : s === "pending" ? "neutral" : "neg";
}
