# Feature 03 — CSV export

`export --csv` prints the whole ledger as CSV to stdout.

- Header row first: `date,amount_cents,category,payee,note`.
- One row per entry, insertion order; amounts are plain integer cents
  (no formatting).
- Fields containing a comma or a double quote are wrapped in double quotes
  with inner quotes doubled (RFC 4180 style). Empty optional fields print as
  empty strings (nothing between the commas).
- Exit 0; an empty ledger prints only the header.
