# Plan: Add `subtract` function to `src/calc.ts` with unit tests in `test/calc.test.ts`

## Context

The project is a TypeScript ESM library (`package.json` type: module, test runner: bun). `src/calc.ts` currently exports only `add(a, b)`. The goal is to extend it with a `subtract(a, b)` function following the same signature style, and add focused unit tests in `test/calc.test.ts` using Bun's built-in `test`/`expect` API.

## Capability audit

- tiered-memory — SKIPPED: no existing entries; nothing to reuse
- existing-skills — SKIPPED: no repo-level skill files found under `.unown/skills/`
- workflows — SKIPPED: no workflow definitions in the repo
- standing-orders — SKIPPED: no standing-orders file present
- routines — SKIPPED: no routines configured for this project
- repo-map — SKIPPED: repo is minimal (single source file, no docs/repo-map)
- project-context — SKIPPED: no AGENTS.md, README, or docs found
- prior-learnings — SKIPPED: no prior session notes relevant to this task
- benchmarks — SKIPPED: no benchmark suite exists; not warranted for a single function
- agent-patterns — SKIPPED: no custom agent patterns defined
- subagent-delegation — SKIPPED: task is small, self-contained, single-file; no isolation needed

## Approach

**Design:** Mirror the existing `add` function exactly in style and signature:
```ts
export function subtract(a: number, b: number): number {
  return a - b;
}
```

**Tests:** Create `test/calc.test.ts` using Bun's native test API:
- Test basic subtraction (positive result)
- Test subtraction producing a negative result
- Test with zero
- Test with floating-point values

Run with: `bun test`

This is a minimal, idiomatic extension requiring no architectural review.

## Specialist review

### product-strategist — SKIPPED: task is a single-function addition with no scope ambiguity; requirements fully specified
### solution-architect — SKIPPED: no design tradeoffs; signature mirrors existing `add`
### delivery-manager — SKIPPED: two files, no sequencing dependencies
### qa-architect — SKIPPED: test cases are straightforward; no unusual failure modes
### devils-advocate — SKIPPED: no hidden assumptions or blind spots in a one-line function

## Synthesis

- consensus: all specialists would agree on the minimal mirror design
- conflicts: none
- missing: no missing considerations surfaced
- confidence: 95

## Steps

1. Open `src/calc.ts` and add `export function subtract(a: number, b: number): number { return a - b; }` after the existing `add` function.
2. Create `test/calc.test.ts` with imports and test cases covering: basic positive result, negative result, zero operand, and floating-point behavior.
3. Run `bun test` to confirm all tests pass.

## Risks

- **Type mismatch on float edge cases** — Mitigation: include a float test (e.g. `subtract(0.3, 0.1)` ≈ 0.2) and document expected tolerance if needed.
- **Test file path not recognized by bun** — Mitigation: Bun discovers `*.test.ts` anywhere in the project; verify with `bun test` output.

## Learning plan

- memory: after this run, record that the project uses `bun test` and the test file convention is `*.test.ts` in a `test/` directory.
- benchmark: not applicable at this scale.

## Verification

```
bun test
```

All tests in `test/calc.test.ts` must pass.
