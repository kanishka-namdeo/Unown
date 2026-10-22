# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated here by AutoDream.
- After full test suite passes, manually exercise untested edge cases (negative indexes, out-of-bounds, optional field on non-object, junk after call, unknown functions, spaces around pipes, empty/spaces-only queries) before declaring done [note 5].

## Conventions
- Implement module boundaries (tokenizer/parser/evaluator/cli) faithfully even if a monolithic approach is simpler; tests verify pipeline wiring, not just final output [note 11].
- For byte-exact CLI specs, derive every error-detail string and column formula directly from the spec, then diff actual vs expected output byte-for-byte using a harness that spawns the real CLI [note 4].
- Read the test suite's exact expected stderr strings before writing any error handler; a single missing space or wrong exit code fails the case [note 10].
- Print errors with process.stderr.write + explicit \n; route usage/parse errors to exit 2 vs eval errors to exit 1 as dictated by spec [note 10].

## Known pitfalls
- When a spec pins error columns (one-past-the-end vs actual char), verify each pinned column against the test suite; general rule and exceptions coexist and must not be conflated [note 7].
- Column 1 is the query's first character; "end of query" offenses get col = len(query) + 1, EXCEPT pinned cases: "query is empty" is always col 1, and "unknown function 'name'" is pinned to the first character of the name [note 12].
- When a spec allows whitespace only in a restricted position (e.g. padding around a pipe), that space is still a parse-error target elsewhere; distinguish "EOF reached directly" from "EOF reached after skipping spaces" — the latter is an error at the first space's col [note 3].
- Disambiguating token role in the tokenizer from the next character is fragile (e.g. '.' is legal after an identifier and as segment start); let the tokenizer emit one generic token kind and let the parser decide its role by context [note 2].
- Group runs of digits (and optional leading '-') into a single INT token at the tokenizer level, not the parser, to keep "expected integer in brackets" / "expected ']' after index" columns stable [note 9].
- The parser's segment-completion check must distinguish clean EOF from EOF-after-space; a space after a completed segment without a trailing pipe is a parse error at that space's column [note 1].

## Task playbooks
- For small tokenizer/parser pairs, let the tokenizer carry 1-based columns on every token (including EOF with col=len+1) and let the parser raise all errors from token columns; this single-source-of-truth pattern prevents column math drift [note 9].
- All 54 tests pass on the read-only ground-truth suite and the scratch harness when implementation is complete [note 1].
