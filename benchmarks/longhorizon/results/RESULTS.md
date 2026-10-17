# Long-horizon refactor — results

**Question:** when a task is too broad to comfortably hold in one context —
a multi-file contract change swept across a whole project — which models
finish, and what do they cost?

This is `docs/testing-strategy.md` §7 J: one deliberately hard task under a
time limit, scored on the **file diff**, not just tests.

## The task

`../task/` — "clippad", a TypeScript note app (11 src modules, 7 test files,
2 docs). The refactor: `createdBy: string` becomes
`createdBy: {id, name}` **everywhere at once** — types, factory, user
directory, notebook, search, both formatters, strict store validation,
stats, CLI, test helpers and pins, and both docs. `../reference/` is the same
tree after a correct hand-written refactor, committed for diff comparison and
never shown to the agent.

The scoring is calibrated against the reference itself
(`calibration.json`): the reference passes **39/39** tests as-is, but with
pristine test files restored it fails **12/39** — a correct refactor
necessarily updates the test contract. A model whose pristine-restore
profile matches 27/12 did the same contract migration as the reference.

## Protocol

- Agent: the full `unown` CLI (print mode) in a pristine workspace copy,
  fresh `UNOWN_HOME` per model.
- **Time cap: 7 minutes** (not the doc's suggested 15): this run was
  orchestrated from an environment that caps single commands at 10 minutes,
  so `LONGHORIZON_TIME_LIMIT_MIN=7` left room for scoring. The cap is
  recorded in every receipt (`timeLimitMin: 7`), the agent prompt states the
  same number, and the runner defaults to 15. n=1 per model, single run.
- Scoring, both ways: tests **as-is** (the agent may legitimately update
  tests) and tests **pristine-restored** (anti-tamper + old-contract probe).
- Diff quality vs the reference: `fileSetJaccard` (overlap of changed-file
  sets) and `finalStateCloseness` (1 − churn(workspace→reference) /
  churn(pristine→reference)). Heuristics — formatting differences count,
  exact match is NOT required.
- Receipts: `summary.json`, per-model `receipt.json`, and the agent's full
  workspace diff as `<model>/workspace.patch`.

## Results (2026-10-17, n=1, 7-min cap)

| Model | Duration | Files (±) | Tests as-is | Tests pristine | Jaccard | Closeness | Input tokens | Cache read | Tools |
|---|---|---|---|---|---|---|---|---|---|
| kimi-k2.5 | 245 s | 13 (+112/−75) | **40/0** | 27/12 | **0.93** | **0.169** | 43,520 | 474,112 | 66 |
| qwen3.7-plus | 299 s | 14 (+123/−81) | **40/0** | 27/12 | 0.87 | 0.134 | 62,617 | 840,704 | 74 |
| qwen3.6-plus | 291 s | 15 (+136/−106) | 39/0 | 27/12 | 0.81 | 0.009 | **1,205,337** | **0** | 87 |

All three models finished inside the cap, said `DONE`, and left a green
as-is suite; all three pristine-restore profiles equal the reference's
27/12 — every model made the same contract migration the hand-written
reference makes. Correctness at this horizon is, on n=1, a three-way tie.

**The separation is cost, not correctness.** qwen3.6-plus spent
**1.2 M input tokens — 28× kimi** — on the same task, with **zero cache
reads**: no prompt caching engaged for its request stream on this endpoint,
so every accumulated tool result was re-sent at full price for 87 tool
calls. kimi and qwen3.7-plus rode 474 K / 841 K of cache reads and paid
43–63 K fresh input tokens. No compaction ran for any model
(`compactionRuns: []` on all three) — at this task size the sessions fit;
the eval's compaction-probing purpose needs either a larger task or a
smaller context window to bite.

## Read it as it is

- n=1, single run, 7-minute cap: point estimates, not significance.
- Closeness is dominated by formatting drift (0.009 for qwen3.6-plus means
  its final state is barely closer to the reference than pristine — while
  still passing every as-is test; the metric is a heuristic, the receipts
  are the evidence).
- Test-count detail: the reference suite is 39 tests; kimi and qwen3.7-plus
  ended at 40 passing (a case added inside an edited test file — no new test
  files, `agentAddedTests: []`), qwen3.6-plus at the reference's 39. All
  three edited existing test files (2/3/4 files respectively) — exactly what
  a correct contract refactor requires.
- The token count includes the whole session (system prompt, tool results,
  re-reads), which is exactly the cost a long-horizon task amplifies.
