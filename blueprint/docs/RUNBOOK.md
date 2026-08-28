# Unown operational runbook

Living operational knowledge the agent maintains about running itself.
The files a proposal may edit are exactly the ones validation re-checks.

## Memory tier order

Effective stack loads as managed -> user -> project -> local; specificity wins conflicts.

## Gate cheat-sheet

- `git push --force` or remote history rewrite: deny
- download piped straight into an interpreter (`curl ... | sh`): deny
- writing token-shaped secrets into files: deny
- other destructive-looking filesystem ops: ask with reason

## Formatting priority

Python edits prefer ruff format then black; web/text formats prefer prettier;
go uses gofmt. Missing formatters skip silently, never block the turn.

## Cost discipline

Budget knobs live in docs/COST.md; nightly jobs cap inputs via DREAM_MAX_NOTES.

## Dream archive

Dream consolidations are archived under memory/dream-archive/ after review.

---
Maintained via harness-analyst proposals; every change passes validate_fix.py.
