# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Run tests with: `node <file>.test.mjs` (no test runner needed)
- Tests use `node:assert/strict` and import from `./calc.mjs`
- Use template literals for clean string construction
- Use `Array.map().join()` for joining formatted rows with separators

## Known pitfalls
- When implementing stats functions that depend on calc.mjs, import `add` and use it to accumulate sums — don't use native `+` directly
- Use `node:fs` `writeFileSync`/`readFileSync` with explicit `"utf8"` encoding for persistence
- JSON.stringify output must end with a single newline for test assertions
- For case-insensitive substring search across record values: `JSON.stringify(record).toLowerCase().includes(q.toLowerCase())`

## Task playbooks
- Implement search: stringify entire record, lowercase both sides, check includes
