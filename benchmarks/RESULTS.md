# Unown benchmark results — master index

Every number below comes from a real run with receipts committed under
`benchmarks/` (per-task JSONL with tokens, durations and outcomes). Models
run through the bundled llm-bridge — the 2026-10-16 trio against Dashscope
(`kimi-k2.5` / `qwen3.7-plus` / `qwen3.6-plus`), and **`agnes-3.0-flash` against the
Agnes AI OpenAI-compatible endpoint** (`apihub.agnes-ai.com/v1`) in the
2026-10-21 re-run campaign, greedy decoding throughout. Methodology and
fairness rules: see `README.md`. Deep-dives per track: the `RESULTS.md`
inside each track's `results/` directory.

**Fresh-checkout verification (2026-10-17):** the whole stack was re-cloned,
re-configured and re-run from scratch — the pi-repo suite at 5,032 tests / 0
failing (4,585 documented + 384 new engine unit tests from the testing
strategy's Phase 1), HumanEval+ and the oh-my-pi edit benchmark re-run end to
end with fresh receipts under `<track>/results/rerun-2026-10-17/` (per-track
`RESULTS.md` there). Headline table shows the committed 2026-10-16 numbers;
the rerun reproduces them within the documented noise bands (evalplus ±1
problem per model; edit-bench kimi exact, qwens inside the n=1 flake band).
Landing-page consts carry the fresh numbers.

## Headline

| Track | What it measures | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus | agnes-3.0-flash (10-21) |
|---|---|---|---|---|---|
| [pi-repo test suite](#1-pi-repo-test-suite) | vendored monorepo health | 4,585 tests green (model-independent) | — | — | 7,812 green (10-21 rerun; suite grew, 0 fail) |
| [oh-my-pi edit benchmark](edit-bench/results/RESULTS.md) | surgical edit accuracy, 106 fixtures; fair A/B vs omp's own agent at n=3: identical best-of-3 scores, 2.4–5.4× fewer input tokens | **98.1%** | **99.1%** | **99.1%** | 97.2% (n=1) |
| [Aider polyglot subset](polyglot/results/RESULTS.md) | real coding accuracy, 50 hardest Exercism exercises, 6 languages, 2 attempts | 94% @1 / **98% @2** | 96% @1 / 98% @2 | 96% @1 / **100% @2** | 90% @1 / 96% @2 |
| [pi vitest-evals](evals/results/summary.json) | agent-loop behavior, pi's own eval suite | 3/3 green | 3/3 green | 3/3 green | 3/3 green |
| [Self-improvement lift](selfimprove/results/RESULTS.md) | repeat-task efficiency, cold vs warm memory | +21.8% in / **−35.1% time** | +23.2% in / +4.2% time | **−23.7% in** / −8.0% time | +197.1% in / **−25.5% time** |
| [HumanEval+ (evalplus)](evalplus/results/RESULTS.md) | model-tier codegen sanity (non-agentic) | 93.3% | 93.3% | **93.9%** | 89.0% |
| [LiveCodeBench v6](livecodebench/results/RESULTS.md) | contamination-aware model-tier headline, post-cutoff problems | 52% @1 | 38% @1 | 36% @1 | 28% @1 |
| [Long-horizon refactor](longhorizon/results/RESULTS.md) | multi-file contract change under a cap; cost separation | 245s · 43.5k in · 474k cache | 299s · 62.6k in · 841k cache | 291s · 1.2M in · 0 cache | 345s · 62k in · **1.07M cache** |
| Memory defenses ([poison](memory-eval/poison-corpus/results/RESULTS.md) · [pbench](memory-eval/mpbench/results/RESULTS.md) · [axes](memory-eval/quality-axes/results/RESULTS.md) · [recall](memory-eval/recall-qa/results/RESULTS.md)) | adversarial memory + QA recall | 10/10 flagged · 0 planted · 4/4 axes · +0.625 lift | | | 10/10 flagged · 0 planted (post-backstop) · 4/4 axes · +0.55 lift |
| Memory ops + retrieval + judge + failure modes ([ops](memory-eval/ops-accuracy/results/RESULTS.md) · [rank](memory-eval/retrieval-rank/results/RESULTS.md) · [judge](memory-eval/judge-calib/results/RESULTS.md) · [fm](memory-eval/failure-modes/results/RESULTS.md)) | SOTA memory-eval suite (2026-10-26) | | | | opsF1 0.992 (11/11) · rank r@5 1.00 onnx / 0.86 lexical · judge 20/20, FPR 0, flips 0/72 · 12/12 failure modes |

## The 2026-10-21 agnes-3.0-flash campaign

A full-stack re-run of every track on a **new upstream** (Agnes AI,
`agnes-3.0-flash` — a vision-capable model, which also re-validated the
bridge multimodal lane end to end). What it bought, beyond the rows above:

- **Track 1 grew to 7,812 passing / 0 failing** (fresh-checkout rerun on
  bun 1.4.3; the suite gained ~2,700 self-learning tests since 10-17) —
  and it caught a genuine vendored-tree regression (the overlay-scrim
  theme-init crash, fixed in the same push).
- **The memory defense chain has its first cross-model stress test**: the
  agnes dream run planted the verbatim poison directive where kimi planted
  nothing (layer-2 prompt resistance is model-dependent), and two
  quality-axes failed — findings that shipped as the zero-extraction
  quarantine contract + layer 2.5 echo backstop, after which the same
  suites read 0/10 planted and 4/4 axes with receipts.
- **Runner hardening that only a re-run exposes**: edit-bench's resume key,
  evalplus's summarize scan, the memory-eval suites' single-model layout,
  selfimprove's restart-from-zero phases, and the model allow-lists in the
  longhorizon/LCB runners — all fixed with receipts in this campaign's
  commits.
- Honest placement: agnes-3.0-flash sits 4–6pp under the Dashscope trio on
  the accuracy tracks (inside the GPT-5 / Sonnet-4.5 leaderboard band on
  HumanEval+), posts the strongest prompt-cache profile measured on the
  long-horizon track, and its memory-lift row is the most expensive warm
  arm yet measured — published as measured.

## 1. pi-repo test suite

`npm run test` across the vendored pi monorepo: **4,585 passing, 0 failing**
(after fixing 63 pre-existing failures that had three root causes — see
`README.md` Track 1: missing `fd` binary, model-catalog drift fixed by
pinning models.dev/OpenRouter snapshots contemporary with pi 0.84.3, and a
`getFileRevision` same-tick staleness bug that we fixed upstream-style with
a content digest). The suite is model-independent; it gates every change we
ship.

## 2. oh-my-pi typescript-edit-benchmark (106 fixtures)

Unown agent core on oh-my-pi's own byte-exact edit benchmark:
**kimi 104/106 (98.1%) · qwen3.7 105/106 (99.1%) · qwen3.6 105/106 (99.1%)**,
edit-call success 95.7–99.1%, zero timeouts. First published numbers for any
agent on this benchmark other than omp's own smoke runs (5/5).

**Fair A/B vs the omp agent itself (edit variant pinned to `replace`, full
106, identical fixtures/bridge/knobs):** n=1 showed parity within noise
(Unown 98.8% vs omp 97.8%); the n=3 variance pass (3 runs/task, 1,908
task-runs) settles it — **identical best-of-3 scores in every cell**
(kimi 106/106 both; qwen3.7 105/106 both; qwen3.6 105/106 both; the n=1
qwen3.6 gap was sampling noise — all 5 omp n=1 failures are 2-of-3 flaky
tasks). Unown's stack uses **2.4–5.4× fewer input tokens per task** at
best-run selection; omp's default `hashline` edit format drops to 71–80%
edit-call success (vs 90.7–100% for replace) and ~1.8× more input tokens
than its own replace runs. `multi-composite-multi-edit-007` fails 11 of 12
qwen task-runs across both agents — a model-level trap, not an agent
defect. Full tables + protocol deltas + receipts:
`edit-bench/results/RESULTS.md` (§ Fair A/B, § n=3 variance pass).

## 3. Aider polyglot subset (50 exercises, 6 languages)

50-exercise stratified subset of Aider-AI/polyglot-benchmark @7e0611e
(proportional per-language mix of the hardest Exercism practice problems —
the ones ≤3 of 7 reference models solved), full Unown agent in the loop,
Aider's 2-attempt protocol, anti-tamper scoring. **First published polyglot
numbers for kimi-k2.5 / qwen3.7-plus / qwen3.6-plus anywhere.**

| Model | pass@1 | pass@2 | python | javascript | cpp | go | java | rust |
|---|---|---|---|---|---|---|---|---|
| qwen3.6-plus | 48/50 (96%) | **50/50 (100%)** | 8/8 | 11/11 | 4→6/6 | 9/9 | 10/10 | 6/6 |
| qwen3.7-plus | 48/50 (96%) | 49/50 (98%) | 8/8 | 11/11 | 4→5/6 | 9/9 | 10/10 | 6/6 |
| kimi-k2.5 | 47/50 (94%) | 49/50 (98%) | 8/8 | 11/11 | 4→5/6 | 9/9 | 9→10/10 | 6/6 |

(cells are pass@1→pass@2 where they differ). Context (official Aider
leaderboard, full 225, their harness — not comparable rows): gpt-5 88.0%,
claude-opus-4 72.0%, Kimi K2 59.1%, Qwen3 32B 40.0%. Per-exercise receipts:
`polyglot/results/`.

Two harness bugs were found and fixed while running this, both documented in
the repo history: a disk-full window that starved builds (re-run clean), and
a cpp scoring bug that executed `CMakeCache.txt` as a test binary via the
kernel's ENOEXEC→/bin/sh fallback (now ELF-magic-checked — cpp went from
0/6 for every model to 4-6/6).

## 4. pi vitest-evals

pi's own behavioral eval suite (smoke tests + extension authoring) through a
real `AgentSession`, all 3 models × 3 evals: **9/9 green**. Honest note: the
extension-authoring judge scores 0.0 for every model and prompt variant —
authoring + reloading a pi extension mid-session is genuinely hard for this
model tier; we report it as-is rather than tuning the prompt until it passes.

## 5. Self-improvement lift (the differentiator, measured honestly)

Repeat-task efficiency: 10 Python tasks solved cold (fresh memory) and warm
(fresh workspace carrying only the dreamed memory). A v1 control with
auto-generated thin notes isolated the prompt-caching confound behind a
fake −25.6%; the published v2 numbers (agent-authored notes, per-task
dreamed-memory receipts) are: **qwen3.6 −23.7% input tokens & −8% wall
time; kimi +21.8% input & −35.1% wall time; qwen3.7 +23.2% input & +4.2%
wall time. 60/60 tasks passed across all six passes** — memory buys
efficiency (sometimes speed, sometimes tokens), not correctness on tasks
the model already solves. Full protocol + receipts:
`selfimprove/results/RESULTS.md`.

## 6. HumanEval+ via official evalplus (164 problems)

Model-tier sanity through the same bridge (labeled non-agentic): **qwen3.6
93.9% · kimi 93.3% · qwen3.7 93.3%** HumanEval+ pass@1 greedy (base
HumanEval: 98.8 / 97.0 / 97.6). Raw-extraction pass@1 identical to the
sanitized headline — extraction does no hidden work. Receipts:
`evalplus/results/RESULTS.md`.

## What we quote instead of self-run (and why)

SWE-bench Verified and Terminal-Bench require per-task Docker environments
(not available here); we cite their official leaderboards with capture dates
instead — the honest pattern other tool vendors use. Reference points
(2026-10, vendor-reported): Kimi K2.5 — SWE-bench Verified 76.8 / TB 2.0
50.8; Qwen3.7-Plus — SWE-bench Verified 77.7 / TB 2.0 70.3.


## The 2026-10-26 memory-eval SOTA round

Four new suites (research-driven — the LoCoMo/LongMemEval/MemoryAgentBench/
MEME/MemBench methodology landscape surveyed first), all run live on
agnes-3.0-flash through the production consolidate path, per-case receipts
committed:

- **ops-accuracy** — 11/11 cases, **opsF1 0.992** (gold-op × observed
  confusion matrix over the Mem0-paper ADD/UPDATE/DELETE/NOOP taxonomy +
  MEME Cascade/Deletion). The campaign measured and fixed a real
  extraction-loss defect (routine infrastructure facts dropped by the
  extraction LLM) — the `MEM0_CUSTOM_INSTRUCTIONS` anti-loss clause with a
  unit-test pin, the repo's established prompt-fix pattern.
- **retrieval-rank** — the platform's own search scored in isolation
  (recall@k/MRR, conflict preference, scope isolation) in two embedder
  arms: lexical r@5 0.864 → onnx **1.000** (the H10 recall-parity gap,
  measured), isolation clean on both arms. Shared finding: the search
  layer prefers the OLD side of a conflict pair (5/6 on onnx) — recency is
  guarded only by the reconciler.
- **judge-calib** — the §10-L open item answered with a measurement:
  agreement 20/20, FPR 0/8, FNR 0/8, leniency 0/4 (strict), abstention
  correct both directions, run-to-run flips 0/72, order sensitivity 0/6.
- **failure-modes** — the competitor-research doc's twelve documented
  failure modes pinned as measured regressions: **12/12 PASS**, with four
  recorded findings inside the passing receipts (reconcile variance on
  contradiction pairs — 1 miss in 3 runs; the fm-07 load-scan coverage gap;
  the raw-import dedup gap; the scanner false-positive surface that can
  silently consume a quarantined benign note).

Per-suite RESULTS.md files carry the full honest-limitations sections; the
scratch engines ran the real `startServer()` (fm-02 concurrency + fm-08
dead-bridge recovery are real process-level receipts, not mocks).

## The 2026-10-26/27 long-run endurance round

Eleven scenarios in [`longrun/`](longrun/README.md) — the duration axis
(METR's time-horizon finding), research-grounded per lane (the bench README
carries the grounding table with links) — all run live on agnes-3.0-flash
through the shared bridge (the metered ~20 RPM upstream is part of the
stress), one run resumed and extended across two sessions, machine receipts
committed per scenario:

- **marathon** — one 150-turn session, ten staged features: **9/10**
  features, exit 0 with `capped: true` + `capped_answer_recovered: true`,
  agent RSS slope bounded — the miss is a genuine agent defect the
  acceptance suite caught (CSV-import skip warnings on stdout; spec says
  stderr).
- **compact-thrash** — 40k window + tightened reserves: **13 mid-run
  compactions** across **256 turns**, 7/7 scored features (01–06 + the
  store), exit 0, session parses — the LR-2 five-layer fix under thrash.
- **kill-resume** — SIGKILL at three staged gates (205 s / 165 s / 325 s),
  the same session resumed every time: session file valid at every leg, **0
  orphan survivors** per kill, final leg exit 0, **8/9 acceptance** (bar
  ≥ 5/8).
- **loop-guard** — impossible read-only lure + `--max-tool-repetitions 6`:
  contract exit 0 at 30 turns, `capped: true`, no hang — the guard honest.
- **turn-cap** — `--max-turns 8`: **exactly 8 turns in 17 s**, exit 0,
  `capped: true`, the partial answer recovered (LR-1's exit contract).
- **notes-storm** — engine DOWN, six real terminal sessions: outbox peak
  **6 → 0 drained**, **0 dead letters**, 0 note loss, the dream lane
  consolidated.
- **budget-fidelity** — the governed dream lane, three engines: engine A
  (`PI_ENGINE_MAX_CALLS_HOUR=3`) ran seeded-note dreams to **callsHour 3/3 —
  `budget:throttled`**; engine B (dead bridge) drove the breaker to backoff
  ("2 consecutive LLM failures, retry in 22s"); engine C (live bridge)
  recovered the dream lane with **overBudget=false** under the same
  governor.
- **engine-soak** — 75 minutes with all four learning lanes on and a
  terminal session every 5 min (8/8 ran): **23 runs + 9 dreams** of
  autonomous self-improvement, engine ready throughout, fd drift 2,
  WAL ≤ 0.67 MB, graceful shutdown, RSS slope **+28.8 MB/h ≤ the 30 MB/h
  budget** over the settled tail. Honest nuance, recorded from the
  receipts: the tail grows with WORK, not time — ~+30 MB over 63 minutes
  of continuous learning (wave-stepped ~1–2 MB per run/dream; the parked
  idle baseline is flat at +7 MB/h), and the k6-canonical 8-hour
  extension stays the next round's open knob (`--soak-minutes`).
- **ralph-chain** — the unattended worker/reviewer loop: contract exit,
  ralph state present, no crash artifacts, and the loop ran to the
  reviewer's explicit **"ship"** verdict (622 s; the final iteration's
  worker 87.5k in / 30.8k out tokens, reviewer 29 turns, exit 0).
- **crash-consistency** — 5 random-offset SIGKILLs (95/100/60/80/75 s) with
  a torn half-written record injected after each kill, the same session
  `--resume`d every time: valid-line count grew monotonically
  30→73→90→113→148→**308**, every corrupt line was one the bench itself
  injected (foreign corruption — the claude-code#52387 class — is what the
  check catches), **0 orphan survivors** at every kill, **5/5 features**
  (bar ≥ 2/5), final leg exit 0.
- **idle-soak** — the learning lanes parked state-aware (the receipt's
  `learningParked` proves all four sat disabled with `run_count` 0 while
  housekeeping kept running — watch-scan 9×, note-sync 3×, sandbox-gc 1×),
  zero terminal traffic for 20 min: idle RSS slope **+7.0 MB/h** (budget
  15), fd drift 1, WAL quiet, engine ready throughout.

The round's defects are part of its record: LR-1 (the `--max-turns` cap's
contradictory messages + the unreachable answer-so-far contract), the LR-2
five-layer chain (terminal mid-exchange auto-compact), and ten runner
fixes the runs themselves surfaced — the engine-boot token poll, the
kill-resume verdict math ("killed is not capped"), the ralph-chain store
prerequisite, the budget-fidelity dream lane, a kill-before-collect
deadlock in the runner's own collector, engine-soak's blind jobs toggle
(the endpoint is a flip and jobs default ON) plus its never-freed session
slot, crash-consistency's torn-record check that contradicted the
lane's own injection design (every torn line must be the bench's own
injected fragment — settled torn lines stay tolerated mid-file forever),
both soak lanes' slope math that read 1000x hot (a per-second delta
scaled by the milliseconds in an hour, with a warmup window that ended
before the first housekeeping wave — whose one-time worker-pool step read
as a phantom leak), and idle-soak's self-driving learning: boot defaults
enable every job, and an "idle" engine measured live self-ran a full
harness cycle with real bridge spend — the lane now parks the learning
jobs state-aware and the receipt proves they sat disabled, never ran.
Honest limitations live in the bench README: one model, one OS, one
2 CPU / 4 GB box; the lane default is 45 minutes and the shipped
engine-soak receipt ran the 75-minute window (`--soak-minutes` — the
verdict math is duration-independent).

