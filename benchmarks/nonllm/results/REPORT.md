# nonllm testbench — campaign report #1

**Date:** 2026-10-18 · **Bench:** `benchmarks/nonllm` (H9–H15 registry) ·
**Host:** linux-x64, 2 vCPU / 4GB · **Remote baseline:** kimi-k2.5 via llm-bridge
(Dashscope) · **Corpus:** 85 real session notes (two engine generations: 65
benchmark + 20 terminal; outcomes 61 passed / 4 failed), 6 memory tiers, 12
dreams — all captured read-only from the live engine.

The question this campaign answers: **how much of Unown's learning layer can
run on fully-local, non-LLM components — and is it worth it?** Executive
answer up front: the retrieval/triage/dedup/ranking seams all verify, at
marginal cost ≈ 0 and 15–40 ms latencies; recency is actively harmful for
dream-input ranking; wholesale extractive compression trades quality for
tokens while activation-ranked hybrid curation wins on both.

## Verdict table

| Hyp | Claim | Verdict | Key numbers |
|---|---|---|---|
| H9 | ONNX encoders run everywhere Unown runs (Bun + Node, 3-OS CI) | **VERIFIED** | bge-small p50: linux 13–15 ms, win 28 ms, mac-arm 39 ms; rerank 1–2 ms/pair everywhere; RSS peak ≤ 363 MB; Bun:Node ratio 1.0 |
| H10 | Local embedding kNN triage ≥ remote quality at ~0 cost | **VERIFIED** | kind acc: bge 94.1% / MiniLM 97.6% vs remote 91.8% (macro-F1 .910/.966 vs .894); outcome acc bge 98.5%, **failed-recall 1.00**; p50 16 ms vs remote 1318 ms (82×), $0 |
| H11 | MinHash-LSH dedup at µs cost; embeddings confirm the hard cases | **VERIFIED** | structural near-dups: 100% recall @ 0.18 ms/doc (estMAE 0.020); paraphrases: MinHash 25% vs cosine 100% (avg cos 0.974); union lane F1 0.962 |
| H12 | 23M cross-encoder reranks retrieval like the remote at ~ms/pair | **VERIFIED** | task-relevance: Spearman ρ 0.559, **top-5 overlap 1.00** vs remote, 15 ms/pair; bi-encoder ablation ρ 0.588/top-5 1.00 — cosine suffices at pool ≤ 20, CE is the bigger-pool tool |
| H13 | Park/Hou activation scoring ≈ remote importance, zero LLM | **VERIFIED** | ρ 0.567 (full) / 0.486 (no-recency); top-5 overlap 0.43; 40 notes scored in ~1 s embedding + 3 ms math; **recency-only ρ −0.106…−0.203 (harmful)** |
| H14 | LexRank dream-input curation: ≥35% token cut, no material quality loss | **PARTIALLY VERIFIED** | compress-all: 33.2–34.9% cut, judge leans full (dropped technical detail); **hybrid (N4-ranked head full + tail compressed): 19.9% cut, judge leans CURATED** (coverage 4.5 vs 4.0, structure 5 vs 4) |
| H15 | Integration = pre-processors around unchanged LLM calls | **DESIGN VALIDATED** (by N5-hybrid end-to-end; no Unown code changed yet) | hybrid lane = dedup + activation ranking + tail compression, all local |

Raw receipts: `results/<run>/` (gitignored); the CI probe artifacts (3 OSes)
for run **39142263790** carry the per-platform N0 JSONs.

## N0 — runtime gate (H9): GREEN everywhere

| platform / runtime | bge-small p50 | MiniLM p50 | rerank p50/pair | RSS peak |
|---|---|---|---|---|
| linux-x64 · node 24.21 (local) | 15 ms | 7 ms | 2 ms | 291 MB |
| linux-x64 · bun 1.3.14 (local) | 15 ms | 14 ms | 2 ms | 363 MB |
| linux-x64 · node 22 (CI) | 13 ms | 9 ms | 1 ms | ~190 MB |
| darwin-arm64 · node 22 (CI) | 39 ms | 19 ms | 1 ms | ~166 MB |
| win32-x64 · node 22 (CI) | 28 ms | 16 ms | 2 ms | ~138 MB |

