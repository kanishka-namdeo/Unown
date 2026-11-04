In this directory, author a pure TypeScript module src/durfmt.ts exporting exactly two functions:
1. formatDuration(ms: number): string — humanizes milliseconds as e.g. '1h 2m 3s 500ms', omitting any
   zero leading units but always keeping at least the smallest non-zero unit; negative input throws
   RangeError; ms values under 1000 render as '<n>ms'.
2. parseDuration(s: string): number — inverse accepting the same unit vocabulary (h, m, s, ms).
Also author tests/durfmt.test.ts using bun:test with at least 8 cases covering: sub-second, minute-only,
mixed units, zero, negative (throw), round-trip, unit omission, whitespace tolerance in parse.
No external dependencies, no imports besides bun:test.
Finish by running `bun test` in this directory and making it pass.