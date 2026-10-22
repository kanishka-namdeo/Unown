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

| Arm | per-session | notes |
|---|---|---|
| cold | 18, 40, 43 | a collapse in the CONTROL arm |
| warm | 0, 8, 41 | warm:0 died at the stall watchdog (14k tokens) |
| notes | 12, 0, 41 | |
| hoist | 0, 0, 0 | hoist:1/2 died in 23–32 s at ~9.4k input tokens each (first-turn stalls — upstream outage, not memory) |

Records: `results/agnes-3.0-flash.round300s.jsonl` (round 1) and
`results/agnes-3.0-flash.jsonl` (round 2).

## The two-round verdict

1. **Upstream stall variance dominates wall-clock-capped agentic measurement
   here.** Collapses (0–18/44) appeared in EVERY arm across both rounds —
   including cold — and the collapsed sessions are identifiable by event
   counts (23–57 vs 72–84 converged) and token starvation (identical ~9.4k
   first-turn deaths late in round 2, when the upstream was in a degraded
   period). Arm means at n=3 are noise under this confounder.
2. **Among converged sessions, no arm separates.** Converged sessions sit in
   the same 35–43 band in all four arms of both rounds. At this n, this
   provider, and this task pair: carried memory — verbatim, raw notes, or
   abstracted — does not measurably help a fresh complex task the model can
   already converge on. This is now the THIRD independent "the loop only
   earns its keep when the model struggles" result in this repo's history
   (selfimprove v3's 0 pp at 6/6, testing-strategy §10 A, this suite).
3. **Naive verbatim carry-forward is rejected as a production mechanism** —
   on the specificity-interference evidence (warm-0's column-convention
   transplant pattern) and on principle (it ships project-bound rules into
   every future project). The user tier stays hand-edited by default; the
   Hoist (`PI_USER_TIER_HOIST=1`) is the opt-in, abstracted, guarded
   alternative — safe by construction (10 unit tests + zero-leakage live
   receipt), benefit unproven at this n.
4. **Methodological receipts for future rounds**: (a) score
   cases-until-green with generous budgets instead of green-at-cap —
   wall-clock caps convert upstream slow bands into fake task failures;
   (b) n ≥ 5 with stall-aware collapse exclusion (excluded WITH receipts,
   reported, never silently — the edit-bench wedge-signature precedent);
   (c) sample dream variance too (each arm's carry material is one dream's
   output); (d) a difficulty regime where the model fails cold MOST of the
   time (a harder task pair or a weaker model) is required for any positive
   transfer to be measurable at all.

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
