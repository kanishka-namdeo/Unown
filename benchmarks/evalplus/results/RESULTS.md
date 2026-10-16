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
