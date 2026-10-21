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
  // A mixed run (models resolved to different rerun dirs) carries the marker
  // after the date — match the date anywhere, and say "mixed" when it does:
  // per-model receipts mean the stamp is a summary, not a single run.
  const mixed = run.includes("(mixed");
  const match = /\/rerun-(\d{4}-\d{2}-\d{2})/.exec(run);
  if (!match) return "base receipt";
  return mixed ? `${match[1]} rerun (per-model runs)` : `${match[1]} rerun`;
}
