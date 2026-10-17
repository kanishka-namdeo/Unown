# Unown on the Aider polyglot benchmark (50-exercise subset) — fresh-checkout verification rerun (2026-10-17)

- Harness: Unown agent headless (`unown -p`) via the bundled llm-bridge, 2 attempts with test-failure feedback (Aider protocol)
- Subset: 50 exercises, stratified proportionally to the official 225 mix, alphabetical evenly-spaced (deterministic) — pinned at 7e0611e77b
- Scoring: canonical per-language test commands, pristine test files restored before scoring; `.meta/` reference solutions never shown to the agent
- Models via Dashscope (coding-intl), agent default settings (qwen thinking disabled by the bridge for snappy turns)
- Captured: 2026-10-17T10:06:13.726Z — same protocol as the committed 2026-10-16 run (../RESULTS.md), re-run from a fresh clone with fresh `UNOWN_HOME` per model; committed receipts untouched

**Reproduction vs committed:** pass@1 matches the committed run EXACTLY on
all three models (47/50 · 48/50 · 48/50). The attempt-2 rescues that lifted
pass@2 to 49/98% and 50/100% in the committed run did not land this time —
every rescue is a one-shot agent retry on a failed cpp exercise, and cpp
remains the weak language either way (3–4/6 fresh vs 4→5-6/6 committed).
Token totals and wall times are within normal serving variance.

| Model | pass@1 | pass@2 | tokens in/out | avg s/exercise |
|---|---|---|---|---|
| kimi-k2.5 | 47/50 (94%) | 47/50 (94%) | 726,488 / 112,559 | 70s |
| qwen3.6-plus | 48/50 (96%) | 48/50 (96%) | 5,100,984 / 94,512 | 49s |
| qwen3.7-plus | 48/50 (96%) | 48/50 (96%) | 1,381,800 / 121,379 | 65s |

## Per-language pass rates (pass@1 → pass@2)

| Model | python | javascript | cpp | go | java | rust |
|---|---|---|---|---|---|---|
| kimi-k2.5 | 8→8/8 | 11→11/11 | 3→3/6 | 9→9/9 | 10→10/10 | 6→6/6 |
| qwen3.6-plus | 8→8/8 | 11→11/11 | 4→4/6 | 9→9/9 | 10→10/10 | 6→6/6 |
| qwen3.7-plus | 8→8/8 | 11→11/11 | 4→4/6 | 9→9/9 | 10→10/10 | 6→6/6 |

Context (official Aider leaderboard, full 225 exercises, Aider's own harness — NOT comparable rows, same benchmark family): gpt-5 88.0%, claude-opus-4 72.0%, Kimi K2 59.1%, Qwen3 32B 40.0%. No kimi-k2.5 / qwen3.7-plus / qwen3.6-plus polyglot rows existed when this was captured.
