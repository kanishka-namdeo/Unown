# clippad API reference

Every module lives in `src/` and is pure TypeScript with no dependencies.

## types.ts

```ts
/** The creator of a note. A plain author NAME, e.g. "ada". */
export type Author = string;

export interface Note {
  id: string;          // "n-001"
  title: string;
  body: string;
  createdAt: number;   // epoch ms
  createdBy: Author;   // author name, e.g. "ada"
  tags: string[];
}

export interface NoteInput {
  title: string;
  body: string;
  createdBy: Author;   // author name
  tags?: string[];
  createdAt?: number;
  id?: string;
}
```

## ids.ts

```ts
nextId(prefix: string): string   // monotonic: "n-001", "u-001", ...
resetIds(): void                 // test helper
```

## note.ts

```ts
createNote(input: NoteInput): Note        // fills id (n-001…) and createdAt (0)
wordCount(note: Note): number             // non-empty words in body
summaryLine(note: Note): string           // "[n-001] Ship it — 3 words"
```

## users.ts

```ts
class UserDirectory {
  register(name: string): string          // new user id "u-001", returns the ID
  nameOf(id: string): string | undefined  // display name for an id
  ids(): string[]                         // registration order
}
```

Note: ids returned here are for bookkeeping only — notes store the NAME.

## notebook.ts

```ts
class Notebook {
  add(input: NoteInput): Note
  remove(id: string): boolean
  get(id: string): Note | undefined
  all(): Note[]
  size(): number
  byAuthor(name: string): Note[]          // matches createdBy === name
  byTag(tag: string): Note[]
  sortedByTitle(): Note[]
}
```

## search.ts

```ts
findMatches(notes: Note[], query: string): Note[]  // substring across title/body/tags/author NAME
findByTitle(notes: Note[], title: string): Note[]  // exact, case-insensitive
```

## format.ts

```ts
formatNote(note: Note): string            // "• [n-001] Ship it (by ada) — 3 words"
formatHeader(label: string, count: number): string // "== All notes (3) =="
```

## format-table.ts

```ts
formatNoteTable(notes: Note[]): string    // columns ID, TITLE, CREATED-BY (name), WORDS
```

## store.ts

```ts
class StoreError extends Error

serializeNotes(notes: Note[]): string     // JSON envelope { version: 1, notes }
parseStore(text: string): Note[]          // lenient envelope parse (note payloads passed through)
parseNote(raw: unknown): Note             // STRICT: throws StoreError unless every field has the
                                          //   right type (createdBy must be a string)
saveNotes(path: string, notes: Note[]): void
loadNotes(path: string): Note[]           // parseStore + parseNote (strict)
```

## stats.ts

```ts
interface AuthorStats { author: string; count: number; words: number }

authorStats(notes: Note[]): AuthorStats[]  // grouped by author NAME, count desc, then name
totalWords(notes: Note[]): number
```

## cli.ts

```ts
interface CliDeps { notebook: Notebook; users: UserDirectory }

runCli(argv: string[], deps: CliDeps): string
freshDeps(): CliDeps
```

Commands and outputs:

| command | output |
| --- | --- |
| `add <title> --body <t> --author <name> [--tags a,b]` | `added n-001` |
| `list` | `== All notes (N) ==` then `• [n-001] Ship it (by ada) — 3 words` lines |
| `table` | fixed-width table, `CREATED-BY` column holds the author name |
| `stats` | `ada: 2 notes, 6 words` per author |
| `find <query>` | matching `formatNote` lines under `== Matches (N) ==` |
| `author <name>` | notes whose createdBy equals the name |
| `total` | `total 42 words` |
