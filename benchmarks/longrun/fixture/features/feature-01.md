# Feature 01 — category filter

`list --category <cat>` shows only entries of that category; matching is
case-insensitive on the stored slug. With no flag, `list` keeps today's
behavior (all entries).

- CLI: `bun src/cli.ts list --category food` → only food rows (or the empty
  placeholder `(no entries)` when nothing matches).
- Module: `Ledger.byCategory(category: string): Entry[]` — same
  case-insensitive match, returns matching entries in insertion order.
- Unknown/missing category flag: `--category` without a value is a usage
  error (exit 1).
