# csvrow — a CSV row filter CLI

You are building **csvrow**, a small command-line tool that filters rows of a
CSV file through a boolean expression language — a real utility in the style of
`awk`/`csvfix`, written as a plain Node.js CLI (no dependencies, no build step,
no TypeScript).

## Command line

```
node src/cli.js '<expr>' <data.csv>
```

- `<data.csv>` is REQUIRED. If it is missing, unreadable, or the CSV is
  malformed (below), print EXACTLY `usage: cli.js '<expr>' <data.csv>` to
  stderr, exit `2`.

## CSV input rules

- Rows are separated by `\n` (a trailing `\r` is stripped — Windows CRLF safe).
- Fields are separated by `,`.
- A field MAY be quoted with `"`. Inside quotes: `,` is literal, and `""` is a
  literal `"` (doubled-quote escape). A quote only opens a quoted field at the
  very start of the field.
- A quoted field that is never closed on its own line = malformed CSV
  (usage error, exit 2 — no stderr text beyond the usage line).
- An empty file is legal data with zero rows.

## Output rules (success)

- Every row for which the expression evaluates TRUE is printed, serialized as
  CSV (same quoting rules as input), one per line, each line ending in `\n`.
- A field is quoted on output ONLY if it contains `,`, `"`, `\n`, or `\r`
  (and then its `"` chars are doubled).
- Zero matching rows → empty stdout (no newline), exit `0`.
- Exit code `0` whenever the expression evaluates (even if nothing matched).

## The expression grammar

```
expr    := or
or      := and ( 'or' and )*
and     := not ( 'and' not )*
not     := 'not' not | primary
primary := '(' or ')' | cmp
cmp     := operand ( ('==' | '!=' | '>' | '>=' | '<' | '<=') operand )?
operand := colref | string | number
colref  := '$' int
number  := '-'? digit+ ( '.' digit+ )?
string  := '"' ( [^"\] | '\' ['"nt\] )* '"'
```

Precedence (tightest first): `not` > `and` > `or`. `and`/`or` are
left-associative. A comparison (`cmp`) is NON-associative: `$1 == "a" == "b"`
is a parse error.

Keywords `and` / `or` / `not` are recognized only as whole lowercase words
(next char must not be a letter/digit/underscore).

A BARE OPERAND (a `$n`, string, or number that is not part of any comparison)
has no truthiness — anywhere it appears, the expression is a parse error:

```
csvrow: error: expected a comparison at col <C>
```

Bareness propagates: `$1` alone, `not $1`, `not not $1`, `$1 == "a" and $2`
are ALL this error. `<C>` is the 1-based column of the FIRST bare operand in
parse order (left to right). `$1 or $2` errors at col 1; `not $1` at col 5.

## Evaluation semantics

- `$n` reads column n of the current row. **Columns are 1-based** (`$1` is the
  first column). `$0` is a parse error (`invalid column number`, col = the
  column of the `0` character). A reference past the row's width is an eval
  error: `column <n> out of range (row has <k> columns)`.
- A field value is a NUMBER iff it matches `^-?[0-9]+(\.[0-9]+)?$` exactly
  (no spaces, no exponents, no leading `+`).
- `==` / `!=`: if both sides are numbers, compare numerically (`5.0 == 5` is
  true); otherwise compare as strings.
- `>` `>=` `<` `<=`: REQUIRE both sides to be numbers. If either side is not a
  number: eval error `not a number: '<value>'` (the first non-numeric side,
  left before right).
- `not` negates; `and`/`or` short-circuit (but either side being an eval
  error still errors when evaluated).

## Error contract (byte-exact — the tests assert every byte)

Exit codes: `0` success, `1` eval error, `2` parse error or usage error.
All errors go to stderr with a trailing newline. Nothing goes to stdout on any
error. NOTE the format — this project's error convention is a single line
with the tool name prefix:

```
csvrow: error: <DETAIL> at col <C>     (parse errors)
csvrow: error: <DETAIL>                (eval errors)
```

Parse DETAILs (col = 1-based position of the offending character, or
one-past-the-end when the query ended too soon):

- `expected a comparison at col <C>` — bare operand at the top level
  (`<C>` = where the operand starts)
- `invalid column number` — `$` not followed by a positive int
- `unterminated string` — a `"` string not closed on the same line
- `invalid escape` — a `\` in a string not followed by one of `\ " n t`
- `unknown token` — anything the tokenizer cannot classify (e.g. `#`, `?`)
- `unexpected token after comparison` — `$1 == "a" == "b"` (the col is where
  the third operand starts)
- `expected an operand` — an operator or keyword appears where an operand
  should start (e.g. `and $1 == 1` at col 1, `$1 == and 2` at the `and`,
  `not and` at the second keyword)
- `expected an operator` — after a complete expression, junk that is not
  `and`/`or`/end (e.g. `$1 == 1 #` — col of the `#`)
- `expected ')'` — an opened `(` whose group is never closed (col: the
  offending char, or one-past at end)

Eval DETAILs (no column in eval errors):

- `column <n> out of range (row has <k> columns)`
- `not a number: '<value>'` — a `<`/`>`/`<=`/`>=` comparison where `<value>`
  is the first non-numeric operand (left side first). The value is printed
  verbatim (empty prints as empty).

## Architecture (required)

- `src/tokenizer.js` — `{type, value, col}` tokens with 1-based cols.
- `src/parser.js` — an AST with precedence as defined.
- `src/evaluator.js` — evaluates per row.
- `src/cli.js` — thin: argv, file read, CSV parse, wiring, output/exit.
- No `eval`/`Function`/dynamic require. Runs on plain Node ≥ 18 via
  `node src/cli.js ...` from the repo root.

## Working rules

- Tests land beside your sources as `*.test.mjs` (already present, READ-ONLY —
  run them, never edit them). They are restored pristine for scoring; your
  job is to make them green.
- Run tests with `node <testfile>`; iterate until green, then stop.
- When every test passes — or you cannot improve further — reply `DONE`.
