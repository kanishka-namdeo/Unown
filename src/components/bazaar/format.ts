/** Shared formatting helpers. All money is in cents. */

export function money(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

export function fmt(date: string | number | Date): string {
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtDateTime(date: string | number | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
