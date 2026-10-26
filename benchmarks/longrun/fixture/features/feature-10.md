# Feature 10 — persistent store v2

The ledger itself becomes persistent, with a strict versioned store.

- State file `.ledger/store.json` holds the entries between invocations:
  shape `{ "version": 2, "entries": [ …Entry… ] }` (entries in insertion
  order).
- `add` / `import` / `recur apply` (and `undo` of those) all operate on the
  loaded store and write it back; `list`, `balance`, `summary`, `export`
  read the loaded store. The in-memory core (`src/ledger.ts`) stays the
  in-process engine; persistence wraps it.
- Load rules: no file → start empty (and create the file lazily on first
  write). A file with `"version": 1` (a bare JSON array of entries) is
  MIGRATED in place to v2 on load (rewrite the file, entries unchanged).
  A file that is neither — bad JSON, missing version, version > 2, or
  entries that fail validation — is a fatal error: exit 1 with a message
  starting `store error:`.
- `store check` command: validates the store without modifying anything;
  prints `store ok (N entries)` or the same `store error:` + exit 1.
- Every write is atomic: write a temp file in the same directory then
  rename over the target (a crash mid-write must never corrupt the store).
