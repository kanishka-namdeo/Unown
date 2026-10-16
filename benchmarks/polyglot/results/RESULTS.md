# Unown on the Aider polyglot benchmark (50-exercise subset)

- Harness: Unown agent headless (`unown -p`) via the bundled llm-bridge, 2 attempts with test-failure feedback (Aider protocol)
- Subset: 50 exercises, stratified proportionally to the official 225 mix, alphabetical evenly-spaced (deterministic) — pinned at 7e0611e77b
- Scoring: canonical per-language test commands, pristine test files restored before scoring; `.meta/` reference solutions never shown to the agent
- Models via Dashscope (coding-intl), agent default settings (qwen thinking disabled by the bridge for snappy turns)
- Captured: 2026-10-16T16:20:22.971Z

| Model | pass@1 | pass@2 | tokens in/out | avg s/exercise |
|---|---|---|---|---|
| kimi-k2.5 | 47/50 (94%) | 49/50 (98%) | 692,304 / 131,023 | 112s |
| qwen3.6-plus | 48/50 (96%) | 50/50 (100%) | 4,467,704 / 99,677 | 73s |
| qwen3.7-plus | 48/50 (96%) | 49/50 (98%) | 1,106,516 / 98,886 | 78s |

## Per-language pass rates (pass@1 → pass@2)

| Model | python | javascript | cpp | go | java | rust |
|---|---|---|---|---|---|---|
| kimi-k2.5 | 8→8/8 | 11→11/11 | 4→5/6 | 9→9/9 | 9→10/10 | 6→6/6 |
| qwen3.6-plus | 8→8/8 | 11→11/11 | 4→6/6 | 9→9/9 | 10→10/10 | 6→6/6 |
| qwen3.7-plus | 8→8/8 | 11→11/11 | 4→5/6 | 9→9/9 | 10→10/10 | 6→6/6 |

Context (official Aider leaderboard, full 225 exercises, Aider's own harness — NOT comparable rows, same benchmark family): gpt-5 88.0%, claude-opus-4 72.0%, Kimi K2 59.1%, Qwen3 32B 40.0%. No kimi-k2.5 / qwen3.7-plus / qwen3.6-plus polyglot rows existed when this was captured.
