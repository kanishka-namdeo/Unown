# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- This project involves text transposition operations.

## Known pitfalls
- When transposing text with uneven row lengths, only pad with spaces on the left (when a shorter row comes before a longer row at a given column), never on the right.
- Check if any subsequent row has content at the current column before adding padding spaces.
