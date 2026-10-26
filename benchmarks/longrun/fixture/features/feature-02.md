# Feature 02 — date-range filter

`list --from <YYYY-MM-DD> --to <YYYY-MM-DD>` filters entries inclusively on
both ends; the flags combine with `--category` (AND semantics).

- CLI: `bun src/cli.ts list --from 2026-01-01 --to 2026-01-31`.
- Module: `Ledger.byDateRange(from: string, to: string): Entry[]` — inclusive
  on both ends, insertion order.
- An invalid date value (fails `YYYY-MM-DD`) is an error: exit 1 with a
  message naming the bad value. A range where from > to simply matches
  nothing (not an error).
