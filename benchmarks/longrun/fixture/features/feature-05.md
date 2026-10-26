# Feature 05 — monthly summary

`summary --month <YYYY-MM>` prints a per-category totals table for that
calendar month, then the month total.

- CLI shape:

  ```
  food       3300
  rent      12000
  total     15300
  ```

  (category slug padded to 10, amounts right-aligned; only categories with
  entries in that month appear; the total line is always present.)
- A month with no entries prints just `total 0`.
- `--month` with a bad format (not `YYYY-MM`) is a usage error (exit 1).
- Module: `Ledger.monthlyTotals(month: string): { category: string; totalCents: number }[]`
  (insertion order of first appearance) and `Ledger.monthTotal(month: string): number`.
