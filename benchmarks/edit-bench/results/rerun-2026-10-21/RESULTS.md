# oh-my-pi typescript-edit-benchmark — agnes-3.0-flash run (2026-10-21)

Same 106 shipped fixtures, same harness (`../run-unown.mjs`), same agent core
(pi `createAgentSession`, read/edit/write tools, pi-native `replace` edit
semantics) as the committed 2026-10-16 runs — but a new upstream lane:
**Agnes AI** (`https://apihub.agnes-ai.com/v1`, model `agnes-3.0-flash`)
served through the local llm-bridge (:3031, provider `zai-bridge`).
Protocol identical: thinking off, timeout 300 s, connection timeout 60 s,
max-turns 30, max-attempts 1, task concurrency 4, 1 run per task.

## n=1 results (2026-10-21)

| Model | Pass | Rate | edit-call success | tok-in mean/task | tok-out mean/task | mean / median duration |
|---|---|---|---|---|---|---|
| agnes-3.0-flash | 103/106 | **97.2%** | 87.0% (107/123) | 1,164 | 399 | 16.8 s / 12.3 s |

- Tier split: easy 38/40, medium 30/31, hard 22/22, nightmare 13/13.
- Median total tokens/task 262 (p99 11,566); prompt p99 11,036; summed task
  duration 29.7 min; 103/103 passes early-stopped on byte-exact match;
  mutation-intent match 101/106; zero timeout / zero-tool / provider
  retries — no provider failures, no runner crashes on the new endpoint.
- Failed tasks (all byte-exact verification misses, all `structural` swap
  mutations, all stable across every attempt in both windows):
  `structural-swap-if-else-001` (easy, 1/1 edit but wrong content),
  `structural-swap-sibling-blocks-001` (easy, same shape),
  `structural-swap-if-else-006` (medium, 2/12 edits succeeded, 10
  `not-found` misses, 144.7 s, 93 k prompt tokens).
- Edit-failure categories (16 failed edit calls suite-wide): not-found 11,
  other 4, not-unique 1.
- Context: the 2026-10-16/17 n=1 band for kimi-k2.5 / qwen3.7-plus /
  qwen3.6-plus was 94.3–99.1% with edit-call success 95.7–99.1% —
  agnes-3.0-flash lands inside the pass band with a lower edit-call
  success rate (its `oldText` misses are absorbed by the in-task retry
  ladder on all but 3 tasks).

### Caveats

- n=1 single pass; the committed n=3 variance study (`../results/RESULTS.md`
  § n=3) measured per-run reliability at 95–99% with 5–9 flaky tasks per
  model — single-task deltas vs the other models are noise at n=1.
- Windowed execution + a resume-key quirk: run under a 540 s window cap.
  Window 1 completed 89 tasks before the cap; window 2 re-ran all 106
  (the runner's resume logic records completed tasks as `task#0` in the
  JSONL but looks them up by bare task id at n=1, so nothing was skipped)
  and finished in 451.1 s. The published dataset is that final
  uninterrupted window — one record per task. Raw 196-record file
  (smoke + both windows) preserved at
  `../../unown-results/agnes-3.0-flash/agnes-3.0-flash.raw-smoke+2windows-196recs.jsonl`.
  Cross-window consistency: the 3 published failures failed every attempt;
  `structural-duplicate-block-004`, `structural-remove-case-label-002`,
  `structural-swap-if-else-007` failed window 1 but passed window 2 (the
  familiar flake band).
- Token accounting is the same diffTokenStats rule as all prior receipts
  (input+cache deltas minus system-prompt overhead), but Agnes reports
  cache usage differently from the dashscope models — cross-model token
  comparisons are indicative, not exact.
- The bridge/engine stack was shared with other benchmark tasks on the
  same 2-CPU box during the run (durations carry scheduling noise;
  pass/fail and tokens are unaffected).

## Receipts

- `agnes-3.0-flash/agnes-3.0-flash.jsonl` — one record per task (resumable
  JSONL: task, tier, mutationType, success, error, editCalls/Successes,
  editFailureDetail, tokens, durationMs, indentScore, mutationIntentMatched,
  earlyStopped, retries, agentResponse, diffExcerpt)
- `agnes-3.0-flash/summary.json` — aggregate metrics (regenerable via
  `node ../run-unown.mjs --model agnes-3.0-flash --summarize`)
- Base-layout copies of both live at `../agnes-3.0-flash.jsonl` +
  `../agnes-3.0-flash.summary.json` (next to `kimi-k2.5.jsonl` et al.)
- Scratch artifacts (per-task event logs, conversation dumps, workdirs,
  raw multi-window JSONL) under `../../unown-results/agnes-3.0-flash/`

Run 2026-10-21 ~16:23–16:31 UTC (published window; 1-fixture smoke and the
interrupted first window earlier the same hour).
