# PT-4 — the capability-audit plan (Plan Mode V3)

Prompt (fixed, verbatim):

```
Plan adding a subtract function to src/calc.ts with unit tests in test/calc.test.ts. Follow the V3 plan structure exactly.
```

Run contract: `unown --plan --max-turns <cap> -p "<prompt>"` in a scratch repo (one
`add()` function in `src/calc.ts`, `bun test` runner, no AGENTS.md, no memory, no
skills — the deliberately capability-empty control), agnes-3.0-flash via the bridge
(:3031), fresh session. Scored with the product's own `scorePlanDocV3`.

What this task measures (the V3 dimensions the V2 rubric cannot see):

- **Capability audit**: eleven rows with USED/SKIPPED decisions and reasons — in the
  empty-repo control the honest outcome is all-SKIPPED-with-reasons (the rubric's
  USED-row sub-check is expected to lose its 2 points: the flag itself is the receipt
  that the scorer does not hand out credit for an audit that reuses nothing).
- **Specialist review**: justified skips for a trivial task (`### <name> — SKIPPED: <why>`)
  — consulting five specialists on a one-function plan is the over-consultation
  failure mode the phase rules exist to prevent.
- **Synthesis + learning plan**: the consensus/conflicts/missing/confidence block and
  at least one landing-lane-tagged learning candidate.

The paired interactive lane (PT-4i): the same objective through the full loop —
`/plan` → approval → execution → `plan_retrospective` — proving the close-out
(the merged `## Retrospective` section, the failure classification contract, and the
`plan retrospective` engine note) against a real TTY.
