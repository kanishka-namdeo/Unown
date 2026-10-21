# HumanEval+ (evalplus) — results

Model-level (non-agentic) codegen sanity through the same llm-bridge the
agent uses — included as a **model-tier reference column only**; it does not
measure the agent.

- Harness: official `evalplus` CLI (v0.3.x) — `sanitize` → `evaluate`,
  greedy decoding (temperature 0), one sample per problem, 164 problems
  (HumanEval+ extends HumanEval's tests ~80×).
- Headline = **pass@1 on sanitized samples** (the official protocol: code
  extracted from fenced blocks, imports hoisted, sanitized before scoring).
  The raw-extraction pass@1 is reported as a robustness check — identical
  numbers mean the extraction is not doing hidden work.
- Generation receipts (tokens, latencies, truncations) in
  `results/<model>/samples.jsonl`; per-problem outcomes in
  `results/<model>/samples-sanitized.eval_results.json`.

## pass@1 (greedy, 164 problems)

| Model | HumanEval+ | HumanEval (base) | raw-extraction | gen failures | truncated |
|---|---|---|---|---|---|
| qwen3.6-plus | **93.9%** (154/164) | 98.8% (162/164) | 93.9% | 0 | 0 |
| kimi-k2.5 | 93.3% (153/164) | 97.0% (159/164) | 93.3% | 0 | 4 |
| qwen3.7-plus | 93.3% (153/164) | 97.6% (160/164) | 93.3% | 0 | 0 |

Sanity context (official evalplus leaderboard, leaderboard-grade models with
tuned decoding, not bridge-greedy): GPT-5 ≈ 90-92% HumanEval+; Claude Sonnet
4.5 ≈ 88-90%. The three bridge models sit in the same tier at greedy
decoding — consistent with their tier, and a useful cross-check that the
bridge + provider path is not degrading codegen quality.

Run date 2026-10-16 via `run-eval.sh` (per-model logs in `logs/`). Two
evaluations were initially OOM-killed while a 9-agent benchmark marathon ran
concurrently (documented in the worklog); they were re-run cleanly at
`--parallel=1` after the marathon drained — identical protocol, results
above.

## 2026-10-21 — agnes-3.0-flash (Agnes AI upstream)

Added **agnes-3.0-flash** (Agnes AI `https://apihub.agnes-ai.com/v1`) to the
model-tier reference column, through the same local llm-bridge (:3031) the
agent uses. Identical protocol to the 2026-10-16 run above: official evalplus
chat instruction, greedy decoding (temperature 0, top_p 1, max_tokens 2048,
n=1), `gen-samples.mjs` → official `evalplus.sanitize` → `evalplus.evaluate`
(evalplus 0.4.0.dev44, pinned dataset `HumanEvalPlus-v0.1.10`, hash
`fe585eb4…`, `--parallel=1` on the shared 2-CPU box).

| Model | HumanEval+ | HumanEval (base) | raw-extraction | gen failures | truncated |
|---|---|---|---|---|---|
| agnes-3.0-flash | **89.0%** (146/164) | 93.3% (153/164) | 89.0% | 0 | 1 |

- Receipts in two layouts, independently evaluated: base
  `results/agnes-3.0-flash/` and `results/rerun-2026-10-21/agnes-3.0-flash/`
  (same samples.jsonl, md5-verified, two separate official evaluate runs) —
  all four `*_eval_results`/`*.eval_results` files agree exactly.
- Raw-extraction equals sanitized (89.0%): fence-stripping does no hidden
  work; the official sanitizer touched 29/164 solutions (import hoisting
  etc.).
- Failure profile: 11 base failures; 7 more pass base but fail on the ~80×
  extended plus tests (18 plus failures total: HumanEval/32, 39, 62, 76, 91,
  92, 95, 102, 116, 124, 127, 129, 132, 141, 145, 151, 154, 163). The one
  truncated generation (HumanEval/129, `finish_reason=length` at
  max_tokens=2048) is among the base failures.
- Generation receipts (`results/agnes-3.0-flash/samples.jsonl`, 164 lines):
  164/164 problems, 0 provider failures, 0 retries (attempts=1 everywhere),
  1 truncation, Σ latency 1498 s (mean 9.1 s/problem), 39.0k prompt /
  48.2k completion tokens; full generation + eval logs in
  `/home/z/my-project/logs/evalplus/` (workspace logs, outside the repo tree).
- Summaries refreshed: base `results/summary.json` + `results/table.md`
  (agnes row added, 2026-10-16 rows untouched) and
  `results/rerun-2026-10-21/summary.json` + `table.md` (same shape as
  `rerun-2026-10-17/`, agnes only).
- Caveats: greedy n=1 through a live bridge — the 2026-10-17 rerun showed
  ±1 problem (±0.6 pp) upstream serving variance for these models, so treat
  89.0% as having a ~±0.6 pp noise band; this is a model-tier reference
  number (not an agent measurement) and uses the evalplus chat-instruction
  prompt, not per-model tuned decoding, so it is not directly comparable to
  official leaderboard entries; the box was shared with the benchmark
  campaign (evaluator serialized at `--parallel=1` per the documented
  OOM-avoidance practice).
- Tier context: 4-5 pp below the other bridge models (93.3-93.9% HumanEval+)
  but within the GPT-5 / Claude Sonnet 4.5 leaderboard band (≈88-92%) —
  consistent with agnes-3.0-flash's role as the bridge fallback/vision lane.
