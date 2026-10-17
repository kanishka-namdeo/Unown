# clippad API reference

Every module lives in `src/` and is pure TypeScript with no dependencies.

## types.ts

```ts
/** The creator of a note: a structured author record. */
export interface Author {
  id: string;   // stable user id, e.g. "u-001"
  name: string; // display name, e.g. "ada"
}

export interface Note {
  id: string;          // "n-001"
  title: string;
  body: string;
  createdAt: number;   // epoch ms
  createdBy: Author;   // structured author record
  tags: string[];
}

export interface NoteInput {
  title: string;
  body: string;
  createdBy: Author;   // structured author record
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
  register(name: string): Author          // new user, returns {id: "u-001", name}
  ensure(name: string): Author            // lookup-or-register by name
  lookup(id: string): Author | undefined  // full author record for an id
  nameOf(id: string): string | undefined  // display name for an id
  ids(): string[]                         // registration order
}
```

## notebook.ts

```ts
class Notebook {
  add(input: NoteInput): Note
  remove(id: string): boolean
  get(id: string): Note | undefined
  all(): Note[]
  size(): number
  byAuthor(id: string): Note[]          // matches createdBy.id === id
  byTag(tag: string): Note[]
  sortedByTitle(): Note[]
}
```

## search.ts

```ts
findMatches(notes: Note[], query: string): Note[]  // substring across title/body/tags and author NAME or ID
findByTitle(notes: Note[], title: string): Note[]  // exact, case-insensitive
```

## format.ts

```ts
formatNote(note: Note): string            // "• [n-001] Ship it (by ada [u-001]) — 3 words"
formatHeader(label: string, count: number): string // "== All notes (3) =="
```

## format-table.ts

```ts
formatNoteTable(notes: Note[]): string    // columns ID, TITLE, CREATED-BY ("ada (u-001)"), WORDS
```

## store.ts

```ts
class StoreError extends Error

serializeNotes(notes: Note[]): string     // JSON envelope { version: 1, notes }
parseStore(text: string): Note[]          // lenient envelope parse (note payloads passed through)
parseNote(raw: unknown): Note             // STRICT: throws StoreError unless every field has the
                                          //   right type (createdBy must be {id: string, name: string})
saveNotes(path: string, notes: Note[]): void
loadNotes(path: string): Note[]           // parseStore + parseNote (strict)
```

## stats.ts

```ts
interface AuthorStats { id: string; name: string; count: number; words: number }

authorStats(notes: Note[]): AuthorStats[]  // grouped by author ID, count desc, then id
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
| `add <title> --body <t> --author <name> [--tags a,b]` | `added n-001` (name resolved via `users.ensure`) |
| `list` | `== All notes (N) ==` then `• [n-001] Ship it (by ada [u-001]) — 3 words` lines |
| `table` | fixed-width table, `CREATED-BY` column shows `ada (u-001)` |
| `stats` | `ada (u-001): 2 notes, 6 words` per author |
| `find <query>` | matching `formatNote` lines under `== Matches (N) ==` |
| `author <id>` | notes whose createdBy.id equals the id |
| `total` | `total 42 words` |