## The 2026-10-29 validation round (the cold-start mission)

The Memory & Learning System Validation Programme as a round: a fresh
clone, a fresh engine DB, and the tracked `.unown/memory/project.md` (v12,
79 bullets) as the only carried-over learning — the deployment every new
contributor experiences. Receipts in [`validation-round/`](validation-round/README.md)
(snapshot driver + baseline/midpoint/final JSON receipts + the per-session
UX ledger + the failure ledger); narrative in
`docs/validation-round-session.md`; the mission's four reports in `docs/`.
Method: drain-before-snapshot, cold-start discipline (no DB restore),
with/without baselines for every improvement claim, cost columns on every
figure, zero LLM calls in collection.

- **Baseline** (`snapshots/baseline-20261028-202136.json`, drained) —
  6 tasks / 3 passing at capture, 3 autonomous cycles (all
  `already-passing` under agnes-3.0-flash), 2 autonomous dreams (engine
  project tier v1 → v3; entries added 4+4, pruned 4+0), 9 runs (9/9
  passed), 9 notes, terminal memory v12 / 79 bullets / 0 staged skills.
  The engine's first minutes with zero operator input are themselves the
  autonomy receipt: the loop ran because it was scheduled, not because a
  button was pressed.
- **Midpoint / final** (`snapshots/midpoint-20261028-210755.json`,
  `snapshots/final-20261028-212306.json`, both drained) — the trajectory:
  cycles 3 → 7 (all `already-passing` — the no-junk-mining contract), dreams
  2 → 12 (34 notes consolidated; the swap-boundary legacy import + the
  corrective-note repair), runs 9 → 29 (27/29 — both failures defenses
  firing: the canary claim-mismatch rollback and the mint self-check
  discard), engine project tier v3 → v10, terminal memory v12/79 → v4/73
  (the F2 erosion + the three-deep restoration). The repeat-task receipt:
  V3 cold (30 turns capped, partial) vs V4 warm (9 turns, complete) —
  −70% turns / −70% wall / −66% output tokens. The four mission reports:
  `docs/learning-system-validation-report.md`,
  `docs/memory-effectiveness-report.md`,
  `docs/learning-progress-report.md`,
  `docs/end-user-experience-report.md`.

