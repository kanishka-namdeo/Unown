# The learning system validation report — the cold-start programme

> The mission's first deliverable: did Unown's five learning mechanisms —
> tiered memory, the self-improving harness, task minting, AutoDream, and
> skill generation — demonstrably work on a from-zero install? This report
> answers with receipts gathered while the systems ran live against a
> real-world project (this repository), including the failures the round
> found, fixed, and pinned. Every claim cites its receipt; nulls are kept
> as findings.

- [The setup](#the-setup)
- [The five mechanisms, validated](#the-five-mechanisms-validated)
- [Memory growth](#memory-growth)
- [Knowledge consolidation](#knowledge-consolidation)
- [Benchmark expansion](#benchmark-expansion)
- [Skills generated](#skills-generated)
- [Learning artefacts created](#learning-artefacts-created)
- [Improvements retained](#improvements-retained)
- [What was NOT validated](#what-was-not-validated)

Related: [the memory effectiveness report](memory-effectiveness-report.md) ·
[the learning progress report](learning-progress-report.md) ·
[the end-user experience report](end-user-experience-report.md) ·
[the failure ledger](../benchmarks/validation-round/validation-log.md) ·
[the session record](validation-round-session.md) ·
[the warm-install learning report](unown-learning-report.md) (the prior
validation this round complements)

## The setup

A fresh clone of the Unown repository (the controlled environment — a real
developer tool with 39 prior release rounds, repeated workflows, and
accumulated pitfalls), a fresh engine database, and the tracked
`.unown/memory/project.md` (v12, 79 rendered bullets) as the only
carried-over learning. The engine booted with zero operator input beyond
`bun run agent:start`; the measurement lane — a snapshot driver, a
retrieval-probe runner, and a per-session UX ledger — is itself committed
artefact ([the lane's README](../benchmarks/validation-round/README.md)).
Three snapshots (baseline / midpoint / final) and five real headless agent
sessions (V1–V4 plus the V2b re-probe) provide the numbers.

## The five mechanisms, validated

| # | Mechanism | Verdict | The receipt that proves it |
|---|---|---|---|
| 1 | Tiered memory | **Validated, with one found-and-fixed defect** — memory carried real knowledge across installs and shaped later sessions; recall drift (F1) was found, fixed, and re-measured | V1's 2-turn verbatim recall; V2→V2b before/after; the probe's 0/6→6/6 recovery |
| 2 | Self-improving harness | **Validated (discipline) + regression prevention validated live** — the no-junk-mining contract held on every cycle, and the canary gate caught and rolled back a bad memory autonomously | 7 cycles all `already-passing`; dream `bc0af2fc` gated + rolled back on a claim mismatch |
| 3 | Task minting | **Validated with honest receipts** — the multi-layer validation gates worked at every seam; the caps blindness (F3) and shape flakiness (F3b) were found and fixed; no task survived the full gate this round | the three mint receipts (caps-discard → shape-discard → self-check-discard, each deeper) |
| 4 | AutoDream | **Validated** — 12 dreams consolidated 34 notes; the swap-boundary legacy import carried a previous install's learning into a fresh platform; the canary rollback protected it | snapshots (dreams 2→12); the legacy import + the v1 project dream; `bc0af2fc` |
| 5 | Skill generation | **Not exercised this round (honest null)** — no staged skill was minted: the round's notes distilled into memory facts, not recurring procedures | the final snapshot's `skills: 0` |

## Memory growth

- **Engine-side:** the engine's project tier grew v1 → v10 across 12
  dreams (snapshots: v3 at baseline, v9 at midpoint, v10 at final) — every
  version a consolidation with entries added/merged/pruned receipted in
  the `dreams` rows.
- **Terminal-side:** the tracked `.unown/memory/project.md` moved v12
  (79 bullets, carried over) → v3 (72 bullets, the first re-render after
  the swap-boundary import) → v4 (73 bullets, the recovered render with
  the restored ground truth). The dip is the F2 story — see below.
- **Cross-scope recall surface:** the platform store went 0 → 66 project
  memories (the legacy import + note extraction), then was surgically
  purged to 0 and rebuilt clean at 67 during the F2 recovery — the
  retrieval probe receipts the arc: **0/6 hit@5 → 6/6 hit@5**
  ([smoke](../benchmarks/validation-round/probes/smoke.json) →
  [recovered](../benchmarks/validation-round/probes/recovered.json)).

## Knowledge consolidation

The round's consolidation receipts (dreams table, cited in full in the
[progress report](learning-progress-report.md)):

- 12 dreams consumed 34 notes (terminal + benchmark lanes);
- the swap-boundary legacy import (79 bullets → the platform) preserved a
  previous install's accumulated learning through a cold start — the
  architecture's continuity contract, proven live;
- the corrective-note lane worked as designed: one operator note carrying
  a source-verified fact repaired the eroded ground truth in a single
  dream cycle;
- consolidation quality found its limit too: the recency-first reconcile
  pruned a correct legacy entry in favor of a newer wrong one (F2's
  amplifier) — the anti-poison extraction clause now blocks the entry
  path, and the Manual-notes lane pins the restored fact against
  re-erosion.

## Benchmark expansion

- The **suite stayed at 6/6 passing** (saturated) — the honest state for a
  model that passes every seed task. The expansion path was exercised at
  every layer: the curriculum mint ran, its caps blindness (F3) and shape
  flakiness (F3b) were found and fixed, and the post-fix mints now travel
  the full validation depth (caps → shape → self-check) — this round's
  mints were discarded at the self-check layer (authored test files that
  crash), which is the gate working, not the lane broken.
- The **validation programme itself minted benchmarks**: the V2 drift
  probe (pinned in `test/memory-drift.test.ts`), the live poison test
  (a wrong-ports note through the real pipeline), and the mint-caps
  prompt pins — three new regression cases that did not exist before the
  round.
- **Zero duplicate mistakes**: the F1 class (recall drift) re-measured
  clean post-fix (V2b); the F2 class (extraction poisoning) re-measured
  clean (the poisoned-ports search returned zero).

## Skills generated

**None this round — an honest null.** The round's session notes distilled
into memory facts (the probe-lane knowledge, the recovery procedure), not
multi-step recurring procedures; the skill minter (which fires only after
a successful project dream with a distillable procedure) correctly stayed
silent. The warm-install report carries the positive case
(`test-cadence-domain`, minted → verified → promoted); the cold-start
case needs a longer horizon than one round — recorded as the programme's
next-step, not a defect.

## Learning artefacts created

- 5 committed session envelopes (`sessions/v{1,2,2b,3,4}-envelope.json`)
- 3 snapshot receipts (baseline / midpoint / final) + 3 probe receipts
  (smoke / post-dream / recovered)
- 11 + 7 + 2 deterministic regression pins (memory-drift, mint-caps, the
  two updated mint-cascade contracts) + 1 budget recalibration
- The failure ledger: F1, F2, F3, F3b — each with root cause, fix, pin,
  and re-run evidence
- The UX ledger: 5 session rows with turns/tokens/wall-time/outcome
- The restored memory: the scrypt ground truth pinned three-deep
  (platform + Facts + Manual-notes lane)
- 8 new project memories (v3→v4 render delta) including the corrective
  extraction and the probe-lane knowledge

## Improvements retained

Three shipped improvements, each retained by a pin and re-measured:

1. **The recall-discipline clause** (F1) — in the memory guide, injected
   every session on both paths; retained by 11 deterministic pins;
   re-measured by V2b (correct + cited).
2. **The extraction-trust clause** (F2) — in
   `MEM0_CUSTOM_INSTRUCTIONS`, active on every dream; retained by 4 pins;
   re-measured by the live poison test (zero extracted).
3. **The mint caps + bounded repair** (F3/F3b) — in `MINT_SYSTEM` +
   `authorDraft`, active on every mint; retained by 7 pins + 2 updated
   contracts; re-measured by the post-fix mint receipts (full-depth
   validation).

Retention across future executions is structural: the clauses live in
prompts the engine loads at boot, and the pins live in the test suite CI
runs on every push.

## What was NOT validated

- **Skill generation** (see above — no procedure recurred this round).
- **A full mine→patch→ship cycle** — the loop's deepest path never fired
  because the model passes every seed task (the honest cold-start state;
  the warm-install report carries the shipped-patch receipt). The mine
  path's *inputs* were validated instead: the no-junk-mining contract and
  the canary rollback.
- **Long-horizon retention** (weeks/months) — a one-session round cannot
  measure it; the tracked memory's own history (v12 carried across
  installs) is the standing evidence.
- **Per-skill evaluation** and **recall-time citations beyond the guide's
  prompt contract** — the round's competitor research records both as the
  field's next frontier and this repo's next work.
