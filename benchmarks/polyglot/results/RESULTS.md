# Unown on the Aider polyglot benchmark (50-exercise subset)

- Harness: Unown agent headless (`unown -p`) via the bundled llm-bridge, 2 attempts with test-failure feedback (Aider protocol)
- Subset: 50 exercises, stratified proportionally to the official 225 mix, alphabetical evenly-spaced (deterministic) — pinned at 7e0611e77b
- Scoring: canonical per-language test commands, pristine test files restored before scoring; `.meta/` reference solutions never shown to the agent
- Models via Dashscope (coding-intl), agent default settings (qwen thinking disabled by the bridge for snappy turns)
- Captured: 2026-10-21T19:43:39.864Z

| Model | pass@1 | pass@2 | tokens in/out | avg s/exercise |
|---|---|---|---|---|
| agnes-3.0-flash | 45/50 (90%) | 48/50 (96%) | 2,098,461 / 325,499 | 117s |

## Per-language pass rates (pass@1 → pass@2)

| Model | python | javascript | cpp | go | java | rust |
|---|---|---|---|---|---|---|
| agnes-3.0-flash | 8→8/8 | 10→11/11 | 4→4/6 | 8→9/9 | 10→10/10 | 5→6/6 |

Context (official Aider leaderboard, full 225 exercises, Aider's own harness — NOT comparable rows, same benchmark family): gpt-5 88.0%, claude-opus-4 72.0%, Kimi K2 59.1%, Qwen3 32B 40.0%. No kimi-k2.5 / qwen3.7-plus / qwen3.6-plus polyglot rows existed when this was captured.

## 2026-10-21 — agnes-3.0-flash (Agnes AI upstream, same protocol)

50 exercises, 2 attempts (attempt 2 receives the attempt-1 test-failure
output), same pinned subset + test commands + anti-tamper rules; the model
routed through the llm-bridge onto `apihub.agnes-ai.com/v1`. Receipt:
`results/agnes-3.0-flash.jsonl` (55 attempt records), summary row in
`results/summary.json`.

| Metric | agnes-3.0-flash | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus |
|---|---|---|---|---|
| pass@1 | **90%** (45/50) | 94% | 96% | 96% |
| pass@2 | **96%** (48/50) | 98% | 98% | 100% |

Per-language pass@1: python 8/8 · javascript 10/11 · C++ 4/6 · go 8/9 ·
java 10/10 · rust 5/6 (attempt-2 recoveries: one C++ and one rust). Inside
the family band of the three committed models, 4-6pp below the leaders on
both metrics; the two hardest C++ exercises (zebra-puzzle class) remain
unsolved at n=2 — same class as the other models' misses.

Honest caveats: n=1 per attempt, single run; different upstream (Agnes AI
vs Dashscope) is a serving-stack variable; 3 workers on a shared 2-CPU box
(the committed runs used 3 workers on a larger box).
