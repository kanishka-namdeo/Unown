# Unown on oh-my-pi's typescript-edit-benchmark — full 106-fixture runs

Agent under test: **Unown pi-repo `createAgentSession`** (in-process, dist @
`/home/z/my-project/Unown/pi-repo/packages/coding-agent/dist`), driven by
`../run-unown.mjs` — a faithful port of omp's metaharness `adapters/edit`
runner semantics (same fixtures, same verify.ts scoring, same benchmark
system-prompt addendum, same retry ladder, early-stop-on-match).

- Provider: `zai-bridge` → http://127.0.0.1:3031/v1 (Unown llm-bridge)
- Agent dir: `../unown-eval-agent` (models.json with all 3 bridge models)
- Tools: `read`, `edit`, `write` only; pi-native **replace** edit semantics
  (`edits[]: {oldText,newText}` batch, exact-match-first, fuzzy fallback)
- Thinking off, max-turns 30, timeout 300 s, connection timeout 60 s,
  concurrency 4, 1 run per task, max-attempts 1
- Run date: 2026-10-16 (bridge :3031)

## Results

| Metric | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus |
|---|---|---|---|
| **Tasks passed (of 106)** | **104 (98.1%)** | **105 (99.1%)** | **105 (99.1%)** |
| Edit-call success | 95.7% (110/115) | 97.3% (108/111) | 99.1% (109/110) |
| Avg tokens/task prompt / completion | 3,238 / 508 | 2,974 / 423 | 2,854 / 405 |
| Median tokens/task (total) | 1,785 | 2,599 | 2,260 |
| p99 prompt tokens | 30,765 | 13,036 | 12,532 |
| Summed task duration | 27.9 min | 18.3 min | 19.2 min |
| Avg / median task duration | 15.8 s / 10.3 s | 10.4 s / 8.1 s | 10.9 s / 7.3 s |
| Mutation-intent match | 102/106 | 102/106 | 104/106 |
| Early stops on byte-match | 104 | 105 | 105 |
| Timeout / zero-tool / provider retries | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| easy / medium / hard / nightmare | 39/40, 30/31, 22/22, 13/13 | 40/40, 31/31, 21/22, 13/13 | 40/40, 31/31, 21/22, 13/13 |

Edit-failure categories (all 318 runs, 9 failed edit calls total):
overlap 2, not-unique 4, not-found 3 — every one recovered in-task.

## Failed tasks

- kimi-k2.5 `structural-duplicate-block-005` (easy): incomplete duplicate
  removal — left 2 stray lines (`});` residue) of the duplicated block.
- kimi-k2.5 `structural-remove-case-label-006` (medium): over-deletion —
  removed the required `case` label plus the similar `'thinking_level_change'`
  label.
- qwen3.7-plus AND qwen3.6-plus `multi-composite-multi-edit-007` (hard):
  over-application — fixed the target negation but also flipped two other
  lookalike `if (!entryRow)` sites to `if (entryRow)`. Same wrong edit by both
  qwen models on the same fixture.

All 4 failed runs had a *successful* edit call (1/1) — the edit arguments
were wrong (wrong content/scope), not the edit format.

## vs the omp smoke runs (6-d, hashline variant, same bridge/day)

| Same 5-task set | omp (hashline) | Unown (pi replace) |
|---|---|---|
| kimi-k2.5 | 5/5, edit-call 70% (10 calls), 2,876 in-tok/task, 45.7 s | 5/5, 100% (5 calls), 639 in-tok/task, 39.1 s |
| qwen3.7-plus | 5/5, 71.4% (7 calls), 2,855 in-tok/task, 37.7 s | 5/5, 83.3% (6 calls), 1,918 in-tok/task, 37.3 s |
| qwen3.6-plus | 5/5, 100% (5 calls), 1,941 in-tok/task, 27.8 s | 5/5, 100% (5 calls), 1,300 in-tok/task, 38.8 s |

Not apples-to-apples: omp ran its default **hashline** edit variant + its own
system prompt; Unown ran pi's **replace** edit + pi's system prompt (same
benchmark addendum both). A fair agent-core A/B needs omp with
`--edit-variant replace`.

## Layout

- `<model>/<model>.jsonl` — one record per task: {task, tier, difficultyScore,
  mutationType, mutationCategory, model, success, error, editCalls,
  editSuccesses, editFailureDetail, readCalls, writeCalls, tokens{prompt,
  completion, reasoning, total}, durationMs, indentScore,
  mutationIntentMatched, earlyStopped, retries, agentResponse, diffExcerpt}
- `<model>/summary.json` — aggregate metrics (also regenerated via
  `node run-unown.mjs --summarize`)
- `<model>/events/*.jsonl` — per-task agent event logs
- `<model>/dumps/<model>/<task>.md` — full conversation receipts
  (system prompt + every message/tool call/result)
- `<model>/workdirs/<task>/` — final file state per task

## Reproduce

```bash
cd /home/z/probes/omp-edit-bench
PI_CODING_AGENT_DIR=/home/z/probes/omp-edit-bench/unown-eval-agent \
  node --import ./openai-vendor-register.mjs run-unown.mjs --model <id> [--tasks id] [--summarize]
```

(The `--import ./openai-vendor-register.mjs` hook redirects bare `openai`
imports from pi-repo's dist to `./vendor/node_modules/openai` — needed since
the `pi-repo/packages/ai/node_modules/openai` symlink vanished at 08:31 today
(declared dep openai@7.34.0; cause unknown). The vendor symlink points at the
identical bun-store copy the earlier runs resolved, so behavior is unchanged
and the Unown repo tree is not modified.)
