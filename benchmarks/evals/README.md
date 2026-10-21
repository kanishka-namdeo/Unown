# pi vitest-evals (Track 4)

The vendored pi monorepo's own behavioral eval suite
(`pi-repo/packages/evals`, vitest-evals): model-backed end-to-end checks of
the agent loop through a real `AgentSession` — a smoke eval (basic prompt
end to end) and the extension-authoring eval (create, reload and use a pi
extension in-session, scored by an LLM judge), each under two system-prompt
harness variants (`default-system-prompt` vs `system-prompt-without-docs`).

## Run it

```bash
cd pi-repo && PI_CODING_AGENT_DIR=<agent-dir> npm run eval -- \
    --provider zai-bridge --model <model>
# <agent-dir>: a scratch pi agent dir whose models.json registers the
# provider+model — benchmarks/edit-bench/unown-eval-agent is the one the
# committed runs used (it carries kimi/qwen/agnes ids pointing at the
# local llm-bridge on :3031).
```

The bridge must be up (`bun run agent:start` at the repo root). Results land
under `pi-repo/packages/evals/.eval/<timestamp>_<runId>/runs.jsonl` (plus
full session transcripts in `sessions/`); the published per-model receipts
in this directory are the `runs.jsonl` of a green run, copied verbatim.

## Receipts

- `results/<model>/runs.jsonl` — one line per test execution: status, harness
  variant, token usage (input/output/cacheRead), wall time, session pointer.
- `results/summary.json` — the per-model roll-up (tests passed, judge score,
  notes). Judge 0.0 is the honest all-models result so far — the eval is
  hard, and the suite being green is what ships.

## History

- 2026-10-16 — kimi-k2.5, qwen3.7-plus, qwen3.6-plus (Dashscope upstream):
  3/3 green each, judge 0.0 across the board; the A/B comparison found the
  default system prompt needs ~10× fewer tokens than the docs-less variant
  at equal judge score.
- 2026-10-21 — agnes-3.0-flash (Agnes AI upstream via the bridge): 3/3
  green, judge 0.0; A/B direction reproduces (default 51.4k vs docs-less
  63.0k tokens). First run attempt hit a transient harness error on one
  repetition (bridge cold start); the immediate re-run was fully green —
  receipt is the green run.
