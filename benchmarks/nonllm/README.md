# nonllm — the non-LLM testbench

**Question:** can *fully-local, performance-optimized NON-LLM models* — ONNX
encoders (sentence embeddings + a cross-encoder reranker) running in-process
via transformers.js/onnxruntime-node, plus *zero-model* symbolic lanes
(MinHash-LSH, LexRank, activation scoring) — speed up or improve Unown's
learning-layer subtasks (note triage, dream-input dedup/ranking/curation)
on the **broad range of systems Unown supports**, without replacing the LLM
calls that genuinely need generation?

This is the companion bench to [`../local-llm`](../local-llm) (H1–H11, the
small-LLM lane). Where local-llm asks "can a 0.6B–2.6B *generative* model do
the subtasks", this bench asks "how much of the pipeline needs *any* neural
generation at all" — the research program's executive answer
(`research/nonllm-*.md`): every credible agent-memory system keeps extraction
and consolidation on an LLM, but runs retrieval, dedup, ranking and scoring
non-LLM. Unown's pipeline has exactly those seams.

## The stack under test

| Lane | Model / method | Size | License | Runtime |
|---|---|---|---|---|
| Embedding | `Xenova/bge-small-en-v1.5` q8 (MTEB 62.11) | 33M / ~35MB | MIT | transformers.js + onnxruntime-node, CPU, in-process |
| Embedding (ablation) | `Xenova/all-MiniLM-L6-v2` q8 | 22M / ~23MB | Apache-2.0 | same |
| Cross-encoder rerank | `Xenova/ms-marco-MiniLM-L-6-v2` (nDCG@10 ≈ 83) | 23M / ~23MB | Apache-2.0 | same |
| Near-dup dedup | hand-rolled MinHash (128 perms, word 3-grams) + LSH 16×8 | 0 | n/a | pure JS, μs/doc |
| Extractive curation | dependency-free LexRank (IDF-cosine + power iteration) | 0 | n/a | pure JS, ms |
| Importance scoring | Park-2023/Hou-2024 activation: `0.995^h` recency × embedding relevance × log-frequency + structural heuristics | 0 | n/a | pure JS |

Why these: bge-small dominates MiniLM on the speed/quality Pareto at the
same class; ms-marco-MiniLM is the canonical CPU reranker (Qdrant benched
this exact ONNX artifact); no maintained pure-JS MinHash exists so it is
hand-rolled (~100 LOC); RWKV/SSM generative lanes stay in local-llm's scope.

## Layout

```
hypotheses.json      the registry: H9–H15, thresholds, guards, verdicts
runner.mjs           CLI driver (works under Bun AND Node >= 18)
export-fixtures.mjs  read-only fixture refresh from the live engine SQLite
lib/
  onnx.mjs           the ONLY native-dep file: model registry, loader (timing
                     + RSS), embed, cross-encoder rerank
  minhash.mjs        MinHash signatures + LSH banding + seeded perturbations
  lexrank.mjs        LexRank + compressNote (dream-input curation)
  activation.mjs     recency/relevance/frequency/structural scoring
  knn.mjs            kNN + centroid (Rocchio) classifiers over embeddings
  stats.mjs          spearman / macro-F1 / PR-F1 / top-k overlap
  experiments.mjs    N0–N5 implementations
  renders.mjs        receipt renderers — NULL-SAFETY CONTRACT (see test)
  renders.test.mjs   pins the null-safety contract (no install needed)
fixtures/            captured from the live engine (notes incl. terminal kind,
                     runs, dreams, memory tiers); merged at load time with
                     ../local-llm/fixtures (the earlier engine generation,
                     which carries the failed-run notes)
results/             run outputs (gitignored) + curated REPORT.md (committed)
package.json         ISOLATED deps — the repo stays native-addon-free; this
                     bench owns its node_modules + committed package-lock
```

## The experiments

| # | Hypothesis | What it does | Key metrics |
|---|---|---|---|
| N0 | H9 runtime gate | load 3 ONNX models, embed/rerank a real note ×10 | loadOk, p50/p90, RSS delta, Bun-vs-Node ratio — **keyless, the CI lane** |
| N1 | H10 embedding triage | LOO kNN/centroid over bge-small vs engine GT (kind, outcome); remote TRIAGE as baseline row | acc/macro-F1, failed-recall, cascade coverage/accuracy |
| N2 | H11 dedup | seeded near-dup corpus (perturbations + remote paraphrases + negatives); MinHash vs cosine vs two-stage | pair-F1 at swept thresholds, ms/doc, est-MAE, per-class recall |
| N3 | H12 reranking | cross-encoder vs remote 0–10 consolidation scores on the dream queue | Spearman ρ, top-5 overlap, ms/pair, CE-vs-biencoder |
| N4 | H13 activation | Park/Hou score vs remote importance ratings; component ablation | Spearman per component, top-5 overlap, zero-LLM cost |
| N5 | H14 curation | AutoDream replay: full vs LexRank-compressed notes (both on the remote model); blind judge | prompt-token reduction, judge win/tie, structural checks |

## Running it

```bash
cd benchmarks/nonllm
npm install                 # once: transformers.js + onnxruntime-node prebuilts

node runner.mjs probe       # N0 — keyless (CI lane), also: bun runner.mjs probe
node runner.mjs fixtures    # refresh fixtures from the live engine (stack up)

# N1–N5 need the bridge reachable (bun run agent:start) for remote baselines:
node runner.mjs n1-triage
node runner.mjs n2-dedup
node runner.mjs n3-rerank
node runner.mjs n4-activation
node runner.mjs n5-dream
node runner.mjs all
```

Env: `TEST_BRIDGE_URL` (default `http://127.0.0.1:3031`),
`TEST_REMOTE_MODEL` (default `kimi-k2.5`), `TEST_JUDGE_MODEL`. Unit tests
(no install): `node --test lib/renders.test.mjs`.

## Method notes (why you can trust the numbers)

- **Engine ground truth, not model-vs-model circularity.** N1 scores against
  the engine's own note rows (`notes.kind`) and run statuses (`runs.status`),
  with the remote model measured on the same axis — its own noise is visible.
- **Real fixtures, two generations.** The live engine export (kind-diverse:
  benchmark + terminal notes) merged with the earlier generation that carries
  the 4 genuinely-failed runs the current DB lost on re-provision.
- **Byte-faithful prompts.** Triage and dream replays reuse
  `../local-llm/lib/prompts.mjs` — the exact production assemblies, with
  sync comments to the engine sources.
- **Blind judging.** N5 uses the local-llm judge (anonymized A/B, positions
  swapped, only consistency-gated verdicts counted; flips = ties).
- **Honest near-dup corpora.** N2's "hard" duplicates are *remote-model
  paraphrases* (same facts, different wording), not just cheap edits; every
  threshold is swept and reported, not cherry-picked.
- **Null-safe receipts.** Every render survives absent lanes (`--no-remote`,
  failed loads) — pinned by unit tests after this exact class cost local-llm
  a red CI run (39123722085).
- **Cross-platform.** N0 runs in CI on ubuntu/macos/windows
  (`.github/workflows/nonllm-probe.yml`) and locally under BOTH Bun and Node;
  onnxruntime-node prebuilds cover linux-x64/arm64, darwin-x64/arm64, win-x64.

## Verdicts

Verdicts live in `hypotheses.json` (status + verdict + evidence) and are
curated into `results/REPORT.md` after each campaign. **No change to Unown
itself is gated on anything less than H9 (runtime gate) verifying on all
three CI OSes plus local Bun/Node**, and H15 integration only proceeds on
H10–H14 evidence.
