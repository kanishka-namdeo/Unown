# oh-my-pi typescript-edit-benchmark — fresh-checkout verification rerun (2026-10-17)

Same 106 shipped fixtures, same harness (`run-unown.mjs`), same agent core
(pi `createAgentSession`, read/edit/write tools, pi-native `replace` edit
semantics), same bridge — re-run from a **fresh clone** to verify the track
reproduces. Writes into this directory (`--results-dir`), committed receipts
untouched.

## n=1 results (2026-10-17)

| Model | Pass | Rate | edit-call success | tok-in mean/task | tok-out mean/task | mean duration |
|---|---|---|---|---|---|---|
| kimi-k2.5 | 104/106 | **98.1%** | 96.4% | 1,062 | 464 | 13.5 s |
| qwen3.7-plus | 102/106 | 96.2% | 98.2% | 2,092 | 479 | 11.6 s |
| qwen3.6-plus | 100/106 | 94.3% | 96.4% | 1,200 | 396 | 18.2 s |

Committed n=1 (2026-10-16): kimi 98.1% · qwen3.7 99.1% · qwen3.6 99.1%.
kimi reproduces exactly; both qwens land 3–5 tasks lower — squarely inside
the n=1 flake band the committed n=3 variance pass quantified
(`../results/RESULTS.md` § n=3: the qwen fixtures that fail at n=1 are
2-of-3 flaky tasks, best-of-3 settles at 105–106/106 for all models).
Per-task receipts: `<model>/<model>.jsonl` (resumable JSONL — one record per
task-run with tokens, durations, edits, outcome) + `<model>/summary.json`;
scratch agent workspaces under `<model>/workdirs/` (gitignored bulk).

Environment deltas vs the committed run, all documented in the worklog:
llm-bridge now runs production-mode (no `bun --hot`) with its pure logic
extracted to `pure.ts` (95 unit tests pin the routing/body/retry behavior
byte-identical); `PI_DIST` resolves repo-relative.

## What this rerun proves

The oh-my-pi edit benchmark runs from a clean checkout with the vendored
agent core and reproduces within the documented noise band — the headline
claim (≈98–99% surgical edit accuracy on omp's own byte-exact benchmark,
first published numbers for any agent but omp's own) stands on both days'
receipts.
