# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Domino chain problems: treat as Eulerian circuit search.

## Known pitfalls
- Domino chain backtracking must try all starting dominoes and both orientations.
- Check even degree and connectivity first for early termination before backtracking.

## Task playbooks
- Domino chain implementation:
  1. Validate: all vertices have even degree.
  2. Validate: graph is connected (using visited count on edges).
  3. Only then run backtracking DFS with orientation flip.
