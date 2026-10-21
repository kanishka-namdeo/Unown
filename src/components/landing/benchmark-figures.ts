/**
 * Figure formatting for the benchmark cards. A generated figure is either a
 * receipt-backed number or `null` (the receipt had no such field); the null
 * path must never be printed as a number, and the card's run stamp must come
 * from the generated canonical run instead of a hand-typed date.
 */

export function formatPct(value: number | null): { text: string; missing: boolean } {
  return value === null ? { text: "not measured", missing: true } : { text: value.toFixed(1), missing: false };
}

export function runStamp(run: string): string {
  const match = /\/rerun-(\d{4}-\d{2}-\d{2})$/.exec(run);
  return match ? `${match[1]} rerun` : "base receipt";
}