All H9 thresholds pass with 6–16× headroom (embed p50 ≤ 250 ms, rerank ≤
25 ms/pair, RSS Δ ≤ 400 MB). transformers.js 4.3.1 + onnxruntime-node 1.30.0
prebuilds loaded on every combo; Bun 1.3.14 runs the native backend at Node
parity (the bun#18079 class of regression is gone). Cold loads (weights
downloaded) 3.5–5.3 s; warm loads 0.4–2.2 s.

**Engineering note (found + fixed during this campaign):** ms-marco-MiniLM in
transformers.js is a SINGLE-LOGIT classifier — the `text-classification`
pipeline softmaxes the 1-element logit vector and returns LABEL_0 = 1.0 for
*everything* (verified: pizza-vs-query scores 1.0 through the pipeline, while
the raw logit is −11.19). The bench now runs the tokenizer + model directly
and sigmoids the raw logit. Anyone reranking with this model in JS hits this.

## N1 — embedding triage (H10): local beats remote on kind, matches on outcome

Ground truth = the engine's own rows (`notes.kind`, `runs.status`), so the
remote model is measured, not defining truth. LOO kNN (k=5, cosine):

| lane | kind acc | kind macro-F1 | outcome acc | failed-recall | p50/note |
|---|---|---|---|---|---|
| bge-small kNN | 0.941 | 0.910 | **0.985** | **1.00** | 16 ms |
| MiniLM kNN | **0.976** | **0.966** | 0.938 | 0.25 | 10 ms |
| remote kimi-k2.5 (TRIAGE prompt) | 0.918 | 0.894 | 1.000 | 1.00 | 1318 ms |

Both local lanes beat the remote on kind (the remote drifts to "other" on
template-heavy notes). bge-small is the all-round lane: it catches all 4
failed-run notes (the minority class that matters most for dream input) —
MiniLM misses 3 of 4. Cascade margin 0.15: 100% coverage at 0.941 (bge) /
99% at 0.988 (MiniLM) — a deferral cascade would be essentially free.
Cost: $0 vs ~$0.01 per 85-note sweep (remote).

## N2 — near-dup detection (H11): zero-model tier + embedding tier are complementary

Seeded corpus: 14 base notes → deterministic perturbations (drop-sentence,
shuffle, append-noise, drop-line) + 8 **remote-model paraphrases** (the hard
case) + 28 true negatives → 66 labeled pairs.

| lane | best F1 | ms/doc | notes |
|---|---|---|---|
| MinHash-128 (est ≥ 0.40) | 0.877 | **0.18** | 100% recall on ALL structural classes; paraphrase recall 0.25 |
| bge cosine (≥ 0.85) | 0.962 | 23.6 | 100% paraphrase recall (avg cos 0.974) |
| union (minhash ≥ 0.5 OR cos ≥ 0.92) | **0.962** | 23.8 | the production shape |

estMAE of MinHash vs exact Jaccard: **0.020** (threshold ≤ 0.05). The LSH
"confirm" composition (LSH candidacy then cosine) measured **0.781** — a
negative result worth keeping: banding candidacy (~0.63 threshold) filters
out the paraphrases the second stage exists to catch. Union, not funnel.
Boundary observation: same-task-family re-run notes sit at cos 0.85–0.92 —
for dream input those ARE the duplicates worth collapsing (label noise, not
model error).

## N3 — retrieval reranking (H12): top-5 agreement 1.00 at 15 ms/pair

Query = a real benchmark task prompt; pool = 6 memory-tier sections + 14
recent notes (20 candidates).

| lane | Spearman ρ vs remote | top-5 overlap | p50 |
|---|---|---|---|
| ms-marco cross-encoder | 0.574 | **1.00** | 34 ms/pair amortized (mixed pool) · 10 ms/pair (uniform notes) |
| bge bi-encoder cosine | 0.554–0.588 | 1.00 | ~24 ms/doc |

