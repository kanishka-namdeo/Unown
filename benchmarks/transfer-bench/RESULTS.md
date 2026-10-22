# transfer-bench — results (agnes-3.0-flash, 2026-10-22)

The first measurements of the question the other suites cannot ask: does memory
learned on complex task A help related-but-different complex task B?

## Setup

- induce: 3 COLD sessions on task A (`exprq`, 54 hidden cases) — 54/54 (307 s),
  53/54 (cap timeout), 54/54 (206 s). Notes: 12 terminal notes filed through the
  production `note` tool.
- dream: the production project dream consolidated them (guard: ship) into
  `results/a-dream-memory.md` — a mix of workflow discipline ("read the test
  suite's exact expected strings before writing any error handler", "derive
  every error-detail string directly from the spec") and exprq-bound detail
  (column formulas, tokenizer grammar specifics).
- hoist: the new production cross-project pass (`src/hoist.ts`, opt-in
  `PI_USER_TIER_HOIST=1`) abstracted exactly 3 project-independent rules from
  that memory — zero specificity leakage (receipt: `results/a-hoist-receipt.json`).

## Round 1 — 300 s cap (n=3 per arm)

| Arm | mean case-pass | per-session | tokens (mean in) |
|---|---|---|---|
| cold | **0.939** | 40, 41, 43 | 60k |
| warm (verbatim A memory → user tier) | 0.591 | 35, 43, 0 | 55k |
| notes (A's raw notes as context file) | 0.606 | 38, 0, 42 | 40k |
| hoist (abstracted rules → user tier) | 0.508 | 21, 41, 5 | 45k |

Deltas vs cold: warm −0.348 · notes −0.333 · hoist −0.431. warm ≈ notes (−0.015):
consolidation added no measurable transfer value over raw context at this n.

## The honest reading (why this is NOT "memory hurts")

Every arm produced at least one 41–43/44 session — the CEILINGS overlap. The
arm means are driven by COLLAPSES (0, 5, 21/44), and the collapses are
**latency-driven, not memory-driven**: the collapsed sessions show 35–57
session events where converged sessions show 72–84 (agnes-3.0-flash has a
measured 1-in-~10 slow band, noted in quality-axes RESULTS too; at a 300 s cap
one slow band beheads a session). The cold arm's tightness (40–43) vs the
carried arms' spread is real but n=3 cannot attribute it to content rather
than chance latency distribution.

What IS attributable: the warm arm's carried memory contains project-bound
rules, and one warm session's failures form a systematic column-convention
transplant pattern (the interference signature) — though cold sessions err on
column exactness too. Naive carry is at best neutral, and the hoist pass
exists precisely so no project-bound rule ever reaches another project.

## Round 2 — 420 s cap (n=3 per arm, the induce-conditions cap)

Records: `results/agnes-3.0-flash.round300s.jsonl` (round 1) and the live
`results/agnes-3.0-flash.jsonl` (round 2); summaries in `results/summary.round300s.json`
and `results/summary.json`.

(See the round-2 table in `results/summary.json` after the run; this file is
updated at the end of the campaign.)

## What this benchmark established (regardless of transfer sign)

1. The machinery to ASK the question now exists: induce → production dream →
   hoist → arms, all against the real engine, real guard, real injection path.
2. **Naive verbatim carry (the "just copy project.md to user.md" idea) measured
   NEGATIVE-LEaning and variance-increasing** — enough to reject it as a
   production mechanism; the architecture's per-project scoping of the project
   tier is empirically defensible.
3. **The abstracting hoist is safe but unproven-beneficial at n=3** — it never
   leaks specifics (10 unit tests + live receipt), costs one extra LLM call
   per project dream, and at this sample size its arm did not separate from
   cold. It ships opt-in (`PI_USER_TIER_HOIST=1`), NOT default-on — the
   default stays hand-edited, exactly as the memory docs promise.
4. Latency variance from the upstream (the slow band) is the dominant
   confounder for time-capped agentic benchmarks on this provider — future
   rounds should raise n and/or use wall-clock-free scoring (cases-until-green
   rather than green-at-cap).
