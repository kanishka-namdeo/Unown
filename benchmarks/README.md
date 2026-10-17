# Unown benchmarks

Everything we run to prove the agent's **accuracy, efficiency and performance** — and the
honest methodology behind every number we publish on the landing page.

The guiding rules (distilled from how Aider, Terminal-Bench, Cline, SWE-bench and
Artificial Analysis publish results — see `docs/benchmark-research.md` for the full
research):

1. **Never mix pass@1 and pass@2** in one column; state attempts explicitly.
2. **Pin everything**: exercise list + source commit, harness version, model ids,
   prompt template, test commands, snapshot date. Results ship with receipts
   (per-task JSONL + session logs).
3. **Anti-tamper scoring**: reference solutions (`.meta/`) never enter the agent
   workspace; test files are read-only during the session *and* restored to their
   pristine state before scoring.
4. **Pair every accuracy number with cost/latency** (tokens, wall time).
5. **Label subsets honestly** — "Aider polyglot, 50-exercise subset, Unown harness,
   2 attempts" — never a bare "polyglot 78%".
6. **Quote, don't fake**: benchmarks we cannot run honestly here (Docker-bound
   SWE-bench / Terminal-Bench) are cited from their official leaderboards with
   links and dates, clearly marked as vendor-reported.

## Tracks

