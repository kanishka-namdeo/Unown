# complementary — the non-traditional local-model testbench (campaign 3)

**Question:** can *non-traditional* fully-local mechanisms — model-free
speculative decoding, draft-model speculation, KV prefix reuse, a tiny local
model as a prompt compressor / query rewriter, embedding-keyed caching, and
the 2026 generation of sub-1B models with native vision — work
**complementary to the configured remote endpoint** (Dashscope
`kimi-k2.5` / `qwen3.7-plus` / `qwen3.6-plus`) to speed up or improve the
harness's tasks on the pi side (local lane, vision) and the memory side
(retrieval), on the **broad range of systems Unown supports** — with any
change to Unown itself gated on this registry, exactly like the two prior
campaigns?

This is the third testbench of the research program. Where
[`../local-llm`](../local-llm) (H1–H11) asked *can a small local LLM run the
subtasks* and [`../nonllm`](../nonllm) (H9–H15) asked *how much needs any
neural generation at all*, this bench asks *what else can a local engine do
around the remote endpoint that neither campaign covered* — speed the local
lane itself, cut what the remote endpoint is paid, harden repeated calls, and
fill the memory-retrieval gap.

## Layout

```
hypotheses.json   the registry: H16–H22, thresholds, guards, verdicts
runner.mjs        CLI driver (pure Node >= 18, no native deps)
lib/
  lane.mjs        ext-model provisioning + timed chat (/completion /tokenize)
  specdec.mjs     C1 n-gram / C2 draft-model speculation / C3 KV reuse
  compress.mjs    C4 local chunk-compression -> remote savings
  semcache.mjs    C5 two-tier semantic cache (exact + embedding near-dup)
  retrieval.mjs   C6 query rewriting over the recall-qa corpus
  bakeoff.mjs     C7 Qwen3.5-0.8B vs incumbent + local-vision probe
  renders.mjs     null-safe receipt renders (pinned by renders.test.mjs)
models/           extra GGUFs (gitignored): qwen3.5-0.8b + mmproj,
                  qwen2.5-0.5b (specdec draft)
results/          receipts per run (gitignored except curated REPORT.md)
```

Fixtures and instruments are REUSED from the sibling benches via relative
imports: `../local-llm/lib/{prompts,llama,openai,report,judge}.mjs`
(byte-faithful production prompt assemblies, engine fixtures incl. the 4
genuine FAILED runs, llama.cpp b11718 lifecycle, blind position-swapped
judge) and `../memory-eval/recall-qa/corpus.json` (40 LongMemEval-adapted
questions with oracle evidence sessions).

## The experiments

| # | Hypothesis | Tests | Key metrics |
|---|---|---|---|
| C0 | runtime gate (keyless) | llama.cpp b11718 capabilities: specdec flags, timings, /tokenize, KV-reuse engagement, prompt-logprobs availability, draft tokenizer compat, qwen35 arch | checks all green; CI runs this on 3 OSes |
| C1 | H16 n-gram speculation | triage + mining replays × {plain, grammar} × {baseline, ngram-simple, ngram-mod} | tok/s ratio, greedy byte-identity, RSS |
| C2 | H17 draft-model speculation | same replays, Qwen2.5-0.5B drafting for Qwen3-0.6B | tok/s ratio (target 1.5x), boot compat, RSS |
| C3 | H18 prefix KV reuse | shared-SYSTEM call sequences vs broken-prefix control | prompt_n delta, prefill ms saved, identity |
| C4 | H19 local compression -> remote | mining + dream payloads: local chunk-select (json_schema) then SAME remote model on full vs compressed | payload cut %, remote token/cost saved, validator parity, blind judge |
| C5 | H20 semantic cache | triage replay ×2 (exact) + adversarial outcome-flipped note edits (danger) | L1 hit rate, L2 hit curve 0.95/0.97/0.99, danger false-serve rate (must be 0) |
| C6 | H21 query rewriting | recall-qa corpus, four arms: embed(raw q) vs embed(0.6B-rewritten q) vs BM25(raw q) [nonllm-c2 lane] vs RRF fusion — same pool, same oracle | recall@5/@10 per arm, rewrite p50, JSON ok |
| C7 | H22 tiny-model bake-off | Qwen3.5-0.8B vs incumbent: probe + triage replay + local-vision acceptance (mmproj) | tok/s, RSS, agreement, vision probe |

## Running it

```bash
# 1. provision (llama.cpp b11718 + incumbent 0.6B + nomic + ext models)
node benchmarks/complementary/runner.mjs provision

# 2. keyless runtime gate (CI lane; no API key needed)
node benchmarks/complementary/runner.mjs probe

# 3. experiments (C4/C5 want the bridge reachable, or pass --no-remote)
bun run agent:start
node benchmarks/complementary/runner.mjs c1-ngram
node benchmarks/complementary/runner.mjs c4-compress --keep-pct 0.5
node benchmarks/complementary/runner.mjs all
```

Env: `TEST_BRIDGE_URL` (default `http://127.0.0.1:3031`),
`TEST_REMOTE_MODEL` (default `kimi-k2.5`), `TEST_JUDGE_MODEL`,
`LLAMA_BUILD` (default `b11718`), `UNOWN_LLAMA_BIN_DIR` /
`UNOWN_LLAMA_MODELS_DIR` (shared asset cache).

## Method notes (why you can trust the numbers)

- **Same instruments as the prior campaigns.** Replays use the byte-faithful
  prompt assemblies and engine fixtures from `../local-llm`; judging reuses
  the blind, position-swapped, consistency-gated `judge.mjs`; costs use the
  public list-price `COSTS` map.
- **llama.cpp's own `timings` are the speed instrument** (`prompt_n`,
  `prompt_ms`, `predicted_per_second` from the non-stream response), not
  wall-clock guesses — the same numbers `llama-bench` would report.
- **Greedy-only identity guards.** Speculative decoding is only
  output-identical under greedy sampling (llama.cpp docs), so every C1/C2
  replay runs at temperature 0 and byte-compares against the baseline arm.
- **Adversarial danger cases.** C5's near-dup tier is tested against
  outcome-flipped note edits — a paraphrase edit that changes the answer
  must MISS at the production threshold, or the tier is refuted.
- **One variable per comparison.** C6's arms share the embedder, the pool
  and the scoring; only the query text differs. C4's arms share the remote
  model and the prompt assembly; only the payload density differs.
- **Cross-platform.** The runner is pure Node; llama.cpp prebuilts cover
  linux/macos/win × x64/arm64. The C0 probe runs keyless in CI on all three
  OSes (`complementary-probe.yml`), asserting the mechanism-level facts
  (flags exist, lane boots, timings present, KV reuse engages) that the
  quality experiments then build on.

## Verdicts

Verdicts live in `hypotheses.json` (status + verdict + evidence links) and
are summarized in `results/REPORT.md` after each experiment campaign.
**Changes to Unown itself are gated on the registry** — the integration
shapes considered are: specdec/KV-reuse flags for the `local-llm runner.mjs
serve` one-liner lane (testbench-level first), and H15-style opt-in env
pre-processors for the compression/cache/retrieval lanes if verified.
