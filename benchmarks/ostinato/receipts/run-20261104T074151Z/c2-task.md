In this directory, author a pure TypeScript module src/urlkit.ts exporting exactly two functions:
1. joinQuery(base: string, params: Record<string, string | number | boolean>): string — returns base with
   the params appended as a query string; keys sorted alphabetically; values URL-encoded; a param whose
   value is false is omitted entirely; '?' is added only when there are params; an existing query string
   in base is preserved and extended with '&'.
2. parseQuery(url: string): Record<string, string> — inverse of joinQuery for string values only.
Also author tests/urlkit.test.ts using bun:test with at least 8 cases covering: empty params, false-values
omitted, key sorting, URL encoding of spaces and ampersands, existing query extension, parse round-trip,
numeric and boolean serialization. No external dependencies, no imports besides bun:test.
Finish by running `bun test` in this directory and making it pass.