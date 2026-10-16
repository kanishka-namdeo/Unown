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
`--edit-variant replace` — that run is now done, below.

## Fair A/B: Unown vs omp agent core, edit variant pinned (full 106)

We ran **oh-my-pi's own agent** (`@oh-my-pi/pi-coding-agent` 18.11.1,
in-process via its metaharness `adapters/edit` runner, unmodified) on the
identical 106 fixtures through the same bridge, same day, same knobs as the
Unown runs above (thinking off, timeout 300 s, connection timeout 60 s,
max-turns 30, max-attempts 1, 1 run per task, task concurrency 4, all 106
tasks — note the omp CLI defaults to a 80-task sample and 120 s timeout, both
overridden). Task IDs verified set-identical to the Unown receipts. Two cells
per model: `replace` (pi-style edits — the confound-free agent-core A/B) and
`hashline` (omp's default edit format, full-106 context for the smoke table
above).

Protocol deltas that remain (each stack run as shipped, honestly labeled):
omp's runner sets `PI_STRICT_EDIT_MODE=1`, exposes an `apply_patch` tool, and
uses omp's system prompt; the Unown runs used pi's defaults (no strict mode,
no apply_patch). Both sides subtract system-prompt overhead from token counts
(identical accounting).

| Task success (of 106) | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus | avg |
|---|---|---|---|---|
| **Unown** (pi replace) | 104 (98.1%) | 105 (99.1%) | 105 (99.1%) | **98.8%** |
| **omp** (replace) | **106 (100%)** | 104 (98.1%) | 101 (95.3%) | 97.8% |
| **omp** (hashline, default) | 105 (99.1%) | 101 (95.3%) | 102 (96.2%) | 96.9% |

| Edit-call success | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus |
|---|---|---|---|
| **Unown** (pi replace) | 95.7% | 97.3% | 99.1% |
| **omp** (replace) | 98.1% | 98.7% | **100%** |
| **omp** (hashline, default) | 71.4% | 80.4% | 71.9% |

| Avg input tokens / task | kimi-k2.5 | qwen3.7-plus | qwen3.6-plus |
|---|---|---|---|
| **Unown** (pi replace) | **3,238** | **2,974** | **2,854** |
| **omp** (replace) | 5,470 | 8,829 | 8,478 |
| **omp** (hashline, default) | 9,482 | 9,450 | 9,917 |

Read it straight:

- **Task success: parity within noise.** 318 runs per side; Unown 314/318
  (98.8%), omp-replace 311/318 (97.8%), omp-hashline 308/318 (96.9%).
  Single-task deltas (kimi, qwen3.7) are noise at n=1; qwen3.6 is the one
  meaningful gap — Unown +4 tasks over omp-replace (omp's qwen3.6-replace
  failed 5 tasks, 3 of them multi-composite).
- **Edit mechanics: replace is simply a better edit format for these models.**
  With the variant pinned, both agents land 95.7–100% edit-call success.
  omp's default hashline drops to 71–80% (0.3–0.6 failed edit calls per task
  plus hashline warnings) and needs ~1.7–1.9× more input tokens than its own
  replace runs to reach slightly worse task success — its retry ladder absorbs
  most, not all, of the grammar failures.
- **Token efficiency: Unown's stack is 1.7–3.1× lighter on input tokens** on
  identical tasks (pi default system prompt + replace tooling vs omp's).
- **Cross-validation:** `multi-composite-multi-edit-007` fails for BOTH qwen
  models on BOTH agents (4/4 qwen runs) — a model-level lookalike-negation
  trap, not an agent defect. omp-kimi-replace is the only 106/106 anywhere.

Receipts: `omp-ab/<model>_<variant>.json` (full per-task results, embedded
config + summary; `omp-runs-eventlogs.tgz` = per-run event JSONL), harness
recipe in `../omp-harness/` (workspace package.json, agent models.yml,
run-ab.sh). Run 2026-10-16 17:24–17:46 UTC.

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
- `omp-ab/` — omp A/B receipts: `<model>_<variant>.json` (per-task + summary
  + embedded config), `<model>_<variant>.log` (runner output),
  `omp-runs-eventlogs.tgz` (per-run event JSONL from omp's runner)

## Reproduce

**Unown side** (harness committed at `../run-unown.mjs`; fixtures: extract
omp's `packages/typescript-edit-benchmark/fixtures.tar.gz` next to it as
`fixtures/`, and provide an agent dir with a `models.json` listing the three
bridge models — see `../omp-harness/omp-agent-models.yml` for the provider
shape):

```bash
cd <checkout>/benchmarks/edit-bench
PI_CODING_AGENT_DIR=<agent-dir> node run-unown.mjs --model <id> [--tasks id] [--summarize]
```

(If `pi-repo/packages/ai/node_modules/openai` is missing — its symlink can be
pruned by package-manager runs — restore it with
`bench-data/relink-node-modules.mjs` or `bun install` in `pi-repo`, or use a
Node `--import` resolution hook pointing at any `openai@7.x` install.)

**omp side** (the fair A/B): build the probe workspace from
`../omp-harness/` — a bun workspace whose `package.json` pins
`@oh-my-pi/*@18.11.1` from npm plus two source copies from the oh-my-pi repo
@`a536558`: `packages/metaharness/adapters/edit` (runner) and
`packages/typescript-edit-benchmark` (fixtures + scoring), laid out to mirror
the repo so the runner's relative paths resolve unpatched. Then:

```bash
cd <probe>/packages/metaharness/adapters/edit
PI_CODING_AGENT_DIR=<probe>/omp-agent bun cli.ts --model zai-bridge/<id> \
  --edit-variant replace --thinking off --timeout 300000 \
  --connection-timeout 60000 --max-turns 30 --max-attempts 1 --runs 1 \
  --task-concurrency 4 --max-tasks 0 --quiet --output out.json
```

(`../omp-harness/run-ab.sh` wraps exactly this; the llm-bridge on :3031 must
be up. `--max-tasks 0` = all 106 — the CLI's default samples 80.)
