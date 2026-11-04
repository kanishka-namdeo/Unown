In this directory, author a pure TypeScript module src/csvrow.ts exporting exactly two functions:
1. csvEscape(value: string): string — quotes the value iff it contains a comma, quote, newline or leading/
   trailing space; doubles embedded quotes when quoting.
2. csvSplitLine(line: string): string[] — splits one CSV record honoring quoted commas and doubled quotes;
   throws SyntaxError on an unterminated quoted field.
Also author tests/csvrow.test.ts using bun:test with at least 8 cases covering: plain field, comma inside
quotes, doubled quotes, leading-space quoting decision, round-trip, unterminated quote (throw), empty
line, single field.
No external dependencies, no imports besides bun:test.
Finish by running `bun test` in this directory and making it pass.