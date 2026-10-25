# Benchmarks (benchmarks/)

## Purpose

The benchmark suites that measure Unown and its models, plus the committed receipts those measurements produce. Six suites feed the landing page's figures (through the generator); the rest are research testbenches and memory-eval lanes whose results back docs claims and design decisions.

## Ownership

- Owns: everything under `benchmarks/` and this doc — the landing-feeding suites (`edit-bench/`, `evalplus/`, `livecodebench/`, `longhorizon/`, `polyglot/`, `selfimprove/`); the memory-eval lanes (`memory-eval/`: poison-corpus, mpbench, quality-axes, recall-qa, results, `_lib/`); the research testbenches (`local-llm/`, `nonllm/`, `complementary/`, `transfer-bench/`); the receipts lanes (`webcache/`, `websearch-live/`, `tui-beauty/`, `detached-engine/`, `vlm-smoke/`, `snapshots/`); the competitive-research reports (`research/<date>/` — web-verified product reverse-engineering sweeps whose findings feed the changelog's design decisions; committed as evidence like receipts, regenerated per sweep, never hand-edited); `benchmarks/README.md` (methodology) and `benchmarks/RESULTS.md` (master index).
- The drivers for `webcache-bench` and `websearch-live` live in `scripts/` (see `scripts/AGENTS.md`); their receipts land here.

## Local Contracts

**Methodology (from `benchmarks/README.md`):**

- Never mix pass@1 and pass@2 in one table; pin everything (subsets, seeds, model ids, dates).
- Anti-tamper scoring: `.meta/` never enters the agent workspace; tests are read-only during sessions and pristine-restored before scoring.
- Pair accuracy with cost/latency; label subsets explicitly; quote-don't-fake for Docker-bound benchmarks (SWE-bench/Terminal-Bench are cited, never claimed).
- Every graded number needs per-case JSONL receipts committed; `RESULTS.md` files are hand-written from `summary.json` receipts.
- All model traffic routes through the bundled llm-bridge on :3031 (stack must be up); some suites additionally drive the real engine on :3030 (`transfer-bench`, `selfimprove` v3 — deterministic dream triggering via `POST /api/jobs/auto-dream/trigger`).

**The landing-page feed (the definitive contract):** `scripts/landing_benchmarks.mjs` reads EXACTLY six receipt paths and writes `src/components/landing/benchmarks-data.ts`:

1. `edit-bench/results/<model>/summary.json` (newest rerun dir) else `edit-bench/results/<model>.summary.json` — `passRate`
2. `evalplus/results/summary.json` — `results.<model>.pass1`
3. `livecodebench/results/summary.json` — `results.<model>.passAt1Pct`, `byOutcome.no_code`
4. `longhorizon/results/summary.json` — `models.<model>.{durationS, diff.filesChanged, session.input, session.cacheRead, similarity.fileSetJaccard}`
5. `polyglot/results/summary.json` — `models.<model>.pass2Pct` / `pass1Pct`
6. `selfimprove/results/v2-notes/summary.<model>.json` — cold/warm deltas

Canonical-run rule: resolved PER MODEL — the newest `rerun-*` dir (lexicographic sort = temporal) holding a receipt for that model wins, else the base receipt. A figure with no receipt field is `null` ("not measured"), never a guess; NaN/negative/over-100 and unparseable receipts are hard failures. A new benchmark run under `benchmarks/` means `bun scripts/landing_benchmarks.mjs` must be re-run and `bun run check:benchmarks` kept green — never hand-edit `benchmarks-data.ts`.

**Suite notes:**

- `edit-bench/` (Track 3) — the TypeScript edit benchmark (106 Babel-AST fixtures) run with the Unown agent core through the bridge; byte-exact scoring after Prettier normalization; includes the fair A/B vs the omp agent itself (`omp-harness/run-ab.sh`, n=3 variance pass) and `unown-results/` scratch (per-task events/dumps/workdirs — large, regenerated not preserved). Fixtures from the committed `packages/typescript-edit-benchmark/fixtures.tar.gz`; the eval agent dir (`unown-eval-agent/models.json`) pins `zai-bridge` → `http://127.0.0.1:3031/v1`.
- `selfimprove/` (Track 5) — the differentiator: repeat-task efficiency, cold vs warm (warm = new workspace carrying only dreamed `.unown/` memory). v2 = agent-authored notes (the landing-feeding variant); v3 = project continuity (evolving repo, real dreams vs memoryless control vs wrong-domain control via `v3-fixture/`). Runner phases: `cold | wait-dream | warm | report`.
- `longhorizon/` (Track 8) — one hard multi-file contract change ("clippad" `createdBy: string → {id, name}` everywhere) under a wall-clock cap, scored on the FILE DIFF against the committed `reference/`; surfaces context-management cost.
- `polyglot/` (Track 2) — Aider polyglot 50-exercise stratified subset (deterministic pin `subset.json`), Aider's 2-attempt protocol.
- `evalplus/` (Track 6) / `livecodebench/` (Track 7) — model-tier codegen (non-agentic, labelled as such) and the contamination-aware headline (post-cutoff contests; `no_code` budget exhaustion counted as fail, not filtered).
- `memory-eval/` — poison-corpus (obfuscation ladder vs the production Mem0 consolidate path), mpbench (external adversarial corpus, 4 measurement layers), quality-axes (deterministic contradiction/staleness/forgetting/interference), recall-qa (multi-session QA lift, judge-free exact-match), ops-accuracy (gold-op ledger: the Mem0-paper ADD/UPDATE/DELETE/NOOP taxonomy + MEME Cascade/Deletion, confusion-matrix scoring), retrieval-rank (platform search scored in isolation: recall@k/MRR per query kind, conflict-recency preference, cross-scope isolation, two embedder arms — lexical + onnx), judge-calib (the binary QA judge calibrated against 24 gold-labeled items: agreement/FPR/FNR/flip-rate/order-sensitivity), failure-modes (the twelve documented cross-industry failure modes as pinned regression cases: 6 deterministic, 4 live, 2 engine); the live lanes run as env-gated engine tests (`UNOWN_MEMORY_LIVE=1`, `UNOWN_MEMORY_POISON=1`) with `_lib/dream-pipeline.mjs` as the shared production-path adapter.
- `local-llm/` / `nonllm/` / `complementary/` — hypothesis testbenches (H1-H25): what can local GGUF/ONNX/symbolic lanes do around the remote endpoint; verified hypotheses shipped as product lanes (bridge LOCAL lane, engine dream lanes, prefix-KV reuse). CI probes (`local-llm-probe.yml`, `nonllm-probe.yml`, `complementary-probe.yml`) render the suites' null-safety tests first, then run keyless probes with receipt artifacts.
- `snapshots/` — pinned model-catalog snapshots contemporary with vendored pi; Track-1 hydration must use these (live endpoints drift).
- `toolchain-restore.sh` — idempotent user-space restore of the polyglot toolchain after benchmark-sandbox wipes.

## Work Guidance

- A new suite documents its run command and receipt shape in its own README/RESULTS and registers in `benchmarks/RESULTS.md`; only landing-feeding suites need the generator wired (a `TRACKS` entry in `scripts/landing_benchmarks.mjs`).
- Scratch outputs (workdirs, dumps, events) are regenerable — never commit them as receipts; receipts are the `summary.json` + per-case JSONL.
- Suite runners are resumable via their `.jsonl` outputs — prefer resuming over restarting a long run.

## Verification

- `bun run check:benchmarks` — the landing figures match the receipts (CI).
- `node --test scripts/landing_benchmarks.test.mjs` — the generator's own unit suite (CI).
- Per-suite: each runner has a `--dry` / report phase that validates receipts without model calls; the memory-eval live lanes document their env gates.

## Child DOX Index

(none — the suites' own README/RESULTS files are their manuals; this doc owns the cross-suite contracts)
