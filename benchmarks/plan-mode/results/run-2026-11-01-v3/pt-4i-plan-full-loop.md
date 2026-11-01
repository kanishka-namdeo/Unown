# Plan: Add `multiply` to src/calc.ts with bun-test unit tests in test/calc.test.ts

## Context
`calc-lab` is a minimal ESM TypeScript project with `add` in `src/calc.ts` (4 lines: one exported function, 4-space indent, no imports). `package.json` defines `test: bun test`. There is no `test/` directory yet. Task: add a `multiply` function plus unit tests matching the existing style.

## Capability audit
- tiered-memory — USED: skimmed `.unown/memory/project.md`; empty conventions/pitfalls, nothing contradicts (relevance: low; benefit: confirmed no recorded style rules; confidence: 90)
- existing-skills — SKIPPED: task is a trivial 2-file addition; repo-exploration / methodical-debugging / verification-first flows add no leverage (relevance: low; confidence: 90)
- workflows — SKIPPED: no workflows defined in `.unown/` (confidence: 95)
- standing-orders — SKIPPED: none present (confidence: 95)
- routines — SKIPPED: nothing scheduled needed; `routine_list` unnecessary for a one-shot task (confidence: 95)
- repo-map — USED: `src/calc.ts` (add), `package.json` (test script = `bun test`), no existing test files, no vitest/jest config (relevance: high; benefit: chose bun test; confidence: 95)
- project-context — SKIPPED: no AGENTS.md/README exist in this repo (confidence: 95)
- prior-learnings — SKIPPED: project memory has no relevant learnings yet (confidence: 90)
- benchmarks — SKIPPED: nothing to measure at this scale (confidence: 95)
- agent-patterns — SKIPPED: no `.unown/agents/*.md` custom agents to consult (confidence: 95)
- subagent-delegation — SKIPPED: ~15 lines of work; spawning specialists is disproportionate (confidence: 95)

## Approach
- Mirror `add` exactly: `export function multiply(a: number, b: number): number { return a * b; }` (4-space indent, same signature shape).
- Tests with `bun:test` (`describe`/`it`/`expect`), one file `test/calc.test.ts`. Style has no prior tests to match, so follow idiomatic bun-test + the function's style: a small `describe("multiply", ...)` block covering: product of two positives, negative × negative, zero, non-integers, and identity (× 1).
- Execution is trivial and low-risk — no dual review needed at build time; verification is the test run itself.

## Specialist review
### product-strategist — SKIPPED: trivial additive task, requirements are fully specified by the prompt (add multiply + tests, existing style); no scope ambiguity worth a consult.
### solution-architect — SKIPPED: no design decisions beyond mirroring the one existing function; architecture surface is one 4-line function.
### delivery-manager — SKIPPED: two-file, zero-dependency change; sequencing is fixed (function → tests → run) and needs no coordination.
### qa-architect — SKIPPED: failure mode is only "bun test doesn't run"; covered in Risks.
### devils-advocate — SKIPPED: no contested assumptions; style reference (`add`) is unambiguous.

## Synthesis
- consensus: reviews all skipped with recorded justification — work is below the delegation threshold.
- conflicts: none (no reviews run).
- missing: none identified; the only risk axis is tooling (`bun` availability), already covered.
- confidence: 95

## Steps
1. Append `multiply` to `src/calc.ts`, mirroring `add`'s style (files: src/calc.ts)
2. Create `test/calc.test.ts` with a `describe("multiply")` block using `bun:test` + `@bun/test`-style `expect` (files: test/calc.test.ts)
3. Run `bun test` and confirm all tests pass (files: none — verification)

## Risks
- `bun` not installed / test runner missing → mitigation: check `bun --version` in step 3; if absent, install bun (`curl -fsSL https://bun.sh/install | bash`) or fall back to an equivalent runner — flag to user rather than silently swapping.
- No existing test file means "existing style" only constrains source style; test style is a guess → mitigation: use canonical `bun:test` describe/it/expect, which is the project's declared runner convention.
- Indentation drift (repo uses 4 spaces) → mitigation: match `src/calc.ts` exactly.

## Learning plan
- memory: note the project's test convention (bun test, `bun:test` describe/it) into project memory conventions so future test additions don't re-derive it.
- benchmark: none at this scale.

## Verification
```bash
bun test            # expect: test/calc.test.ts pass, 0 fail
bun --version       # confirm runner present
```

## Retrospective

- outcome: delivered
- failure class: none
- root cause: n/a
- resolution: n/a
- prevention: n/a
- learnings:
  - memory: calc-lab test convention — bun test runner (package.json), test files at test/*.test.ts, imports use relative path with .ts extension; source uses 4-space indent. Verified against actual file contents and a passing run.
  - benchmark: none at this scale — trivial 2-file change, no scenario worth measuring.
- improvements:
  - Plan scored 100 on first write; the specialist-skip justifications kept the plan scannable without over-consultation. No change needed.
