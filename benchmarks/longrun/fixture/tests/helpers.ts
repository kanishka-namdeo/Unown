import { Ledger } from "../src/ledger";

const A: [string, number, string][] = [
  ["2026-01-02", 2500, "food"],
  ["2026-01-03", 12000, "rent"],
  ["2026-01-04", 800, "food"],
];

export function makeLedger(): Ledger {
  const l = new Ledger();
  for (const [date, amountCents, category] of A) l.add({ date, amountCents, category });
  return l;
}

export const SEED_TOTAL = 2500 + 12000 + 800;
