# Feature 07 — undo

`undo` reverts the most recent mutating CLI operation, whatever it was
(an `add`, an `import` row-by-row in reverse, ...), one level per call.

- Each undo prints what it undid: `undo add e-003` / `undo import 2 entries`
  (an import undoes as ONE level: all its rows, newest first).
- Multi-level: consecutive `undo` calls keep walking back the operation
  stack. When there is nothing left to undo: message `nothing to undo`,
  exit 1.
- The undo stack persists in `.ledger/undo.json` so undo works across
  process invocations.
- Undo itself is a read-only inspection of the stack: undoing does not add
  an "undo" entry onto the stack (redo is out of scope).
