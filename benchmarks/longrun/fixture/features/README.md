# ledgerlog — staged buildout

This directory holds the feature work for ledgerlog, in strict order:

- Read `feature-01.md` … `feature-10.md` **in order** and implement each one
  completely before moving to the next.
- After each feature: make `bun test` green (add your own tests under
  `tests/` — never delete or weaken an existing test), then commit with
  `git commit -m "feat: NN <short-slug>"`.
- The CLI entry is `bun src/cli.ts <command> [args]` and must stay that.
- Any persistent state lives under `.ledger/` **relative to the current
  working directory** (create it on demand; it may be absent).
- Keep the project dependency-free (bun + TypeScript stdlib only).
