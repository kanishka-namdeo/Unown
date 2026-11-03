# Coda domain layer

Pure-TypeScript, DOM-free, dependency-light core of the Coda app.
Everything under this directory is tested headlessly and must stay
that way — the persistence adapters (IndexedDB) and the UI live outside
the domain and exchange ONLY serialized strings with it.

## Purity contract

- No imports outside this directory, except the single pure third-party
  module `fuse.js` (resolves upward from the repo root `node_modules`;
  Coda itself declares zero dependencies).
- No DOM / Node globals. The two proof mechanisms:
  - `scripts/check-import-boundary.ts` — a boundary test that reads
    every `src/domain/**/*.ts` and asserts the import graph: only
    relative imports (`./…`) or `fuse.js`. Fails the run on anything
    else.
  - A plain grep: `grep -rE 'document\.|window\.|indexedDB|localStorage' src/domain/`
    must return nothing.
- The module is side-effect-free at import time: importing a domain
  file neither touches a clock (clocks are injected into `Repository`)
  nor any I/O.

## Data model (`types.ts`)

- `Note { id, title, body, createdAt, updatedAt, tags[] }`
- `Task { id, boardId, title, status: todo|doing|done, dueAt?, noteIds[], createdAt, updatedAt }`
- `Board { id, name, taskOrder[], createdAt, updatedAt }`
- `CodaData { notes, tasks, boards }` — the single serializable shape.

All fields are plain JSON types (strings, string arrays). No `Date`
objects, no class instances, no symbols — `JSON.stringify` of the whole
`CodaData` is the export/sync payload and round-trips losslessly.

## State machine (`repository.ts`)

`Repository.moveTask(id, to)` is the ONLY status-mutation surface.
The legal transition table is the single source of truth
(`LEGAL_TRANSITIONS`):

| from    | legal `to`            |
|---------|-----------------------|
| `todo`  | `doing`, `done`       |
| `doing` | `done`, `todo`        |
| `done`  | `doing`, `todo`       |

- Same-status is a legal no-op and does NOT bump `updatedAt`.
- Anything else — including a `to` value outside the three statuses —
  throws `DomainInvariantError`.

Other invariants, all enforced by the repository:

- **taskOrder integrity** — for every board, the set of task ids on the
  board equals `board.taskOrder` exactly. `createTask` appends,
  `deleteTask` removes, `reorderTasks` replaces (validating the set
  first), `deleteBoard` cascades.
- **reference integrity** — a task's `boardId` must exist; a task's
  `noteIds` must all exist; `deleteNote` scrubs the id from every task.

## Store (`store.ts`)

ONE serializable in-memory container:

- `new Store()` — empty
- `Store.fromSerialized(json)` / `store.toSerialized()` — the only
  byte-format seam; deserialization is structurally validated
  (`DataFormatError` on shape drift, never a half-valid store).
- `replaceAll(data)` — atomic whole-state replace (import/sync restore).
- Repository binds to the store's live arrays; UI code sees only the
  readonly accessors.

Export/sync later is a non-rewrite: the payload format is already the
JSON of one `CodaData` object.

## Search (`search.ts`)

- `buildSearcher(notes, tasks)` → Fuse-backed, case-insensitive,
  special-char-safe (Fuse does its own literal handling; no regex is
  ever built from user input).
- Empty query = "most recently updated" list (score 0), not an error.
- Ranking: relevance score first, then `updatedAt` desc, then `id`
  asc — deterministic for a given snapshot.
- `substringSearch` is the pure-substring fallback used when Fuse is
  unavailable in a target runtime; same empty-query contract.

## Markdown format (`markdown.ts`)

One note = one `.md` file, lossless round-trip:

```
---
id: <id>
createdAt: <iso>
updatedAt: <iso>
tags: <JSON array of strings, or []>
---
# <title>            ← ALWAYS present ("# " when the title is empty)

<body verbatim>
```

Grammar invariants (what makes `noteToMarkdown`/`markdownToNote` a
total bijection):

1. The parser looks for the FIRST closing `---` after line 0; further
   `---` lines are body, not delimiters.
2. The title line is ALWAYS emitted and is always consumed as exactly
   the first line after the header — so a body that itself starts with
   `# …` can never be mistaken for the title.
3. The body is written and read verbatim, including leading blank lines
   and `---` lines.
4. `tags` is a JSON array of strings — any character survives.

Foreign / hand-written files that do not match this grammar are
rejected with `MarkdownParseError` (never silently lossy).

## Tests

`bun test` from `apps/coda/` (Lane A — no happy-dom preload, DOM-free
proof) and `bun test apps/coda` from the repo root (Lane B — the future
CI lane, where the happy-dom preload applies and would MASK purity
violations, so the boundary check + grep are the real guards).
