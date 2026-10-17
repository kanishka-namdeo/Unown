# HumanEval+ (evalplus) — fresh-checkout verification rerun (2026-10-17)

Same protocol as the committed 2026-10-16 run (../RESULTS.md): official
`evalplus` CLI — `sanitize` → `evaluate`, greedy decoding, one sample per
problem, 164 problems, through the bundled llm-bridge. This pass re-ran
everything from a **fresh clone** to verify the track reproduces: generation
(gen-samples.mjs), official sanitize + evaluate (evalplus master
`0.4.0.dev44` — the committed `--output_file` flag needs master, not the
0.3.1 PyPI release), and summarize, all writing into this directory
(`RESULTS_ROOT`), leaving the committed receipts untouched.

## pass@1 (greedy, 164 problems) — 2026-10-17

| Model | HumanEval+ | HumanEval (base) | raw-extraction | gen failures | truncated |
|---|---|---|---|---|---|
| kimi-k2.5 | **93.9%** (154/164) | 97.6% (160/164) | 93.9% | 0 | 4 |
| qwen3.6-plus | 93.3% (153/164) | 98.2% (161/164) | 93.3% | 0 | 0 |
| qwen3.7-plus | 92.7% (152/164) | 98.2% (161/164) | 92.7% | 0 | 0 |

Committed 2026-10-16: 93.3 / 93.9 / 93.3. Every model moved by at most one
problem (±0.6 pp) — consistent with greedy decoding through a live bridge on
a paid plan endpoint (upstream serving variance, not harness drift).
Raw-extraction still equals sanitized for all three models: the extraction
does no hidden work. 492 generations, 0 failures, 2 retried requests (the
kimi HumanEval/26 stall during an llm-bridge hot-reload window — see the
worklog; the bridge now runs production-mode, no `--hot`).

Generation receipts: `<model>/samples.jsonl` (tokens, latency, finish reason,
attempts per problem). Official evaluator output:
`<model>/samples-sanitized.eval_results.json` (+ raw
`samples.eval_results.json`). Summary: `summary.json` / `table.md`.

Run order: kimi gen (164) → eval; qwen3.7 gen (resume after an OOM-killed
first pass during a concurrent vitest run) → eval; qwen3.6 gen → eval —
serialized, `EVALPLUS_PARALLEL=1` for the evaluator (the documented
OOM-avoidance practice; the 2026-10-16 run used the same knob after its own
OOM incident).
