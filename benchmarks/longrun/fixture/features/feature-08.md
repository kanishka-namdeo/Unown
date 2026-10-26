# Feature 08 — audit log

Every mutating operation appends a journal line to `.ledger/audit.log`.

- Line shape: `<ISO-8601-utc> <OP> <detail>` — e.g.
  `2026-01-15T10:30:00.000Z ADD e-003 food 2500` or
  `2026-01-15T10:31:00.000Z IMPORT 2`.
- Ops journaled: ADD (cli add), IMPORT (count of rows), BUDGET-SET
  (category), UNDO (what was undone). Read-only commands never journal.
- `audit` prints the journal to stdout, newest LAST (append order); cap the
  listing at the most recent 20 lines, prefixing with `…` when older lines
  exist. Empty/missing journal → `(no audit entries)` exit 0.
- The audit log is append-only: nothing in the app ever rewrites or truncates
  it (the cap is on the PRINTING, not the file).
