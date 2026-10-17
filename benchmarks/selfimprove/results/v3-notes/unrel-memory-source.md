# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Use imperative style for algorithmic rules — concise and actionable.

## Known pitfalls
- **Book store discount grouping**: Greedy largest-first grouping fails. Two groups of 4 (5120) beats 5+3 (5160).
  - After greedy grouping, post-optimize: swap any 5+3 pair for 4+4 to minimize cost.
  - Verify with: 8 books → compare (5,3) vs (4,4) costs before finalizing.
