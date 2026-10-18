# Testing strategy and evaluation backlog (Unown)

> **What this page is.** The engineering contract for how Unown proves its own
> harness works: which layers get which kind of test, what runs in CI, what runs
> on a schedule, and what must be true before a number may be published. It is a
> decision record, not a usage page: it records the method, the evidence and the
> open verdicts. Companion pages: `docs/benchmark-research.md` (which public
> benchmarks are worth running and why), `benchmarks/README.md` (the nine tracks
> that already run), `docs/memory-system-review.md` (the memory subsystem's own
> review, findings F1-F10), `docs/AGENTS.md` (the contract this page must keep).
>
> **Verdict on the previous revision (2026-10-16), re-evaluated 2026-10-18.** The
> strategy is right in ambition and unusually honest about measurement, and its
> pipeline has demonstrably worked (8 hook-bypass classes closed, 10/10 poison
> notes flagged with 0 shipped, a container-free contamination-aware benchmark
> headline). As a *working document* it fails on three structural points and four
> substantive ones. The structural ones are fixed in this revision. The
> substantive ones are the real content of this page now:
>
> 1. **D3 - no competitive baseline for *testing* practice.** It compares
>    competitor benchmarks but never competitor test engineering, so it cannot
>    tell whether its own choices are ahead, level or harmful.
> 2. **B1 - it missed the field's central 2026 lesson: the verifier must be
>    outside the agent's reach.** Unown ships the agent, its memory, its
>    graders, its corpus and its gates inside one writable tree. Nothing in the
>    old document tested that.
> 3. **B2 - every differentiator number is LLM-graded and no judge was ever
>    calibrated.** The memory-vendor field's documented failures are judge
>    failures; Unown publishes rubric-less grades.
> 4. **B3 - the memory axes nobody measures are the ones Unown could win.** No
>    test exists for contradiction, staleness, forgetting or interference under
>    accumulation, which is exactly what tier precedence plus rollback claims.
> 5. **B4 - it claimed measurement discipline it did not implement.** Coverage
>    targets with no coverage gate, a golden-set policy with no frozen set, a
>    "read the transcripts" norm with no ritual, per-metric regression rules with
>    no per-metric record.
>
> §8, §7.6 and §10 items L-N are the new required work; the coverage gate and the
> docs gate are the two promises this revision actually keeps (D1, D2 are fixed
> structurally). Everything else in the old backlog that is not marked SHIPPED is
> still valid and still open.

