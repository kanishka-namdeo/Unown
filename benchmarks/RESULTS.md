# Unown benchmark results — master index

Every number below comes from a real run with receipts committed under
`benchmarks/` (per-task JSONL with tokens, durations and outcomes). Models
run through the bundled llm-bridge against Dashscope
(`kimi-k2.5` / `qwen3.7-plus` / `qwen3.6-plus`), greedy decoding, 2026-10-16.
Methodology and fairness rules: see `README.md`. Deep-dives per track: the
`RESULTS.md` inside each track's `results/` directory.

## Headline

| Track | What it measures | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus |
|---|---|---|---|---|
| [pi-repo test suite](#1-pi-repo-test-suite) | vendored monorepo health | 4,585 tests green (model-independent) | — | — |
| [oh-my-pi edit benchmark](edit-bench/results/RESULTS.md) | surgical edit accuracy, 106 fixtures; fair A/B vs omp's own agent at n=3: identical best-of-3 scores, 2.4–5.4× fewer input tokens | **98.1%** | **99.1%** | **99.1%** |
| [Aider polyglot subset](polyglot/results/RESULTS.md) | real coding accuracy, 50 hardest Exercism exercises, 6 languages, 2 attempts | 94% @1 / **98% @2** | 96% @1 / 98% @2 | 96% @1 / **100% @2** |
| [pi vitest-evals](evals/results/summary.json) | agent-loop behavior, pi's own eval suite | 3/3 green | 3/3 green | 3/3 green |
| [Self-improvement lift](selfimprove/results/RESULTS.md) | repeat-task efficiency, cold vs warm memory | +21.8% in / **−35.1% time** | +23.2% in / +4.2% time | **−23.7% in** / −8.0% time |
| [HumanEval+ (evalplus)](evalplus/results/RESULTS.md) | model-tier codegen sanity (non-agentic) | 93.3% | 93.3% | **93.9%** |

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
