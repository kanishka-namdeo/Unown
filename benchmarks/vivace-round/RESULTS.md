# The Vivace round — results

One-line purpose: the before/after ledger for the round's benchmark
claims — baseline, midpoint, closeout; every number points at its receipt.

- Round log: [docs/vivace-round-session.md](../../docs/vivace-round-session.md)
- Methodology: [../README.md](../README.md) · suite: [README.md](README.md)

## Baseline (2026-11-05, tree `18e4a98a`, bun 1.4.4, agnes-3.0-flash)

| Task | Result | Receipt |
|---|---|---|
| C1 codegen+run | PASS · 3-4 turns · 4-5 s · exit 0 | `sessions/c1-envelope-*.json` |
| C2 test-fix | PASS · 4 turns · ~6 s · exit 0 | `sessions/c2-envelope-*.json` |
| C3 delegate+schema | content PASS · schema exit 3 (V-3 class) · 2 turns · ~20 s | `sessions/c3-envelope-*.json` |
| B-15 schema-strict (holdout) | not yet run (frozen at Phase 0) | — |
| B-16 hostile-clip (holdout) | not yet frozen (lands with ticket V-3) | — |

## Midpoint

(null — fills as tickets land)

## Closeout

(null — fills at teardown)