## The 2026-10-30 delegation round — baseline

The subagent-orchestration round's before/after benchmark, run live against
the real agent (bridge → Agnes, engine notes/dreams on the production path):
ten delegation-inviting lanes with byte-pinned prompts, scored on the
mission's ten axes by a read-only scorer over committed receipts
(`delegation-round/README.md` is the methodology contract; the honest
limitations — n=1 per lane, heuristic handoff scoring, author-scored rubric
axes — are binding).

- **Baseline: v0.0.45 scores 76/100** (`delegation-round/RESULTS.md` carries
  the full table): delegation quality 86 (handoff 84%, 7/8 spawns ok) ·
  subagent reuse **0** (no steer/resume event ever happened) · context
  efficiency 93 (caveat: inflated by the runaway's 596k-token burn) · user
  explainability **56** (`why` on 0/8 spawns) · progress visibility **55**
  (TUI widget proven by pane receipt; headless stream shows nothing) · memory
  utilisation 100 · learning retention 70 (post-workload dream consolidated,
  v3→4) · failure recovery 100 (2/2 injected) · autonomous decision quality
  100 (7/7) · human intervention rate 100 (9/9).
- **The flagship product failure was caught live (F26)**: a runaway scout —
  104 turns, 596k input tokens, 111 tool calls, killed only by the 300 s
  wall clock (the Claude Code #106025 shape: no turn cap, no token budget,
  no loop guard on children). Six further failures (F27–F33, product +
  harness) are reproduced in `delegation-round/validation-log.md`.
- The after-run (checkpoint 5 of `docs/delegation-round-session.md`) re-scores
  the identical workload on the round's build with `--compare`.

## The 2026-10-31 settings-ux round — the BEFORE baseline

The Settings Evolution round's Phase-9 lane (M2): seven PTY-driven
benchmarks (BM-1..BM-7) measuring first-configuration time, find-and-change
success, search hit-rate, IA depth, recovery-path reachability, six-question
coverage and the trust gates — scripted-driver methodology with pane-truth
receipts (`settings-ux/README.md` is the contract; the honest limits are
binding: machine timings compare BEFORE/AFTER, never human labs).

- **BEFORE (v0.0.50, `settings-ux/RESULTS.md`)**: the round-1 hub holds its
  core promises — BM-1 five-minute test **PASS** (5.7s, 5 steps), BM-2
  **5/5** reachable changes (disk + ledger verified), BM-5 **5/5** recovery
  paths, BM-6 **6/6** mission questions, BM-7 audit + typed-confirmation
  gate green. The measured debts: **32 pi-selector rows unreachable from
  the TUI** (S2-1, machine-counted; the setup wizard still tells users
  `/settings` switches themes — false since the override), search hit-rate
  **8/12** (the 4 misses are S2-1 ×2, S2-11, S2-4), settable coverage
  **10/89 (11.2%)**, browse depth mean 9.6 Downs.
- The AFTER run (M5) re-measures the identical pinned workload on the
  round's build; the DELTA table lands in `settings-ux/RESULTS.md`.
