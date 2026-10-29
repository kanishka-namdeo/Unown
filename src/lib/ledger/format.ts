/**
 * Ledger — the pure formatters (the encore format.ts pattern).
 *
 * Money and dates render through these helpers ONLY — one spelling per
 * figure class, so the numbers-don't-lie voice stays consistent (and
 * tabular everywhere).
 */

/** $1,284,600 — the account/KPI spelling. Negative keeps its sign: −$4,120. */
export function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$${abs.toLocaleString("en-US")}`;
}

/** Compact for chart axes and deltas: $48.2k / $1.25M / −$96.4k. */
export function moneyCompact(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** +12.4% / −8.1% — the delta chips. */
export function pct(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
}

/** "18 Oct 2026" — built by hand so a UTC prerender and any hydration agree. */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]?.slice(0, 3) ?? ""} ${y}`;
}

/** "19 mo" — the runway spelling. */
export function months(n: number): string {
  return `${Math.round(n)} mo`;
}
