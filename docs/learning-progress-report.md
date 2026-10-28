# The learning progress report — baseline, midpoint, final

> The mission's third deliverable: the measurable trajectory. Three
> drained snapshots of the engine's full learning state plus the session
> ledger, every figure from a committed receipt. The honest shape: strong
> growth in every learning lane, one found-and-fixed defect class in the
> memory lane, and the loop's defenses observed firing.

Related: [the learning system validation report](learning-system-validation-report.md) ·
[the snapshot receipts](../benchmarks/validation-round/snapshots/) ·
[the UX ledger](../benchmarks/validation-round/ux-ledger.md)

## The trajectory

| Metric | Baseline (20:21) | Midpoint (21:07) | Final (21:23) | Δ |
|---|---|---|---|---|
| Benchmark tasks | 6 (6 passing) | 6 (6 passing) | 6 (6 passing) | suite saturated, held |
| Harness cycles | 3 | 6 | 7 | +4, all `already-passing` |
| Dreams | 2 | 10 | 12 | +10 |
| Runs | 9 (9/9 passed) | 25 (23/25) | 29 (27/29) | +20 runs; both failures are defenses firing |
| Notes | 9 | 30 | 34 | +25 (5 real session notes + engine run notes) |
| Engine project tier | v3 | v9 | v10 | +7 versions |
| Platform memories (project scope) | 0 | 66 → purged → rebuilt | 67 | the import + recovery arc |
| Tracked memory | v12 / 79 bullets | v3 / 72 | v4 / 73 | carried → re-rendered → recovered |
| Tokens in / out (engine runs) | 21,405 / 4,176 | 126,977 / 20,053 | 145,125 / 22,337 | the autonomous loop's spend |
| Improvements shipped | 0 | 0 | 0 | honest: no failing task to mine |
| Staged skills | 0 | 0 | 0 | honest null (see the validation report) |

All three snapshots are drained (no live cycles or running dreams at
capture) and carry `drained: true`.

## What moved, and why

**Cycles (3 → 7).** The router's 10-minute harness-cycle job ran the
remaining seed tasks (all `already-passing` — the no-junk-mining contract)
plus the canary re-runs the dreams triggered. No improvement could be
mined because nothing fails: the honest cold-start state for a model that
passes the seed suite.

**Dreams (2 → 12) and the project tier (v3 → v10).** Every consolidation
is a row with its entries added/merged/pruned; the two operator-triggered
dreams (the corrective note, the poison test) plus the scheduled ones
cover both lanes. The v6 `rollback` row is the canary gate catching a
claim mismatch and reverting autonomously — regression prevention,
receipted.

**Runs (9 → 29, 27/29 passed).** The two failures: the canary's
claim-mismatch catch (a defense) and the mint self-check crash (a gate).
No run failed for a memory regression.

**Notes (9 → 34).** Five real session notes (V1–V4 + V2b), one corrective
note, one crafted poison-test note, the rest the engine's own run notes
from cycles and canaries.

**The tracked memory (v12/79 → v3/72 → v4/73).** The dip is the F2
failure story (the recency reconcile pruning ground truth), and the
recovery (v4/73) is the corrective arc — the restored scrypt fact pinned
three-deep. The bullet-count delta nets to −6: 13 pruned by the
upstream/first reconcile passes, the poison replaced, the restoration
added back.

## The session ledger (the UX axis)

| Session | Turns | Tokens in/out | Wall | Outcome |
|---|---|---|---|---|
| V1 (recall/decision) | 2 | 8,850 / 232 | 5 s | correct decision, cited |
| V2 (recall/fact) | 1 | 227 / 119 | 2 s | partial — Q1 wrong (F1) |
| V2b (recall/fact, post-fix) | 1 | 4,925 / 166 | 3 s | correct, cited, poison negated |
| V3 (cold build) | 30 (capped) | 42,104 / 5,995 | 89 s | partial — core done, capped mid-DOX |
| V4 (warm repeat) | 9 | 21,418 / 2,020 | 27 s | complete, verified working |

The V3→V4 deltas — the round's repeat-task improvement receipt: **−70%
turns, −70% wall time, −66% output tokens** for the same-shape task with
the learning dreamed in between.

## The failure→fix→re-measure ledger

| Defect | Found | Fixed | Re-measured |
|---|---|---|---|
| F1 recall drift | V2 (bcrypt confabulated over a correct memory) | the guide's anti-drift contract | V2b — correct + cited |
| F2 extraction poisoning | the poisoned platform memory + the erased ground truth | the extraction trust clause + the recovery | live poison test — zero extracted; probe 0/6→6/6 |
| F3 mint caps blindness | the discarded mint receipt | caps stated in the authoring prompt | post-fix mint passed the caps |
| F3b mint shape flakiness | the second discarded mint receipt | one bounded repair pass | the mint travels the full validation depth |

Each fix is retained by deterministic pins in the engine's test suite
(4,885 pass / 0 fail post-change; the full suite ran green in the fix
commit).

## The cost axis

The engine's autonomous learning spend across the round: 145,125 tokens
in / 22,337 out over 29 runs (the snapshots' `runStats`) — the metered
free-tier upstream, serialized by the bridge. The measurement lane itself
is free (zero LLM calls in the snapshot driver; the probe's recall is a
lexical surface). The five real sessions cost 77,524 in / 8,532 out —
the operator-visible axis the UX report carries.
