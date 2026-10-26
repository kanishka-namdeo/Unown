# Feature 06 — category budgets

Budgets put a spending cap per category.

- `budget set <category> <cents>` stores the cap; prints `budget food = 5000`.
  Re-setting a category overwrites. Bad category slug or non-positive cents
  → usage error (exit 1).
- `budget report` prints one line per known budget:
  `food  3300 / 5000` and, when spent exceeds the cap, the line ends with
  ` OVER` (e.g. `food  6300 / 5000 OVER`). Categories without a budget are
  not listed. No budgets at all → `(no budgets)` exit 0.
- Budgets persist in `.ledger/budgets.json` (JSON object mapping category →
  cents). Spent is computed against the current ledger state.
- `budget` with no subcommand is a usage error (exit 1).
