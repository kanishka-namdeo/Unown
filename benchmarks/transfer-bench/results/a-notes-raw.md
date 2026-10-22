--- note (2026-10-21T23:05:54.866Z) ---
In byte-exact CLI error formats (like exprq's "parse error: line 1, col N: detail"), column 1 is the query's FIRST character, not 0. "End of query" offenses get col = len(query) + 1 (one past the last char), EXCEPT the two pinned cases: "query is empty" is always col 1, and "unknown function 'name'" is pinned to the FIRST character of the name (not where the error is detected). If a spec lists pinned-column exceptions, honor them literally — tests assert every byte.

--- note (2026-10-21T23:05:56.649Z) ---
When a spec mandates multiple modules (tokenizer/parser/evaluator/cli), implement the module boundaries faithfully even if a single monolithic implementation would be simpler — tests check the pipeline wiring, not just the final output.

--- note (2026-10-21T23:06:00.184Z) ---
For byte-exact CLI tools: read the test suite's exact expected stderr strings before writing any error handler; a single missing space or wrong exit code fails the whole case. Print errors with process.stderr.write + explicit \n, and route usage/parse errors to exit 2 vs eval errors to exit 1 as the spec dictates.

--- note (2026-10-21T23:06:02.388Z) ---
When implementing a tokenizer/parser split for a CLI that must emit byte-exact column errors, let the tokenizer carry 1-based columns on every token (including EOF with col=len+1) and let the parser raise all errors from token columns. Group runs of digits (and optional leading '-') into a single INT token at the tokenizer level, not the parser — otherwise "expected integer in brackets" / "expected ']' after index" columns are fragile. This is the single-source-of-truth pattern: one place owns column math, so errors cannot drift.

--- note (2026-10-21T23:06:06.275Z) ---
In the transfer-bench repoA task, `node exprq.test.mjs` from the repo root is the ground truth — it spawns `src/cli.js` as a subprocess and compares exit code + stdout + stderr byte-for-byte against expected values. The test file is READ-ONLY and gets restored pristine before scoring; never edit it. The working loop is: implement, run the test, read the "want vs got" diff the harness prints, fix the offending byte, repeat. When the harness prints "54 passed, 0 failed" and exit 0, the task is complete.

--- note (2026-10-21T23:06:06.439Z) ---
When a spec pins error columns ("one-past-the-end" vs. actual offending char, with a few explicit exceptions like col 1 for empty queries), verify each pinned column against the test suite before finalizing the parser — the general rule and the exceptions coexist and must not be conflated.

--- note (2026-10-21T23:06:10.152Z) ---
Terminal session in /home/z/my-project/scratch-mem/transfer-bench/repoA (5 min): 2 prompt(s), 41 tool call(s) (read, bash, write, edit, note).
Final outcome: All 54 tests pass with exit 0. The implementation is complete:
- `src/tokenizer.js` — emits `{type, value, col}` tokens with 1-based cols and an EOF token at col `len+1`.
- `src/parser.js` — builds a flat step list (field/index/call) from the token stream, raising `ParseError` with byte-exact detail + col (including the two pinned-column cases).
- `src/evaluator.js` — walks the step list left-to-r
If the session hit failures or discovered project-specific pitfalls, record them as concise imperative rules; otherwise record any durable project conventions worth remembering.

--- note (2026-10-21T23:06:13.694Z) ---
After a full implementation passes the visible test suite, manually exercise a batch of untested edge cases (negative indexes, out-of-bounds, optional field on non-object, junk after call, unknown functions, spaces around pipes, empty/spaces-only queries) before declaring done — the spec's edge cases are broader than the test suite.

--- note (2026-10-21T23:16:22.716Z) ---
For byte-exact CLI specs (jq-style error strings with 1-based cols), derive every error-detail string and column formula directly from the spec's error list — including the "one-past-the-end" sentinel col (len+1) and any pinned exceptions — then diff actual vs expected output byte-for-byte with a test harness that spawns the real CLI, not just an in-process import.

--- note (2026-10-21T23:16:29.938Z) ---
When a spec allows whitespace only in a restricted position (e.g. padding around a pipe), that space is still a parse-error target elsewhere: "trailing space with no pipe" fails at the space's own column. The parser's "done" check must distinguish "EOF reached directly" from "EOF reached after skipping spaces" — the latter is an error at the first space's col, not a clean break.

--- note (2026-10-21T23:16:33.199Z) ---
For small tokenizer/parser pairs, let the tokenizer emit one generic token kind (e.g. 'ident') and let the parser decide its role by context (field name after '.' vs bare call at segment start). Disambiguating in the tokenizer from the next character is fragile: a char like '.' is legal both after an identifier (a field chain) and as the start of a segment, so it cannot decide the token's meaning.

--- note (2026-10-21T23:16:37.952Z) ---
Terminal session in /home/z/my-project/scratch-mem/transfer-bench/repoA (3 min): 2 prompt(s), 47 tool call(s) (read, bash, edit, note).
Final outcome: All 54 tests pass on the read-only ground-truth suite and the scratch harness.

Summary of the session:
- The repo already had a previous-session implementation; it failed 1 test (case 51: `".a "` trailing space — a space after a completed segment is a parse error at that space's column, but the parser treated EOF-after-space as clean end).
- Fixed the parser's segment-completion check: only break
If the session hit failures or discovered project-specific pitfalls, record them as concise imperative rules; otherwise record any durable project conventions worth remembering.