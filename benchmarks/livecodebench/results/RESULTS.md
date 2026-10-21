# LiveCodeBench v6 — results

**Question:** how do these models do on problems published *after* their
knowledge cutoff — i.e. codegen ability that cannot be memorized?

This is the contamination-aware model-tier headline `docs/testing-strategy.md`
§7K asked for. HumanEval+ (Track 6) stays as the pre-cutoff reference column;
this track is the post-cutoff one.

## Protocol

Pinned in `../runner.mjs` (verbatim copies of the official LCB prompt template
and a stdlib-only port of their grader — see the runner header for the full
pin list):

- **Problems:** the 50-problem stratified subset in `../dataset/subset.json`,
  drawn from the LiveCodeBench `release_v6` increment (`test6.jsonl`, contests
  2025-01-04 → 2025-04-06, the newest LCB window). Proportional allocation
  across the six platform×difficulty cells with largest-remainder rounding,
  deterministic even spacing within cells — no seed, no cherry-picking. The v6
  increment contains **0 Codeforces problems** (LCB's newest window added only
  AtCoder + LeetCode); reaching back for Codeforces would mean older-window
  problems, which is the opposite of contamination-aware. Subset pinned with
  per-problem test counts.
- **Prompt:** LCB's own OpenAIChat template (system message +
  `get_generic_question_template_answer`), pinned text.
- **Decoding:** greedy (temperature 0, top_p 1, n 1), max_tokens 4096 → pass@1.
- **Extraction:** official LCB `extract_code` — the code between the LAST pair
  of ``` fence lines; fewer than 2 fence lines = `no_code`.
- **Scoring:** `../scorer.py`, faithful stdlib port of `lcb_runner`'s
  `testing_util.py`: public + private lite tests, first-fail-stop, 6 s per
  test, LCB reliability guard, fresh scratch process per problem.
- **Anti-tamper:** tests never enter any model-visible prompt; solutions run
  in throwaway scratch dirs, killed and discarded.
- **Endpoint:** Dashscope coding-intl via the bundled llm-bridge, strictly
  sequential per model, three models in parallel (one request each).
- **Receipts:** `<model>.jsonl`, one line per problem — outcome, error code,
  test counts, tokens in/out, generation latency, scoring wall time,
  stdout/stderr tails, and the full extracted solution.

## Results (2026-10-17, single run, greedy)

| Model | pass@1 | pass | `no_code` | `wa` | `rte` | `tle` | tokens in/out |
|---|---|---|---|---|---|---|---|
| kimi-k2.5 | **52.0%** | 26/50 | 15 | 4 | 2 | 3 | 28,851 / 130,234 |
| qwen3.7-plus | 38.0% | 19/50 | 26 | 4 | 1 | 0 | 31,183 / 135,042 |
| qwen3.6-plus | 36.0% | 18/50 | 27 | 4 | 1 | 0 | 31,183 / 138,986 |

By difficulty (pass counts): every model sweeps **easy** (13/13, 13/13, 12/13);
medium splits 9/14, 5/14, 5/14; **hard** is where it ends — 4/23, 1/23, 1/23.

## Read it as it is

- **`no_code` is the dominant failure** (15/26/27 of 50): the model spends the
  entire 4096-token budget without closing a fenced code block, so extraction
  finds no code and the problem scores as failed. This is a real property of
  the pinned protocol at max_tokens 4096 — models that reason at length in
  content before writing code get cut off. It is reported as-is, not filtered;
  a protocol with a larger budget would likely move these numbers up, and that
  experiment is future work, not a silent re-run.
- Comparison with the official LCB leaderboard is apples-to-oranges: they run
  the full release_v6 (1,055 problems, 2023-05 → 2025-04) with per-model
  max_tokens configs; this track runs the 50-problem newest-window subset with
  one pinned budget for all three. Same family, same decoder, different
  protocol — the receipts exist precisely so this can be audited.
- kimi-k2.5 leads on hard problems (4 vs 1) and on wall-clock-stability; all
  three models average 45–54 s generation per problem on this endpoint.
- Single run, greedy, n=1 per problem — these are point estimates, not
  significance-tested means.

## Reproducing

```bash
# 1. fetch the pinned dataset file (sha256 in summary.json)
#    huggingface.co/datasets/livecodebench/code_generation_lite/resolve/main/test6.jsonl
# 2. subset it
python3 ../prepare.py
# 3. run (needs the llm-bridge on :3031)
node ../runner.mjs --model kimi-k2.5
# 4. summarize
node ../runner.mjs --report
```

## Results (2026-10-21) — agnes-3.0-flash (Agnes AI upstream, single run, greedy)

Same pinned protocol as above (50-problem `release_v6` subset, LCB OpenAIChat
prompt, greedy t=0/top_p=1/n=1, max_tokens 4096, official `extract_code` +
`scorer.py`), executed through the same bundled llm-bridge (`:3031/v1`) — but
with the bridge's upstream pointed at **Agnes AI (`apihub.agnes-ai.com/v1`),
model `agnes-3.0-flash`** instead of Dashscope coding-intl. Same prompt, same
decoder, same scorer, different serving stack.

| Model | pass@1 | pass | `no_code` | `wa` | `rte` | `tle` | tokens in/out |
|---|---|---|---|---|---|---|---|
| agnes-3.0-flash | 28.0% | 14/50 | 35 | 1 | 0 | 0 | 34,083 / 152,974 |

By difficulty: **easy 12/13**, medium 2/14, **hard 0/23**. By platform:
AtCoder 8/32, LeetCode 6/18. Average generation 50.7 s/problem (same 45–54 s
band as the three Dashscope models), avg eval 0.1 s.

- **`no_code` is even more dominant here (35/50)**: every single `no_code` row
  has `finish_reason: "length"` — the model spent the entire 4096-token budget
  (reasoning at length in content) without ever closing a fenced code block.
  Agnes answers the easy AtCoder/LeetCode cells directly in 150–1,500 output
  tokens (12/13 easy passed), but on medium/hard it burns the full budget
  before writing code, so the pinned protocol scores it 0 on hard. Reported
  as-is, not filtered — same class as the 2026-10-17 `no_code` note, stronger.
- The one `wa` (leetcode 3744) closed its fence at 3,986 tokens and failed a
  private test; zero runtime errors, zero TLEs, zero generation failures
  (0 `api_error` rows, 0 retries needed across all 50 problems).
- Windowed resumable run: 6 × `timeout 540` foreground windows (receipts are
  resume-safe; 5 windows ended at the sandbox's 9-minute tool cap by design,
  final window exited 0 with `generated=2 gen_failures=0 skipped(resume)=48`).
  Wall time ≈ 47 min total across windows. Full logs:
  `/home/z/my-project/logs/lcb/agnes-{1..6}.log`.
- `--report` caveat: the runner's report mode regenerates `summary.json` from a
  hardcoded 3-model list and **overwrites** the file, so the agnes row was
  merged in by a small script outside the repo
  (`/home/z/my-project/add-agnes-lcb-summary.mjs`, recomputing the row with the
  runner's own report logic); the 3 existing model rows are byte-identical.
- Single run, greedy, n=1 — a point estimate, not a significance-tested mean;
  the 2026-10-17 models ran on a different upstream (Dashscope vs Agnes AI),
  which is itself a serving-stack variable. Shared 2-CPU box.
- Receipts: `agnes-3.0-flash.jsonl` (one line per problem: outcome, tokens,
  latency, full extracted solution, stdout/stderr tails) + the
  `results["agnes-3.0-flash"]` row in `summary.json`.
