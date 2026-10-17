# clippad

A tiny note-taking CLI app used as the fixture for a multi-file refactor
exercise. Pure TypeScript, no dependencies, tests run with [bun](https://bun.sh):

```sh
bun test
```

## What it does

clippad keeps notes in memory (and can persist them as JSON). Every note
records **who created it** with a single plain string field:

```json
{
  "id": "n-001",
  "title": "Ship it",
  "body": "release notes draft",
  "createdAt": 0,
  "createdBy": "ada",
  "tags": ["work"]
}
```

`createdBy` is just the author NAME (e.g. `"ada"`). `src/users.ts` hands out
user ids (`u-001`, ...) for registered names, but notes only ever store the
name.

## Commands

```
clippad add <title> --body <text> --author <name> [--tags a,b]   # create a note
clippad list                                                     # "• [n-001] Ship it (by ada) — 3 words"
clippad table                                                    # fixed-width table, CREATED-BY column
clippad stats                                                    # "ada: 2 notes, 6 words"
clippad find <query>                                             # search title/body/tags/author
clippad author <name>                                            # notes by that author name
clippad total                                                    # word total
```

## Layout

```
src/types.ts          Note, NoteInput, Author (string)
src/ids.ts            n-001 / u-001 id generator
src/note.ts           createNote, wordCount, summaryLine
src/users.ts          UserDirectory (register, nameOf)
src/notebook.ts       Notebook container (add/remove/byAuthor/byTag/...)
src/search.ts         findMatches, findByTitle
src/format.ts         formatNote, formatHeader
src/format-table.ts   formatNoteTable
src/store.ts          JSON persistence + strict parseNote validation
src/stats.ts          authorStats, totalWords
src/cli.ts            runCli command dispatch
tests/                bun test suite (helpers + one file per module)
docs/API.md           full API reference
```

See [docs/API.md](docs/API.md) for the per-module API.