Latency engineering receipt (three shapes, all measured): per-pair calls —
15 ms/pair linux but **30 ms/pair on darwin-arm64 CI** (tokenization + session
overhead per call); one padded batch — 90 ms/pair amortized on heterogeneous
docs (every pair pays the longest doc's padding); **length-sorted chunks of 8**
(the shipped shape) — 10 ms/pair uniform, 34 ms/pair mixed, amortizing
overhead without padding waste. Every remote scoring call it replaces: ~5.6 s.

Both local lanes reproduce the remote's ENTIRE top-5 injection set. The
bi-encoder ties the CE at this pool size (20 docs) — the CE's extra pairwise
precision is for larger pools/longer docs; at Unown's current scale, cosine
+ optional CE confirm is the economical shape.

**Negative control (kept honest):** against consolidation-VALUE judgments
(importance), the relevance-trained CE measures ρ **0.158** vs bi-encoder
0.436 — relevance ≠ importance; importance is N4's lane. Reranking is for
retrieval, activation scoring is for curation.

## N4 — activation scoring (H13): ρ 0.57, and recency is harmful here

Fully non-LLM score (0.995^h recency × embedding relevance-to-goal ×
log-frequency + structural heuristics) vs remote 1–10 importance ratings on
40 notes, two independent runs:

| component | run 1 ρ | run 2 ρ |
|---|---|---|
| full activation | **0.456** | **0.567** |
| no-recency variant | 0.486 | 0.486 |
| recency only | **−0.203** | **−0.106** |
| relevance only | 0.364 | 0.391 |
| frequency only | 0.381 | 0.325 |
| structural only | 0.290 | 0.452 |

The field's default (Park-2023 recency decay) is **anti-correlated** with
what the production model values: dream input curation prizes durable
failure lessons over fresh routine passes. The recommended Unown recipe
weights relevance + frequency + structure and drops recency to a tiebreaker.
Cost after embeddings: 3 ms for 40 notes (zero LLM calls).

## N5 — dream-input curation (H14): the hybrid is the win

AutoDream replayed (byte-faithful prompt, remote production model): full
notes vs compressed, blind position-swapped judge on the resulting NEXT
MEMORY.

| mode | prompt-token cut | judge outcome |
|---|---|---|
| compress-all (top-2 sentences, floor 0.35 / 0.20) | 33.2% / 34.9% | leans full — dropped technical detail (LRU pattern truncated, CSV line-endings lost) |
| **hybrid (N4-ranked: top-30% notes full, tail compressed)** | **19.9%** | **leans curated** — "eliminates redundant note references, tightens descriptions, removes duplicate CSV notes" (coverage 4.5 vs 4.0, structure 5 vs 4) |

All lanes structurally valid (JSON ok, sane length, injection scan clean).
Every judge verdict in every N5 run was position-inconsistent → tie by the
consistency gate; the lean directions above are from the judges' reasons and
criterion scores. Compress-all is a token-budget dial with a real quality
price; the activation-ranked hybrid is the shape that wins on both axes —
and it is exactly H15's proposed integration.

## What this means for Unown (no changes made yet — per the gate)

The verified, ready-to-integrate lanes (H15, all as pre-processors around
unchanged LLM calls, each behind its own env flag):

1. **PI_TRIAGE=knn** — bge-small kNN triage, margin-defer to the LLM (N1).
2. **PI_NOTE_DEDUP=union** — MinHash bucket at µs/doc + cosine confirm (N2).
3. **PI_MEMORY_RANK=activation** — no-recency activation scoring for dream
   input ordering and budget selection (N4); optional cross-encoder confirm
   for retrieval pools > 20 (N3).
4. **PI_DREAM_CURATE=hybrid** — top-30% full + LexRank tail (N5).

None of these replace an LLM call; they shrink/order/dedup the inputs. The
generative stays remote (or on the local-llm lane per H1–H8). Integration
proceeds only after a shadow-mode replay against the live engine, per the
registry guards.

## Open items

- ONNX-vs-GGUF embedding bake-off (llama.cpp `/v1/embeddings` vs in-process
  ONNX) — deferred; the in-process lane is already 15 ms/note with no
  server to manage, so the burden of proof is now on the GGUF lane.
- SetFit fine-tune on ~24 hand-labeled notes to push kind/outcome further
  (research says 8–16 labels/class is enough) — next campaign, if triage
  needs more than kNN gives.
- The "other" note kind has no exemplars in either corpus generation —
  production kNN must defer "other" to the LLM by design (margin guard).
