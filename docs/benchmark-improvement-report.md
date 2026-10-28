# The benchmark improvement report — did the agent get better while it worked?

> The mission's benchmark deliverable: baseline → midpoint → final
> trajectories with measurable evidence, every number traceable to a
> committed receipt. Three measurement layers, honestly separated:
> **(1)** the standing benchmark inventory (the agent's measured
> capability, model-tier and harness-tier), **(2)** the round trajectories
> (the engine's learning state while building real software), and
> **(3)** the improvement receipts (the specific before/after deltas the
> loop produced). Unmeasured things print "not measured" — never a guess.

- [The measurement framework](#the-measurement-framework)
- [Layer 1 — the standing benchmark inventory](#layer-1--the-standing-benchmark-inventory)
- [Layer 2 — the round trajectories](#layer-2--the-round-trajectories)
- [Layer 3 — the improvement receipts](#layer-3--the-improvement-receipts)
- [What improved, what didn't, and how we know](#what-improved-what-didnt-and-how-we-know)

Related: [the learning report](unown-learning-report.md) (the five
mechanisms' validation) · [the competitor report](competitor-comparison-report.md)
(the benchmark-design research behind the method) ·
[benchmarks/RESULTS.md](../benchmarks/RESULTS.md) (the master inventory) ·
[the parley validation log](../benchmarks/parley-round/validation-log.md)
(the failure→fix ledger)

## The measurement framework

The framework was built **before** the builds (benchmark-first, the
mission's rule) and inherited its discipline from the competitor
research: matched-model gating (every learning claim runs the same model,
agnes-3.0-flash, before and after — the harness delta is the only thing
measured), drain-before-snapshot (a snapshot refuses to write while a
cycle or dream is in flight, so counts are completed-work counts — the
ZCode `--memory-bench` pattern), holdout discipline (the final re-run
covers the seed suite AND the minted tasks — "an improvement that only
shows on the tasks a patch was mined from is not retained learning"), and
cost columns on every figure (tokensIn/tokensOut/toolCalls — the Goose
Harbor pattern). Collection is zero-LLM, deterministic and re-runnable:
`sota-round/metrics.mjs` reads the engine DB + the receipts ledgers;
`parley-round/snapshot.mjs` reads the live engine REST API
([the driver](../benchmarks/parley-round/snapshot.mjs), schema
`parley-round/1`). Receipts are committed, never regenerated; a figure
with no receipt prints `null`.

## Layer 1 — the standing benchmark inventory

The agent's measured capability at the programme's start (full tables and
receipt links in [benchmarks/RESULTS.md](../benchmarks/RESULTS.md)):

| Track | Metric | agnes-3.0-flash | Receipt |
|---|---|---|---|
| pi-repo test suite | vendored monorepo health | 7,812 green / 0 fail | `benchmarks/RESULTS.md` (rerun 10-21) |
| Edit accuracy (106 oh-my-pi fixtures) | pass rate | **97.2%** (103/106) | `edit-bench/results/rerun-2026-10-21/` |
| Aider polyglot (50 hardest, 6 langs) | pass@1 / pass@2 | 90% / 96% | `polyglot/` |
| Self-improvement lift (repeat tasks) | tokens / duration | +197.1% in / **−25.5% time**, 0pp pass | `selfimprove/results/RESULTS.md` |
| Memory defenses (poison · mpbench · axes · recall) | flags/plants/axes/lift | 10/10 · 0 planted · 4/4 axes · +0.55 lift | `memory-eval/*/RESULTS.md` |
| Memory SOTA suite (10-26) | opsF1 · r@5 · judge · failure modes | 0.992 · 1.000 onnx · 20/20 · 12/12 | `memory-eval/ops-accuracy/` etc. |
| Long-horizon refactor | duration · tokens | 345 s · 62k in · 1.07M cache | `longhorizon/` |
| Long-run stress (11 scenarios) | allPass | **true — 11/11** | `longrun/results/run-2026-10-26T23-05-23/` |

The honest baseline caveat: agnes-3.0-flash is a free-tier flash model —
its LiveCodeBench v6 pass@1 is 28% (model-tier), while the agent-tier
numbers above (97.2% edit accuracy on the fixture bench) show what the
harness buys. The two memory-lift experiments bracket the honest claim:

- **Edit-bench memory-lift (2026-10-28):** four hand-authored
  editing-discipline rules appended to the harness prompt → pass rate
  **identical at 97.2%** (103/106) — a null result kept honestly; but
  task duration **−32%** (16.8 s → 11.4 s) at +50% tokens, and one
  target-category failure healed (`if-else-001`) while a non-target
  failure appeared (`case-label-004`). Receipt:
  `edit-bench/results/memory-lift-2026-10-28/RESULTS.md`.
- **Selfimprove v2/v3 (repeat-task efficiency):** warm memory buys
  −25.5% wall time on agnes (9/10 → 9/10 passes), 0pp pass-rate lift
  everywhere; wrong-domain memory costs ~30% input and buys nothing.
  Receipt: `selfimprove/results/RESULTS.md`.

**Conclusion of Layer 1 (the programme's standing finding): memory and
prompt discipline buy efficiency — never correctness.** Correctness gains
must come from the loop's own mechanisms (mined tasks, shipped patches,
regression sweeps), which is what Layer 3 measures.

## Layer 2 — the round trajectories

### The Parley round (the multi-tenant support-inbox SaaS — the mission's vehicle)

Engine learning state, baseline (pre-build, 2026-10-28T16:07:18) →
midpoint (post-E2E, 2026-10-28T18:46:14, drained), schema
`parley-round/1`:

| Field | Baseline | Midpoint | Δ |
|---|---|---|---|
| Suite tasks | 5 (all seed) | 6 (5 seed passing + the minted `swap-if-else-messages`) | +1 minted task in the lineage |
| Runs | 14 (14 passed) | 43 (30 passed, 13 errors) | +29 runs |
| Pass rate | 100% (saturated seed suite) | 70% (the suite grew a failing task — by design) | the honest dip of a real benchmark |
| Harness cycles | 5 (all `already-passing`) | 11 (10 `already-passing` + **1 `improved`**) | **the first closed cycle** |
| Improvements shipped | 0 | **1** | see Layer 3 |
| Dreams | 5 | 13 | +8 consolidations |
| Notes | 15 | 38 | +23 session notes delivered |
| Project memory version | v4 | **v12** | +8 re-renders (incl. the shipped patch at v11) |
| Skills | 0 | 0 | staged skills live in the SOTA lineage (below) |
| Token cost | (not recorded at baseline) | 151,472 in / 23,934 out / 201 tool calls | the cost column |

Receipts: `parley-round/snapshots/baseline-20261028-160718.json` ·
`parley-round/snapshots/midpoint-2026-10-28184614.json` (drained: true).

### The SOTA round (the Fugue AI-workflow platform — the benchmark framework's own build)

Engine learning state, baseline (2026-10-28T12:26:15Z, pre-build) →
midpoint (2026-10-28T18:11:37Z, post-P3), via `metrics.mjs`:

| Group | Field | Baseline | Midpoint | Δ |
|---|---|---|---|---|
| Learning | runs | 9 | 105 | +96 |
| Learning | suite tasks | 5 seed | 9 (6 seed + **3 minted**) | +3 minted |
| Learning | cycles | 3 | 27 | +24 (all already-passing at capture) |
| Learning | dreams | 11 | 50 (24 merged / 108 added / 112 pruned) | the consolidation engine at work |
| Learning | notes | 20 | 140 | +120 |
| Learning | memory versions | 7 | 58 | +51 |
| Learning | skills staged | 0 | **2** | +2 (the `test-cadence-domain` skill verified + promoted) |
| Learning | hook decisions | 127 | 1,733 | +1,606 (1 deny in the live engine — the guard stack firing) |
| Agent | build sessions | 0 | 19 | the Fugue build |
| Agent | tool calls / results | 0 | 568 / 558 | **tool success 99.46%** |
| Agent | human interventions | not measured | 1 | the documented mid-run cap-resume |
| SDLC | edit-bench (matched model) | 97.2% | 97.2% | unchanged — the model tier didn't move (as designed) |
| SDLC | unit tests (the app under construction) | — | 168 green | the app's own suite |

Receipts: `sota-round/results/snapshot-baseline.json` ·
`sota-round/results/snapshot-midpoint.json` · rendered by
`sota-round/results/REPORT.md`. Final snapshots for both rounds are
pending receipts (marked `not measured` until committed — the rounds are
still closing at this writing).

## Layer 3 — the improvement receipts

The specific before/after deltas the loop produced — the mission's core
evidence:

### R1 — the first shipped improvement: `swap-if-else-messages` (the parley lineage)

The complete lifecycle, receipted in
`parley-round/snapshots/midpoint-2026-10-28184614.json` (improvement
`f0db6ac3`, cycle `4c6a432e`):

- **Provenance:** the task was **minted from a measured failure** — the
  edit-bench `structural-swap-if-else-006` fixture (one of the three
  97.2%'s failures, receipt `edit-bench/results/rerun-2026-10-21/`),
  converted into an engine capability task so harness cycles hit a real
  gap (the SOTA round's F1 decision).
- **Baseline:** FAILED in the engine's full-tool sandbox (run
  `864d69da`, score_before `failed`) — the failure reproduced, not
  assumed.
- **Diagnosis (mined):** "The agent failed to recognize that escaping
  backticks and newlines within template literals inside a Python string
  resulted in incorrect replacement text. It confused the source code
  syntax with the literal bytes required by the task."
- **Patch (4 rules → project memory v11):** extract exact bytes with
  `od -c`/`repr()` before replacements; never assume standard escaping
  for backticks; inspect on 'exact text not found' errors; validate
  byte-identity with SHA-256 when the task specifies byte-exact.
- **Candidate:** PASSED (run `b07be91b`, score_after `passed`) — and the
  harness's verify-twice rule ran it twice before shipping ("iteration 1
  patch passed twice — shipped").
- **Cycle record:** `baseline failed; iteration 1 patch passed twice —
  shipped (4 rules → project v11)`, 18:20:35 → 18:32:52 UTC.
- **Retention (pending):** the final snapshot's regression sweep must
  show the task still passing with the patch live — the retention check
  the round closes with. *(This is the "improvements retained" claim's
  receipt lane.)*

### R2 — the F3 envelope fix: a measured failure became a shipped agent fix (this round's own SDLC loop)

The mission's "convert failures into benchmarks, improve the agent,
rerun" executed on Unown itself — the full chain in
[the parley validation log](../benchmarks/parley-round/validation-log.md):

- **Baseline behaviour:** two headless build sessions died with 0-byte
  result envelopes (forced exits called `process.exit()` bare) — measured
  live, receipted (receipts `…180025-x95c.jsonl`, `…181703-edd6.jsonl`,
  the bridge usage log's degenerate pair at 18:19:40/44).
- **Root cause:** two layers — an upstream empty-completion pair (the
  trigger; all three existing guard layers fired as designed) + the CLI's
  own envelope-loss defect (the fix's target).
- **Improvement:** `installPrintStallWatchdog` gained the `lastResort`
  hook; every forced exit now writes the full envelope (subtype
  `forced_exit`) via `writeSync(1, …)`; the text lanes emit the stderr
  note. Commit `b4cdbbe`, pinned by
  `pi-repo/packages/self-learning/test/print-exit-envelope.test.ts` (4
  tests: hook-before-exit ordering, fail-open boundedness, the envelope
  shape).
- **Validation:** 4/4 pinning tests; output-format suite 15/15; live
  smoke green; 647 unit tests green on the rebased tree.
- **Rerun:** the interrupted build workflow resumed through the same
  detached launcher with the fix live — the envelope now always lands.
- **Retention:** the pinning test is the regression net; the CHANGELOG
  Agent Behavior entry + BEHAVIOR.md card carry the contract forward.

### R3 — the skills lane (the SOTA lineage)

Notes → dream → mint → stage → verify → promote, every step receipted
(the fugue session record): a smoke session's `run:finished` fired
`dream-check`, the dream minted `test-cadence-domain` (a real procedure
distilled from real notes — how to verify the cadence domain), staged it
under `.unown/skills-staged/`; the operator verified its claims exactly
(62 tests, 2,343 expects — measured) and promoted it (the documented
human gate). Two skills were staged by the SOTA midpoint. The engine's
task-minting gate also held honestly: two mined patterns were **discarded
by the solvability gate** during the round — the gate preventing
unsolvable tasks from burning agent runs every cycle.

## What improved, what didn't, and how we know

**Improved (with receipts):** the harness closed its first full cycle in
the parley lineage — a measured edit-bench failure → minted task → failed
baseline → mined diagnosis → 4-rule patch → verified twice → shipped
(R1); the CLI's unattended-caller contract got strictly stronger through
the mission's own failure→benchmark→fix→pin loop (R2); AutoDream
consolidated 50 dreams (24 merged / 108 added / 112 pruned) and 140 notes
into 58 memory versions while the apps were being built; the tool lane
ran at 99.46% success across 568 calls with exactly one human
intervention; the agent authored, tested and shipped a multi-tenant SaaS
(647 unit tests green, E2E 8/8 steps after 3 live-fixed defects).

**Did not improve (and the honest reasons):** model-tier correctness
(edit-bench 97.2% → 97.2% — the matched-model design isolates the
harness from the model; a model-tier lift was never the claim); pass-rate
lift from hand-authored memory rules (the F1 null — "memory buys
efficiency, not correctness", twice-reproduced); the parley suite's
headline pass rate went DOWN at midpoint (100% → 70%) because the suite
grew the failing mined task — the honest cost of a benchmark that
measures gaps instead of celebrating saturation.

**Pending receipts:** both rounds' final snapshots (the retention sweep
for R1's patch, the closing token/run totals) — committed at round close;
marked "not measured" here rather than projected.