- [1. Verdict on the 2026-10-16 draft](#1-verdict-on-the-2026-10-16-draft)
  - [1.1 What holds up](#11-what-holds-up)
  - [1.2 Three structural defects](#12-three-structural-defects)
  - [1.3 Four substantive blind spots](#13-four-substantive-blind-spots)
- [2. How to read this record](#2-how-to-read-this-record)
- [3. Live inventory (2026-10-18)](#3-live-inventory-2026-10-18)
  - [3.1 Reconciling the test counts](#31-reconciling-the-test-counts)
  - [3.2 What CI actually gates today](#32-what-ci-actually-gates-today)
- [4. The competitive baseline](#4-the-competitive-baseline)
  - [4.1 Agent-memory vendors](#41-agent-memory-vendors)
  - [4.2 Coding-agent vendors](#42-coding-agent-vendors)
  - [4.3 Task-length measurement (METR)](#43-task-length-measurement-metr)
  - [4.4 Sandbox and deny-list practice](#44-sandbox-and-deny-list-practice)
  - [4.5 Where Unown stands](#45-where-unown-stands)
- [5. Test architecture as built](#5-test-architecture-as-built)
- [6. CI gate ledger](#6-ci-gate-ledger)
- [7. Surface-by-surface backlog](#7-surface-by-surface-backlog)
  - [7.1 Dashboard](#71-dashboard)
  - [7.2 Self-learning engine](#72-self-learning-engine)
  - [7.3 CLI and terminal hooks](#73-cli-and-terminal-hooks)
  - [7.4 LLM bridge](#74-llm-bridge)
  - [7.5 Sandbox and OS isolation](#75-sandbox-and-os-isolation)
  - [7.6 Memory system and eval integrity](#76-memory-system-and-eval-integrity)
  - [7.7 Security cross-cutting](#77-security-cross-cutting)
  - [7.8 Data integrity and migration](#78-data-integrity-and-migration)
  - [7.9 Performance and cost](#79-performance-and-cost)
  - [7.10 Usability, docs and published claims](#710-usability-docs-and-published-claims)
- [8. Verifier integrity](#8-verifier-integrity)
- [9. Measurement standards](#9-measurement-standards)
- [10. Differentiator evals](#10-differentiator-evals)
- [11. Roadmap](#11-roadmap)
- [12. Success criteria](#12-success-criteria)
- [13. Out of scope](#13-out-of-scope)
- [14. Operating the portfolio](#14-operating-the-portfolio)
  - [14.1 Cadence](#141-cadence)
  - [14.2 Failure taxonomy](#142-failure-taxonomy)
  - [14.3 From failure to improvement](#143-from-failure-to-improvement)
  - [14.4 Guardrails](#144-guardrails)
- [Appendix A: sources](#appendix-a-sources)

## 1. Verdict on the 2026-10-16 draft

### 1.1 What holds up

Keep all of it; none of it was padding.

- **The three-layer split** (protect the harness / prove non-functional claims /
  measure the differentiator) is the right frame and is what makes the portfolio
  reviewable rather than a pile of tests.
- **The failure taxonomy and the reproduce-reduce-bisect playbook** (§14.2-§14.3)
  are better than most published agent-testing practice, and they exploit
  something competitors cannot: Unown can bisect *its own memory versions* on a
  failing task. Keep verbatim.
- **Anti-tamper scoring, honest subset labelling, and quoting-don't-fake** are
  already enforced in `benchmarks/README.md` and should stay the default.
- **The adversarial corpus discipline** (labelled deny/allow set, measured
  recall/precision, every bypass added to the corpus) is the correct shape and
  it has produced results.
- **The contamination-aware headline** (Track 7) is the right call after OpenAI
  dropped SWE-bench Verified over contamination `[C]`.

### 1.2 Three structural defects

**D1. The document was stale by construction.** All live state lived in a
60-line preamble; the body still described the 2026-10-16 tree. A reader who
started at the inventory table would have concluded "`src/` has zero tests, CI
is lint-only, there is no typecheck gate" - all three false for weeks. The
recommended stack was also wrong about itself: it specified Vitest + MSW while
what shipped is `bun test` + happy-dom + React Testing Library (deliberately, and
correctly for this stack). Fix: §3 is now a measured inventory, §6 is a gate
ledger, every backlog item carries a status tag, and §5 describes what is built
rather than what was once proposed.

**D2. It failed its own folder's contract.** `docs/AGENTS.md` requires every page
to carry a bullet mini-TOC of its own sections and a "Related pages" line, and
requires decision records to tier load-bearing claims `[V]` / `[C]` / `[U]`.
This page had no mini-TOC, no Related-pages line, and not one tier tag - so a
future reader could not tell a reproduced number from a proposal. Fixed here. The
tiers are not decoration: `benchmarks/RESULTS.md` currently carries three
different pi-repo test counts (see §3.1) precisely because nothing required a
claim to name its evidence.

**D3. No competitive baseline for testing practice.** `docs/benchmark-research.md`
studies what competitors *benchmark*. Nothing studied what competitors *test and
how they grade*, so this document could not answer its own question - is our
approach ahead, level, or behind? §4 is that baseline. It changed three
priorities, not just added reading.

### 1.3 Four substantive blind spots

**B1. Verifier integrity (now §8, and the top of the roadmap).** Unown measures
an agent with the agent's own corpus, in the agent's own writable tree. The
2026 eval literature is unambiguous that this is the dominant measurement risk:
reward must be computed in an environment the agent cannot mutate, the agent's
environment should be destroyed before verification, and benchmark-passing trials
should be audited rather than trusted `[C]` (one 2026 audit refuted 34.4% of
passing trials across five benchmarks, dropping the headline resolution rate
from 50.6% to 33.2%). Unown's terminal write jail is project-root scoped
`[V: pi-repo/packages/self-learning/src/hooks.ts:186]`, so `benchmarks/**`,
`scripts/**`, `pi-repo/**` and the poison corpus are all writable by the thing
being measured. The old document never raised this, and no test covers it.

**B2. No judge was ever calibrated.** Every differentiator number - memory lift,
dream quality, canary verdicts, screenshot review - is produced by an LLM judge
(`[V]` `src/guard.ts`, `src/canary.ts`, `benchmarks/*/vlm_review.mjs`). In the
adjacent memory-vendor field the documented failures are overwhelmingly judge
failures: LoCoMo's answer key is 6.4% wrong, its default judge accepts ~63% of
intentionally-wrong answers, and independent re-runs of the same published
benchmark name differ by 16-45 points for reasons traced to answer/judge prompt
tuning rather than to the system under test `[C]`. Unown publishes no judge
identity, no rubric, and no false-positive probe for any graded number.

**B3. The memory axes nobody measures are the ones Unown could win.** In the
memory field, contradiction resolution, staleness/forgetting and interference
under accumulation are the acknowledged weak axes - multi-hop conflict
resolution sits at or below 7% for GPT-4o-class agents `[C]`. These are precisely
the axes where tiered memory with explicit precedence, versioning and rollback
should beat a flat vector store. Unown has zero tests for them (§7.6, §10 item M).

**B4. Promised measurement hygiene that nothing implemented.** Coverage targets
with no gate (`bun test --coverage` works today, zero new dependencies, and no CI
job calls it `[V]`); no flakiness policy; no record/replay mode, so the live
memory suites cannot run hermetically in CI; no frozen golden set; no per-metric
regression gate; no transcript-reading ritual. §5-§6, §9 and §11 now state each
one as either implemented or explicitly deferred with a reason.

## 2. How to read this record

Claim tiers, per `docs/AGENTS.md`:

| Tag | Meaning |
|---|---|
| `[V]` | Verified here: reproduced command, cited `file:line`, or a receipt in the tree |
| `[C]` | Upstream/vendor/blog claim, quoted with a link, not re-derived by us |
| `[U]` | Unknown: what a spike must settle before the claim can be made |

Status tags on backlog items: **SHIPPED** (in the tree, with the receipt named),
**PARTIAL** (some cases covered, the gap named), **OPEN** (not started),
**DECISION** (needs an owner call, with the options stated).

Where a claim is `[C]`, treat the source's incentive as part of the claim. Vendor
benchmarks, vendor security research and vendor "audit" posts are all `[C]`;
several of the most useful sources in §4 are published by parties that sell the
thing they are measuring, and one of them (a judge-false-positive audit) exists
only because a competitor's number was inconvenient.

## 3. Live inventory (2026-10-18)

All counts below are from this tree unless marked `[C]`, and are now
platform-tagged: after the cross-platform merge (M2-M4, `afd962b`) the engine
suite's path-semantics differ per OS and the differences are load-bearing
(§7.2).

| Surface | What exists | Measured | Gap |
|---|---|---|---|
| `src/` (dashboard + landing) | `bun test src` with happy-dom + RTL | 206 tests / 13 files, 0 fail `[V: 2026-10-18, Windows]` | No E2E, no a11y, no visual regression, no landing-page tests; line coverage 91.1% overall but `providers.tsx` 58% and `activity-feed.tsx` 54% `[V]` |
| `pi-repo/.../self-learning` (engine) | `bun test test/` unit + guard + canary + budget suites; `test/cli/golden.test.ts`; `test/termhooks.adversarial.test.ts`; `test/integration/`; new: `tools.test.ts`, seatbelt and Windows-hook tests (M2/M3) | pre-fix `888c8fa`: 603 pass / 35 skip / 64 fail of 702; post-fix `ae7b01b` (three-OS portability): **600 pass / 79 skip / 25 fail of 704** across 20 files `[V: 2026-10-18, Windows, bun 1.4.2 AND pinned 1.4.3 - not a bun-version delta]`; ubuntu leg green on both runs (733/37/0 at run 39071373372) | the 25 residuals (§7.2): canary suite 6, CLI golden 16, path tests 3; no fault injection, no load test, no coverage measurement, no property fuzzing; live suites are env-gated and therefore never run in CI |
| `mini-services/llm-bridge` | `bun test pure.test.ts` (pure routing/thinking/retry/backoff/SSE math) + env-gated VLM smoke | 95 tests, 0 fail `[V: 2026-10-18, Windows]` | No load/chaos, no cancellation test, no contract test against a real OpenAI client, not in CI (§11) |
| `bin/unown` (CLI + TUI) | `test/cli/golden.test.ts` (setup/doctor/memory/plan/headless/env-knobs/parallel) | covered in the engine suite above | The golden suite still fails 16 cases on this Windows tree after `ae7b01b` (subprocess-spawn families, §7.2); no TUI interaction test, no `unown setup` idempotency-under-failure test |
| `pi-repo/*` (upstream vendored) | `npm run test` per workspace with pinned model-catalog snapshots | pre-merge Linux receipt: 4,809 pass / 0 fail / 13 skip `[V: benchmarks/snapshots/track1-rerun-2026-10-17/summary.json]` | Out of our scope by policy (§13); receipt needs re-measuring post-merge on the Linux box |
| Benchmarks | Tracks 1-9 (`benchmarks/README.md`) | re-verified 2026-10-17 with receipts `[C: benchmarks/RESULTS.md]` | No time-horizon ladder, no judge calibration, no external memory benchmark |
| Sandbox | `bwrap_smoke.sh` (25 checks), `verify_sandbox.mjs` (12 checks) | In CI as the `sandbox-smoke` job (ubuntu) `[V: ci.yml]`; trajectory across runs: red 10/11/1 at `afd962b` (launcher dies) `[V: 39069143075]` -> profile step green 21/0/1, engine step red 10/2 at `ae7b01b` `[V: 39071373372]` -> **fully green** (both steps) at `a13cf9d` `[V: 39072290887]` | the launcher-vs-engine split diagnosed itself across the three runs; the record keeps the per-step receipts (§7.5) |
| CI (`.github/workflows/ci.yml`) | lint-shell, `build-test` (3-OS real-installer matrix + engine suite + CLI smokes), `sandbox-smoke` (ubuntu), lint, typecheck, `bun test src`, coverage gate, docs gate, theme, GBA palette, gitleaks, `bun audit --prod` | 12 jobs `[V: ci.yml]` | No bridge tests, no integration, no build, no E2E/axe; at run 39072290887 (`a13cf9d`): `sandbox-smoke` fully green, all dashboard gates green, engine legs red (ubuntu 735/37/1, windows 689/80/3, macos 729/41/3) |

### 3.1 Reconciling the test counts

Three numbers were in circulation for the same suite: 4,585 (upstream baseline
quoted in the old §2 and §9), 5,032 (`benchmarks/RESULTS.md` line 11) and 5,342
(this page's old preamble). Only one is current: **5,342 pass / 0 fail / 13
skip**, per-workspace, with the receipt in
`benchmarks/snapshots/track1-rerun-2026-10-17/summary.json` `[V]`. Of those,
4,809 are vendored upstream and 533 are the self-learning engine (384 unit +
149 Phase 3 CLI/adversarial; the 10 integration tests are counted separately in
that receipt's note). `benchmarks/README.md` and `RESULTS.md` should adopt the
same figure and the same scope sentence - a count without its scope is not a
fact, which is this page's own `docs-drift` taxonomy item (§14.2 #9).

That reconciliation is now itself historical: the cross-platform merge
(`afd962b`, 2026-10-17) grew the engine suite to 700+ collected tests and the
5,342 receipt predates it. Fix `ae7b01b` then re-based the fixtures
platform-aware (realpath'd `/var/tmp` on POSIX, homedir scratch on win32,
platform-gated corpora: local skip count rose 35 -> 79 on Windows, which is the
gating working, not a regression). The standing rule this page commits to is
per-platform, scope-tagged receipts, not one global figure: Windows (this
tree, post-fix 600/79/25) and Linux (last full receipt 5,342/0/13) each carry
their own number until the Windows residuals are cleared (§7.2). Re-measure
the full Track 1 pipeline on the Linux box post-merge before quoting any new
global figure.

### 3.2 What CI actually gates today

`[V: .github/workflows/ci.yml]` twelve jobs: `lint-shell` (bash -n over
`scripts/*.sh`), `build-test` (ubuntu/macos/windows matrix: the real installer
`bun scripts/install.ts` with model-data hydration, then the engine suite
`bun test test/`, then `unown --help` and a `doctor`-table smoke), `sandbox-smoke`
(ubuntu: `bwrap_smoke.sh` + `verify_sandbox.mjs`), dashboard lint (`bunx eslint
src`), typecheck (`tsc --noEmit` after `db:generate`), dashboard unit tests
(`bun test src`), the changed-line coverage gate (`scripts/check_coverage.mjs
--run`), the docs link/anchor gate (`scripts/check_docs.mjs docs/*.md`), theme
schema, landing GBA palette contract, gitleaks full-history secret scan, and
`bun audit --prod` with three documented prisma-internal ignores. A concurrency
group cancels superseded runs.

Still absent: the integration suite, `bun run build`,
and E2E/axe. The bridge suite (95) was wired in this revision's round
three. The merge also surfaced a second, subtler honesty problem -
"the job exists" is not "the job pays off". At `afd962b` the newest upstream
run had engine tests green on the ubuntu leg but red on the windows and macos
legs, and `sandbox-smoke` red on ubuntu because the ubuntu-24.04 runner image
blocks unprivileged user namespaces `[V: runs 39069143075, 39070679749]`.
`ae7b01b` shipped the remedies - platform-aware test fixtures, the macOS
`/private/etc` allowlist fix, a `sandbox-smoke` sysctl pre-step, and an early
userns canary in `bwrap_smoke.sh` that prints the exact fix when userns is
unavailable. Version 39071373372 (`5f35339`) then measured that fix in CI:
the profile suite went green (21 pass / 0 fail / 1 skip, from 10/11/1), but
the windows engine leg still fails 3 pure path-math tests (687/79/3 of 769),
macOS fails its env-guard self-tests plus one system-tree test (726/40/4 of
770), and `verify_sandbox.mjs` fails 2 of 12 engine-level checks. `a13cf9d`
(round two, 2026-10-17T21:45Z) then targets those receipts directly - bun
exec-dir runtime-bind for the sandbox failures, a `node:path` realpath join
for the macOS deny dodge, raw-target lexical test for the win32 device path -
with upstream receipt run 39072290887 (completed post-capture): `sandbox-smoke`
went fully GREEN for the first time in this series, but the engine legs came
back newly composed - ubuntu 735/37/1 of 773 (a round-two-introduced fixture-
ordering bug: `memory.test.ts:60` lstats a `/tmp/engine-tests-b` subtree a
sibling test already removed), macos 729/41/3 of 773 (env-guard self-tests x3:
the `^/...` deny regexes still not exercised - likely the `_env.ts` import
order the tripwire names), windows 689/80/3 of 772 (canary rollback + the F4
bun-node live-pinned case + the win32 raw-device twin). Locally two of the
CLI-golden cases plus the raw-device twin went green (Windows: 604/80/23
of 707, was 600/79/25). So round two bought `sandbox-smoke` at the price of
one fixture-ordering defect and re-shaped the windows/macos residue;
§7.2 and §7.5 carry the residue; §11 keeps clearing it first.

## 4. The competitive baseline

The question this section answers: when a reader asks "how do you know this is a
good testing strategy for an agent?", what is the external reference point?

### 4.1 Agent-memory vendors

The nearest competitors to Unown's differentiator are not coding agents; they are
memory systems: Mem0, Letta/MemGPT, Zep/Graphiti and Supermemory. All of them
publish memory-benchmark numbers, and the field's headline lesson is that those
numbers are not comparable across vendors `[C]`.

| Benchmark | What it measures | Scale | Grading | Vendor scores `[C]` |
|---|---|---|---|---|
| LoCoMo (arXiv 2402.17753) | QA over long multi-session dialogue: single-hop, multi-hop, temporal, open-domain | ~9k tokens/conversation, up to 35 sessions, 1,540 questions | F1/BLEU originally; LLM judge in most recent work | Mem0 92.5%, Zep 94.7% claimed, ByteRover 92.2%, Dakera 88.2% |
| LongMemEval (arXiv 2410.10813) | five abilities: extraction, multi-session reasoning, temporal, knowledge update, abstention | 500 questions; S ~115k tokens, M ~1.5M | LLM judge | Mem0 94.4%, Mastra 84.23%, Zep 71.2%, Emergence 86% |
| DMR (arXiv 2310.08560) | one fact planted in an earlier session | 500 conversations | judge | MemGPT 93.4%, Zep 94.8% - a 1.4-point margin, i.e. saturated |
| BEAM / MemoryAgentBench / STATE-Bench / MemoryArena | memory at 1M-10M tokens; conflict resolution; does the agent finish a real task | varies | mixed | sparse |

Four published findings from that field change what Unown owes its own numbers:

1. **The graded artifacts are the weak link, not the systems.** A 2026 third-party
   audit found 99 errors in 1,540 LoCoMo answer-key entries (6.4%) and measured
   the default judge accepting 62.81% of intentionally-wrong but topically
   adjacent answers `[C]`. Another independent reproduction reports its own judge
   at 1% false-positive rate on LongMemEval and 0% on LoCoMo - a 60-point
   difference caused entirely by the judge configuration `[C]`. A memory score is
   therefore meaningless without the judge id, the rubric version, and a measured
   false-positive rate.
2. **The same benchmark name can differ by 16-45 points across runs of the same
   product.** One audit traced the entire gap between a 73.8% reproduction and a
   93.4% published figure to dataset-specific equivalence rules and hidden
   reasoning blocks inside the vendor's *answer and judge prompt files*, at named
   commits `[C]`. Prompt-file tuning is invisible in the score and is not the
   memory system.
3. **Knowledge updates and contradictions are the unsolved part.** Add-only
   architectures keep superseded facts alongside current ones; multi-hop conflict
   resolution sits at or below 7% for GPT-4o-class agents `[C]`. This is the
   opening for a tiered memory with explicit precedence and rollback - and it is
   currently untested in Unown (§7.6).
4. **A benchmark only tests memory when the history does not fit in context.**
   LoCoMo's ~9k-token conversations fit comfortably inside a current context
   window, so a high LoCoMo score is evidence of cheap context management, not of
   memory capacity `[C]`. Unown's repeat-task suites are unambiguously in the
   fits-in-context regime. That is a legitimate and publishable claim ("memory
   changes behaviour at a fraction of the token cost"), and it must be *labelled*
   as such rather than implied to be memory-capacity evidence.

**Obligations this creates for Unown** (implemented or queued in §11): name the
judge and rubric for every graded number; measure the judge's false-positive rate
with a fixed-seed adversarial probe; ship a full-context / no-memory baseline at
matched token budget wherever the history fits; never quote a LoCoMo-class number
as ours; and state which regime each track measures in the landing page copy.

### 4.2 Coding-agent vendors

- **Anthropic, "Demystifying evals for AI agents" (2026-01-09)** `[C]`, is the
  most directly transferable document in this section. Its rules that Unown does
  not yet follow: deterministic graders first, transcript grading for behaviour a
  test cannot see; a committed reference solution per task to prove the task is
  solvable and the grader is correctly configured; per-trial isolation, because
  shared state produces correlated failures and one internal eval had agents
  gaining an unfair advantage from reading git history left by previous trials;
  graders designed to resist bypass; "0% pass@100 is a broken task, not an
  incapable agent"; and read the transcripts before trusting a score. It also
  reports a real grader bug - Opus 4.5 scored 42% on CORE-Bench until rigid
  grading, ambiguous specs and irreproducible stochastic tasks were fixed, after
  which it scored 95%.
- **Google, "The Anatomy of Harness Engineering" (2026-09-09)** `[C]`: treat
  behavioural evaluations as the integration-test layer of an agent harness -
  fast, deterministic, unit-style assertions on discrete observable actions -
  and run noisy model-backed evals as batches that establish a trend, rather than
  gating a PR on a single stochastic run.
- **Google Cloud, "Four eval engineering lessons" (2026-10-16)** `[C]`: grade the
  execution trajectory, not the agent's closing summary (a rubric line "did it
  run X?" is a guess unless the tool-call trajectory is inspected); preserve turn
  structure in telemetry extractors; and **run a live arm and a plan-only arm
  side by side**, because permission errors mask reasoning and routing defects.
  Unown is one of the few agents that can do this cheaply: `--plan` is a shipped
  mode.
- **Google, "Evaluating AI agents: moving past the vibe check" (2026-10-15)**
  `[C]`: four layers (unit tests, deterministic metrics, boolean judge rubrics,
  integration tests); freeze the golden dataset, because deleting a noisy test
  moves the baseline rather than the agent; prefer boolean ("did it verify the
  account id before refunding?") over 1-5 scales; and gate on per-metric
  regression even when the aggregate score holds steady.
- **Cline** publishes same-build rerun spreads (e.g. 43.8% -> 56.2% on 89 tasks)
  and its "Hill Climber's Checklist" `[C]`; **Artificial Analysis** composites
  three benchmarks, shows cost/task and time/task, and reports safety-refusal and
  reward-hacking columns `[C]`; **Warp** publishes nothing self-run and quotes
  official boards `[C]`. `docs/benchmark-research.md` already mines these for
  presentation patterns; §4.2 mines them for *method*.

### 4.3 Task-length measurement (METR)

The field standard for "can this agent do long tasks" is METR's task-completion
time horizon: rate each task by the time a qualified human needs, run the agent
N times, fit `P(success) = sigma((log h - log t_task) * beta)`, and read off the
task length at which the agent succeeds 50% (or 80%) of the time `[C:
arXiv 2503.14499; METR time-horizon pages, 2026]`. The trend measure is the
doubling time (~196 days in TH1.0; ~131 days post-2023 in TH1.1).

Two consequences for Unown's Track 8, which is currently n=1 on a single task
where all three models passed:

- A single task cannot produce a horizon, and a passing n=1 run cannot separate
  models. The cheap fix is a **task-length ladder**: the same task at three time
  caps (2/7/15 min) plus at least one harder task, scored pass/fail per point, so
  the curve has a slope (`beta`) instead of a dot. Unown already has an
  env-tunable cap and a committed reference refactor, so the marginal cost is
  runs, not new harness (§10 item J).
- METR's *operating* practice is the more important half: elicit on a dev set,
  then run an independent test set, launch multiple independent runs per task,
  **flag passing runs for reward hacks** (automatic LLM + keyword screen, then
  human review), check that the token budget was sufficient, and bootstrap CIs
  hierarchically over families/tasks/runs `[C]`. Their task suite also removes and
  rewrites tasks that were "confusing, or easy to reward-hack, or [had] scoring
  functions with errors" `[C]` - which is the same advice as §8, arrived at
  independently.

Also worth internalising: a time horizon is a measure of *task difficulty*, not
of how long an agent can safely run unattended, and human baseline estimates
carry large noise `[C]`.

### 4.4 Sandbox and deny-list practice

- **Both filesystem and network isolation, stated as a boundary** - and the
  honest distinction the vendors now draw is isolation boundary versus permission
  prompt. Anthropic's own docs state that a per-command bash sandbox "does not
  cover everything that runs in a session" (file tools, hooks and MCP servers run
  outside it) and that a bash-only sandbox "is not sufficient for fully
  unattended runs in either mode" `[C: code.claude.com/docs/en/sandbox-environments]`.
  Unown already makes the same split (engine runs inside bwrap; terminal sessions
  are unsandboxed by design) - §7.5 should adopt the vendor framing and state the
  unattended-vs-interactive rule as a contract rather than a footnote.
- **Regex deny lists are the recurring root cause.** Two 2026 Claude Code CVEs -
  a quoted-dash bypass (`"-exec"` where the regex expects `-exec`) and a zsh
  clobber-operator bypass (`>!` where path validation expects `>`) - both escaped
  sandbox and permission, because the security decision was a regex over a shell
  command string `[C]`. Both are families Unown's corpus does not yet enumerate
  (§7.3, §7.7). The generalisation: deny lists must be structured (argv-aware,
  shell-quote-aware, fail-closed) and continuously fuzzed, because no enumerated
  corpus finishes the job.
- **Tool-invocation is a second attack surface, and it is not a file.** Red-team
  work on six production coding agents achieved prompt exfiltration through
  benign tool-argument retrieval and remote code execution through a two-channel
  injection split across the tool *description* and the tool *return value*
  `[C: arXiv 2509.05755]`. MITRE-aligned benchmarking of CLI agents measures
  OS-level misuse with deterministic, resettable multi-host verification `[C:
  arXiv 2510.06607]`. Unown's injection coverage is file-shaped (README, notes,
  skills); the *tool-return* channels - `fetch_url` output, subagent returns,
  task results, the injected memory block itself - are untested (§7.7).
- **Reward must be computed where the agent cannot mutate it.** The clearest
  statement of the verifier boundary: the agent's environment should be destroyed
  before verification, the verifier should see only declared submitted bytes, and
  agent egress must be separated from task egress `[C: rishidesai.org/posts/task-design]`.
  Unown's analogue is §8.

### 4.5 Where Unown stands

| Dimension | Field practice `[C]` | Unown | Verdict |
|---|---|---|---|
| Adversarial command corpus | labelled deny/allow set, measured recall, fuzzed | labelled corpus, 149 tests, recall/precision tracked; no fuzzer | **Ahead**, minus fuzzing |
| Memory poisoning | provenance tags, delimiters, canary gating, MPBench-style probes | provenance in the injected block, deterministic guard, canary with K samples, n=10 poison corpus | **Ahead** |
| Contamination-aware model headline | LiveCodeBench / SWE-rebench, post-cutoff windows | Track 7, pinned window, official prompt + grader, `no_code` reported honestly | **Ahead** |
| Container-free honest benchmarking | cite third-party boards rather than fake a self-run | Tracks 2/3/4/6/7/8 self-run; SWE-bench/TB quoted with dates | **Ahead** |
| CI gate on the engine's own suite | universal | wiring landed; ubuntu leg green; windows 3 red / macos 4 red post-`ae7b01b` `[V: run 39071373372]`, 25 local Windows residuals of which ~22 are privilege-environment and pass on the runner | **Wired and mostly green; path/env residue named in §7.2** |
| Verifier integrity / anti-contamination | verifier boundary, reward-hack flagging, trial auditing | none | **Behind, and unpriced** |
| Judge calibration for graded metrics | judge id + rubric + FPR probe published | none | **Behind, and cheap to fix** |
| Coverage as a gate | routine | targets stated, no gate (gate added in this revision) | **Fixed here** |
| Long-horizon measurement | time-horizon curves, 6-8 runs/task | n=1, all models pass | **Behind on method** |
| Memory-quality axes (contradiction, forgetting, interference) | the field's acknowledged frontier | untested | **Behind, and it is our differentiator** |
| Dashboard/component testing | component + E2E + a11y | 206 component tests, no E2E, no a11y | **Level**, with E2E/a11y missing |
| Failure taxonomy + memory-version bisection | rare outside vendor-internal work | present since the first revision | **Ahead** |

## 5. Test architecture as built

The previous recommendation (Vitest + MSW) was superseded during Phase 0. What is
in the tree, and why it is the right call:

| Layer | Tooling | Location | Speed/cost | When |
|---|---|---|---|---|
| Unit (pure functions, reducers, formats) | `bun test` (built in, no config) | `src/**/*.test.ts` | <5 s, $0 | every PR |
| Component (React) | `bun test` + happy-dom + `@testing-library/react` + `user-event` | `src/components/dashboard/__tests__/` | <5 s, $0 | every PR |
| Engine unit + guard suites | `bun test test/` | `pi-repo/packages/self-learning/test/` | <60 s, $0 | every PR (wired; ubuntu leg green, the fixture-level portability landed in `ae7b01b`, Windows residuals §7.2) |
| Contract (engine <-> dashboard) | hand-maintained `src/lib/agent-types.ts` + integration fixture capture | `src/lib`, `test/integration/` | seconds | every PR (partial) |
| Integration (HTTP, SSE, DB) | real `startServer` on an ephemeral port, mock bridge, temp state | `test/integration/` | ~30 s, $0 | every PR (once wired) |
| CLI golden | subprocess `bin/unown` against a temp `UNOWN_HOME` | `test/cli/golden.test.ts` | ~2 min, $0 | every PR (wired inside the ubuntu build-test leg; 16 Windows residuals post-`ae7b01b`, §7.2) |
| Adversarial corpus | labelled cases + expected decision | `test/termhooks.adversarial.test.ts` | <10 s | every PR |
| Live probes (memory, poison, VLM) | env-gated (`UNOWN_MEMORY_LIVE=1`, `UNOWN_MEMORY_POISON=1`, `UNOWN_VLM_SMOKE=1`) | engine + bridge | minutes, $$ | weekly + pre-release |
| Agent evals / benchmarks | existing `runner*.mjs` per track | `benchmarks/*` | hours, $$ | weekly + release |
| End-to-end (UI) | Playwright - **not yet adopted** | `e2e/` (absent) | 5-15 min | nightly (planned) |
| Sandbox | `bwrap_smoke.sh`, `verify_sandbox.mjs` | `scripts/` | ~1 min | every PR (in CI as the ubuntu `sandbox-smoke` job; `ae7b01b` adds the userns canary + sysctl pre-step - §7.5) |
| Coverage | `bun test --coverage` + `scripts/check_coverage.mjs` | CI job | +5 s | every PR (shipped in this revision) |

Notes on the two decisions that changed from the original proposal:

- **`bun test` over Vitest.** The dashboard already runs on Bun, CI installs Bun,
  and `bun test` needs no config or extra dependency. Vitest would add a second
  runner to a repository whose engine is Bun-native. Cost: no built-in browser
  environment (happy-dom is the substitute) and no first-class watch mode.
- **No MSW.** The dashboard's network surface is one typed client
  (`src/lib/agent-api.ts`), so component tests stub `fetch` at that boundary
  instead of running a service-worker mock. Revisit only if a second HTTP client
  appears; MSW buys little when the whole surface is one module.

## 6. CI gate ledger

| # | Gate | Status | Note |
|---|---|---|---|
| 1 | `bunx eslint src` | SHIPPED | |
| 2 | `bun run typecheck` (`tsc --noEmit`, after `db:generate`) | SHIPPED | |
| 3 | `bun test src` | SHIPPED | 206 tests |
| 4 | `bash -n scripts/*.sh` | SHIPPED | per-file, fails with `::error` annotations |
| 5 | `bun scripts/check_theme.mjs` | SHIPPED | reads a `.ts` file from pi-repo, so it needs bun |
| 6 | `bun scripts/gba_palette_check.mjs` | SHIPPED | browser-free, so it is a real gate not a caption |
| 7 | gitleaks full-history secret scan | SHIPPED | |
| 8 | `bun audit --prod` | SHIPPED | 3 documented prisma-internal ignores |
| 9 | Changed-line coverage >= 80% in `src/` | SHIPPED (this revision) | `bun test --coverage` + `scripts/check_coverage.mjs`; measured baseline 91.1% lines |
| 10 | Engine suite `bun test test/` in `self-learning` | SHIPPED (upstream, `build-test` matrix) | ubuntu green; post-`ae7b01b` (run 39071373372): windows 687/79/3, macos 726/40/4; locally on Windows 600/79/25 - 22 of the local 25 pass on the runner (privilege environment), 3 are real (§7.2). Hermetic means green on **every** runner |
| 11 | Bridge suite `bun test pure.test.ts` | **SHIPPED** (this revision, round three) | 95 tests, sub-second, no deps/network — dedicated `bridge` CI job | 
| 12 | Engine integration suite (`test:integration`) | **SHIPPED** (this revision, round three) | 10 tests, real server + mock bridge — `PI_TEST_SCOPE=integration` step in the 3-OS `build-test` matrix |
| 13 | Sandbox suite in CI | SHIPPED (upstream, unconditional ubuntu `sandbox-smoke` job) | **GREEN** as of run 39072290887 (`a13cf9d`): trajectory red 10/11/1 -> profile green 21/0/1 + engine red 10/2 -> fully green. The red phase proved the value of the early-canary design (§7.5) |
| 14 | `bun run build` before deploy | **SHIPPED** (this revision) | dedicated `build` job: frozen-lockfile install + prisma generate + `bun run build` + standalone-server smoke (/ and /dashboard 200 on a scratch port) |
| 15 | Mermaid byte-identity (`scripts/mermaid_check.mjs`) | **SHIPPED** (this revision) | own `ci.yml` job: sources extracted from README.md itself (single source of truth), parsed under the vendored sha-pinned mermaid 11.16.1 (the version github.com runs as of 2026-08), rendered twice in two fresh browser contexts, PNG sha256s compared byte-for-byte. Found live while wiring it: mermaid 11.16.1's shape generators sample `Math.random` — UNPINNED, the loop diagram's stadium nodes wobble up to 30px of path control points between renders (10/31 paths; the architecture diagram, no stadium nodes, was accidentally stable); the gate pins `Math.random` (mulberry32) + `deterministicIds`, and the receipt records both pins |
| 16 | Playwright E2E + axe-core | **SHIPPED** (this revision) | dedicated `e2e` job: `e2e/mock-engine.mjs` (zero-dep node:http stand-in implementing the full REST + SSE contract of `agent-api.ts`) + the production standalone build in DIRECT api mode + `bunx playwright test`. 11 tests: 9-tab render with zero browser console errors, SSE feed assertions (hello + scripted events), console prompt round-trip, axe-core WCAG 2.0/2.1 A+AA scans of the landing page and all nine tabs. Found live on first run: 80+ real AA contrast defects (zinc-500/600 small text, StatChip `opacity-70` labels, zinc-700 mono text) + one aria violation (DifficultyStars `aria-label` on a role-less span) — all fixed in `src/` |
| 17 | Docs link and anchor integrity on `docs/*.md` | SHIPPED (this revision; verified green against upstream's new `windows.md`/`macos.md`) | `scripts/check_docs.mjs` as the `docs` CI job; the CLI-surface and env-var cross-checks in `docs/AGENTS.md` remain prose (§7.10) |

## 7. Surface-by-surface backlog

Every item is OPEN unless marked. Section numbers from the previous revision are
preserved in the margin notes where they were cited from history.

### 7.1 Dashboard

*(was §4.1; surface: `src/`)*

- **SHIPPED** - `agent-format.ts`, `agent-store.ts`, `agent-api.ts`, `utils.ts`
  unit tests; `use-toast` reducer; all nine tabs' happy/empty/error states and
  mutation flows; SSE bridge invalidation and `router:error` toasts (206 tests).
  This layer already found a real crash (`refetchInterval` on run-less data).
- **OPEN** - `providers.tsx` is at 58% line coverage and `activity-feed.tsx` at
  54% `[V]`; the uncovered ranges are the SSE frame parser and the activity
  normalisation. These are the two highest-risk pure functions in the dashboard
  and are the first target of the new coverage gate.
- **SHIPPED** - End-to-end (§6 gate 16, the `e2e` CI job): Playwright against a
  zero-dependency mock engine (`e2e/mock-engine.mjs`, the exact REST + SSE
  contract). Boot, all nine tabs render live data with zero browser console
  errors, the SSE feed renders hello + scripted events, and the console tab's
  prompt flow (busy state -> interactive run -> transcript) round-trips. Still
  open from the original list: the clipboard-unavailable fallback (needs a
  permissions-denied context) and SSE-driven KPI invalidation asserts (the
  invalidation fires; only the feed text is asserted today).
- **SHIPPED (axe half)** - Accessibility: axe-core per tab + the landing page
  (WCAG 2.0/2.1 A+AA, zero-violation gate in the `e2e` CI job — its first run
  found 80+ real contrast defects + 1 aria violation, all fixed). Still open:
  keyboard-only navigation across tabs and dialogs, focus trapping in
  `AlertDialog`, `sr-only` labels, and Lighthouse >= 90 (§12 criterion 6's
  other half).
- **OPEN** - Type/DTO drift: a contract test that the dashboard's
  `agent-types.ts` still accepts a captured `GET /api/overview` fixture. The types
  are hand-maintained and will drift on the next engine change.
- **OPEN** - Visual regression for the `dashboard-*.png` assets, extending the
  existing capture/review pipeline rather than adding a new one.
- **OPEN** - Landing page (`src/components/landing/`) has no behavioural tests.
  Its contracts are currently *static* checks (GBA palette, theme, contrast
  audit), which is a reasonable trade for a marketing surface - but the numbers
  it prints are not checked, and that is §7.10.

### 7.2 Self-learning engine

*(was §4.2; surface: `pi-repo/packages/self-learning/src`)*

- **SHIPPED** - memory, tasks, mint, router, llm, notes, skills, outbox, bwrap,
  termhooks (unit + adversarial), guard, dream-guard, canary, budget, CLI golden,
  HTTP integration (10 tests, real server + mock bridge); from the M2/M3 merge:
  `tools.test.ts`, the seatbelt (macOS sandbox-exec) suite, and a Windows-hook
  suite.
- **OPEN (residual after `ae7b01b`, which cleared most of it)** -
  **cross-platform test debt**. The merge pushed the family into CI, and
  upstream's own `build-test` windows/macos legs failed for exactly the same
  families this tree failed locally (64 failures at `888c8fa`, `[V: run
  39069143075 + local 2026-10-18 receipt]`). Fix `ae7b01b` then did the first
  half: platform-aware fixture roots, win32-gated seatbelt/bwrap-backend and
  POSIX-symlink corpora (skip counts rose 35 -> 79 on both Windows trees:
  platform-elective coverage now tells the truth instead of failing), and a
  real engine fix (SYSTEM_TREE now admits the macOS `/private/` prefix - a
  genuine deny-gap, the exact symlink-indirection family §4.4 teaches). The
  measured residue, per platform, run 39071373372 + local receipts:

  | Context | Collected | Pass / skip / fail | Residue |
  |---|---|---|---|
  The measured residue, per context and run (each row cites its own receipt
  so the deltas stay legible):

  | Context | Collected | Pass / skip / fail | Residue |
  |---|---|---|---|
  | CI ubuntu (`ae7b01b`, run 39071373372) | 770 | 733 / 37 / **0** | none |
  | CI windows (same run) | 769 | 687 / 79 / **3** | `jailPath` diagnostics x2 ("resolved path returned", "no over-jailing"), win32 `bashRedirectEscape` raw-device twin |
  | CI macos (same run) | 770 | 726 / 40 / **4** | env-guard self-tests x3 ("env redirect is active"), one `bashRedirectEscape` absolute-redirect |
  | CI ubuntu (`a13cf9d`, run 39072290887) | 773 | 735 / 37 / **1** | fixture-ordering ENOENT (`memory.test.ts:60` lstats a `/tmp/engine-tests-b` subtree an earlier test removed) - introduced by round two |
  | CI windows (same run) | 772 | 689 / 80 / **3** | `canaryCheck` rollback + F4 bun-node live-pinned + win32 raw-device twin |
  | CI macos (same run) | 773 | 729 / 41 / **3** | env-guard self-tests x3 (unchanged by round two's join) |
  | Local Windows (`a13cf9d`) | 707 | 604 / 80 / **23** | residual CI families + `canaryCheck` x6 + CLI golden x14; those two families PASS on the runner: local-privilege failures (symlink/process spawning), not suite defects |

  The policy rules unchanged: a "hermetic suite" means green on every runner,
  and the small absolute residue (3 + 4 in CI) is the actual repair list; the
  22-test local/runner delta argues for an env-normalisation pass over the
  spawn-based suites so local receipts match CI receipts.

  Round two (`a13cf9d`, "sandbox runtime-bind + realpath hardening - first
  3-OS CI findings") then landed against exactly that residue: `bwrap.ts`
  runtime-binds the bun exec dir back into the sandbox (the mask eats
  `~/.bun` on runners and dodged `bun run` - the two `verify_sandbox.mjs`
  failures), `hooks.ts` realpathAncestor joins via `node:path` (a `//`
  prefix when the ancestor is `/` dodged every `^/...` deny regex on macOS),
  and `bashRedirectEscape` now tests the RAW redirect target against the
  lexical deny for win32 device paths. Local Windows receipt post-`a13cf9d`:
  604 pass / 80 skip / 23 fail of 707 (was 600/79/25 - two CLI-golden
  subprocess cases and the raw-twin now pass locally). CI verdict for the
  round (`39072290887`): `sandbox-smoke` fully green (first time in this
  series); the engine legs return the residue the table above lists, with
  the newly introduced ubuntu fixture-ordering bug at the top of the repair
  list (its own author's commit caused it - invariant: a shared fixture root
  is mutable state; a test that deletes a subtree other tests still read
  needs an mkdtemp of its own, which is §7.1's per-test isolation rule).
- **SHIPPED (round three, this session)** - the whole import-order / ENOENT
  class closed at its source, local receipts: (a) the self-learning package
  `bunfig.toml` preloads `test/_env.ts` before ANY test file's imports
  evaluate (order-independent env redirect - same pattern the repo root
  already uses for its DOM preload); (b) `_env.ts` materializes
  `<TEST_TMP>/data` and `<TEST_TMP>/unown-home` up front (`store.ts` only
  mkdirs `dirname(DB_PATH)`, so a tripwire `realpathSync(DATA_DIR)` could
  ENOENT on a clean runner before the first memory write - reproduced the
  CI ubuntu receipt deterministically, then five consecutive clean-`/tmp`
  runs at 736/0/37); (c) `memory-live`/`memory-poison` claim their scratch
  env only under their gates (module bodies evaluate even when skipped, and
  an ungated claim steals `PI_SELFLEARNING_*` from later-loading unit files
  whose `_env` import only sets defaults `??=`). The macOS env-guard
  self-test x3 share the import-order root cause and are expected to clear
  on the next CI run; the windows residue (canary rollback + F4 live-pinned
  + raw-device twin) is path-semantics work that stays OPEN.
- **OPEN** - Fault injection, none of it: bridge down mid-run; process kill
  mid-run then restart (orphan recovery must leave memory versions monotonic and
  no partial write visible); SQLite concurrent read while a run writes (WAL, no
  `database is locked`); `DATA_DIR` unwritable; malformed JSON from the miner;
  bwrap absent on the host (isolation must be reported as `process`, never as a
  silent success).
- **OPEN** - The "engine self-suite" of ~10 fixtures that the harness must keep
  passing. The suite exists as seeded tasks; what is missing is a *release*
  assertion that runs it on a clean checkout with pinned snapshots. This is what
  makes later self-improvement experiments interpretable, and it is still the
  single most valuable un-run thing in the repository.
- **OPEN** - Coverage measurement for `self-learning/src` and `llm-bridge`. Both
  are Bun projects, so `bun test --coverage` already works; no gate exists.
- **OPEN** - Property-based tests (`fast-check` or Bun's built-in) for the
  security-critical pure functions: `decideBash`, `jailPath`,
  `bashRedirectEscape`, `stripQuotes`, and the budget cap arithmetic. Examples
  and a corpus are not enough for regex-and-path code (§4.4).

### 7.3 CLI and terminal hooks

*(was §4.3; surface: `bin/unown`, `termhooks.ts`)*

- **SHIPPED** - golden tests for setup/doctor/memory/plan/headless/env-knobs/
  parallel sessions; the adversarial corpus through B1-B10 plus the §4.3 candidate
  families.
- **OPEN** - The shell-quoting and redirection families that produced two 2026
  CVEs in a comparable product `[C]`: quoted-flag disguises (`"-exec"`,
  `--exec=…`), zsh clobber operators (`>!`, `>|`) reaching system paths, and
  escape-built strings (`eval "$c"` where `c` is assembled from fragments).
  These are the highest-yield additions to the corpus because the root cause
  (regex over a command string) is shared.
- **OPEN** - The property fuzzer over `decideBash`/`jailPath`/
  `bashRedirectEscape`. Named as future work in the previous revision; it is the
  only defence that scales against unenumerated bypasses.
- **OPEN** - `fetch_url` has no SSRF guard: `fetchUrlText` validates the scheme
  and then follows redirects with no host policy `[V:
  pi-repo/packages/self-learning/src/tools.ts:343-369]`. This was §5 item 6 in the
  previous revision and is still open. It is also the exfiltration channel §4.4
  warns about, so it should be treated as a security item, not a robustness one.
- **OPEN** - TUI-level behaviour (resume, `/reload` state reconstruction, subagent
  progress rendering) is only covered at the process level today.

### 7.4 LLM bridge

*(was §4.4; surface: `mini-services/llm-bridge/index.ts`)*

- **SHIPPED** - 95 unit tests over the extracted pure module: routing, tool-call
  sanitisation, thinking resolution, retry classification, backoff and spacing
  math, SSE parse stats.
- **OPEN** - Contract test against a real OpenAI SDK client pointed at the bridge
  (the failure mode that matters is "a strict client rejects our response", not
  "our own parser accepts our own response").
- **OPEN** - Load and cancellation: concurrent spacing (inter-request upstream
  starts >= `BRIDGE_MIN_SPACING_MS`), a 100-request burst, a client-disconnect
  storm (no socket leak), and 429 injection with backoff.
- **OPEN** - `BRIDGE_UPSTREAM_TIMEOUT_MS` bounds headers only; the body stream is
  uncapped by design. Add a slow-trickling-body test so the intent is pinned
  rather than accidental.
- **OPEN** - `/health` probes upstream on every call while
  `mini-services/llm-bridge/AGENTS.md` describes a 30 s cache. That drift was
  §5 item 10 in the previous revision; it is a doc-vs-code mismatch of exactly the
  kind §14.2 #9 exists to catch. Either cache it or correct the doc - decide, do
  not leave it.

### 7.5 Sandbox and OS isolation

*(was §4.5; surface: `sandbox.ts`, `bwrap.ts`)*

- **SHIPPED** - `bwrap_smoke.sh` (25 checks) and `verify_sandbox.mjs` (12
  checks); both are wired into CI as the unconditional ubuntu `sandbox-smoke`
  job (upstream M4) - no `paths:` filter, at the cost of ~1 min per run.
- **PARTIALLY VALIDATED IN CI** - the red `afd962b` run (10 pass / 11 fail /
  1 skip, launcher dies on every check) found a real test-design trap: the
  "passes" were the fail-closed assertions (write `/etc` blocked, TCP blocked)
  that cannot tell "blocked as designed" from "the launcher is dead".
  `ae7b01b` shipped both fixes this record named, and run 39071373372 proves
  them where they mattered: the profile suite went from 10/11/1 to
  **21 pass / 0 fail / 1 skip** after the sysctl. The job still fails one step
  later, which is itself diagnostic: `verify_sandbox.mjs` reports
  10 pass / 2 fail - `execInSandbox` works (isolation=bwrap, exit-code
  propagation passes) but "bun runs inside sandbox" and the
  `verifyInSandbox` isolation self-test fail. Engine-level sandbox
  integration on the runner was the next concrete fix, and `a13cf9d` (round
  two) addresses it: `bwrap.ts` runtime-binds the bun exec dir back into the
  sandbox (runners mask `~/.bun`, so sandboxed `bun run` died
  command-not-found); `runtimeBindArgs` is now unit-tested for
  masked/unmasked/inert. **Validated in CI**: run 39072290887 shows the
  `sandbox-smoke` job fully green (both steps) for the first time in the
  series.
- **OPEN** - Adopt the vendor's boundary framing as a written contract
  (§4.4 `[C]`): state which surface each isolation layer covers, state that the
  terminal agent is *outside* the OS sandbox by design, and state the rule that
  unattended runs (engine, router jobs, `--plan`-less dashboard triggers) run
  inside bwrap while interactive terminal sessions do not. Fail closed on
  unavailable bwrap for the unattended path, as the vendor configuration does,
  rather than degrading silently.
- **OPEN** - Configuration-based escape corpus (env overrides, bind-map
  overrides, `--unshare` toggles, `LD_PRELOAD`, host socket reuse) and an FD/stdio
  leakage check asserting no host descriptor survives into the sandbox.
- **OPEN** - Resource ceilings: a run that writes GBs must not fill the host.
  bwrap's `--size` plus a disk budget, with the tradeoff documented.

### 7.6 Memory system and eval integrity

*(new; extends the previous §4.6 memory items and the §10 A-C eval list)*

- **SHIPPED** - four-tier resolution and precedence; per-tier size caps; the hard
  sum budget on the injected block (`PI_MEMORY_TOTAL_CHARS`, oldest-first
  degradation); provenance in the block; SQLite-authoritative writes with atomic
  materialisation and self-healing reads; the deterministic guard; K-sampled
  canaries; live injection proof by unique marker in the captured upstream
  request; a 10-case obfuscation ladder with 10/10 flagged, 0 planted, 0 shipped.
- **OPEN, highest value in this section** - **contradiction and staleness**
  tests. Ship two memories that conflict; assert the precedence rule decides, that
  the loser is not injected as an active directive, and that `changed_by`
  provenance makes the winner auditable. Then supersede a rule and assert the
  obsolete text is not still presented as current.
- **OPEN** - **forgetting / interference under accumulation**. Drive the tier to
  its cap with low-value rules and assert the retention policy degrades in the
  documented order and that task success does not regress versus an empty tier.
  The field reports this as the unsolved axis `[C: §4.1]`; it is the axis where a
  versioned, rollback-capable memory should be measurably better, and right now
  Unown has no measurement at all.
- **OPEN** - **full-context baseline at matched token budget** for the
  repeat-task suites: cold vs warm vs "everything inline in the prompt". Without
  it, "warm costs +36% tokens for 6/6" (Track 5 v3) cannot be read as a win - it
  is only a win against a baseline that is equally correct and equally cheap.
- **OPEN** - **judge calibration for every graded number** (§10 item L).
- **OPEN** - **regime labelling**: each memory claim states whether the history
  fits in context. Per §4.1 finding 4, this determines what the number means.

### 7.7 Security cross-cutting

*(was §4.6)*

- **SHIPPED** - gitleaks full-history scan, `bun audit --prod` with documented
  ignores, 149-test adversarial hook corpus, the deterministic dream guard, and
  the poison corpus.
- **OPEN** - **Tool-channel injection and exfiltration** (§4.4 `[C:
  arXiv 2509.05755]`). The current corpus tests injection arriving through
  repository files. Untested: injection split across a tool *description* and a
  tool *return*, and exfiltration by asking the agent to echo its system prompt
  or injected memory block into a `fetch_url` call. Unown's channels are
  `fetch_url` output, subagent returns, skill bodies, notes and the memory block
  itself - each is attacker-reachable if a repository, note or skill contains it.
- **OPEN** - **Tool-result poisoning** specifically: `fetch_url` returns remote
  content as tool output, which is the highest-value injection surface in an
  agent that reads documentation. Assert that hostile content in a fetched page
  does not change tool policy, and that the injected memory block's delimiters
  cannot be closed by fetched content.
- **OPEN** - Path jail under adversarial filesystem conditions: TOCTOU (write
  then swap), `/proc/self/root`, Unicode NFC/NFD filename equivalence,
  case-insensitive filesystems.
- **OPEN** - `~/.unown` permissions are asserted to be 0700 and provider keys
  0600 in a test, not just in prose.
- **OPEN** - Host-header and bind-address assertion: the engine binds loopback and
  refuses remote connections unless configured. The boot banner prints
  `http://127.0.0.1:${server.port}` `[V: pi-repo/packages/self-learning/src/server.ts:392]`;
  the test should assert the socket, not the banner.
- **OPEN** - Availability: many slow SSE clients, large `fetch_url` bodies, and
  the agent watchdog actually aborting a hanging tool call.

### 7.8 Data integrity and migration

*(was §4.7)*

- **SHIPPED** - atomic memory materialisation with self-healing reads (this was
  §5 item 7 of the previous revision and is now closed).
- **OPEN** - Migration idempotency across versions, including an upgrade path from
  a pre-`notes.kind`, pre-`improvements.memory_version` database.
- **OPEN** - A boundary test that the legacy `src/lib/db.ts` Prisma scaffold can
  never become the engine's store (it is dead by design; a test makes that
  durable rather than aspirational).
- **OPEN** - Session artifact schema snapshots (`runs/*.meta.json`, `files.json`).
- **OPEN** - `fd` presence: its absence breaks the `find` tool at runtime and ten
  upstream tests, and `unown doctor` does not report it (previous §5 item 9, still
  open).

### 7.9 Performance and cost

*(was §4.8)*

- **OPEN** - Per-task token and cost budgets with an alert when a memory version
  increases prompt tokens by >20% *without* a measurable accuracy gain. Prompt
  bloat is the characteristic failure of a self-improving system, and Unown's own
  Track 5 v3 already shows a +36% token cost for real memory - which is exactly
  the number this budget exists to interpret.
- **OPEN** - Series, not points: persist per-run records so p50/p95 tokens, cost,
  cycles/hour, busy-mutex 409 rate and SSE-invalidations-per-event are all
  trendable. The previous revision asked for this and it is still the cheapest
  missing capability.
- **OPEN** - Dashboard invalidation thrash measurement (renders per SSE event,
  query dedup, `staleTime` behaviour).
- **OPEN** - A 1000-run soak on a tmp filesystem: SQLite growth, sandbox GC
  (cap 40), handle leaks.
- **OPEN** - Cold start: engine boot plus orphan recovery under 5 s; dashboard
  first paint.

### 7.10 Usability, docs and published claims

*(was §4.9, extended)*

- **OPEN** - Automated cross-check that every command and flag in `docs/usage.md`
  and `docs/configuration.md` exists in `cli.ts` HELP, and that every documented
  env var exists in `.env.example`. This is the `docs-drift` class, mechanised.
- **OPEN** - **Claim provenance**: every number printed on the landing page or in
  the README must resolve to a receipt under `benchmarks/**/results/`. A checker
  that fails when a published statistic has no matching receipt is worth more
  than any additional unit test, because the published numbers are the product.
- **SHIPPED (this revision)** - Docs link integrity and anchor correctness as a
  runnable gate: `scripts/check_docs.mjs` implements the `docs/AGENTS.md` rules
  (CRLF-aware heading scan, GitHub slug rule including the double-hyphen case,
  cross-file anchors, and the bare-label link-corruption rule with `AGENTS.md`
  exempt — the rule and its grep are in `docs/AGENTS.md` §Verification) and runs
  as the `docs` CI job. `bun run check:docs` runs it locally.
- **OPEN** - The remaining prose-only rules in `docs/AGENTS.md`: commands and
  flags named in the docs must exist in `cli.ts` HELP, env vars in
  `configuration.md` must exist in `.env.example`, and troubleshooting symptoms
  must match real error strings. Those are greppable and belong in the same
  script.
- **OPEN** - Error-message quality: a persona script (new user, clean
  `UNOWN_HOME`) from `unown setup` to a first successful headless run, asserting
  each failure message names the documented fix.

## 8. Verifier integrity

**The finding.** Unown benchmarks an agent inside a tree that the agent can
write to, using graders, corpora and gate scripts that live in that same tree.
The terminal write jail is the project root `[V:
pi-repo/packages/self-learning/src/hooks.ts:186 - jailPath resolves against the
session cwd with realpath hardening, and accepts any path inside it]`. Nothing in
the jail excludes `benchmarks/`, `scripts/`, `pi-repo/`, `.github/` or the poison
corpus `[V]`. AutoDream writes `<project>/.unown/memory/project.md`, dream-minted
skills write `<project>/.unown/skills/**`, and terminal sessions can write anywhere
under the project `[V:
pi-repo/packages/self-learning/src/skills.ts, termhooks.ts]`. So the measured
system and the measuring apparatus share one writable namespace.

**Why it matters, concretely.** The failure is not that an attack is *trying* to
cheat; it is that a *correct* loop can be scored by its own homework. Three
plausible, non-malicious paths already exist:

1. A run's notes feed the dreamer; the dreamer writes memory into the project; a
   later benchmark of the same project inherits memory shaped by earlier
   benchmark runs. Track 5's "warm" arm measures a system that has seen the cold
   arm's traces - intended - but a *stray* note from an unrelated task would
   silently join the same tier with no marker distinguishing it.
2. The agent edits the file that grades it. Polyglot restores pristine tests and
   long-horizon scores a diff, so both are defended; the engine's own seeded
   verify scripts are sha256-pinned, so that is defended too. But the
   *corpus definition files* (`subset.json`, the poison ladder, reference
   solutions) have no pin.
3. A skill minted from a dream lands in `.unown/skills/` and is auto-discovered by
   every later session in that project - including the sessions that are supposed
   to be measuring the cold arm.

**What the field does** `[C]`: compute reward in an environment the agent cannot
mutate; destroy the agent's environment before verification; hand the verifier
only declared bytes; audit passing trials for reward hacks automatically and by
hand; and re-derive task suites when a task turns out to be easy to hack or
broken.

**Required work** (ordered; the first two are days, not weeks):

1. **Classify every path by owner.** Three classes, written down: *harness-owned*
   (agent-read-only: `benchmarks/**`, `scripts/**`, `.github/workflows/**`,
   `pi-repo/**`, `docs/**` and every `AGENTS.md` contract), *state*
   (agent-writable: `.unown/**`, `data/**`, source files), *evidence*
   (append-only: everything under `benchmarks/**/results/`,
   `benchmarks/snapshots/`). This classification is the deliverable; the
   enforcement options are below.
2. **Enforcement (DECISION - needs an owner call).** Option A: extend the write
   policy so harness-owned globs are refused for agent-initiated writes, the same
   way system paths are refused today (strongest; a real policy change, and it
   must not break the terminal agent's legitimate work inside `pi-repo/`).
   Option B: CI diff-check - any change under a harness-owned path must come from
   a commit that also touches the corpus manifest (a detector, not a defence).
   Option C: runners execute from a pristine copy of the corpus outside the
   project tree. Recommendation: **A + C**. B alone is a detector in a tree the
   agent can write, which is the definition of a weak control.
3. **Corpus checksum manifest.** `benchmarks/manifest.json` lists every pinned
   input - subset files, poison-corpus cases, reference solutions, verify scripts,
   prompt templates - with a sha256. Runners verify before and after a run and fail
   on drift. Cheap, deterministic, and it also catches accidental human edits to a
   pinned corpus.
4. **Reward-hack triage in the runner.** After a passing trial, automatically
   flag runs that (a) modified any graded file, (b) scored highly with zero test
   edits on a task whose difficulty is supposed to require them, or (c) contain a
   disabled/skipped assertion. Flagged runs go to a human-readable report, not to
   the pass count.
5. **Reference-solution certification per graded task.** Every task whose score
   is a pass/fail must have a committed solution that passes its grader in a clean
   environment. Long-horizon already has this (the committed reference refactor);
   extend it to the selfimprove fixtures and any future eval.
6. **Transcript reading as a ritual.** Read N transcripts per suite run and
   classify each failure as agent mistake or grader mistake before fixing
   anything. The CORE-Bench 42% -> 95% episode is the argument: the bug was in the
   grader, and no amount of re-running would have found it.
7. **Publish the boundary.** If a metric is produced by a system the agent can
   modify, the landing page says so. The alternative - discovering that a
   published number was self-graded - costs the credibility the whole portfolio
   was built to earn.

## 9. Measurement standards

Unchanged from the previous revision and still binding: never mix pass@1 and
pass@2; pin subset + commit, harness version, model ids, prompt template,
snapshot date; ship receipts (JSONL plus session logs); pair every accuracy
number with tokens, wall time and dollars; report `pass@k` (capability) and
`pass^k` (reliability) separately with the correct estimator; report 95% CIs and
say what the width is at the achieved n; tag runnable-here versus quoted.

Added:

- **Name the judge.** Every LLM-graded number states the judge model, the rubric
  (or prompt) version, and whether it is binary or scored. A graded number
  without a judge id is not reproducible and is not publishable.
- **Measure the judge's false-positive rate.** A fixed-seed adversarial probe:
  N known-wrong outputs, scored by the judge, reported as an FPR. This is
  standard practice in the memory field `[C: §4.1]` and costs one cheap run per
  rubric. Require FPR < 5% before any judge-graded number is published.
- **Boolean rubrics over scales.** "Did the agent verify the id before acting?"
  rather than "how careful was it, 1-5" `[C: §4.2]`. Unown's canary already
  produces boolean verdicts; dream-quality grading should follow.
- **Freeze the golden set.** No case is deleted because it is noisy - deleting it
  moves the baseline, not the agent `[C: §4.2]`. Retiring a case requires the
  requirement it tested to have changed, recorded in the same commit.
- **Per-metric regression gate.** An aggregate that holds while one core metric
  regresses is a regression `[C: §4.2]`. Store per-metric series and gate on the
  core set, not the mean.
- **Determinism controls.** Record and replay: the live suites
  (`memory-live`, `memory-poison`, `vlm-smoke`) currently require a real bridge,
  which is why they can never run in CI. A record/replay fixture mode (a
  local recording proxy that serves a captured upstream transcript, the same
  technique the live memory suite already uses for request capture) would make
  them hermetic and free. Until then, say so: those suites are weekly, not
  per-PR.
- **No PR gate on a single stochastic eval.** Batch model-backed evals and gate
  on the trend; keep the fast deterministic layer as the per-PR gate `[C:
  §4.2]`.

Coverage and correctness targets, restated so they are checkable:

| Target | Status |
|---|---|
| Changed `src/` lines >= 80% covered | SHIPPED (gate 9); measured baseline 91.1% lines |
| Engine + bridge coverage >= 60% lines | OPEN - no measurement exists; Bun can produce it today |
| Every new HTTP endpoint gets an integration test in the same PR | OPEN - enforced by review, not by tooling |
| Adversarial corpus green or an explicit accepted-risk comment | OPEN - comment convention not adopted |
| Performance budgets ratchet downward only by explicit decision | OPEN - no budget file yet |

## 10. Differentiator evals

Tracks 1-9 live in `benchmarks/README.md` and are not duplicated here. What
follows is the testing-strategy view: what each eval must prove to be publishable,
plus the items the previous revision left open.

- **A. Memory lift (Track 5).** SHIPPED as repeat-task efficiency, extended to
  the v3 project-continuity arm (real / control / unrelated-domain arms). OPEN:
  the **full-context baseline at matched token budget** (§7.6) without which the
  +36% token cost for real memory cannot be called a win, and the regime label.
- **B. Skill acquisition.** OPEN. Assert a minted skill is valid frontmatter,
  then measure transfer: fewer tool calls or tokens with the skill present on a
  task it was not minted from, and that rollback restores prior behaviour. A
  skill that is minted and never reused is a minting bug; a skill that is reused
  without a measurable gain is an extraction-quality bug.
- **C. Dream canary correctness.** SHIPPED (canary + K-sampling + claim-vs-ground
  truth analysis). OPEN: the negative arms - inject a regression and assert
  `gated` plus memory rollback to v-1; inject an empty LLM output and assert
  `error` with no partial write.
- **D. Hook adversarial benchmark.** SHIPPED as a labelled corpus with tracked
  recall/precision. OPEN: the fuzzer, and the shell-quoting/clobber families
  (§7.3).
- **E. Router reliability under load.** OPEN: mutex, punctuality within +-30 s of
  the configured interval accounting for busy, error isolation, and the specific
  regression - next_run advances and busy clears when a job throws.
- **F. Mint graduation.** OPEN: a minted capability task that passes baseline
  graduates to regression; one that fails stays capability; failure count before
  mint is capped; active minted count respects `UNOWN_MAX_MINTED_TASKS`.
- **G. Recovery and concurrency.** OPEN: engine restart mid-run, two concurrent
  TUI sessions, outbox race, dream write during an active run. All must leave
  memory versions monotonic and valid.
- **H. Model routing.** SHIPPED in the bridge's pure-module tests (unknown id ->
  default, thinking policy per family, tool-call round-trip). OPEN: an end-to-end
  routing assertion through a live run.
- **I. VLM.** Image-understanding half SHIPPED (env-gated, receipt + caveats).
  OPEN: screenshot-to-code, which is the half that a user actually feels.
- **J. Long-horizon refactor (Track 8).** SHIPPED at n=1 (all three models pass;
  cost is the differentiator). OPEN: turn the point into a curve - the same task
  at 2/7/15-minute caps plus one harder task, scored pass/fail per point, so a
  slope exists; and add a contract checklist grade alongside the diff score,
  because a fixed test suite systematically overstates capability when the
  requirements in the prompt are not covered by the tests `[C: §4.3, TestJack]`.
- **K. Contamination-aware headline (Track 7).** SHIPPED.
- **L. Judge calibration (NEW).** Every graded number gets a judge id, a rubric
  version, and an FPR probe with a fixed seed. Until this exists, dream-quality
  and canary-quality numbers are internal signals, not published evidence.
- **M. Memory-quality axes (NEW).** ~~Contradiction, staleness, forgetting and
  interference under accumulation, each with a task-level assertion rather than a
  score (§7.6).~~ **SHIPPED** (benchmarks/memory-eval/quality-axes/): 4/4 axes
  PASS on the production dream path with deterministic line-classification
  receipts (no judge), 0 guard FPs. Report against the field's published
  weakness on these axes `[C: §4.1]` - carefully, since those are other
  people's numbers and their harnesses, so the comparison is directional
  context, not a leaderboard row.
- **N. Claim provenance (NEW).** A checker that every published statistic resolves
  to a receipt (§7.10).

## 11. Roadmap

Re-prioritised by (risk x cheapness) against the state in §3, not by the original
phase structure. Phases 0-3 of the previous revision are done; the ordering below
is what remains.

**Now (days).**

1. ~~Close the measured cross-platform residue.~~ **CLOSED for the
   import-order/ENOENT class (round three, this session)** — the
   `bunfig.toml` preload + up-front redirect-root materialization + gated
   live-suite env claims are shipped with local receipts (five consecutive
   clean-`/tmp` runs at 736/0/37, the exact condition that produced the
   ubuntu `memory.test.ts:60` receipt; macOS env guards share the root
   cause). The predicted "one-line fix" turned out to be three small
   changes — the tripwire was the symptom, not the defect. **REMAINS
   OPEN:** the Windows path-semantics residue (canary rollback + F4
   live-pinned + raw-device twin, §7.2) — needs a Windows receipt, not a
   Linux guess.
2. ~~Wire the bridge suite (95, sub-second) into CI.~~ **DONE** — dedicated
   `bridge` job (checkout + setup-bun + `bun test pure.test.ts`; no
   install, no network).
3. Corpus checksum manifest + runner verification (§8.3), and the owner decision on
   write containment (§8.2). This is the only P0 in the document that is about the
   integrity of published numbers rather than about catching bugs.
4. Judge id + rubric + FPR probe for the graded numbers (§10 item L). Cheap, and it
   is the difference between a measurement and an opinion.
5. Re-measure the full Track 1 pipeline on the Linux box post-merge and
   reconcile `benchmarks/README.md`, `RESULTS.md` (§3.1).
6. Extend `check_docs.mjs` to the prose-only rules: commands in the docs exist in
   `cli.ts` HELP, env vars in `configuration.md` exist in `.env.example`.

**Next (one to two weeks).**

7. `bun run build` into CI.
8. Docs-drift checks: README/landing numbers to receipts (§7.10).
9. Property-based tests for `decideBash` / `jailPath` /
   `bashRedirectEscape` / budget arithmetic - property testing is also the
   structural fix for the Windows path-semantics failures, not just a hardening
   item.
10. The engine self-suite release assertion: ~10 fixtures that must pass on a
    clean checkout with pinned snapshots, run per release.

**Then (weeks).**

11. Playwright E2E + axe-core for the dashboard - the largest untouched surface.
12. Memory-quality axes: contradiction, staleness, forgetting, interference
    (§7.6, §10 item M). **SHIPPED** — `benchmarks/memory-eval/quality-axes/`
    (4/4 PASS, deterministic receipts); and the external-corpus poisoning
    statistics landed as `benchmarks/memory-eval/mpbench/` (MPBench-adapted,
    50+20 live cases — found and forced the fix for the ADV_1590
    security-bypass gap).
13. Full-context baseline for the repeat-task suites.
14. Long-horizon task ladder + contract grade.
15. Tool-channel injection and exfiltration corpus; the SSRF/redirect guard for
    `fetch_url`.
16. Live-vs-plan differential arm, using the shipped `--plan` mode (§4.2).
17. Fault injection: bridge down, process kill mid-run, disk/permission denial.
18. Perf/cost budget file with per-metric series; the +20%-without-gain alert.
19. Soak test (1000 runs, tmp filesystem).

**Deferred with a reason.** Playwright E2E + axe-core is no longer deferred — it
is the next gate (§6 gate 16). Load/chaos for the bridge (needs a stable mock
upstream first); 99th-percentile time horizons (METR notes these need ~300
diverse tasks per bucket `[C]` - out of reach at this repo's size).

## 12. Success criteria

The previous revision listed seven conditions for "proves its mettle". As of
2026-10-18 **none is fully met: four are partial and three are not met at all.**
Stating that is the point.

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | CI enforces lint + typecheck + unit + security scan | **PARTIAL** | All dashboard gates ship green (including coverage + docs; `sandbox-smoke` too at run 39072290887). The engine suite is wired in the 3-OS matrix but red on all three legs at that run (ubuntu one fixture-ordering bug `memory.test.ts:60`, windows 3, macos 3, §7.2) and the bridge suite (95) is still absent (§6 gates 10-13) |
| 2 | The harness self-suite is green on a clean checkout with pinned snapshots | **NOT MET** | The seeded suite exists; no release assertion runs it (§7.2) |
| 3 | Hook deny recall >= 99% on the adversarial corpus, every miss triaged | **PARTIAL** | Corpus and triage exist; recall is not published as a number per run, and the fuzzer is absent (§7.3) |
| 4 | Memory lift shows a statistically significant improvement for a shipped memory version, with CI | **NOT MET** | Track 5 v3 is n=1 and 6/6 everywhere - saturated, therefore uninformative. Needs the full-context baseline and repetitions (§7.6, §10 item A) |
| 5 | No P0 open: sandbox escape, secret leak, test tampering, hook bypass | **PARTIAL** | The named P0s are covered by shipped suites. Uncovered: the self-grading surface (§8) and `fetch_url` SSRF (§7.3) |
| 6 | axe-core clean and Lighthouse accessibility >= 90 on all nine tabs | **PARTIAL** | axe-core half SHIPPED: the `e2e` CI job scans the landing page + all nine tabs (wcag2/21 A+AA) against real rendered data and fails on any violation — green after fixing the 80+ contrast defects + 1 aria violation its first run found (§6 gate 16). Lighthouse >= 90 half still OPEN (next: LHCI collect against the same mock-engine pair) |
| 7 | Cost/token budget tracked, no >20% regression without a decision | **PARTIAL** | Per-run tokens are recorded; no budget, no alert, no decision record (§7.9) |

Criteria 2, 4 and 6 are the ones that would most change what this repository can
claim. None of them is expensive; all three have been open since the previous
revision, which is precisely the drift this revision exists to stop.

## 13. Out of scope

- Re-running or replacing the vendored pi monorepo's own suite. It protects
  upstream; Unown consumes it via Track 1. We add around it.
- Self-running SWE-bench Verified, Terminal-Bench, Commit0 or SWE-Marathon. Docker
  (and, for the native Terminal-Bench path, KVM) does not exist in the documented
  deployment environment. Quote official boards with links and dates, as Warp
  does.
- Load-testing the upstream model endpoint. Out of our control; test the bridge's
  behaviour against a mock and record upstream incidents.
- Running the competing memory benchmarks (LoCoMo, LongMemEval, BEAM). They measure
  conversational memory retrieval, not a coding harness's tiered behavioural
  memory; the transferable content is their *methodology* (§4.1), which this page
  adopts, and citing their numbers as context rather than entering their
  leaderboard.
- 99th-percentile time horizons: ~300 diverse tasks per bucket `[C: §4.3]`.
- Localising `docs/`; no i18n.

## 14. Operating the portfolio

### 14.1 Cadence

- **Pre-commit / local**: pure unit + hook corpus + coverage on changed files
  (<2 min, $0).
- **Per PR**: lint, typecheck, dashboard unit, coverage gate, docs gate,
  changed-path security scan; engine suite wired inside the 3-OS `build-test`
  matrix (ubuntu leg green, win/mac red - §7.2); bridge + integration suites
  once wired.
- **Nightly**: dashboard E2E + axe, perf and cost trend, soak.
- **Weekly**: adversarial corpus rerun, live memory and poison probes, VLM
  review, memory-lift and skill-acquisition evals.
- **Release**: full benchmark matrix, harness self-suite, sandbox escape corpus,
  model-routing verification, red-team replay, transcript review.

Persist every result as schema-versioned JSON/JSONL with a date. The value is the
series; a flat pass rate is uninformative.

### 14.2 Failure taxonomy

Classify before fixing; the label is part of the run record.

1. **infra** - bridge/engine down, bwrap unavailable, catalog drift, disk/perm.
   Fix infra; never let it masquerade as capability.
2. **model-capability** - stable failure across runs and memory versions.
   Candidate for harder task minting or model routing.
3. **harness-orchestration** - watchdog fired, verify marker missing, test tamper,
   the agent asked to edit tests. Fix the harness; often a security finding.
4. **memory-quality** - cold/warm gap is negative, a rule is verbose or
   unverifiable, a dream shipped without its gate. Tighten mining; verify the
   gate is on the path that shipped.
5. **hook-overblocking** - legitimate flow denied. Relax with a corpus case; the
   false-positive rate is a product signal, not just a test metric.
6. **hook-underblocking** - red-team bypass. P0 by default: patch, add to the
   corpus, fuzz.
7. **sandbox-limit** - time/size/network constraint killed a legitimate task. Tune
   knowingly; never a silent bigger sandbox.
8. **ui/ux** - tab-switch cost, invalidation thrash, a11y violation, broken copy.
9. **docs-drift** - help text, config docs or published numbers disagree with the
   code. Automate the cross-check.
10. **cost-regression** - tokens or dollars per task up >20% without an accuracy
    gain. Audit prompt and memory bloat.
11. **grader-integrity** (new) - the failure was in the measurement, not the
    agent: a broken task, a lenient judge, a tampered fixture, a corpus that
    drifted from its manifest. Handle per §8: reproduce, audit, fix the grader,
    and re-issue any number the grader touched.

### 14.3 From failure to improvement

1. **Reproduce deterministically** - pin model id and snapshot date, task, subset
   file, harness version, toolchains. Re-run only after isolation.
2. **Reduce** - capture session JSONL, transcript, hook log, dream note, memory
   version diff. Write the minimal failing case as a test.
3. **Bisect memory versions** - the same task cold, then at each shipped version.
   A flip that explains the failure names the suspect patch. This is Unown's
   structural advantage; use it before reaching for a code fix.
4. **Classify** per §14.2, then act: add a regression task if the harness should
   have solved it, a capability task if it is genuinely new; add hook or sandbox
   findings to the corpus and the fuzz target; run the memory-consolidation judge
   for memory findings.
5. **Verify twice** (candidate + confirmation, the existing noise gate) before
   shipping an improvement. Prefer retention auto-unship to human-only review.
   Record lift against baseline in the same commit.
6. **Update the docs in the same change** - README numbers, troubleshooting,
   AGENTS.md, and this page's status tags. Stale numbers in a self-improving
   system's own documentation are the most corrosive drift there is.

### 14.4 Guardrails

- Separate capability claims from regression claims. Never quote the self-suite as
  if it were SWE-bench.
- Keep an unseen hold-out (10% of polyglot, one unseen task cluster) that the
  miner and dreamer never see. Hold-out drift is the canary for overfitting.
- Keep a kill switch: a run with `UNOWN_NO_PREFLIGHT=1` and pinned versions can
  reproduce any historical result. If reproduction fails, the changelog is suspect.
- Attribute every improvement to an evidence ID or run; `.unown` memory versions
  already carry `changed_by` - extend that to eval reports.
- When in doubt, roll back the memory patch and fix the harness. "The model got
  worse" is usually "the test or the hook got worse".

---

*Method: tree inspection of `src/`, `pi-repo/packages/self-learning/`,
`mini-services/llm-bridge/`, `.github/workflows/ci.yml`, `scripts/`, and
`benchmarks/`; reproduced commands (`bun test src`, `bun test src --coverage`,
`bun test pure.test.ts`, and post-merge `bun test test/` on Windows, Appendix A);
receipts under `benchmarks/**/results/` and `benchmarks/snapshots/`; upstream CI
evidence collected from the GitHub Actions API (runs list, jobs, logs) at
2026-10-18; external sources listed in Appendix A, captured 2026-10-18.
In-repo claims are tagged `[V]` with a `file:line`, a run id, or a receipt;
external claims are `[C]` and carry the publisher's incentive.*

## Appendix A: sources

External sources, all captured 2026-10-18. `[C]` throughout: none of these were
re-derived by us, and several are published by parties with a commercial interest
in the number they report.

**Agent evaluation practice**

- Anthropic, "Demystifying evals for AI agents" (2026-01-09):
  https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Google, "The Anatomy of Harness Engineering" (2026-09-09):
  https://developers.googleblog.com/en/the-anatomy-of-harness-engineering-how-to-evaluate-iterate-and-guard-ai-coding-agents/
- Google Cloud, "Four eval engineering lessons" (2026-10-16):
  https://cloud.google.com/blog/topics/developers-practitioners/four-eval-engineering-lessons
- Google, "Evaluating AI agents: moving past the vibe check" (2026-10-15):
  https://developers.googleblog.com/en/evaluating-ai-agents-moving-past-the-vibe-check/
- METR, "Measuring AI Ability to Complete Long Software Tasks" (arXiv 2503.14499):
  https://arxiv.org/html/2503.14499v3
- METR, "Time Horizon 1.1" (2026-01-29):
  https://metr.org/blog/2026-01-29-time-horizon-1-1/
- METR, "Impact of modeling assumptions on time horizon results" (2026-03-20):
  https://metr.org/notes/2026-03-20-impact-of-modelling-assumptions-on-time-horizon-results/
- METR, "Clarifying limitations of time horizon" (2026-01-22):
  https://metr.org/notes/2026-01-22-time-horizon-limitations/
- TestJack, "Should you trust the results in coding benchmarks?" (arXiv 2610.10619):
  https://arxiv.org/html/2610.10619
- Rishi Desai, "Designing eval harnesses that prevent reward hacking" (2026-05-13):
  https://www.rishidesai.org/posts/task-design/
- "Engineering Reliable Coding Agents: Evaluating and Operating the System Around
  the Model" (arXiv 2608.13867): https://arxiv.org/abs/2608.13867

**Agent memory: benchmarks and their audits**

- Mem0, "How to Read Memory Benchmarks":
  https://mem0.ai/library/agent-memory/how-to-read-memory-benchmarks
- Mem0, "AI Memory Benchmarks in 2026":
  https://mem0.ai/library/agent-memory/ai-memory-benchmarks-in-2026
- "Memory Benchmark Transparency: Why LongMemEval and LOCOMO Numbers Don't
  Compare" (2026-04-24): https://agentos.sh/blog/memory-benchmark-transparency-audit/
- Maximem, "State of AI Memory 2026: claimed vs observed":
  https://www.maximem.ai/blog/state-of-ai-memory-2026-claimed-vs-observed
- Digital Applied, "Open-Source Agent Memory: Mem0 vs Letta vs Zep":
  https://www.digitalapplied.com/blog/open-source-agent-memory-mem0-letta-zep-compared
- "The agent-memory benchmark landscape": https://nlqdb.com/agent-memory-benchmarks/
- LoCoMo (arXiv 2402.17753) · LongMemEval (arXiv 2410.10813) · DMR (arXiv
  2310.08560) · Zep (arXiv 2501.13956) · Mem0 (arXiv 2504.19413)

**Agent and coding-agent security**

- "Red-Teaming Coding Agents from a Tool-Invocation Perspective" (arXiv
  2509.05755): https://arxiv.org/html/2509.05755v5
- "Your Harness is Not Secure: Benchmarking Real-world Threat of CLI Agents"
  (arXiv 2510.06607): https://arxiv.org/abs/2510.06607
- Claude Code command injection and sandbox escape (CVE-2026-24887,
  CVE-2026-24053): https://blindcyber.com/2026/02/08/claude-code-command-injection-sandbox-escape/
- Claude Code, "Choose a sandbox environment":
  https://code.claude.com/docs/en/sandbox-environments
- Anthropic, "Making Claude Code more secure and autonomous with sandboxing"
  (2025-10-20): https://www.anthropic.com/engineering/claude-code-sandboxing
- containers/bubblewrap: https://github.com/containers/bubblewrap
- OWASP Top 10 for LLM Applications:
  https://owasp.org/projects/top-10-for-large-language-model-applications
- OWASP AI Agent Security Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- Promptfoo agent red-teaming: https://www.promptfoo.dev/docs/red-team/agents/
- AgentThreatBench: https://ukgovernmentbeis.github.io/inspect_evals/evals/safeguards/agent_threat_bench/
- Persistent memory poisoning (Forcepoint):
  https://www.forcepoint.com/blog/x-labs/persistent-memory-poisoning-ai-agents
- MPBench (arXiv 2606.04329): https://arxiv.org/html/2606.04329v1

**Evaluation statistics** (carried forward from the previous revision)

- Anthropic, "A statistical approach to model evals":
  https://www.anthropic.com/research/statistical-approach-to-model-evals
- pass@k versus pass^k for agent reliability:
  https://www.philschmid.de/agents-pass-at-k-pass-power-k
- Efficient evaluation of LLM performance with statistical guarantees (arXiv
  2601.20251): https://www.alphaxiv.org/abs/2601.20251

**Frontend testing and runtime**

- Playwright accessibility testing: https://playwright.dev/docs/accessibility-testing
- Property-based testing with the Bun test runner (fast-check):
  https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-bun-test-runner/
- Zustand testing guide: https://zustand.docs.pmnd.rs/learn/guides/testing.html
- SQLite WAL mode: https://www.sqlite.org/wal.html

**Repository-internal sources for this page**

- `benchmarks/README.md` (tracks and measurement rules) · `benchmarks/RESULTS.md`
  (receipts) · `benchmarks/snapshots/track1-rerun-2026-10-17/summary.json` (the
  pre-merge Linux receipt: 5,342 pass / 0 fail / 13 skip) ·
  `docs/benchmark-research.md` (benchmark selection and fairness rules) ·
  `docs/memory-system-review.md` (findings F1-F10) ·
  `docs/AGENTS.md` (the page contract this record must satisfy) ·
  `scripts/AGENTS.md` (sandbox and asset pipelines) ·
  `.github/workflows/ci.yml` (the gate ledger's source).

**CI and platform receipts (2026-10-18)**

- Upstream CI run 39069143075 (push to `main`, commit `afd962b`,
  2026-10-17T21:01Z): `Build + test (ubuntu-latest)` success; `Build + test
  (windows-latest)` and `Build + test (macos-latest)` failed at the
  "Self-learning engine tests" step; `Sandbox smoke (bwrap profile)` failed
  (10 pass / 11 fail / 1 skip, every launcher-dependent check failing on
  `exit=1`). Run 39070679749 (commit `888c8fa`, the merge of it) failed the
  same way - the red state reproduced through the merge, not caused by it.
  Evidence via the GitHub Actions API (runs, jobs, step logs):
  https://github.com/kanishka-namdeo/Unown/actions/runs/39069143075
- Fix `ae7b01b` (2026-10-17T21:32Z): platform-aware fixture roots, win32-
  gated corpora, macOS `SYSTEM_TREE` `/private/` allowlist fix, `sandbox-smoke`
  sysctl pre-step + early userns canary in `bwrap_smoke.sh`.
- Upstream CI run 39071373372 (commit `5f35339`, includes `ae7b01b`;
  completed 2026-10-17T21:3x): `build-test` - ubuntu green (733 pass / 37
  skip / 0 fail of 770), windows red (687/79/3 of 769: 2x `jailPath`
  diagnostics, 1x win32 `bashRedirectEscape` raw-device twin), macos red
  (726/40/4 of 770: 3x env-guard self-tests, 1x `bashRedirectEscape`
  absolute redirect); `sandbox-smoke` - `bwrap_smoke.sh` now green (21 pass /
  0 fail / 1 skip, from 10/11/1), `verify_sandbox.mjs` red (10 pass / 2 fail:
  "bun runs inside sandbox", "verifyInSandbox passes isolation self-test");
  every dashboard gate green (lint, typecheck, unit, coverage, docs, theme,
  palette, security). So: sysctl fix validated, engine-at-CI residue real.
  https://github.com/kanishka-namdeo/Unown/actions/runs/39071373372
- Round two `a13cf9d` (2026-10-17T21:45Z, "sandbox runtime-bind + realpath
  hardening - first 3-OS CI findings, round two"): bwrap runtime-binds the
  bun exec dir (targets the 2 `verify_sandbox.mjs` failures), hooks'
  realpathAncestor joins via `node:path` (the `//`-prefix dodged macOS deny
  regexes), `bashRedirectEscape` tests the raw win32 redirect target, DATA_DIR
  tripwires realpath'd. CI run 39072290887 (completed 2026-10-17T21:4x):
  `sandbox-smoke` fully GREEN (both steps - first time in the series); engine
  legs: ubuntu 735/37/**1** of 773 (fixture-ordering ENOENT introduced by this
  commit), macos 729/41/**3**, windows 689/80/**3**. Local Windows
  post-`a13cf9d`: 604 pass / 80 skip / 23 fail of 707 (two CLI-golden
  subprocess cases + the raw twin went green vs `5f35339`).
- Local Windows comparison (2026-10-18, identical result on bun 1.4.2 and
  CI-pinned 1.4.3 - not a bun-version delta): `bun test test/` collects 704
  tests across 20 files: 600 pass / 79 skip / 25 fail. Against the pre-fix
  state (702 collected, 603/35/64 at `888c8fa`): the fixture fix converted
  the failure families into skips (35 -> 79) and into runner-green (the
  canary + CLI-golden families fail locally but pass on the runner, i.e.
  they are local privilege-environment failures - Windows symlink creation
  rights etc.), leaving 3 shared-real failures.
- Other local receipts (2026-10-18, Windows): `bun test src` 206 pass /
  0 fail; `bun test pure.test.ts` 95 pass / 0 fail; `node
  scripts/check_coverage.mjs --run` and `node scripts/check_docs.mjs
  docs/*.md` both green (the latter validating the merged `docs/windows.md`
  and `docs/macos.md` pages).

**Related pages:** [benchmark-research.md](benchmark-research.md) (which public
benchmarks to run and the fairness rules), [memory-system-review.md](memory-system-review.md)
(the memory subsystem's own review), [landing-research.md](landing-research.md)
(the sourcing rules behind every published claim), [configuration.md](configuration.md)
and [troubleshooting.md](troubleshooting.md) (the surfaces this page's gates
protect).
