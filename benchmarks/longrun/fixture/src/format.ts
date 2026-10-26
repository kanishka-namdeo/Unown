import type { Entry } from "./types";

/** "e-001  2026-01-15  food       2500  grocery run" (payee/note optional tail). */
export function formatEntry(e: Entry): string {
  const head = `${e.id}  ${e.date}  ${e.category.padEnd(10)}${String(e.amountCents).padStart(7)}`;
  const tail = [e.payee, e.note].filter(Boolean).join(" - ");
  return tail ? `${head}  ${tail}` : head;
}

/** Cents to "12.34" (no currency symbol). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
