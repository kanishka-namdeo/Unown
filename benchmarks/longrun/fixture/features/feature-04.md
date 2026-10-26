# Feature 04 — CSV import

`import --csv <path>` reads a CSV in the exact shape of feature-03's export
(header `date,amount_cents,category,payee,note`) and adds every valid row.

- Valid rows are added and counted; a summary line prints on stdout:
  `imported N entries, skipped M` (plus ` imported ids: e-…, e-…` when N>0).
- A row is skipped (counted in M, warning to stderr naming the row number)
  when: wrong column count, non-integer or non-positive amount, malformed
  date, malformed category slug. Valid rows still import — one bad row never
  aborts the file.
- A missing file is an error (exit 1, message names the path). The header row
  is required but not imported; a wrong header name is an error (exit 1).
- RFC 4180 quoting from feature-03 is honored on parse.
