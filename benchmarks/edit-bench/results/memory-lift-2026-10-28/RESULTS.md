# Memory-lift campaign 2026-10-28 (agnes-3.0-flash, SOTA round)

> **Verdict up front:** no headline lift. The matched-model experiment —
> the same 106 fixtures, the same model, the same byte-exact scoring, with a
> four-rule editing-discipline block appended to the harness system prompt
> (`UNOWN_BENCH_MEMORY_LIFT=1`) — scored **103/106 (97.2%), identical to the
> canonical baseline** ([rerun-2026-10-21](../rerun-2026-10-21/RESULTS.md):
> 103/106). What the rules did move: the swap category healed one of its three
> baseline failures (23/26 → 24/26) while a **non-target** failure appeared
> (structural-remove-case-label-004 — a remove mutation, outside the swap
> discipline the rules teach), and mean task duration fell **16.8 s → 11.4 s
> (−32%)** as the read-back discipline produced early-stops. Efficiency moved;
> correctness did not — the same conclusion the self-improvement round
> published from a different axis ("memory buys efficiency, not correctness",
> [selfimprove RESULTS](../../selfimprove/results/RESULTS.md)), reproduced
> here on the edit-bench lane.

- [Method](#method)
- [The numbers](#the-numbers)
- [Failure-set deltas](#failure-set-deltas)
- [What this means for the round](#what-this-means-for-the-round)

Related pages: [SOTA round validation log](../../../benchmarks/sota-round/validation-log.md)
(the F1 entry this campaign opened) · [rerun-2026-10-21](../rerun-2026-10-21/RESULTS.md)
(the canonical agnes-3.0-flash baseline these results are matched against) ·
[edit-bench RESULTS](../RESULTS.md) (the umbrella record: omp A/B, n3 variance,
the agnes campaign).

## Method

The runner gained an env-gated lane (`UNOWN_BENCH_MEMORY_LIFT`, default off —
default runs stay omp-faithful and the landing's canonical-receipt resolver
ignores `memory-lift-*` dirs by naming convention). Enabled, it appends four
editing-discipline rules to the benchmark system prompt — the rules a memory
layer would carry after the baseline's three structural-swap failures:

1. read the exact current text of every line you will touch before editing;
2. one edit whose old text spans the complete affected region for swaps;
3. read the affected region back after every edit and verify;
4. never declare done while the file still differs.

These rules were **hand-authored from the baseline postmortems** — a
simulated memory patch, not one mined and shipped by the harness. That
distinction is the point: the experiment measures whether memory-style
prompt discipline alone lifts a measured capability gap. Model, fixtures,
scoring, retry ladder: identical to the baseline (in-process pi agent, tools
`read|edit|write`, byte-exact prettier-normalized verification).

## The numbers

| Metric | Baseline (rerun-2026-10-21) | Memory-lift (this run) | Δ |
|---|---|---|---|
| Pass rate | 103/106 (97.2%) | 103/106 (97.2%) | 0 |
| Structural-swap category | 23/26 | 24/26 | +1 (if-else-001 healed) |
| Structural-remove failures | 0 | 1 (case-label-004) | −1 (outside the rules' category) |
| Mean task duration | 16.8 s | 11.4 s | **−32%** |
| Total tokens (106 tasks) | 165,664 | 247,748 | +50% (the rules ride every call) |
| Edit calls | 123 | 117 | −5% |
| Early-stops | (not stamped in the 2026-10-21 receipts) | the dominant exit shape | — |

## Failure-set deltas

| Task | Baseline | Memory-lift | Note |
|---|---|---|---|
| structural-swap-if-else-001 | FAIL | PASS | the rules' target shape — healed |
| structural-swap-sibling-blocks-001 | FAIL | FAIL | 12-edit near-miss persists at n=1 |
| structural-swap-if-else-006 | FAIL | FAIL | the harness-mined engine task's origin; persists here |
| structural-remove-case-label-004 | PASS | FAIL | **not a swap** — a remove mutation; the rules do not address it |

Both campaigns are n=1 per task. agnes-3.0-flash run-to-run variance is
unmeasured (the n=3 receipts cover the qwen/kimi trio only — "not measured",
never a guess); a single non-target flip at n=1 is consistent with variance
around a hard-task boundary as much as with rule interference. The honest
read: **no evidence the rules lift correctness; clear evidence they change
behaviour** (duration, early-stops, one healed target).

## What this means for the round

1. **The null result is the finding.** A simulated memory patch — hand-written
   from a failure postmortem — did not close a measured capability gap on the
   model that has it. The loop's value cannot be claimed from prompt
   discipline alone; it has to be shown by the engine's own receipts: mined
   tasks, solvability-gated mints, shipped memory patches with canary
   confirmation, and regression sweeps on ship (see
   [docs/memory.md#learning-integrity](../../../docs/memory.md)).
2. **The engine task mint stands on its own evidence**: the measured
   if-else-006 failure was converted to a sandbox capability task
   (`swap-if-else-messages`, `pi-repo/packages/self-learning/src/tasks-swap.ts`)
   so the harness cycles on a real gap rather than a saturated seed suite —
   in the engine's full-tool sandbox the task passes 12/12 (the gap is
   edit-bench-toolset-specific, not a general capability hole), which is
   itself a measured result the Learning Report carries.
3. **Efficiency is real and cheap to claim**: −32% mean duration from
   verify-then-stop discipline, at +50% token overhead on a 106-task sweep.
   Automation-relevant (wall-clock), not correctness-relevant.