| # | Track | What it proves | Where |
|---|-------|----------------|-------|
| 1 | pi-repo test suite | Codebase health: the vendored pi monorepo's own unit tests (4,585 tests) | `pi-repo/` |
| 2 | Aider polyglot subset | Real coding accuracy: hardest Exercism exercises, 6 languages, Unown as the solving agent | `polyglot/` |
| 3 | oh-my-pi typescript-edit-benchmark | Surgical edit accuracy on oh-my-pi's own 106 TS-mutation fixtures | `edit-bench/` |
| 4 | pi vitest-evals | Behavioral correctness of the agent loop (pi's own eval suite) | `evals/` |
| 5 | Self-improvement lift | The differentiator: repeat-task pass-rate/token improvement from Unown memory | `selfimprove/` |
| 6 | HumanEval+ (evalplus) | Model-level codegen sanity (non-agentic, labelled as such) | `evalplus/` |
| 7 | LiveCodeBench v6 subset | Contamination-aware model-tier headline: post-cutoff problems (2025-01→04 window) | `livecodebench/` |
| 8 | Long-horizon refactor | One hard multi-file contract change under a time cap, scored on the file diff — surfaces context-management cost | `longhorizon/` |

## Track 1 — pi-repo test suite

`npm run test` across the vendored pi monorepo workspaces. The suite is green only when
the gitignored model-catalog data is hydrated from the **pinned snapshot** contemporary
with the vendored pi version (0.84.3, released 2026-08-24) — hydrating from today's live
models.dev endpoint produces catalog drift (52 failures). The pinned snapshots live in
`snapshots/`:

```bash
cd pi-repo/packages/ai
MODELS_DEV_API_URL=../../../benchmarks/snapshots/modelsdev-api-2026-08-25.json \
OPENROUTER_MODELS_URL=../../../benchmarks/snapshots/openrouter-models-2026-08-25.json \
node scripts/generate-models.ts --strict --data-only
```

The env overrides are a committed, backwards-compatible patch to
`pi-repo/packages/ai/scripts/generate-models.ts` (defaults unchanged: live endpoints).

Fixed along the way (see worklog for details):

- `fd` binary missing → 10 find-tool test failures (and degraded agent `find` tool at runtime).
- `getFileRevision` (coding-agent utils) — same-size rewrites inside one filesystem
  timestamp tick collided (`dev:ino:size:mtimeNs:ctimeNs` all equal on coarse-granularity
  filesystems) and served stale credential/model caches; now includes a content digest.
- Bun's non-hoisted `node_modules` layout breaks cross-package `vi.mock("openai")` in
  coding-agent tests; any `npm exec` can prune per-package store symlinks (repair:
  re-run `bun install`, or use the relink script in the worklog appendix). Root-caused
  2026-10-17: the coding-agent test file could not resolve `openai` from its own
  package, so the mock never applied — fixed properly by declaring `openai` as a
  coding-agent devDependency (bun install maintains the store symlink). The npm
  workspace runner can still die mid-suite on the root `vitest/config` resolution;
  the robust verification path is per-workspace runs (see the 2026-10-17
  consolidated receipts in `RESULTS.md`).

## Track 2 — Aider polyglot subset (`polyglot/`)

The Aider polyglot benchmark (225 hardest Exercism exercises across Python/JS/C++/Go/
Java/Rust, chosen as the problems ≤3 of 7 reference models could solve) is the closest
public analog to what Unown does. We run a **50-exercise stratified subset** with the
full Unown agent in the loop:

- **Subset**: per-language counts proportional to the official mix (Py 8, JS 11, C++ 6,
  Go 9, Java 10, Rust 6), alphabetical + evenly-spaced selection (deterministic, no
  cherry-picking). Pinned in `polyglot/subset.json` with the source commit.
- **Protocol** (mirrors Aider): 2 attempts per exercise; attempt 2 receives the
  attempt-1 test-failure output. Report pass@1 and pass@2.
- **Agent**: `unown -p` headless session in a fresh scratch copy of the exercise
  (`.meta/` reference solutions stripped), per-model isolated `UNOWN_HOME`.
- **Scoring**: canonical per-language test command run by the harness after restoring
  pristine test files: `pytest -q` · `npm test` (xtest→test, as Aider does) ·
  `cmake -DEXERCISM_RUN_ALL_TESTS=1 && cmake --build build` + run the produced test
  binary · `go test ./...` · `./gradlew test` · `cargo test -- --include-ignored`.
- **Efficiency**: per-task tokens (prompt/completion, from session logs) and wall time
  are recorded next to every attempt.

Run it:

```bash
node polyglot/gen-subset.mjs          # regenerate/pin the subset (already committed)
node polyglot/runner.mjs --model kimi-k2.5 --workers 3
```

Context rows from the official Aider leaderboard (full 225, Aider's own harness, pass@2,
2026-10 capture — clearly not comparable numbers, same benchmark family):
gpt-5 88.0% ($29.08) · claude-opus-4 72.0% · Kimi K2 59.1% ($1.24) · Qwen3 32B 40.0%.
No kimi-k2.5 / qwen3.7-plus / qwen3.6-plus polyglot rows existed anywhere when we ran
this — Unown publishes the first.

## Track 3 — oh-my-pi typescript-edit-benchmark (`edit-bench/`)

oh-my-pi (the pi fork with benchmark infrastructure of its own) ships a 106-task edit
benchmark: Babel-AST mutations of real TypeScript sources (token swaps, structural
moves, multi-hunk bugs), scored by byte-exact equality after Prettier normalization —
no tests, no LLM judge. We run the same fixtures with the Unown agent core (pi
`createAgentSession`, read/edit/write tools, `replace` edit semantics) through the same
bridge; results in `edit-bench/results/`. Fairness caveat: oh-my-pi's own harness runs
its default hashline edit variant, so cross-agent rows compare *agent + edit variant*,
not agent cores in isolation (Unown's pi-native `replace` semantics are the confound).

## Track 4 — pi vitest-evals (`evals/`)

The vendored pi monorepo's own behavioral eval suite (`pi-repo/packages/evals`,
vitest-evals): model-backed end-to-end checks of the agent loop through a real
`AgentSession`. We run it against all three models via the bundled bridge:

```bash
cd pi-repo && PI_CODING_AGENT_DIR=<agent-dir> npm run eval -- --provider zai-bridge --model <model>
```

## Track 5 — self-improvement lift (`selfimprove/`)

Unown's differentiator, measured honestly: the same task set solved twice in the same
project (cold pass vs. warm pass with accumulated session notes + dreamed memory).
Reported as pass-rate delta and token delta between passes. This is *repeat-task*
efficiency — memory doing exactly what it exists for — and is labelled as such.

## Track 6 — HumanEval+ via evalplus (`evalplus/`)

Model-level (non-agentic) codegen sanity through the same bridge, greedy decoding,
pass@1 on the HumanEval+ test suites (80× more tests than HumanEval). Included as a
model-tier reference column only — it does not measure the agent.

## Track 7 — LiveCodeBench v6 subset (`livecodebench/`) — contamination-aware headline

HumanEval+ problems predate every current model, so a high score cannot distinguish
ability from memorization. This track is the post-cutoff answer: a 50-problem
stratified subset of LiveCodeBench's newest window (contests 2025-01-04 → 2025-04-06,
after all three models' cutoffs), official LCB prompt template and grader logic,
greedy decoding, pass@1, per-problem JSONL receipts. Dominated honestly by the
`no_code` cutoff failure mode at the pinned 4096-token budget — reported as measured.
HumanEval+ (Track 6) stays as the pre-cutoff reference column; this is the one that
cannot have been memorized.

## Track 8 — Long-horizon refactor (`longhorizon/`)

§7 J's probe: one deliberately hard multi-file contract change (`createdBy: string` →
`{id, name}` across an 11-module TypeScript app) under a hard wall-clock cap, run with
the full unown agent, scored on the file diff (not just tests) against a committed
reference refactor. On n=1 all three models solved it — the separation is cost:
qwen3.6-plus spent 1.2 M input tokens with zero cache reads where kimi-k2.5 spent 44 K
riding 474 K of cache. The eval exists to surface exactly that context-management
difference.

## What we deliberately do NOT self-run (and why)

SWE-bench Verified and Terminal-Bench require per-task Docker environments (or, for
oh-my-pi's native TB runner, a KVM host) — neither exists in the target deployment
environment this repository documents. Quoting their official leaderboards for the same
model families (with links + dates) is the honest alternative — the same pattern Warp
uses. Reference points captured 2026-10 (vendor-reported, full benchmarks, different
harnesses): Kimi K2.5 — SWE-bench Verified 76.8 (self-reported tech report) / 70.8
(official board, mini-SWE-agent) / Terminal-Bench 2.0 50.8; Qwen3.7-Plus — SWE-bench
Verified 77.7 / Terminal-Bench 2.0 70.3.
