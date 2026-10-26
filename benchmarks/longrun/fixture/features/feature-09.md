# Feature 09 — recurring entries

Templates that expand into real entries on demand.

- `recur add <amount-cents> <category> [--payee p] [--note n] --every month --day <DD>`
  stores a template: prints `recur r-001 added (monthly on day 15)`.
  Templates persist in `.ledger/recurring.json` (JSON array).
- `recur apply --month <YYYY-MM>` adds ONE entry per template, dated
  `<YYYY-MM>-<DD>` (day kept as-is). Prints `applied N entries for 2026-03`.
- Idempotency: applying the same month twice adds NOTHING the second time
  (prints `applied 0 entries for 2026-03 - already applied`). Track what has
  been applied in `.ledger/recurring.json` itself (an `appliedMonths` list
  per template).
- `recur list` prints the templates: `r-001  1500  food  monthly day 15`.
  Empty → `(no recurring templates)` exit 0.
- Bad `--every` (only `month` is supported) or out-of-range `--day`
  (1–28 — no month-end games) → usage error exit 1.
