# exprq — a JSON query CLI

You are building **exprq**, a small command-line tool that evaluates a query
language over a JSON file — a real utility in the style of `jq`, written as a
plain Node.js CLI (no dependencies, no build step, no TypeScript).

## Command line

```
node src/cli.js '<query>' <data.json>
```

- `<data.json>` is REQUIRED. If it is missing, unreadable, or not valid JSON,
  print EXACTLY `usage: cli.js '<query>' <data.json>` to stderr, exit `2`.
- The `<query>` argument must be present (may be empty; that is a parse error).

## Output rules (success)

- Print the result as COMPACT JSON — `JSON.stringify` default, no spaces —
  followed by exactly one newline, to stdout; exit `0`.
- If a query result is `undefined`, print `null` instead (never the text
  `undefined`).

## The grammar

```
query    := segment ( '|' segment )*
segment  := path | call
path     := '.' ( field | '[' int ']' ) ( '.' field | '[' int ']' )*
field    := IDENT | IDENT '?'
call     := IDENT '(' ')'
int      := '-'? digit+
IDENT    := [a-z][a-z0-9_]*
```

Semantics:

1. The query is a PIPELINE: the input value flows left to right through each
   segment. `.a | .b` on `{"a":{"b":7}}` yields `7`.
2. `.field` reads a key from an object. On a non-object: eval error.
3. `[i]` indexes an array. Negative counts from the end: `-1` is the last
   element. On a non-array: eval error. Out of range: eval error.
4. `field?` is the OPTIONAL form of 2: a failure it would raise (missing field,
   or input not an object) instead yields `null` and evaluation continues
   from that `null`. `.foo?` on the number `5` yields `null`. There is no
   optional form of `[i]` — `.[0]?` is a parse error (see the error list).
5. The ONLY calls are:
   - `length()` — object: number of keys; array: number of elements; string:
     its character length; null: `0`; number: the number itself.
   - `keys()` — object only: its keys sorted in ascending code-point order as
     an array of strings. On anything else: eval error.
   - Any other name called is a parse error (`unknown function`).
6. SPACES are legal ONLY as padding immediately around the pipe `|`
   (any number before and after it). Anywhere else a space is an ordinary
   character and usually the offending one in a parse error (including
   trailing spaces with no pipe following). A query consisting only of
   spaces is the empty-query error.

## Error contract (byte-exact — the tests assert every byte)

Exit codes: `0` success, `1` eval error, `2` parse error or usage error.
All errors go to stderr with a trailing newline. Nothing goes to stdout on any
error.

EVAL errors — format exactly:

```
eval error: <DETAIL>
```

DETAIL is exactly one of (fill `<...>` with actual values):

- `missing field '<name>'`
- `expected object, got <t>`
- `expected array, got <t>`
- `index <i> out of bounds (length <n>)`

`<t>` is the JSON type of the offending value: one of `array`, `string`,
`number`, `boolean`, `null` (an `undefined` prints as `null`).

PARSE errors — format exactly:

```
parse error: line 1, col <COL>: <DETAIL>
```

`<COL>` is 1-BASED (column 1 is the query's first character). DETAIL is
exactly one of:

- `query is empty` — for `''` and for spaces-only queries; ALWAYS col 1.
- `expected '.' at start of segment` — the character starting a segment (the
  query's first char, or the first non-space char after `|`) is neither `.`
  nor a valid IDENT start. Col: the offending char (or one-past-the-end when
  the query ended before a segment started).
- `invalid field name` — what follows `.` is not an IDENT (end of query, a
  digit-first name, a symbol, ...). Col: the offending char (one-past at end).
- `expected '.' or '[' after field '<name>'` — a field (with its optional `?`
  if present) is followed by something that is not `.`, `[`, `|`, or end.
  Col: the offending char.
- `expected '.' or '[' after index` — a `[i]` step is followed by something
  that is not `.`, `[`, `|`, or end. Col: the offending char.
- `expected integer in brackets` — `[` is not followed by an int. Col: the
  offending char (one-past at end).
- `expected ']' after index` — the int inside brackets is not followed by `]`.
  Col: the offending char (one-past at end).
- `expected '(' after function name '<name>'` — a valid IDENT starts a
  segment but no `(` follows it. Col: the offending char (one-past at end).
- `unknown function '<name>'` — IDENT + `(` but the name is not `length` or
  `keys`. Col: the FIRST character of the name (pinned).
- `expected '|' after segment` — a segment finished and the next character is
  not `|`, not pipe-padding spaces, and not end of query. Col: the offending
  char (or one-past at end).

General column rule: the col is where the offending character sits; when the
offense is "the query ended too soon", the col is one past the last character
(len(query) + 1). The two pinned exceptions: `query is empty` (col 1) and
`unknown function` (col of the name's first char).

## Architecture (required)

- `src/tokenizer.js` — produces `{type, value, col}` tokens with 1-based cols.
- `src/parser.js` — builds an AST from the token stream.
- `src/evaluator.js` — walks the AST.
- `src/cli.js` — thin: argv, file read, wiring, output/exit.
- No `eval`/`Function`/dynamic require. Runs on plain Node ≥ 18 via
  `node src/cli.js ...` from the repo root.

## Working rules

- Tests land beside your sources as `*.test.mjs` (already present, READ-ONLY —
  run them, never edit them). They are restored pristine for scoring; your
  job is to make them green.
- Run tests with `node <testfile>`; iterate until green, then stop.
- Before finishing, use the `note` tool to record 2-4 concise lessons a future
  session in a RELATED project would benefit from (format conventions you
  discovered, workflow gotchas, byte-exactness rules) — durable engineering
  lessons, not project trivia.
- When every test passes — or you cannot improve further — reply `DONE`.
